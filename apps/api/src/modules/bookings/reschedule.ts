import { eq } from 'drizzle-orm';
import { errors } from '@universal-booking/core';
import type { RescheduleInput } from '@universal-booking/contracts';
import { evaluateReschedule, type BookingPolicy } from '@universal-booking/booking-engine';
import { bookingAllocations, bookingItems, bookings, type Tx } from '@universal-booking/database';
import type { AppContext } from '../../context';
import { quoteForService } from '../pricing/load';
import { loadServiceVersion } from '../catalog/services';
import { releaseExpiredHolds, lockInventory } from './inventory';
import { emitEvent } from '../events/outbox';
import { isExclusionViolation } from '@universal-booking/database';

export async function rescheduleBooking(
  app: AppContext,
  tx: Tx,
  input: {
    tenantId: string;
    timezone: string;
    bookingId: string;
    body: RescheduleInput;
    actor: 'customer' | 'staff';
  },
) {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId));
  if (!row) throw errors.notFound('Booking');
  const policy = row.policySnapshot as BookingPolicy;
  const start = row.startAt;
  const check = evaluateReschedule(policy, {
    start,
    now: app.now(),
    rescheduleCount: row.rescheduleCount,
    actor: input.actor,
  });
  if (!check.allowed) throw errors.policy(check.reason ?? 'Reschedule is not allowed.');

  const { service, version } = await loadServiceVersion(tx, row.serviceId);
  const request = {
    serviceId: row.serviceId,
    startDate: input.body.startDate,
    endDate: input.body.endDate,
    startTime: input.body.startTime,
    startAt: input.body.startAt,
    durationMinutes: input.body.durationMinutes,
    quantity: row.quantity,
    participants: row.participants,
    resourceIds: input.body.resourceIds,
  };

  const { plan } = await quoteForService(app, tx, {
    tenantId: input.tenantId,
    timezone: input.timezone,
    snap: version.snapshot,
    serviceId: service.id,
    request,
    actor: input.actor,
  });
  if (!plan.availability.available) throw errors.unavailable();

  const newStart = plan.duration.periods[0]!.start;
  const newEnd = plan.duration.periods.at(-1)!.end;
  const resourceIds = plan.resourceIds;

  await releaseExpiredHolds(tx, input.tenantId, resourceIds, app.now());
  await lockInventory(tx, resourceIds);

  await tx.update(bookingAllocations).set({ status: 'released', releasedAt: app.now() }).where(eq(bookingAllocations.bookingId, row.id));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [item] = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, row.id));
      if (item) {
        await tx.update(bookingItems).set({ startAt: newStart, endAt: newEnd }).where(eq(bookingItems.id, item.id));
      }
      for (const alloc of plan.allocations) {
        await tx.insert(bookingAllocations).values({
          tenantId: input.tenantId,
          bookingId: row.id,
          bookingItemId: item?.id,
          serviceId: row.serviceId,
          resourceId: alloc.resourceId,
          period: alloc.period,
          blockedPeriod: alloc.blocked,
          quantity: alloc.quantity,
          exclusive: alloc.exclusive,
          status: 'active',
          occurrence: alloc.occurrence,
        });
      }
      const [updated] = (await tx
        .update(bookings)
        .set({
          startAt: newStart,
          endAt: newEnd,
          rescheduleCount: row.rescheduleCount + 1,
          updatedAt: app.now(),
        })
        .where(eq(bookings.id, row.id))
        .returning()) as (typeof bookings.$inferSelect)[];
      app.realtime.publish(input.tenantId, 'bookings', 'booking.rescheduled', { id: row.id, reference: row.reference });
      app.realtime.publish(input.tenantId, 'availability', 'availability.changed', { serviceId: row.serviceId });
      await emitEvent(tx, {
        tenantId: input.tenantId,
        type: 'booking.rescheduled',
        aggregateType: 'booking',
        aggregateId: row.id,
        payload: { reference: row.reference, reason: input.body.reason },
        notify: ['booking.rescheduled'],
      });
      return updated!;
    } catch (e) {
      if (attempt < 2 && isExclusionViolation(e)) continue;
      throw e;
    }
  }
  throw errors.unavailable();
}