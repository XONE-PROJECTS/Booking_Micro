import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { bookings, customers, notificationLogs, services } from '@universal-booking/database';
import { newId } from '@universal-booking/core';
import type { AppContext } from '../context';

/** Enqueue reminder notifications for appointments starting within 24h and unpaid balances. */
export async function enqueueBookingReminders(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const in24h = new Date(now.getTime() + 24 * 60 * 60_000);
  let queued = 0;
  return ctx.db.system(async (t) => {
    const rows = await t
      .select({ booking: bookings, email: customers.email, serviceName: services.name })
      .from(bookings)
      .leftJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(services, eq(services.id, bookings.serviceId))
      .where(
        and(
          gte(bookings.startAt, now),
          lte(bookings.startAt, in24h),
          sql`${bookings.statusCategory} not in ('cancelled', 'completed')`,
        ),
      )
      .limit(100);
    for (const r of rows) {
      if (!r.email) continue;
      const exists = await ctx.db.tenant(r.booking.tenantId, (tx) =>
        tx
          .select({ id: notificationLogs.id })
          .from(notificationLogs)
          .where(and(eq(notificationLogs.bookingId, r.booking.id), eq(notificationLogs.templateKey, 'booking.reminder')))
          .limit(1),
      );
      if (exists.length) continue;
      await ctx.db.tenant(r.booking.tenantId, (tx) =>
        tx.insert(notificationLogs).values({
          id: newId(),
          tenantId: r.booking.tenantId,
          bookingId: r.booking.id,
          templateKey: 'booking.reminder',
          channel: 'email',
          recipient: r.email!,
          status: 'queued',
          attempts: 0,
        }),
      );
      queued++;
    }
    return queued;
  });
}