import { eq, sql } from 'drizzle-orm';
import { tenantDomains, tenants, tenantSettings } from '@universal-booking/database';
import type { AppContext, TenantInfo } from '../../context';
import { TtlCache } from '../../lib/cache';

const cache = new TtlCache<TenantInfo | null>(30_000);

export async function loadTenant(app: AppContext, by: { id?: string; slug?: string; domain?: string }): Promise<TenantInfo | null> {
  const key = by.id ? `id:${by.id}` : by.slug ? `slug:${by.slug}` : `domain:${by.domain?.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const row = await app.db.system(async (tx) => {
    const base = tx
      .select({ tenant: tenants, settings: tenantSettings })
      .from(tenants)
      .innerJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id));
    if (by.id) return (await base.where(eq(tenants.id, by.id)))[0];
    if (by.slug) return (await base.where(eq(tenants.slug, by.slug)))[0];
    const [d] = await tx
      .select({ tenantId: tenantDomains.tenantId })
      .from(tenantDomains)
      .where(sql`lower(${tenantDomains.domain}) = ${by.domain!.toLowerCase()} and ${tenantDomains.status} = 'verified'`);
    if (!d) return undefined;
    return (await base.where(eq(tenants.id, d.tenantId)))[0];
  });

  const info: TenantInfo | null =
    row && !row.tenant.deletedAt
      ? {
          id: row.tenant.id,
          slug: row.tenant.slug,
          name: row.tenant.name,
          status: row.tenant.status,
          timezone: row.settings.timezone,
          currency: row.settings.currency,
          locale: row.settings.locale,
          holdMinutes: row.settings.holdMinutes,
          referencePrefix: row.settings.bookingReferencePrefix,
          guestBookingEnabled: row.settings.guestBookingEnabled,
          defaultWorkflowId: row.settings.defaultWorkflowId,
          defaultPolicyId: row.settings.defaultPolicyId,
        }
      : null;
  cache.set(key, info, info ? 30_000 : 5_000);
  return info;
}

export function invalidateTenant(tenant: { id: string; slug?: string }): void {
  cache.delete(`id:${tenant.id}`);
  if (tenant.slug) cache.delete(`slug:${tenant.slug}`);
  cache.deleteWhere((k) => k.startsWith('domain:'));
}
