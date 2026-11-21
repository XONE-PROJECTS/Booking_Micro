import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { newId, presetDefinition } from '@universal-booking/core';
import { provisionTenant, services, tenants, users } from '@universal-booking/database';
import { createAppContext } from '../bootstrap';
import { publishService } from '../modules/catalog/services';
import { loadTenant, invalidateTenant } from '../modules/tenancy/tenant-cache';
import { findUserByEmail } from '../modules/identity/sessions';

const DEMO_SLUG = process.env.DEMO_TENANT_SLUG ?? 'demo-cafe';
const DEMO_NAME = process.env.DEMO_TENANT_NAME ?? 'Demo Cafe';
const OWNER_EMAIL = process.env.DEMO_OWNER_EMAIL ?? 'owner@demo.test';
const OWNER_PASSWORD = process.env.DEMO_OWNER_PASSWORD ?? 'ChangeMe123!';

const ctx = await createAppContext();
try {
  let tenantId: string | null = null;

  await ctx.db.system(async (sys) => {
    const [existing] = await sys.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO_SLUG));
    if (existing) {
      tenantId = existing.id;
      console.log(`Demo tenant "${DEMO_SLUG}" already exists`);
      return;
    }

    let owner = await findUserByEmail(sys, OWNER_EMAIL);
    if (!owner) {
      [owner] = await sys
        .insert(users)
        .values({
          email: OWNER_EMAIL,
          name: 'Demo Owner',
          passwordHash: await hash(OWNER_PASSWORD),
          emailVerifiedAt: new Date(),
          status: 'active',
        })
        .returning();
      console.log(`Created demo owner ${OWNER_EMAIL}`);
    }

    const result = await provisionTenant(sys, {
      slug: DEMO_SLUG,
      name: DEMO_NAME,
      ownerUserId: owner!.id,
    });
    tenantId = result.tenantId;
    invalidateTenant({ id: tenantId, slug: DEMO_SLUG });
    console.log(`Created demo tenant "${DEMO_SLUG}"`);
  });

  if (!tenantId) throw new Error('Demo tenant id missing');

  const tenant = await loadTenant(ctx, { slug: DEMO_SLUG });
  if (!tenant) throw new Error('Demo tenant could not be loaded');

  await ctx.db.tenant(tenant.id, async (tx) => {
    const [published] = await tx
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(eq(services.status, 'published'))
      .limit(1);
    if (published) {
      console.log(`Published service already present: ${published.name}`);
      return;
    }

    const serviceId = newId();
    const definition = presetDefinition('appointment');
    const pricing = { strategy: 'fixed', configuration: {} };
    const [row] = await tx
      .insert(services)
      .values({
        id: serviceId,
        tenantId: tenant.id,
        name: 'Counter service',
        slug: 'counter-service',
        status: 'draft',
        visibility: 'public',
        shortDescription: 'Sample bookable service for the demo cafe.',
        basePrice: '350',
        currency: tenant.currency,
        definition,
        pricing,
      })
      .returning();
    const publishedService = await publishService(ctx, tx, tenant, row!, null);
    console.log(`Published demo service "${publishedService.service.name}" (v${publishedService.version.version})`);
  });

  console.log(`Demo ready: http://localhost:3000/${DEMO_SLUG}`);
} finally {
  await ctx.db.close();
}
