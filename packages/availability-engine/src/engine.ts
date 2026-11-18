import {
  addDays,
  addMinutes,
  capacityGuestTotal,
  coveredBy,
  dayOfWeek,
  eachDate,
  expand,
  guestTotal,
  isAppError,
  localDayInterval,
  toLocalDate,
  toLocalIso,
  zoned,
  type BookingDefinition,
  type Interval,
} from '@universal-booking/core';
import { capacityFor, hasExclusiveConflict, peakUsage } from './capacity';
import { resolveDuration, timedDurationMinutes } from './duration';
import { openWindows } from './windows';
import type {
  AvailabilityContext,
  AvailabilityRequest,
  CalendarDay,
  CandidateResult,
  RangeAvailability,
  ResourceInfo,
  ResourceOption,
  Slot,
} from './types';

/** Units each resource must supply for one booking. */
export function unitsPerResource(def: BookingDefinition, req: AvailabilityRequest): number {
  const quantity = Math.max(1, req.quantity ?? 1);
  if (def.inventory === 'exclusive') return 1;
  if (def.inventory === 'capacity') return def.guests.enabled ? Math.max(1, capacityGuestTotal(def, req.participants)) : quantity;
  return quantity;
}

/** Distinct resources one booking needs. */
export function resourcesNeeded(def: BookingDefinition, req: AvailabilityRequest): number {
  if (def.resources.mode === 'none' || def.resources.mode === 'optional') return 0;
  const perUnit = def.resources.mode === 'multiple' ? def.resources.count : 1;
  if (def.inventory === 'exclusive') return perUnit * Math.max(1, req.quantity ?? 1);
  return perUnit;
}

export function eligibleResources(ctx: AvailabilityContext, req: AvailabilityRequest): Array<ResourceInfo | null> {
  const def = ctx.definition;
  if (def.resources.mode === 'none') return [null];
  const party = guestTotal(def, req.participants);
  const filter = req.resourceIds?.length ? new Set(req.resourceIds) : null;
  const list = ctx.resources
    .filter((r) => r.status === 'active')
    .filter((r) => !filter || filter.has(r.id))
    .filter((r) => !def.resources.matchGuestCapacity || r.capacity === null || party <= r.capacity)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (!list.length && def.resources.mode === 'optional') return [null];
  return list;
}

export function checkLimits(ctx: AvailabilityContext, period: Interval): string | null {
  const def = ctx.definition;
  const lead = Math.max(def.limits.leadTimeMinutes, def.limits.cutoffMinutes ?? 0);
  const earliest = addMinutes(ctx.now, lead);
  if (def.timeSelection === 'none') {
    if (toLocalDate(period.start, ctx.timezone) < toLocalDate(earliest, ctx.timezone)) return 'lead_time';
  } else if (period.start < earliest) {
    return 'lead_time';
  }
  if (period.start.getTime() > ctx.now.getTime() + def.limits.horizonDays * 86_400_000) return 'horizon';
  if (def.limits.dailyCapacity !== undefined) {
    const booked = ctx.dailyBookedCounts?.[toLocalDate(period.start, ctx.timezone)] ?? 0;
    if (booked >= def.limits.dailyCapacity) return 'daily_capacity';
  }
  return null;
}

export function checkCandidate(
  ctx: AvailabilityContext,
  resource: ResourceInfo | null,
  period: Interval,
  units: number,
  sessionCapacity?: number,
): CandidateResult {
  const def = ctx.definition;
  const windows = openWindows(ctx, resource, period);
  if (!coveredBy(period, windows)) return { available: false, remaining: 0, reason: 'closed' };

  if (def.inventory === 'exclusive') {
    if (!resource) return { available: true, remaining: 1 };
    const blocked = expand(period, def.buffers.beforeMinutes, def.buffers.afterMinutes);
    const conflict = hasExclusiveConflict(ctx.allocations, resource.id, blocked);
    return conflict ? { available: false, remaining: 0, reason: 'conflict' } : { available: true, remaining: 1 };
  }

  const resourceId = resource?.id ?? null;
  const cap = capacityFor(ctx, resourceId, period, sessionCapacity);
  const used = peakUsage(ctx.allocations, resourceId, period);
  const remaining = Math.max(0, cap - used);
  return remaining >= units ? { available: true, remaining } : { available: false, remaining, reason: 'capacity' };
}

function evaluateOptions(ctx: AvailabilityContext, req: AvailabilityRequest, periods: Interval[], sessionCapacity?: number): {
  options: ResourceOption[];
  available: boolean;
  units: number;
  reasons: string[];
} {
  const def = ctx.definition;
  const units = unitsPerResource(def, req);
  const reasons = new Set<string>();
  for (const p of periods) {
    const r = checkLimits(ctx, p);
    if (r) reasons.add(r);
  }
  const options: ResourceOption[] = eligibleResources(ctx, req).map((resource) => {
    const optReasons: string[] = [];
    let remaining = Number.POSITIVE_INFINITY;
    for (const p of periods) {
      const c = checkCandidate(ctx, resource, p, units, sessionCapacity);
      remaining = Math.min(remaining, c.remaining);
      if (!c.available && c.reason) optReasons.push(c.reason);
    }
    return {
      resourceId: resource?.id ?? null,
      resourceName: resource?.name,
      available: optReasons.length === 0 && reasons.size === 0,
      remainingCapacity: Number.isFinite(remaining) ? remaining : 0,
      reasons: [...new Set(optReasons)],
    };
  });

  if (!options.length) reasons.add('no_resources');
  const needed = resourcesNeeded(def, req);
  const availableCount = options.filter((o) => o.available).length;
  let available: boolean;
  if (reasons.size) available = false;
  else if (def.inventory === 'exclusive' && needed > 0) available = availableCount >= needed;
  else available = availableCount > 0;
  if (!available && !reasons.size) reasons.add(def.inventory === 'exclusive' ? 'conflict' : 'capacity');
  return { options, available, units, reasons: [...reasons] };
}

