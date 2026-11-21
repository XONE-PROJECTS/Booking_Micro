import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { lockOrder } from '@universal-booking/resource-engine';
import { bookingAllocations, bookings, type Tx } from '@universal-booking/database';

export async function releaseExpiredHolds(tx: Tx, tenantId: string, resourceIds: string[], now: Date) {
  if (!resourceIds.length) return;
  const expired = await tx
    .select({ bookingId: bookingAllocations.bookingId })
    .from(bookingAllocations)
    .where(and(eq(bookingAllocations.tenantId, tenantId), inArray(bookingAllocations.resourceId, resourceIds), eq(bookingAllocations.status, 'held'), isNotNull(bookingAllocations.expiresAt), lt(bookingAllocations.expiresAt, now)));
  const ids = [...new Set(expired.map((e) => e.bookingId))];
  if (!ids.length) return;
  await tx.update(bookingAllocations).set({ status: 'released', releasedAt: now }).where(inArray(bookingAllocations.bookingId, ids));
  await tx.update(bookings).set({ status: 'expired', statusCategory: 'cancelled' }).where(inArray(bookings.id, ids));
}

export async function lockInventory(tx: Tx, resourceIds: string[]) {
  const ids = lockOrder(resourceIds);
  if (ids.length) {
    await tx.execute(sql`select id from resources where id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) order by id for update`);
  }
}