import {
  addDays,
  intersectAll,
  mergeIntervals,
  subtractIntervals,
  toLocalDate,
  windowsForRange,
  type Interval,
} from '@universal-booking/core';
import type { AvailabilityContext, ClosedPeriod, ResourceInfo } from './types';

const appliesTo = (p: ClosedPeriod, resource: ResourceInfo | null) =>
  p.targetType === 'business' || p.targetType === 'service' || (resource !== null && p.targetId === resource.id);

/** Bookable windows for a resource (or the service itself) inside a range, after hours, exceptions and closures. */
export function openWindows(ctx: AvailabilityContext, resource: ResourceInfo | null, range: Interval): Interval[] {
  if (resource && resource.status !== 'active') return [];
  const tz = ctx.timezone;
  let windows: Interval[] = [range];

  if (ctx.definition.timeSelection !== 'none') {
    const from = toLocalDate(range.start, tz);
    const to = addDays(toLocalDate(range.end, tz), 1);
    if (ctx.businessHours.length) windows = intersectAll(windows, windowsForRange(ctx.businessHours, from, to, tz));
    if (ctx.serviceWindows.length) windows = intersectAll(windows, windowsForRange(ctx.serviceWindows, from, to, tz));
    if (resource?.schedule?.length) windows = intersectAll(windows, windowsForRange(resource.schedule, from, to, tz));
    if (resource?.breaks?.length) windows = subtractIntervals(windows, windowsForRange(resource.breaks, from, to, tz));
  }

  const relevant = ctx.periods.filter((p) => appliesTo(p, resource));
  const opens = relevant.filter((p) => p.kind === 'open').map((p) => p.interval);
  if (opens.length) windows = mergeIntervals([...windows, ...intersectAll(opens, [range])]);
  const closed = relevant.filter((p) => p.kind === 'closed').map((p) => p.interval);
  return subtractIntervals(windows, closed);
}