/** Availability for a concrete request (date range, timed booking, or recurring series). */
export function searchAvailability(ctx: AvailabilityContext, req: AvailabilityRequest): RangeAvailability {
  const duration = resolveDuration(ctx.definition, req, ctx.timezone);
  const result = evaluateOptions(ctx, req, duration.periods);
  return { available: result.available, duration, unitsRequested: result.units, options: result.options, reasons: result.reasons };
}

interface Candidate {
  start: Date;
  end: Date;
  capacity?: number;
}

function sessionCandidates(ctx: AvailabilityContext, date: string): Candidate[] {
  const dow = dayOfWeek(date);
  return ctx.sessions
    .filter((s) => (s.date ? s.date === date : s.dayOfWeek === dow))
    .map((s) => {
      const start = zoned(date, s.startTime, ctx.timezone);
      let end = zoned(date, s.endTime, ctx.timezone);
      if (end <= start) end = zoned(addDays(date, 1), s.endTime, ctx.timezone);
      return { start, end, capacity: s.capacity };
    });
}

function steppedCandidates(ctx: AvailabilityContext, req: AvailabilityRequest, date: string, minutes: number): Candidate[] {
  const def = ctx.definition;
  const step = def.slotIntervalMinutes ?? (def.duration.mode === 'fixed' ? minutes : (def.duration.stepMinutes ?? 30));
  const day = localDayInterval(date, ctx.timezone);
  const seen = new Map<number, Candidate>();
  for (const resource of eligibleResources(ctx, req)) {
    for (const w of openWindows(ctx, resource, day)) {
      for (let t = w.start; addMinutes(t, minutes) <= w.end; t = addMinutes(t, step)) {
        if (!seen.has(t.getTime())) seen.set(t.getTime(), { start: t, end: addMinutes(t, minutes) });
      }
    }
  }
  return [...seen.values()];
}

/** Bookable start times on one local date for slot or duration based services. */
export function listSlots(ctx: AvailabilityContext, req: AvailabilityRequest & { date: string }): Slot[] {
  const def = ctx.definition;
  if (def.timeSelection === 'none') return [];
  const unitMinutes = def.duration.unit === 'hours' ? 60 : def.duration.unit === 'days' ? 1440 : 1;
  const defaultMinutes = def.duration.mode === 'fixed' ? undefined : (def.duration.min ?? 1) * unitMinutes;
  const minutes = ctx.sessions.length ? 0 : timedDurationMinutes(def, req.durationMinutes ?? defaultMinutes);
  const candidates = ctx.sessions.length ? sessionCandidates(ctx, req.date) : steppedCandidates(ctx, req, req.date, minutes);
  return candidates
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((c) => {
      const result = evaluateOptions(ctx, req, [{ start: c.start, end: c.end }], c.capacity);
      const availableOptions = result.options.filter((o) => o.available);
      const remaining =
        def.inventory === 'exclusive'
          ? availableOptions.length
          : availableOptions.reduce((m, o) => Math.max(m, o.remainingCapacity), 0);
      return {
        start: c.start.toISOString(),
        end: c.end.toISOString(),
        localStart: toLocalIso(c.start, ctx.timezone),
        localEnd: toLocalIso(c.end, ctx.timezone),
        available: result.available,
        remaining,
        resources: availableOptions.map((o) => ({ resourceId: o.resourceId, remaining: o.remainingCapacity })),
      };
    });
}

/** Per-date summary for date pickers. */
export function availabilityCalendar(
  ctx: AvailabilityContext,
  req: AvailabilityRequest & { from: string; to: string },
): CalendarDay[] {
  const def = ctx.definition;
  return eachDate(req.from, req.to).map((date) => {
    try {
      if (def.timeSelection !== 'none') {
        const slots = listSlots(ctx, { ...req, date });
        const open = slots.filter((s) => s.available);
        return { date, available: open.length > 0, remaining: open.length };
      }
      const span = def.duration.min ?? 1;
      const endDate = def.dateSelection === 'range' ? (def.duration.unit === 'nights' ? addDays(date, span) : addDays(date, span - 1)) : undefined;
      const result = searchAvailability(ctx, { ...req, startDate: date, endDate, recurrence: undefined });
      const remaining =
        def.inventory === 'exclusive'
          ? result.options.filter((o) => o.available).length
          : result.options.reduce((m, o) => Math.max(m, o.available ? o.remainingCapacity : 0), 0);
      return { date, available: result.available, remaining };
    } catch (e) {
      if (isAppError(e)) return { date, available: false, remaining: 0 };
      throw e;
    }
  });
}
