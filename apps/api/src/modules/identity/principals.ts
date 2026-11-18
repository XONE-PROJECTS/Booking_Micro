import { and, eq, inArray, sql } from 'drizzle-orm';
import { anonymousIdentity, defaultRolePermissions, newId, permissionKeys, type IdentityContext, type PermissionKey } from '@universal-booking/core';
import { verifyApiKeySecret, parseApiKey, type AccessClaims, type ExternalIdentity } from '@universal-booking/auth';
import {
  addMember,
  apiKeys,
  customers,
  externalIdentities,
  membershipRoles,
  rolePermissions,
  roles,
  tenantMemberships,
  users,
  type Tx,
} from '@universal-booking/database';
import { errors } from '@universal-booking/core';
import type { AppContext, TenantInfo } from '../../context';
import { TtlCache } from '../../lib/cache';
import { loadTenant } from '../tenancy/tenant-cache';

const validPermissions = new Set<string>(permissionKeys);
const principalCache = new TtlCache<IdentityContext>(30_000);
const apiKeyTouch = new TtlCache<true>(60_000);

export function invalidatePrincipals(userId?: string): void {
  if (!userId) principalCache.clear();
  else principalCache.deleteWhere((k) => k.includes(userId));
}

export interface MembershipAccess {
  membershipId: string;
  roles: string[];
  permissions: PermissionKey[];
}

export async function membershipAccess(tx: Tx, userId: string, tenantId: string): Promise<MembershipAccess | null> {
  const rows = await tx
    .select({ membershipId: tenantMemberships.id, roleKey: roles.key, permission: rolePermissions.permissionKey })
    .from(tenantMemberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, tenantMemberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'active')));
  if (!rows.length) return null;
  return {
    membershipId: rows[0]!.membershipId,
    roles: [...new Set(rows.map((r) => r.roleKey))],
    permissions: [...new Set(rows.map((r) => r.permission).filter((p): p is PermissionKey => !!p && validPermissions.has(p)))],
  };
}

async function customerIdFor(tx: Tx, userId: string, tenantId: string): Promise<string | null> {
  const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.userId, userId), eq(customers.tenantId, tenantId)));
  return c?.id ?? null;
}

/** Identity for an internal access token. Membership and permissions are re-read (cached briefly) so revocations apply quickly. */
export async function identityFromAccessToken(app: AppContext, claims: AccessClaims): Promise<IdentityContext> {
  const key = `u:${claims.sub}:${claims.tid ?? '-'}`;
  const cached = principalCache.get(key);
  if (cached) return cached;
  const identity = await app.db.system(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, claims.sub));
    if (!user || user.status !== 'active') throw errors.unauthenticated('Account is not active.');
    const base: IdentityContext = {
      principalId: user.id,
      principalType: 'user',
      tenantId: null,
      roles: user.isPlatformAdmin ? ['super_admin'] : [],
      permissions: [],
      source: 'internal',
      isPlatformAdmin: user.isPlatformAdmin,
      email: user.email,
    };
    if (!claims.tid) return base;
    const access = await membershipAccess(tx, user.id, claims.tid);
    if (!access && !user.isPlatformAdmin) return base;
    const isCustomer = access?.roles.includes('customer') ?? false;
    return {
      ...base,
      tenantId: claims.tid,
      roles: [...base.roles, ...(access?.roles ?? [])],
      permissions: access?.permissions ?? [],
      principalType: isCustomer && access!.roles.length === 1 ? ('customer' as const) : ('user' as const),
      customerId: isCustomer ? await customerIdFor(tx, user.id, claims.tid) : null,
    };
  });
  principalCache.set(key, identity);
  return identity;
}

/** Integration tokens are minted by POST /integration/tokens/exchange for a host system's user. */
export async function identityFromIntegrationToken(app: AppContext, claims: AccessClaims): Promise<IdentityContext> {
  if (!claims.tid) throw errors.unauthenticated('Integration token has no tenant.');
  const scopes = claims.scp ?? ['customer'];
  let permissions: PermissionKey[] = [];
  if (scopes.includes('staff')) {
    const key = `staffperms:${claims.tid}`;
    const cached = principalCache.get(key);
    permissions =
      cached?.permissions ??
      (await app.db.tenant(claims.tid, async (tx) => {
        const rows = await tx
          .select({ p: rolePermissions.permissionKey })
          .from(rolePermissions)
          .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
          .where(eq(roles.key, 'staff'));
        return rows.map((r) => r.p as PermissionKey);
      }));
    if (!cached) principalCache.set(key, { ...anonymousIdentity(claims.tid), permissions });
  }
  if (scopes.includes('customer')) permissions = [...new Set([...permissions, 'customer.self' as const])];
  return {
    principalId: claims.sub,
    principalType: scopes.includes('staff') ? 'user' : 'customer',
    tenantId: claims.tid,
    roles: scopes,
    permissions,
    source: 'integration_token',
    isPlatformAdmin: false,
    customerId: claims.cid ?? null,
    email: claims.email ?? null,
  };
}

