import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { addDays, type WeeklyWindow } from '@universal-booking/core';
import type { AvailabilityContext, ClosedPeriod, ExistingAllocation, ResourceInfo, SessionRule } from '@universal-booking/availability-engine';
import {
  availabilityExceptions,
  availabilityRules,
  blackoutDates,
  bookingAllocations,
  capacityDefinitions,
  operatingHours,
  resources,
  resourceSchedules,
  serviceResources,
  staffProfiles,
  type Tx,
} from '@universal-booking/database';
import type { ServiceSnapshot } from '@universal-booking/database';
import { sql as rawSql } from 'drizzle-orm';

function weeklyFromRows(rows: { dayOfWeek: number; startTime: string; endTime: string }[]): WeeklyWindow[] {
  return rows.map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime }));
}

export async function loadAvailabilityContext(
  tx: Tx,
  input: {
    tenantId: string;
    timezone: string;
    now: Date;
    definition: ServiceSnapshot['definition'];
    serviceId: string;
    resourceIds: string[];
    window: { start: Date; end: Date };
  },
): Promise<AvailabilityContext> {
  const { tenantId, serviceId, resourceIds, window, now, timezone, definition } = input;

  let ids = resourceIds;
  if (!ids.length) {
    const links = await tx.select({ resourceId: serviceResources.resourceId }).from(serviceResources).where(eq(serviceResources.serviceId, serviceId));
    ids = links.map((l) => l.resourceId);
  }
  const staffRows = await tx
    .select({ resourceId: staffProfiles.resourceId })
    .from(staffProfiles)
    .where(and(eq(staffProfiles.tenantId, tenantId), sql`${staffProfiles.resourceId} is not null`));
  const staffResourceIds = staffRows.map((s) => s.resourceId!).filter((id) => !ids.includes(id));
  if (staffResourceIds.length && (definition.strategy === 'appointment' || definition.inventory === 'exclusive')) {
    ids = [...ids, ...staffResourceIds];
  }

  const resourceRows = ids.length
    ? await tx.select().from(resources).where(and(inArray(resources.id, ids), sql`${resources.deletedAt} is null`))
    : [];

  const schedules = ids.length
    ? await tx.select().from(resourceSchedules).where(inArray(resourceSchedules.resourceId, ids))
    : [];

  const resourcesOut: ResourceInfo[] = resourceRows.map((r) => {
    const work = schedules.filter((s) => s.resourceId === r.id && s.kind === 'work');
    const breaks = schedules.filter((s) => s.resourceId === r.id && s.kind === 'break');
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      capacity: r.capacity,
      quantity: r.quantity,
      schedule: work.length ? weeklyFromRows(work) : null,
      breaks: breaks.length ? weeklyFromRows(breaks) : undefined,
      sortOrder: r.sortOrder,
      attributes: r.metadata as Record<string, unknown>,
    };
  });

  const hours = await tx.select().from(operatingHours).where(eq(operatingHours.tenantId, tenantId));
  const businessHours: WeeklyWindow[] = hours.map((h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime }));

  const rules = await tx.select().from(availabilityRules).where(eq(availabilityRules.serviceId, serviceId));
  const serviceWindows: WeeklyWindow[] = rules.filter((r) => r.kind === 'window').map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime }));
  const sessions: SessionRule[] = rules
    .filter((r) => r.kind === 'session')
    .map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, capacity: r.capacity ?? undefined, resourceId: r.resourceId }));

  const exceptions = await tx
    .select()
    .from(availabilityExceptions)
    .where(and(sql`${availabilityExceptions.endsAt} > ${window.start}`, sql`${availabilityExceptions.startsAt} < ${window.end}`));

  const blackouts = await tx
    .select()
    .from(blackoutDates)
    .where(
      and(
        or(eq(blackoutDates.serviceId, serviceId), sql`${blackoutDates.serviceId} is null`),
        sql`${blackoutDates.endDate} >= ${addDays(window.start.toISOString().slice(0, 10), 0)}`,
      ),
    );

  const periods: ClosedPeriod[] = [
    ...exceptions.map((e) => ({
      targetType: e.targetType,
      targetId: e.targetId,
      interval: { start: e.startsAt, end: e.endsAt },
      kind: e.kind,
      reason: e.reason ?? undefined,
    })),
    ...blackouts.flatMap((b) => {
      const dates: ClosedPeriod[] = [];
      for (let d = b.startDate; d <= b.endDate; d = addDays(d, 1)) {
        const start = new Date(`${d}T00:00:00.000Z`);
        const end = new Date(`${addDays(d, 1)}T00:00:00.000Z`);
        dates.push({
          targetType: b.resourceId ? 'resource' : b.serviceId ? 'service' : 'business',
          targetId: b.resourceId ?? b.serviceId,
          interval: { start, end },
          kind: 'closed',
          reason: b.reason ?? undefined,
        });
      }
      return dates;
    }),
  ];

  const allocRows = await tx
    .select()
    .from(bookingAllocations)
    .where(
      and(
        inArray(bookingAllocations.status, ['held', 'active']),
        sql`${bookingAllocations.blockedPeriod} && tstzrange(${window.start.toISOString()}, ${window.end.toISOString()}, '[)')`,
        ids.length ? or(inArray(bookingAllocations.resourceId, ids), eq(bookingAllocations.serviceId, serviceId)) : eq(bookingAllocations.serviceId, serviceId),
      ),
    );

  const allocations: ExistingAllocation[] = allocRows.map((a) => ({
    resourceId: a.resourceId,
    period: a.period,
    blocked: a.blockedPeriod,
    quantity: a.quantity,
    exclusive: a.exclusive,
    bookingId: a.bookingId,
  }));

  const capacities = await tx.select().from(capacityDefinitions).where(eq(capacityDefinitions.serviceId, serviceId));
  const serviceCapacity = capacities.find((c) => c.resourceId === null)?.capacity ?? null;

  const dailyRows = (await tx.execute(rawSql`
    select to_char(b.start_at at time zone ${timezone}, 'YYYY-MM-DD') as d, count(*)::int as c
    from bookings b
    where b.tenant_id = ${tenantId}::uuid and b.service_id = ${serviceId}::uuid
      and b.status_category not in ('cancelled', 'draft')
      and b.start_at >= ${window.start} and b.start_at < ${window.end}
    group by 1
  `)) as { rows: { d: string; c: number }[] };

  const dailyBookedCounts = Object.fromEntries(dailyRows.rows.map((r) => [r.d, r.c]));

  return {
    timezone,
    now,
    definition,
    businessHours,
    serviceWindows,
    sessions,
    resources: resourcesOut,
    periods,
    allocations,
    capacities: capacities.map((c) => ({ resourceId: c.resourceId, capacity: c.capacity })),
    serviceCapacity,
    dailyBookedCounts,
  };
}
