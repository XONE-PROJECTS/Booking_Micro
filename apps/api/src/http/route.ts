import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { and, eq, lt } from 'drizzle-orm';
import { AppError, errors, hasPermission, type IdentityContext, type PermissionKey } from '@universal-booking/core';
import { sha256 } from '@universal-booking/core/node';
import { idempotencyKeys, type Tx } from '@universal-booking/database';
import type { AuthRequirement, HttpMethod, RouteDoc } from '@universal-booking/contracts';
import type { AppContext, TenantInfo } from '../context';
import { Reply, sendReply } from './envelope';
import { toAppError } from './errors';
import { writeAudit, type AuditEntry } from '../modules/audit/audit';
import { loadTenant } from '../modules/tenancy/tenant-cache';

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

export interface HandlerContext<P, Q, B> {
  req: Request;
  res: Response;
  app: AppContext;
  identity: IdentityContext;
  /** Present when the route requires a tenant. */
  tenant: TenantInfo;
  params: P;
  query: Q;
  body: B;
  /** Runs fn in a transaction scoped to the request tenant (row-level security applies). */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  audit(entry: Omit<AuditEntry, 'tenantId'>, tx?: Tx): Promise<void>;
  require(permission: PermissionKey): void;
}

export interface RouteSpec<P extends z.ZodType | undefined, Q extends z.ZodType | undefined, B extends z.ZodType | undefined> {
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  auth: AuthRequirement;
  permission?: PermissionKey;
  /** Any of these permissions is enough. */
  anyPermission?: PermissionKey[];
  /** "required" (default for authenticated routes), "public" (resolved from :businessSlug) or "none". */
  tenant?: 'required' | 'public' | 'optional' | 'none';
  params?: P;
  query?: Q;
  body?: B;
  response?: z.ZodType;
  status?: number;
  idempotent?: boolean;
  description?: string;
  platformAdmin?: boolean;
  handler(c: HandlerContext<Infer<P>, Infer<Q>, Infer<B>>): Promise<unknown>;
}

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export function createRouteBuilder(app: AppContext, router: Router) {
  return function route<P extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined, B extends z.ZodType | undefined = undefined>(spec: RouteSpec<P, Q, B>): void {
    const doc: RouteDoc = {
      method: spec.method,
      path: spec.path,
      summary: spec.summary,
      tags: spec.tags,
      auth: spec.auth,
      permission: spec.permission ?? spec.anyPermission?.join(' or '),
      params: spec.params,
      query: spec.query,
      body: spec.body,
      response: spec.response,
      status: spec.status,
      idempotent: spec.idempotent,
      description: spec.description,
    };
    app.registry.add(doc);
    const tenantMode = spec.tenant ?? (spec.auth === 'none' ? 'none' : 'required');

    router[spec.method](spec.path, async (req: Request, res: Response) => {
      const identity = req.ctx.identity;
      if (spec.auth !== 'none' && identity.principalType === 'anonymous') throw errors.unauthenticated();
      if (spec.auth === 'apiKey' && identity.source !== 'api_key') throw errors.forbidden('This endpoint requires an API key.');
      if (spec.platformAdmin && !identity.isPlatformAdmin) throw errors.forbidden('Platform administrator access is required.');

      if (tenantMode === 'public') {
        const slug = String(req.params.businessSlug ?? '');
        const t = await loadTenant(app, { slug });
        if (!t || t.status === 'archived') throw errors.notFound('Business');
        if (t.status === 'suspended') throw new AppError('TENANT_SUSPENDED', 'This business is not accepting bookings right now.');
        if (identity.tenantId && identity.tenantId !== t.id && !identity.isPlatformAdmin) {
          // Credentials for another tenant must not act on this one; fall back to anonymous access.
          req.ctx.identity = { ...identity, permissions: [], roles: [], customerId: null, principalType: 'anonymous', principalId: null, tenantId: t.id };
        }
        req.ctx.tenant = t;
      }
      const tenant = req.ctx.tenant;
      if (tenantMode === 'required' || tenantMode === 'public') {
        if (!tenant) throw errors.forbidden('No business is selected for this request.');
        if (tenant.status === 'suspended' && !identity.isPlatformAdmin) throw new AppError('TENANT_SUSPENDED', 'This business is suspended.');
        if (tenantMode === 'required' && identity.tenantId !== tenant.id && !identity.isPlatformAdmin) throw errors.forbidden();
      }

      const effective = req.ctx.identity;
      if (spec.permission && !hasPermission(effective, spec.permission)) throw errors.forbidden();
      if (spec.anyPermission && !spec.anyPermission.some((p) => hasPermission(effective, p))) throw errors.forbidden();

      const params = (spec.params ? spec.params.parse(req.params) : undefined) as Infer<P>;
      const query = (spec.query ? spec.query.parse(req.query) : undefined) as Infer<Q>;
      const body = (spec.body ? spec.body.parse(req.body ?? {}) : undefined) as Infer<B>;

      const ctx: HandlerContext<Infer<P>, Infer<Q>, Infer<B>> = {
        req,
        res,
        app,
        identity: effective,
        tenant: tenant as TenantInfo,
        params,
        query,
        body,
        tx: (fn) => {
          if (!tenant) throw errors.forbidden('No business is selected for this request.');
          return app.db.tenant(tenant.id, fn);
        },
        audit: (entry, tx) =>
          writeAudit(app, { ...entry, tenantId: tenant?.id ?? null, actorType: entry.actorType ?? effective.principalType, actorId: entry.actorId ?? effective.principalId, requestId: req.ctx.requestId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined }, tx),
        require: (permission) => {
          if (!hasPermission(effective, permission)) throw errors.forbidden();
        },
      };

      if (spec.idempotent) {
        await runIdempotent(app, req, res, ctx, spec);
        return;
      }
      const result = await spec.handler(ctx);
      sendReply(res, result instanceof Reply ? result : new Reply(spec.status ?? (spec.method === 'post' ? 201 : 200), result ?? null));
    });
  };
}

