import { resolveTxt } from 'node:dns/promises';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { errors, offsetOf, pageMeta } from '@universal-booking/core';
import { createOpaqueToken, hashPassword, passwordProblems } from '@universal-booking/auth';
import {
  bookingPolicies,
  businessProfiles,
  provisionTenant,
  tenantBranding,
  tenantDomains,
  tenants,
  tenantSettings,
  users,
  workflowDefinitions,
} from '@universal-booking/database';
import { brandingInput, businessProfileInput, createTenantInput, domainInput, idParam, pageQuery, tenantSettingsInput, updateTenantInput } from '@universal-booking/contracts';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { invalidateTenant, loadTenant } from './tenant-cache';
import { findUserByEmail } from '../identity/sessions';
import { invalidatePrincipals } from '../identity/principals';

export function registerTenancyRoutes(route: RouteBuilder) {
  // -------------------------------------------------------------------------
  // Platform administration (super admin)
  // -------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/platform/tenants',
    summary: 'List businesses on the platform',
    tags: ['Platform'],
    auth: 'user',
    tenant: 'none',
    platformAdmin: true,
    query: pageQuery,
    async handler({ app, query }) {
      return app.db.system(async (tx) => {
        const where = and(isNull(tenants.deletedAt), query.search ? or(ilike(tenants.name, `%${query.search}%`), ilike(tenants.slug, `%${query.search}%`)) : undefined);
        const [{ count }] = (await tx.select({ count: sql<number>`count(*)::int` }).from(tenants).where(where)) as [{ count: number }];
        const rows = await tx
          .select({
            id: tenants.id,
            slug: tenants.slug,
            name: tenants.name,
            status: tenants.status,
            createdAt: tenants.createdAt,
            timezone: tenantSettings.timezone,
            currency: tenantSettings.currency,
            bookings: sql<number>`(select count(*)::int from bookings b where b.tenant_id = ${tenants.id})`,
          })
          .from(tenants)
          .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
          .where(where)
          .orderBy(desc(tenants.createdAt))
          .limit(query.pageSize)
          .offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, count));
      });
    },
  });

  route({
    method: 'post',
    path: '/platform/tenants',
    summary: 'Create a business (tenant) with default roles, workflow and policy',
    tags: ['Platform'],
    auth: 'user',
    tenant: 'none',
    platformAdmin: true,
    body: createTenantInput,
    async handler({ app, body, identity, audit }) {
      if (app.env.APP_DEPLOYMENT_MODE !== 'multi-tenant') {
        const [existing] = await app.db.system((tx) => tx.select({ id: tenants.id }).from(tenants).where(isNull(tenants.deletedAt)).limit(1));
        if (existing) throw errors.conflict(`Only one business is allowed in ${app.env.APP_DEPLOYMENT_MODE} mode.`);
      }
      if (body.owner?.password) {
        const problems = passwordProblems(body.owner.password);
        if (problems.length) throw errors.validation('Owner password is too weak.', problems.map((message) => ({ path: 'owner.password', message })));
      }
      const result = await app.db.system(async (tx) => {
        const [taken] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.slug));
        if (taken) throw errors.conflict('That business URL is already taken.', [{ path: 'slug', message: 'Already in use' }]);
        let ownerUserId: string | undefined;
        if (body.owner) {
          const existing = await findUserByEmail(tx, body.owner.email);
          ownerUserId =
            existing?.id ??
            (await tx
              .insert(users)
              .values({ email: body.owner.email, name: body.owner.name, passwordHash: body.owner.password ? await hashPassword(body.owner.password) : null, status: body.owner.password ? 'active' : 'invited' })
              .returning({ id: users.id }))[0]!.id;
        }
        return provisionTenant(tx, { slug: body.slug, name: body.name, timezone: body.timezone, currency: body.currency, locale: body.locale, ownerUserId });
      });
      if (result.membershipId) invalidatePrincipals();
      await audit({ action: 'tenant.created', entityType: 'Tenant', entityId: result.tenantId, changes: { slug: body.slug, name: body.name, createdBy: identity.principalId } });
      return Reply.created({ id: result.tenantId, slug: body.slug, name: body.name });
    },
  });

  route({
    method: 'get',
    path: '/platform/tenants/:id',
    summary: 'Get a business',
    tags: ['Platform'],
    auth: 'user',
    tenant: 'none',
    platformAdmin: true,
    params: idParam,
    async handler({ app, params }) {
      const t = await loadTenant(app, { id: params.id });
      if (!t) throw errors.notFound('Business');
      return t;
    },
  });

  route({
    method: 'patch',
    path: '/platform/tenants/:id',
    summary: 'Rename, suspend, reactivate or archive a business',
    tags: ['Platform'],
    auth: 'user',
    tenant: 'none',
    platformAdmin: true,
    params: idParam,
    body: updateTenantInput,
    async handler({ app, params, body, audit }) {
      const [row] = await app.db.system((tx) =>
        tx
          .update(tenants)
          .set({ ...body, ...(body.status === 'archived' ? { deletedAt: new Date() } : body.status ? { deletedAt: null } : {}) })
          .where(eq(tenants.id, params.id))
          .returning(),
      );
      if (!row) throw errors.notFound('Business');
      invalidateTenant(row);
      await audit({ action: 'tenant.updated', entityType: 'Tenant', entityId: row.id, changes: body });
      return row;
    },
  });

  // -------------------------------------------------------------------------
  // Business profile, settings, branding (tenant scoped)
  // -------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/business',
    summary: 'Business profile, settings and branding',
    tags: ['Business'],
    auth: 'user',
    permission: 'business.read',
    async handler({ tx, tenant }) {
      return tx(async (t) => {
        const [profile] = await t.select().from(businessProfiles).where(eq(businessProfiles.tenantId, tenant.id));
        const [settings] = await t.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id));
        const [branding] = await t.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenant.id));
        return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status }, profile, settings, branding };
      });
    },
  });

  route({
    method: 'put',
    path: '/business/profile',
    summary: 'Update the business profile',
    tags: ['Business'],
    auth: 'user',
    permission: 'business.manage',
    body: businessProfileInput,
    async handler({ app, tx, tenant, body, audit }) {
      const row = await tx(async (t) => {
        const [r] = await t
          .insert(businessProfiles)
          .values({ tenantId: tenant.id, ...body, socialLinks: body.socialLinks ?? {} })
          .onConflictDoUpdate({ target: businessProfiles.tenantId, set: { ...body, updatedAt: new Date() } })
          .returning();
        await audit({ action: 'business.profile_updated', entityType: 'BusinessProfile', entityId: r!.id, changes: body }, t);
        return r;
      });
      if (body.displayName !== tenant.name) {
        await app.db.system((t) => t.update(tenants).set({ name: body.displayName }).where(eq(tenants.id, tenant.id)));
        invalidateTenant(tenant);
      }
      return row;
    },
  });

  route({
    method: 'patch',
    path: '/settings',
    summary: 'Update business settings (time zone, currency, holds, defaults)',
    tags: ['Business'],
    auth: 'user',
    permission: 'settings.manage',
    body: tenantSettingsInput,
    async handler({ tx, tenant, body, audit }) {
      const row = await tx(async (t) => {
        if (body.defaultWorkflowId) {
          const [w] = await t.select({ status: workflowDefinitions.status }).from(workflowDefinitions).where(eq(workflowDefinitions.id, body.defaultWorkflowId));
          if (!w || w.status !== 'published') throw errors.validation('The default workflow must be a published workflow.', [{ path: 'defaultWorkflowId', message: 'Not published' }]);
        }
        if (body.defaultPolicyId) {
          const [p] = await t.select({ status: bookingPolicies.status }).from(bookingPolicies).where(eq(bookingPolicies.id, body.defaultPolicyId));
          if (!p || p.status !== 'published') throw errors.validation('The default policy must be a published policy.', [{ path: 'defaultPolicyId', message: 'Not published' }]);
        }
        const [r] = await t
          .update(tenantSettings)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(tenantSettings.tenantId, tenant.id))
          .returning();
        await audit({ action: 'settings.updated', entityType: 'TenantSettings', entityId: tenant.id, changes: body }, t);
        return r;
      });
      invalidateTenant(tenant);
      return row;
    },
  });

  route({
    method: 'patch',
    path: '/branding',
    summary: 'Update branding and portal appearance',
    tags: ['Business'],
    auth: 'user',
    permission: 'branding.manage',
    body: brandingInput,
    async handler({ tx, tenant, body, audit }) {
      return tx(async (t) => {
        const [current] = await t.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenant.id));
        const portal = body.portal ? { ...(current?.portal ?? {}), ...body.portal } : undefined;
        const [r] = await t
          .update(tenantBranding)
          .set({ ...body, ...(portal ? { portal } : {}), updatedAt: new Date() })
          .where(eq(tenantBranding.tenantId, tenant.id))
          .returning();
        await audit({ action: 'branding.updated', entityType: 'TenantBranding', entityId: tenant.id, changes: body }, t);
        return r;
      });
    },
  });

  // -------------------------------------------------------------------------
  // Custom domains (verified with a DNS TXT record)
  // -------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/domains',
    summary: 'List custom domains',
    tags: ['Business'],
    auth: 'user',
    permission: 'settings.manage',
    async handler({ tx }) {
      const rows = await tx((t) => t.select().from(tenantDomains).orderBy(desc(tenantDomains.createdAt)));
      return rows.map((d) => ({ ...d, dnsRecord: { type: 'TXT', name: `_ub-verify.${d.domain}`, value: `ub-verify=${d.verificationToken}` } }));
    },
  });

  route({
    method: 'post',
    path: '/domains',
    summary: 'Add a custom domain for the booking portal',
    tags: ['Business'],
    auth: 'user',
    permission: 'settings.manage',
    body: domainInput,
    async handler({ tx, tenant, body, audit }) {
      return tx(async (t) => {
        const token = createOpaqueToken(16).token;
        const [row] = await t
          .insert(tenantDomains)
          .values({ tenantId: tenant.id, domain: body.domain.toLowerCase(), isPrimary: body.isPrimary, verificationToken: token })
          .returning();
        await audit({ action: 'domain.added', entityType: 'TenantDomain', entityId: row!.id, changes: { domain: body.domain } }, t);
        return Reply.created({ ...row, dnsRecord: { type: 'TXT', name: `_ub-verify.${row!.domain}`, value: `ub-verify=${token}` } });
      });
    },
  });

  route({
    method: 'post',
    path: '/domains/:id/verify',
    summary: 'Check the DNS TXT record and verify a custom domain',
    tags: ['Business'],
    auth: 'user',
    permission: 'settings.manage',
    params: idParam,
    status: 200,
    async handler({ tx, tenant, params }) {
      const [domain] = await tx((t) => t.select().from(tenantDomains).where(eq(tenantDomains.id, params.id)));
      if (!domain) throw errors.notFound('Domain');
      let records: string[] = [];
      try {
        records = (await resolveTxt(`_ub-verify.${domain.domain}`)).map((r) => r.join(''));
      } catch {
        records = [];
      }
      const ok = records.includes(`ub-verify=${domain.verificationToken}`);
      const [row] = await tx((t) =>
        t
          .update(tenantDomains)
          .set({ status: ok ? 'verified' : 'failed', verifiedAt: ok ? new Date() : null })
          .where(eq(tenantDomains.id, params.id))
          .returning(),
      );
      invalidateTenant(tenant);
      return { ...row, verified: ok, message: ok ? 'Domain verified.' : 'TXT record not found yet. DNS changes can take a while to propagate.' };
    },
  });

  route({
    method: 'delete',
    path: '/domains/:id',
    summary: 'Remove a custom domain',
    tags: ['Business'],
    auth: 'user',
    permission: 'settings.manage',
    params: idParam,
    status: 204,
    async handler({ tx, tenant, params, audit }) {
      await tx(async (t) => {
        const [row] = await t.delete(tenantDomains).where(eq(tenantDomains.id, params.id)).returning();
        if (!row) throw errors.notFound('Domain');
        await audit({ action: 'domain.removed', entityType: 'TenantDomain', entityId: row.id, changes: { domain: row.domain } }, t);
      });
      invalidateTenant(tenant);
      return Reply.noContent();
    },
  });

  // -------------------------------------------------------------------------
  // Public business information for portals and embeds
  // -------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/public/resolve',
    summary: 'Resolve a custom domain to a business slug',
    tags: ['Public'],
    auth: 'none',
    query: z.object({ domain: z.string().max(253) }),
    async handler({ app, query }) {
      const t = await loadTenant(app, { domain: query.domain });
      if (!t || t.status !== 'active') throw errors.notFound('Business');
      return { slug: t.slug, name: t.name };
    },
  });

  route({
    method: 'get',
    path: '/public/:businessSlug',
    summary: 'Public business profile and portal branding',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    async handler({ app, tenant }) {
      return app.db.tenant(tenant.id, async (t) => {
        const [profile] = await t.select().from(businessProfiles).where(eq(businessProfiles.tenantId, tenant.id));
        const [branding] = await t.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenant.id));
        return {
          slug: tenant.slug,
          name: tenant.name,
          timezone: tenant.timezone,
          currency: tenant.currency,
          locale: tenant.locale,
          guestBookingEnabled: tenant.guestBookingEnabled,
          profile: profile ? { displayName: profile.displayName, description: profile.description, email: profile.email, phone: profile.phone, website: profile.website, address: profile.address, socialLinks: profile.socialLinks } : null,
          branding: branding
            ? {
                logoUrl: branding.logoUrl,
                faviconUrl: branding.faviconUrl,
                primaryColor: branding.primaryColor,
                accentColor: branding.accentColor,
                backgroundColor: branding.backgroundColor,
                textColor: branding.textColor,
                fontFamily: branding.fontFamily,
                borderRadius: branding.borderRadius,
                whiteLabel: branding.whiteLabel,
                portal: branding.portal,
              }
            : null,
        };
      });
    },
  });
}
