import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { errors, newId } from '@universal-booking/core';
import { csrfMatches, hashPassword, passwordProblems, verifyPassword } from '@universal-booking/auth';
import { addMember, customers, externalIdentities, roles, users } from '@universal-booking/database';
import { authSession, changePasswordInput, loginInput, registerCustomerInput, switchTenantInput, tokenExchangeInput } from '@universal-booking/contracts';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { CSRF_COOKIE, REFRESH_COOKIE, clearSessionCookies, findUserByEmail, issueSession, listMemberships, revokeFamily, rotateRefreshToken, setSessionCookies, type SessionView } from './sessions';
import { invalidatePrincipals } from './principals';
import { loadTenant } from '../tenancy/tenant-cache';

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

function publicSession(s: SessionView & { refreshToken: string; csrfToken: string }, includeRefresh: boolean): SessionView {
  const { refreshToken, ...rest } = s;
  return includeRefresh ? { ...rest, refreshToken } : rest;
}

export function registerIdentityRoutes(route: RouteBuilder) {
  route({
    method: 'post',
    path: '/auth/login',
    summary: 'Sign in with email and password',
    tags: ['Auth'],
    auth: 'none',
    body: loginInput.extend({ tokenTransport: z.enum(['cookie', 'body']).default('cookie') }),
    response: authSession,
    status: 200,
    async handler({ app, body, req, res }) {
      const session = await app.db.system(async (tx) => {
        const user = await findUserByEmail(tx, body.email);
        if (user?.lockedUntil && user.lockedUntil > new Date()) throw errors.unauthenticated('Too many failed attempts. Try again later.');
        const ok = await verifyPassword(user?.passwordHash, body.password);
        if (!user || !ok || user.status !== 'active') {
          if (user) {
            const failed = user.failedLoginCount + 1;
            await tx
              .update(users)
              .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
              .where(eq(users.id, user.id));
          }
          throw errors.unauthenticated('Email or password is incorrect.');
        }
        await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
        const tenant = body.tenantSlug ? await loadTenant(app, { slug: body.tenantSlug }) : null;
        if (body.tenantSlug && !tenant) throw errors.unauthenticated('Email or password is incorrect.');
        return issueSession(app, tx, { userId: user.id, tenantId: tenant?.id ?? null, req });
      });
      if (body.tokenTransport === 'cookie') setSessionCookies(app, res, session.refreshToken, session.csrfToken);
      return new Reply(200, publicSession(session, body.tokenTransport === 'body'));
    },
  });

  route({
    method: 'post',
    path: '/auth/refresh',
    summary: 'Rotate the refresh token and get a new access token',
    tags: ['Auth'],
    auth: 'none',
    body: z.object({ refreshToken: z.string().max(200).optional(), tenantId: z.uuid().optional() }),
    response: authSession,
    status: 200,
    async handler({ app, body, req, res }) {
      const fromCookie = !body.refreshToken;
      const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
      if (!token) throw errors.unauthenticated('No session.');
      if (fromCookie && !csrfMatches(req.get('x-csrf-token'), req.cookies?.[CSRF_COOKIE])) throw errors.forbidden('Missing or invalid CSRF token.');
      const session = await app.db.system((tx) => rotateRefreshToken(app, tx, token, req, body.tenantId));
      if (fromCookie) setSessionCookies(app, res, session.refreshToken, session.csrfToken);
      return new Reply(200, publicSession(session, !fromCookie));
    },
  });

  route({
    method: 'post',
    path: '/auth/logout',
    summary: 'Sign out and revoke the session',
    tags: ['Auth'],
    auth: 'none',
    status: 204,
    async handler({ app, req, res }) {
      const familyId = req.ctx.sessionId;
      if (familyId) await app.db.system((tx) => revokeFamily(tx, familyId));
      clearSessionCookies(app, res);
      return Reply.noContent();
    },
  });

  route({
    method: 'get',
    path: '/auth/me',
    summary: 'Current session',
    tags: ['Auth'],
    auth: 'user',
    tenant: 'optional',
    async handler({ app, identity, req }) {
      if (identity.source !== 'internal' && identity.source !== 'external') {
        return { identity: { ...identity }, tenant: req.ctx.tenant };
      }
      return app.db.system(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, identity.principalId!));
        return {
          user: { id: user!.id, email: user!.email, name: user!.name, isPlatformAdmin: user!.isPlatformAdmin, phone: user!.phone, locale: user!.locale },
          tenant: req.ctx.tenant ? { id: req.ctx.tenant.id, slug: req.ctx.tenant.slug, name: req.ctx.tenant.name, timezone: req.ctx.tenant.timezone, currency: req.ctx.tenant.currency, locale: req.ctx.tenant.locale } : null,
          memberships: await listMemberships(tx, user!.id),
          permissions: identity.permissions,
          roles: identity.roles,
          customerId: identity.customerId ?? null,
        };
      });
    },
  });

  route({
    method: 'post',
    path: '/auth/switch-tenant',
    summary: 'Switch the active business for this session',
    tags: ['Auth'],
    auth: 'user',
    tenant: 'optional',
    body: switchTenantInput,
    response: authSession,
    status: 200,
    async handler({ app, body, identity, req, res }) {
      if (identity.source !== 'internal') throw errors.forbidden('Only internal sessions can switch business.');
      const familyId = req.ctx.sessionId!;
      const session = await app.db.system(async (tx) => {
        const s = await issueSession(app, tx, { userId: identity.principalId!, tenantId: body.tenantId, familyId, req });
        await revokeFamily(tx, familyId);
        return s;
      });
      setSessionCookies(app, res, session.refreshToken, session.csrfToken);
      return new Reply(200, publicSession(session, false));
    },
  });

  route({
    method: 'post',
    path: '/auth/change-password',
    summary: 'Change your password',
    tags: ['Auth'],
    auth: 'user',
    tenant: 'optional',
    body: changePasswordInput,
    status: 204,
    async handler({ app, body, identity }) {
      if (identity.source !== 'internal') throw errors.forbidden();
      const problems = passwordProblems(body.newPassword);
      if (problems.length) throw errors.validation('Password is too weak.', problems.map((message) => ({ path: 'newPassword', message })));
      await app.db.system(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, identity.principalId!));
        if (!(await verifyPassword(user?.passwordHash, body.currentPassword))) throw errors.validation('Current password is incorrect.', [{ path: 'currentPassword', message: 'Incorrect password' }]);
        await tx.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user!.id));
      });
      return Reply.noContent();
    },
  });

  // Customer accounts in the hosted portal.
  route({
    method: 'post',
    path: '/public/:businessSlug/auth/register',
    summary: 'Create a customer account for a business',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: registerCustomerInput,
    response: authSession,
    async handler({ app, body, tenant, req, res }) {
      const problems = passwordProblems(body.password);
      if (problems.length) throw errors.validation('Password is too weak.', problems.map((message) => ({ path: 'password', message })));
      const session = await app.db.system(async (tx) => {
        let user = await findUserByEmail(tx, body.email);
        if (user?.passwordHash) throw errors.conflict('An account with this email already exists. Sign in instead.');
        if (!user) {
          [user] = await tx
            .insert(users)
            .values({ email: body.email, name: `${body.firstName} ${body.lastName ?? ''}`.trim(), phone: body.phone, passwordHash: await hashPassword(body.password) })
            .returning();
        } else {
          await tx.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, user.id));
        }
        const [role] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenant.id), eq(roles.key, 'customer')));
        await addMember(tx, tenant.id, user!.id, role!.id);
        const [existing] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenant.id), sql`lower(${customers.email}) = ${body.email}`));
        if (existing) await tx.update(customers).set({ userId: user!.id, type: 'registered' }).where(eq(customers.id, existing.id));
        else await tx.insert(customers).values({ tenantId: tenant.id, userId: user!.id, type: 'registered', firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone });
        return issueSession(app, tx, { userId: user!.id, tenantId: tenant.id, req });
      });
      invalidatePrincipals(session.user.id);
      setSessionCookies(app, res, session.refreshToken, session.csrfToken);
      return Reply.created(publicSession(session, false));
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/auth/login',
    summary: 'Customer sign-in for a business portal',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: loginInput.omit({ tenantSlug: true }),
    response: authSession,
    status: 200,
    async handler({ app, body, tenant, req, res }) {
      const session = await app.db.system(async (tx) => {
        const user = await findUserByEmail(tx, body.email);
        if (user?.lockedUntil && user.lockedUntil > new Date()) throw errors.unauthenticated('Too many failed attempts. Try again later.');
        if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
          if (user) await tx.update(users).set({ failedLoginCount: user.failedLoginCount + 1, lockedUntil: user.failedLoginCount + 1 >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null }).where(eq(users.id, user.id));
          throw errors.unauthenticated('Email or password is incorrect.');
        }
        await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
        return issueSession(app, tx, { userId: user.id, tenantId: tenant.id, req });
      });
      setSessionCookies(app, res, session.refreshToken, session.csrfToken);
      return new Reply(200, publicSession(session, false));
    },
  });

  // Host-system token exchange (blueprint 4.4): a trusted backend with a secret API key mints a short-lived
  // booking token for one of its users, so the host keeps its own login.
  route({
    method: 'post',
    path: '/integration/tokens/exchange',
    summary: 'Exchange a host-system user for a short-lived booking token',
    tags: ['Integration'],
    auth: 'apiKey',
    permission: 'integrations.manage',
    body: tokenExchangeInput,
    status: 200,
    async handler({ app, body, tenant }) {
      const result = await app.db.tenant(tenant.id, async (tx) => {
        let [link] = await tx.select().from(externalIdentities).where(and(eq(externalIdentities.provider, body.provider), eq(externalIdentities.subject, body.subject)));
        let customerId = link?.customerId ?? null;
        if (body.scopes.includes('customer') && !customerId) {
          const [byEmail] = body.email ? await tx.select({ id: customers.id }).from(customers).where(sql`lower(${customers.email}) = ${body.email}`) : [];
          customerId =
            byEmail?.id ??
            (await tx
              .insert(customers)
              .values({ id: newId(), tenantId: tenant.id, type: 'registered', firstName: body.firstName ?? 'Customer', lastName: body.lastName, email: body.email, phone: body.phone })
              .returning({ id: customers.id }))[0]!.id;
        }
        if (!link) {
          [link] = await tx.insert(externalIdentities).values({ tenantId: tenant.id, provider: body.provider, subject: body.subject, customerId, email: body.email }).returning();
        } else if (customerId && link.customerId !== customerId) {
          await tx.update(externalIdentities).set({ customerId }).where(eq(externalIdentities.id, link.id));
        }
        await tx.update(externalIdentities).set({ lastSeenAt: new Date() }).where(eq(externalIdentities.id, link!.id));
        return { linkId: link!.id, customerId };
      });
      const ttl = Math.min(body.ttlSeconds ?? app.env.INTEGRATION_TOKEN_TTL_SECONDS, 3600);
      const token = await app.tokens.sign({ sub: result.linkId, tid: tenant.id, typ: 'integration', cid: result.customerId, scp: body.scopes, email: body.email }, ttl);
      return { token, tokenType: 'Bearer', expiresIn: ttl, customerId: result.customerId, scopes: body.scopes };
    },
  });
}
