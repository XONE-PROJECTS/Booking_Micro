import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bookings, customers, paymentTransactions, services } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';

const reportQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

const kinds = ['bookings', 'revenue', 'services', 'occupancy', 'utilization', 'cancellations', 'customers', 'payments', 'trends'] as const;

function csvRow(cols: (string | number | null | undefined)[]): string {
  return cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

export function registerReportRoutes(route: RouteBuilder) {
  for (const kind of kinds) {
    route({
      method: 'get',
      path: `/reports/${kind}`,
      summary: `Report: ${kind}`,
      tags: ['Reports'],
      auth: 'user',
      permission: 'reports.read',
      query: reportQuery,
      async handler({ tx, tenant, query }) {
        const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(0);
        const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date('2099-12-31T23:59:59.999Z');
        return tx(async (t) => {
          if (kind === 'bookings') {
            const rows = await t
              .select({
                reference: bookings.reference,
                status: bookings.status,
                startAt: bookings.startAt,
                total: bookings.total,
                paymentStatus: bookings.paymentStatus,
              })
              .from(bookings)
              .where(and(eq(bookings.tenantId, tenant.id), gte(bookings.startAt, from), lte(bookings.startAt, to)));
            if (query.format === 'csv') {
              const lines = [
                'reference,status,startAt,total,paymentStatus',
                ...rows.map((r) => csvRow([r.reference, r.status, r.startAt.toISOString(), r.total, r.paymentStatus])),
              ];
              return { csv: lines.join('\n'), mime: 'text/csv' };
            }
            return { rows, count: rows.length };
          }
          if (kind === 'revenue') {
            const [agg] = await t
              .select({
                bookings: sql<number>`count(*)::int`,
                gross: sql<string>`coalesce(sum(${bookings.total}::numeric), 0)::text`,
                paid: sql<string>`coalesce(sum(${bookings.amountPaid}::numeric), 0)::text`,
              })
              .from(bookings)
              .where(
                and(
                  eq(bookings.tenantId, tenant.id),
                  gte(bookings.startAt, from),
                  lte(bookings.startAt, to),
                  sql`${bookings.statusCategory} <> 'cancelled'`,
                ),
              );
            return agg;
          }
          if (kind === 'services') {
            const rows = await t
              .select({
                serviceId: bookings.serviceId,
                name: services.name,
                count: sql<number>`count(*)::int`,
                revenue: sql<string>`coalesce(sum(${bookings.total}::numeric), 0)::text`,
              })
              .from(bookings)
              .innerJoin(services, eq(services.id, bookings.serviceId))
              .where(and(eq(bookings.tenantId, tenant.id), gte(bookings.startAt, from), lte(bookings.startAt, to)))
              .groupBy(bookings.serviceId, services.name);
            return { rows };
          }
          if (kind === 'cancellations') {
            const rows = await t
              .select({
                reference: bookings.reference,
                cancelledAt: bookings.cancelledAt,
                reason: bookings.cancellationReason,
                total: bookings.total,
              })
              .from(bookings)
              .where(
                and(
                  eq(bookings.tenantId, tenant.id),
                  sql`${bookings.cancelledAt} is not null`,
                  gte(bookings.cancelledAt, from),
                  lte(bookings.cancelledAt, to),
                ),
              );
            return { rows, count: rows.length };
          }
          if (kind === 'customers') {
            const rows = await t
              .select({
                id: customers.id,
                firstName: customers.firstName,
                lastName: customers.lastName,
                email: customers.email,
                bookings: sql<number>`count(${bookings.id})::int`,
              })
              .from(customers)
              .leftJoin(bookings, and(eq(bookings.customerId, customers.id), gte(bookings.startAt, from), lte(bookings.startAt, to)))
              .where(eq(customers.tenantId, tenant.id))
              .groupBy(customers.id);
            return { rows };
          }
          if (kind === 'payments') {
            const rows = await t
              .select()
              .from(paymentTransactions)
              .where(
                and(
                  eq(paymentTransactions.tenantId, tenant.id),
                  gte(paymentTransactions.createdAt, from),
                  lte(paymentTransactions.createdAt, to),
                ),
              );
            return { rows, count: rows.length };
          }
          if (kind === 'trends') {
            const rows = await t.execute(sql`
              select date_trunc('day', start_at) as day, count(*)::int as bookings, coalesce(sum(total::numeric), 0)::text as revenue
              from bookings
              where tenant_id = ${tenant.id}::uuid and start_at >= ${from} and start_at <= ${to}
              group by 1 order by 1
            `);
            return { rows: (rows as { rows: unknown[] }).rows ?? rows };
          }
          if (kind === 'occupancy') {
            const result = await t.execute(sql`
              select
                coalesce(ba.resource_id, r.id) as "resourceId",
                coalesce(r.name, 'Unassigned capacity') as name,
                r.capacity,
                r.quantity,
                coalesce(sum(ba.quantity), 0)::int as allocated_units,
                count(distinct ba.booking_id)::int as booking_count,
                coalesce(sum(greatest(b.guest_count, 1)), 0)::int as guest_count
              from booking_allocations ba
              inner join bookings b
                on b.id = ba.booking_id
                and b.tenant_id = ba.tenant_id
                and b.status_category <> 'cancelled'
                and b.start_at >= ${from}
                and b.start_at <= ${to}
              left join resources r
                on r.id = ba.resource_id
                and r.tenant_id = ba.tenant_id
              where ba.tenant_id = ${tenant.id}::uuid
                and ba.status in ('held', 'active')
              group by coalesce(ba.resource_id, r.id), r.name, r.capacity, r.quantity
              order by name
            `);
            const rows = ((result as { rows?: unknown[] }).rows ?? result) as Record<string, unknown>[];
            const summary = await t
              .select({
                day: sql<string>`date_trunc('day', ${bookings.startAt})::text`,
                bookings: sql<number>`count(*)::int`,
                guests: sql<number>`coalesce(sum(${bookings.guestCount}), 0)::int`,
              })
              .from(bookings)
              .where(
                and(
                  eq(bookings.tenantId, tenant.id),
                  gte(bookings.startAt, from),
                  lte(bookings.startAt, to),
                  sql`${bookings.statusCategory} <> 'cancelled'`,
                ),
              )
              .groupBy(sql`date_trunc('day', ${bookings.startAt})`)
              .orderBy(sql`date_trunc('day', ${bookings.startAt})`);
            if (query.format === 'csv') {
              const lines = [
                'resourceId,name,capacity,quantity,allocated_units,booking_count,guest_count',
                ...rows.map((r) =>
                  csvRow([
                    r.resourceId as string,
                    r.name as string,
                    r.capacity as number | null,
                    r.quantity as number | null,
                    r.allocated_units as number,
                    r.booking_count as number,
                    r.guest_count as number,
                  ]),
                ),
              ];
              return { csv: lines.join('\n'), mime: 'text/csv' };
            }
            return { byResource: rows, byDay: summary };
          }
          if (kind === 'utilization') {
            const rangeSeconds = Math.max(1, (to.getTime() - from.getTime()) / 1000);
            const result = await t.execute(sql`
              select
                r.id as "resourceId",
                r.name,
                r.quantity,
                coalesce(
                  sum(
                    extract(epoch from (
                      least(upper(ba.blocked_period), ${to}::timestamptz)
                      - greatest(lower(ba.blocked_period), ${from}::timestamptz)
                    ))
                  ),
                  0
                )::numeric as blocked_seconds
              from resources r
              left join booking_allocations ba
                on ba.resource_id = r.id
                and ba.tenant_id = r.tenant_id
                and ba.status in ('held', 'active')
                and ba.blocked_period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[]')
              left join bookings b
                on b.id = ba.booking_id
                and b.status_category <> 'cancelled'
              where r.tenant_id = ${tenant.id}::uuid
                and r.status = 'active'
              group by r.id, r.name, r.quantity
              order by r.name
            `);
            const raw = ((result as { rows?: unknown[] }).rows ?? result) as {
              resourceId: string;
              name: string;
              quantity: number;
              blocked_seconds: string;
            }[];
            const rows = raw.map((r) => {
              const capacity = Math.max(1, r.quantity ?? 1);
              const blocked = Number(r.blocked_seconds);
              const available = rangeSeconds * capacity;
              const utilizationPercent = available > 0 ? Math.round((blocked / available) * 10000) / 100 : 0;
              return { ...r, rangeSeconds, availableSeconds: available, utilizationPercent };
            });
            if (query.format === 'csv') {
              const lines = [
                'resourceId,name,quantity,blocked_seconds,rangeSeconds,utilizationPercent',
                ...rows.map((r) => csvRow([r.resourceId, r.name, r.quantity, r.blocked_seconds, r.rangeSeconds, r.utilizationPercent])),
              ];
              return { csv: lines.join('\n'), mime: 'text/csv' };
            }
            return { rows, rangeSeconds };
          }
          return { kind, note: 'Unknown report kind.', from: query.from, to: query.to };
        });
      },
    });
  }
}
