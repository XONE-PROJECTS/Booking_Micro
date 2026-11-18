import { overlaps, type Interval } from '@universal-booking/core';
import type { AvailabilityContext, ExistingAllocation } from './types';

/** Highest number of units in use at any instant inside the interval (sweep line). */
export function peakUsage(allocations: ExistingAllocation[], resourceId: string | null, window: Interval): number {
  const events: Array<[number, number]> = [];
  for (const a of allocations) {
    if (a.resourceId !== resourceId || !overlaps(a.period, window)) continue;
    events.push([Math.max(a.period.start.getTime(), window.start.getTime()), a.quantity]);
    events.push([Math.min(a.period.end.getTime(), window.end.getTime()), -a.quantity]);
  }
  // Ends sort before starts at the same instant because intervals are half-open.
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > peak) peak = current;
  }
  return peak;
}

export function hasExclusiveConflict(allocations: ExistingAllocation[], resourceId: string, blocked: Interval): boolean {
  return allocations.some((a) => a.resourceId === resourceId && overlaps(a.blocked, blocked));
}

/** Total units available for a resource (or service-level pool) during an interval. */
export function capacityFor(ctx: AvailabilityContext, resourceId: string | null, window: Interval, sessionCapacity?: number): number {
  const inventory = ctx.definition.inventory;
  if (inventory === 'exclusive') return 1;
  if (sessionCapacity !== undefined) return sessionCapacity;

  const scoped = ctx.capacities.filter((c) => c.resourceId === resourceId);
  const periodic = scoped.filter((c) => c.interval && overlaps(c.interval, window));
  if (periodic.length) return Math.min(...periodic.map((c) => c.capacity));
  const flat = scoped.find((c) => !c.interval);
  if (flat) return flat.capacity;

  if (resourceId === null) return ctx.serviceCapacity ?? 0;
  const resource = ctx.resources.find((r) => r.id === resourceId);
  if (!resource) return 0;
  return inventory === 'pooled' ? resource.quantity : (resource.capacity ?? 0);
}
