import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { eq, sql } from 'drizzle-orm';
import { newId, presetDefinition } from '@universal-booking/core';
import { defaultPolicy } from '@universal-booking/booking-engine';
import {
  bookingAllocations,
  bookings,
  createDatabase,
  isExclusionViolation,
  provisionTenant,
  resources,
  roles,
  runMigrations,
  services,
  serviceVersions,
  syncPermissions,
  type DatabaseClient,
} from '../src';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // optional
}
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let client: DatabaseClient;
let tenantA: string;
let tenantB: string;

async function makeBooking(tenantId: string, workflowId: string) {
  return client.tenant(tenantId, async (tx) => {
    const serviceId = newId();
    await tx.insert(services).values({ id: serviceId, tenantId, name: 'Room', slug: `room-${serviceId}`, definition: presetDefinition('accommodation') });
    const versionId = newId();
    await tx.insert(serviceVersions).values({
      id: versionId,
      tenantId,
      serviceId,
      version: 1,
      snapshot: { name: 'Room', currency: 'PHP', basePrice: '0', definition: presetDefinition('accommodation'), pricing: { strategy: 'fixed', configuration: {} }, formId: null, workflowId: null, policyId: null, resourceIds: [], options: [] },
    });
    const resourceId = newId();
    await tx.insert(resources).values({ id: resourceId, tenantId, name: '101' });
    const booking = async (ref: string) => {
      const id = newId();
      await tx.insert(bookings).values({
        id,
        tenantId,
        reference: ref,
        serviceId,
        serviceVersionId: versionId,
        workflowId,
        status: 'confirmed',
        statusCategory: 'active',
        source: 'api',
        startAt: new Date('2026-12-01T00:00:00Z'),
        endAt: new Date('2026-12-02T00:00:00Z'),
        timezone: 'UTC',
        currency: 'PHP',
        subtotal: '0',
        total: '0',
        pricingSnapshot: {} as never,
        policySnapshot: defaultPolicy,
      });
      return id;
    };
    return { serviceId, resourceId, b1: await booking(`R-${newId()}`), b2: await booking(`R-${newId()}`) };
  });
}

d('database guarantees', () => {
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await admin.end();
    await runMigrations(url!);
    client = createDatabase({ url: url!, rlsRole: 'booking_app', poolMax: 4 });
    await client.system(async (tx) => {
      await syncPermissions(tx);
      tenantA = (await provisionTenant(tx, { slug: 'tenant-a', name: 'A' })).tenantId;
      tenantB = (await provisionTenant(tx, { slug: 'tenant-b', name: 'B' })).tenantId;
    });
  });
  afterAll(async () => {
    await client?.close();
  });

  it('isolates tenants with row-level security', async () => {
    const visible = await client.tenant(tenantA, (tx) => tx.select({ tenantId: roles.tenantId }).from(roles));
    expect(visible.length).toBeGreaterThan(0);
    expect(new Set(visible.map((r) => r.tenantId))).toEqual(new Set([tenantA]));
    const crossRead = await client.tenant(tenantA, (tx) => tx.select().from(roles).where(eq(roles.tenantId, tenantB)));
    expect(crossRead).toHaveLength(0);
  });

  it('rejects writes into another tenant', async () => {
    await expect(client.tenant(tenantA, (tx) => tx.insert(resources).values({ tenantId: tenantB, name: 'sneaky' }))).rejects.toThrow();
  });

  it('sees nothing without a tenant context', async () => {
    const rows = await client.db.transaction(async (tx) => {
      await tx.execute(sql.raw('set local role booking_app'));
      return tx.select().from(roles);
    });
    expect(rows).toHaveLength(0);
  });

  it('prevents overlapping exclusive allocations but allows back-to-back stays', async () => {
    const wf = await client.tenant(tenantA, (tx) => tx.execute<{ id: string }>(sql`select id from workflow_definitions limit 1`));
    const { serviceId, resourceId, b1, b2 } = await makeBooking(tenantA, wf.rows[0]!.id);
    const range = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });
    const alloc = (bookingId: string, s: string, e: string) => ({
      tenantId: tenantA,
      bookingId,
      serviceId,
      resourceId,
      period: range(s, e),
      blockedPeriod: range(s, e),
      exclusive: true,
      status: 'active' as const,
    });
    await client.tenant(tenantA, (tx) => tx.insert(bookingAllocations).values(alloc(b1, '2026-12-01T00:00:00Z', '2026-12-04T00:00:00Z')));
    const err = await client.tenant(tenantA, (tx) => tx.insert(bookingAllocations).values(alloc(b2, '2026-12-03T00:00:00Z', '2026-12-05T00:00:00Z'))).catch((e) => e);
    expect(isExclusionViolation(err)).toBe(true);
    await expect(client.tenant(tenantA, (tx) => tx.insert(bookingAllocations).values(alloc(b2, '2026-12-04T00:00:00Z', '2026-12-06T00:00:00Z')))).resolves.toBeDefined();
    const [row] = await client.tenant(tenantA, (tx) => tx.select().from(bookingAllocations).where(eq(bookingAllocations.bookingId, b2)));
    expect(row!.period.start.toISOString()).toBe('2026-12-04T00:00:00.000Z');
  });

  it('lets only one of many concurrent overlapping inserts win', async () => {
    const wf = await client.tenant(tenantA, (tx) => tx.execute<{ id: string }>(sql`select id from workflow_definitions limit 1`));
    const { serviceId, resourceId, b1 } = await makeBooking(tenantA, wf.rows[0]!.id);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        client.tenant(tenantA, (tx) =>
          tx.insert(bookingAllocations).values({
            tenantId: tenantA,
            bookingId: b1,
            serviceId,
            resourceId,
            period: { start: new Date('2027-01-01T00:00:00Z'), end: new Date('2027-01-03T00:00:00Z') },
            blockedPeriod: { start: new Date('2027-01-01T00:00:00Z'), end: new Date('2027-01-03T00:00:00Z') },
            exclusive: true,
            status: 'held',
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
