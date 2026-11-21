import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bookings, customers, paymentTransactions, services } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
              const lines = ['reference,status,startAt,total,paymentStatus', ...rows.map((r) => csvRow([r.reference, r.status, r.startAt.toISOString(), r.total, r.paymentStatus]))];
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
              .where(and(eq(bookings.tenantId, tenant.id), gte(bookings.startAt, from), lte(bookings.startAt, to), sql`${bookings.statusCategory} <> 'cancelled'`));
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
              .select({ reference: bookings.reference, cancelledAt: bookings.cancelledAt, reason: bookings.cancellationReason, total: bookings.total })
              .from(bookings)
              .where(and(eq(bookings.tenantId, tenant.id), sql`${bookings.cancelledAt} is not null`, gte(bookings.cancelledAt, from), lte(bookings.cancelledAt, to)));
            return { rows, count: rows.length };
          }
          if (kind === 'customers') {
            const rows = await t
              .select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName, email: customers.email, bookings: sql<number>`count(${bookings.id})::int` })
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
              .where(and(eq(paymentTransactions.tenantId, tenant.id), gte(paymentTransactions.createdAt, from), lte(paymentTransactions.createdAt, to)));
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
          return { kind, note: 'Aggregate metrics — extend with resource calendar data as needed.', from: query.from, to: query.to };
        });
      },
    });
  }
}