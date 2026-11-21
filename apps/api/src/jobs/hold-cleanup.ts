import { and, eq, inArray, lt } from 'drizzle-orm';
import { bookingAllocations, bookingHolds, bookings } from '@universal-booking/database';
import type { AppContext } from '../context';
import { emitEvent } from '../modules/events/outbox';

/** Expires stale inventory holds and marks bookings as `expired`. */
export async function cleanupExpiredHolds(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  return ctx.db.system(async (tx) => {
    const due = await tx
      .select({ id: bookingHolds.id, tenantId: bookingHolds.tenantId, bookingId: bookingHolds.bookingId })
      .from(bookingHolds)
      .where(and(eq(bookingHolds.status, 'active'), lt(bookingHolds.expiresAt, now)))
      .limit(200);
    if (!due.length) return 0;

    const bookingIds = due.map((h) => h.bookingId);
    const holdIds = due.map((h) => h.id);

    await tx
      .update(bookingAllocations)
      .set({ status: 'released', releasedAt: now, expiresAt: null })
      .where(and(inArray(bookingAllocations.bookingId, bookingIds), eq(bookingAllocations.status, 'held')));
    await tx
      .update(bookings)
      .set({ status: 'expired', statusCategory: 'cancelled', holdExpiresAt: null, updatedAt: now })
      .where(inArray(bookings.id, bookingIds));
    await tx
      .update(bookingHolds)
      .set({ status: 'expired', resolvedAt: now })
      .where(inArray(bookingHolds.id, holdIds));

    for (const h of due) {
      await emitEvent(tx, {
        tenantId: h.tenantId,
        type: 'booking.expired',
        aggregateType: 'booking',
        aggregateId: h.bookingId,
        payload: { reason: 'hold_expired' },
        notify: ['booking.expired'],
      });
    }

    ctx.log.info({ count: due.length }, 'hold.cleanup processed');
    return due.length;
  });
}