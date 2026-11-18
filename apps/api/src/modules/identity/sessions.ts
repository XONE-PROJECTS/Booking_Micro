import type { Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { errors, newId } from '@universal-booking/core';
import { createCsrfToken, createOpaqueToken, hashOpaqueToken } from '@universal-booking/auth';
import { membershipRoles, refreshTokens, roles, tenantMemberships, tenants, users, type Tx } from '@universal-booking/database';
import type { AppContext } from '../../context';
import { membershipAccess } from './principals';

export const REFRESH_COOKIE = 'ub_refresh';
export const CSRF_COOKIE = 'ub_csrf';

export interface SessionView {
  accessToken: string;
  expiresIn: number;
  csrfToken?: string;
  refreshToken?: string;
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenant: { id: string; slug: string; name: string } | null;
  memberships: { tenantId: string; slug: string; name: string; roles: string[] }[];
  permissions: string[];
  roles: string[];
}

export async function listMemberships(tx: Tx, userId: string) {
  const rows = await tx
    .select({ tenantId: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, roleKey: roles.key })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'active'), isNull(tenants.deletedAt)));
  const map = new Map<string, { tenantId: string; slug: string; name: string; roles: string[] }>();
  for (const r of rows) {
    if (r.status === 'archived') continue;
    const m = map.get(r.tenantId) ?? { tenantId: r.tenantId, slug: r.slug, name: r.name, roles: [] };
    m.roles.push(r.roleKey);
    map.set(r.tenantId, m);
  }
  return [...map.values()];
}

function cookieOptions(app: AppContext) {
  const secure = app.env.NODE_ENV === 'production' || app.env.APP_URL.startsWith('https://');
  return { secure, sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax', path: `${app.env.API_PREFIX}/auth` };
}

export function setSessionCookies(app: AppContext, res: Response, refreshToken: string, csrf: string) {
  const opts = cookieOptions(app);
  const maxAge = app.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  res.cookie(REFRESH_COOKIE, refreshToken, { ...opts, httpOnly: true, maxAge });
  res.cookie(CSRF_COOKIE, csrf, { ...opts, path: '/', httpOnly: false, maxAge });
}

export function clearSessionCookies(app: AppContext, res: Response) {
  const opts = cookieOptions(app);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, path: '/' });
}

/** Issues an access token plus a new refresh token in the given family (rotation). */
export async function issueSession(
  app: AppContext,
  tx: Tx,
  input: { userId: string; tenantId: string | null; familyId?: string; req: Request; replaces?: string },
): Promise<SessionView & { refreshToken: string; csrfToken: string }> {
  const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
  if (!user || user.status !== 'active') throw errors.unauthenticated('Account is not active.');
  const memberships = await listMemberships(tx, user.id);
  let tenantId = input.tenantId;
  if (tenantId && !memberships.some((m) => m.tenantId === tenantId) && !user.isPlatformAdmin) throw errors.forbidden('You are not a member of that business.');
  if (!tenantId && memberships.length && !user.isPlatformAdmin) tenantId = memberships[0]!.tenantId;

  const familyId = input.familyId ?? newId();
  const refresh = createOpaqueToken(48);
  const id = newId();
  await tx.insert(refreshTokens).values({
    id,
    userId: user.id,
    tenantScope: tenantId,
    familyId,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + app.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: input.req.get('user-agent')?.slice(0, 300),
    ip: input.req.ip,
  });
  if (input.replaces) await tx.update(refreshTokens).set({ revokedAt: new Date(), replacedById: id }).where(eq(refreshTokens.id, input.replaces));

  const accessToken = await app.tokens.sign({ sub: user.id, tid: tenantId, typ: 'access', sid: familyId }, app.env.ACCESS_TOKEN_TTL_SECONDS);
  const access = tenantId ? await membershipAccess(tx, user.id, tenantId) : null;
  const [tenantRow] = tenantId ? await tx.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)) : [];
  return {
    accessToken,
    expiresIn: app.env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.token,
    csrfToken: createCsrfToken(),
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
    tenant: tenantRow ?? null,
    memberships,
    permissions: access?.permissions ?? [],
    roles: [...(user.isPlatformAdmin ? ['super_admin'] : []), ...(access?.roles ?? [])],
  };
}

/** Rotates a refresh token. Presenting an already-rotated token revokes the whole family (theft detection). */
export async function rotateRefreshToken(app: AppContext, tx: Tx, token: string, req: Request, tenantId?: string) {
  const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashOpaqueToken(token)));
  if (!row) throw errors.unauthenticated('Session expired. Please sign in again.');
  if (row.revokedAt) {
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    throw errors.unauthenticated('Session expired. Please sign in again.');
  }
  if (row.expiresAt < new Date()) throw errors.unauthenticated('Session expired. Please sign in again.');
  return issueSession(app, tx, { userId: row.userId, tenantId: tenantId ?? row.tenantScope, familyId: row.familyId, req, replaces: row.id });
}

export async function revokeFamily(tx: Tx, familyId: string) {
  await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function findUserByEmail(tx: Tx, email: string) {
  const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return u;
}
