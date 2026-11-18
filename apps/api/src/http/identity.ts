import type { RequestHandler } from 'express';
import { decodeJwt } from 'jose';
import { anonymousIdentity, isUuid } from '@universal-booking/core';
import type { AppContext } from '../context';
import { identityFromAccessToken, identityFromApiKey, identityFromExternal, identityFromIntegrationToken } from '../modules/identity/principals';
import { loadTenant } from '../modules/tenancy/tenant-cache';

/**
 * Resolves a trusted identity and tenant for every request. Tenant and user ids in headers are never trusted,
 * except X-Tenant-Id for platform administrators choosing which tenant to operate on.
 */
export function identityMiddleware(app: AppContext): RequestHandler {
  const issuer = app.env.JWT_ISSUER ?? 'universal-booking';
  return async (req, _res, next) => {
    const requestId = String(req.id ?? '');
    req.ctx = { requestId, identity: anonymousIdentity(), tenant: null, ip: req.ip, userAgent: req.get('user-agent') ?? undefined };

    const apiKey = req.get('x-api-key');
    const auth = req.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;

    if (apiKey) {
      const { identity, apiKeyId } = await identityFromApiKey(app, apiKey);
      req.ctx.identity = identity;
      req.ctx.apiKeyId = apiKeyId;
    } else if (bearer) {
      let iss: string | undefined;
      try {
        iss = decodeJwt(bearer).iss;
      } catch {
        iss = undefined;
      }
      if (iss === issuer || !app.oidc || app.env.AUTH_MODE === 'internal') {
        const claims = await app.tokens.verify(bearer);
        req.ctx.identity = claims.typ === 'integration' ? await identityFromIntegrationToken(app, claims) : await identityFromAccessToken(app, claims);
        req.ctx.sessionId = claims.sid;
      } else {
        const ext = await app.oidc.verify(bearer);
        const fallback = app.env.APP_DEPLOYMENT_MODE === 'multi-tenant' ? null : await loadTenant(app, { slug: app.env.DEFAULT_TENANT_SLUG });
        req.ctx.identity = await identityFromExternal(app, ext, fallback);
      }
    }

    const identity = req.ctx.identity;
    const adminTenant = req.get('x-tenant-id');
    if (identity.isPlatformAdmin && adminTenant && isUuid(adminTenant)) {
      req.ctx.tenant = await loadTenant(app, { id: adminTenant });
      if (req.ctx.tenant) req.ctx.identity = { ...identity, tenantId: req.ctx.tenant.id };
    } else if (identity.tenantId) {
      req.ctx.tenant = await loadTenant(app, { id: identity.tenantId });
    } else if (app.env.APP_DEPLOYMENT_MODE !== 'multi-tenant') {
      req.ctx.tenant = await loadTenant(app, { slug: app.env.DEFAULT_TENANT_SLUG });
    }
    next();
  };
}