/**
 * Idempotency-Key handling: the first request is executed and its response stored; retries with the same key
 * and body replay the stored response; a different body under the same key is rejected.
 */
async function runIdempotent<P, Q, B>(app: AppContext, req: Request, res: Response, ctx: HandlerContext<P, Q, B>, spec: RouteSpec<z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined>) {
  const key = req.get('idempotency-key');
  if (!key) throw errors.badRequest('The Idempotency-Key header is required for this request.');
  if (key.length > 200) throw errors.badRequest('Idempotency-Key is too long.');
  const tenantId = ctx.tenant.id;
  const scope = `${spec.method.toUpperCase()} ${spec.path}`;
  const principal = ctx.identity.principalId ?? `anon:${req.ip ?? 'unknown'}`;
  const requestHash = sha256(JSON.stringify({ params: req.params, body: req.body ?? null }));
  const now = app.now();

  const claim = await app.db.tenant(tenantId, async (tx) => {
    await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.principal, principal), lt(idempotencyKeys.expiresAt, now)));
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ tenantId, key, scope, principal, requestHash, lockedUntil: new Date(now.getTime() + 60_000), expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted[0]) return { fresh: true as const, id: inserted[0].id };
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.principal, principal)));
    return { fresh: false as const, existing };
  });

  if (!claim.fresh) {
    const ex = claim.existing!;
    if (ex.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different request.');
    if (ex.status === 'in_progress') throw new AppError('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed.');
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(ex.responseStatus ?? 200).json(ex.responseBody);
    return;
  }

  try {
    const result = await spec.handler(ctx as never);
    const reply = result instanceof Reply ? result : new Reply(spec.status ?? 201, result ?? null);
    const body = { success: true, data: reply.data, meta: { requestId: req.ctx.requestId, timestamp: new Date().toISOString(), ...reply.options.meta } };
    await app.db.tenant(tenantId, (tx) => tx.update(idempotencyKeys).set({ status: 'completed', responseStatus: reply.status, responseBody: body, lockedUntil: null }).where(eq(idempotencyKeys.id, claim.id)));
    res.status(reply.status).json(body);
  } catch (err) {
    const appError = toAppError(err);
    if (appError.status >= 500) {
      await app.db.tenant(tenantId, (tx) => tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, claim.id))).catch(() => undefined);
    } else {
      const body = { success: false, error: { code: appError.code, message: appError.message, details: appError.details.length ? appError.details : undefined }, meta: { requestId: req.ctx.requestId, timestamp: new Date().toISOString() } };
      await app.db.tenant(tenantId, (tx) => tx.update(idempotencyKeys).set({ status: 'completed', responseStatus: appError.status, responseBody: body, lockedUntil: null }).where(eq(idempotencyKeys.id, claim.id))).catch(() => undefined);
    }
    throw err;
  }
}

export type RouteBuilder = ReturnType<typeof createRouteBuilder>;