export async function identityFromApiKey(app: AppContext, raw: string): Promise<{ identity: IdentityContext; apiKeyId: string }> {
  const parsed = parseApiKey(raw);
  if (!parsed) throw errors.unauthenticated('Invalid API key.');
  const [key] = await app.db.system((tx) => tx.select().from(apiKeys).where(eq(apiKeys.prefix, parsed.prefix)));
  if (!key || !verifyApiKeySecret(parsed.secret, key.keyHash)) throw errors.unauthenticated('Invalid API key.');
  if (key.revokedAt) throw errors.unauthenticated('API key has been revoked.');
  if (key.expiresAt && key.expiresAt < app.now()) throw errors.unauthenticated('API key has expired.');
  if (!apiKeyTouch.get(key.id)) {
    apiKeyTouch.set(key.id, true);
    void app.db.system((tx) => tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id))).catch(() => undefined);
  }
  const permissions = key.kind === 'secret' ? key.scopes.filter((s): s is PermissionKey => validPermissions.has(s)) : [];
  return {
    apiKeyId: key.id,
    identity: {
      principalId: key.id,
      principalType: 'api_key',
      tenantId: key.tenantId,
      roles: [key.kind === 'secret' ? 'api_key' : 'publishable_key'],
      permissions,
      source: 'api_key',
      isPlatformAdmin: false,
    },
  };
}

/**
 * External identity provider tokens (AUTH_MODE external or hybrid). The signed tenant claim picks the tenant;
 * the account is linked through external_identities by provider and subject.
 */
export async function identityFromExternal(app: AppContext, ext: ExternalIdentity, fallbackTenant: TenantInfo | null): Promise<IdentityContext> {
  const key = `ext:${ext.provider}:${ext.subject}:${ext.tenant ?? fallbackTenant?.id ?? '-'}`;
  const cached = principalCache.get(key);
  if (cached) return cached;
  const tenant = ext.tenant ? await loadTenant(app, { slug: ext.tenant }) : fallbackTenant;
  if (!tenant) throw errors.unauthenticated('External token does not identify a known tenant.');

  const identity = await app.db.system(async (tx) => {
    let [link] = await tx
      .select()
      .from(externalIdentities)
      .where(and(eq(externalIdentities.tenantId, tenant.id), eq(externalIdentities.provider, ext.provider), eq(externalIdentities.subject, ext.subject)));
    let userId = link?.userId ?? null;
    if (!userId) {
      const email = ext.email ?? `${ext.subject}@${new URL(ext.provider).hostname}.external`;
      const [existing] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
      userId = existing?.id ?? (await tx.insert(users).values({ email, name: ext.name ?? email, status: 'active' }).returning({ id: users.id }))[0]!.id;
      if (link) await tx.update(externalIdentities).set({ userId }).where(eq(externalIdentities.id, link.id));
      else [link] = await tx.insert(externalIdentities).values({ tenantId: tenant.id, provider: ext.provider, subject: ext.subject, userId, email: ext.email, claims: ext.claims }).returning();
    }
    await tx.update(externalIdentities).set({ lastSeenAt: new Date(), claims: ext.claims }).where(eq(externalIdentities.id, link!.id));

    const wanted = ext.roles.filter((r) => r in defaultRolePermissions || /^[a-z][a-z0-9_]*$/.test(r));
    const roleRows = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), inArray(roles.key, wanted.length ? wanted : ['customer'])));
    for (const r of roleRows.length ? roleRows : []) await addMember(tx, tenant.id, userId, r.id);
    if (!roleRows.length) {
      const [customerRole] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenant.id), eq(roles.key, 'customer')));
      if (customerRole) await addMember(tx, tenant.id, userId, customerRole.id);
    }
    const access = await membershipAccess(tx, userId, tenant.id);
    const isCustomer = !!access && access.roles.every((r) => r === 'customer');
    let customerId: string | null = null;
    if (isCustomer) {
      customerId = await customerIdFor(tx, userId, tenant.id);
      if (!customerId) {
        customerId = newId();
        await tx.insert(customers).values({ id: customerId, tenantId: tenant.id, userId, type: 'registered', firstName: ext.name?.split(' ')[0] ?? 'Customer', lastName: ext.name?.split(' ').slice(1).join(' ') || null, email: ext.email });
      }
    }
    return {
      principalId: userId,
      principalType: isCustomer ? ('customer' as const) : ('user' as const),
      tenantId: tenant.id,
      roles: access?.roles ?? [],
      permissions: access?.permissions ?? [],
      source: 'external' as const,
      isPlatformAdmin: false,
      customerId,
      email: ext.email ?? null,
    };
  });
  principalCache.set(key, identity, 60_000);
  return identity;
}
