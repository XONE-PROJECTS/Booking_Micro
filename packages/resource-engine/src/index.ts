import { errors, expand, type BookingDefinition, type Interval } from '@universal-booking/core';
import type { ExistingAllocation, ResourceOption } from '@universal-booking/availability-engine';

export interface PlannedAllocation {
  resourceId: string | null;
  period: Interval;
  blocked: Interval;
  quantity: number;
  exclusive: boolean;
  occurrence: number;
}

export interface SelectionInput {
  definition: BookingDefinition;
  options: ResourceOption[];
  /** Resources the customer or admin explicitly chose. */
  requestedResourceIds?: string[];
  needed: number;
  units: number;
  existingAllocations: ExistingAllocation[];
}

/** Sorted, de-duplicated ids so concurrent transactions always lock rows in the same order (avoids deadlocks). */
export function lockOrder(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === 'string'))].sort();
}

function bookedCount(allocations: ExistingAllocation[], resourceId: string): number {
  return allocations.filter((a) => a.resourceId === resourceId).length;
}

/**
 * Chooses which resources fulfil a booking. Deterministic for identical input so retries
 * produce identical plans. Returns resource ids, or [] when no specific resource is needed.
 */
export function selectResources(input: SelectionInput): Array<string | null> {
  const { definition: def, options } = input;
  const available = options.filter((o) => o.available);

  if (def.resources.mode === 'none') {
    const pool = available.find((o) => o.resourceId === null);
    if (!pool) throw errors.capacity();
    return [null];
  }

  if (input.requestedResourceIds?.length) {
    const chosen = input.requestedResourceIds.map((id) => available.find((o) => o.resourceId === id));
    if (chosen.some((o) => !o)) throw errors.unavailable('One or more selected resources are not available.');
    if (def.inventory === 'exclusive' && chosen.length < input.needed) {
      throw errors.validation(`Select ${input.needed} resources for this booking.`);
    }
    return chosen.map((o) => o!.resourceId);
  }

  if (def.resources.mode === 'optional') return [];

  let ranked = available.filter((o) => o.resourceId !== null);
  if (def.inventory !== 'exclusive') ranked = ranked.filter((o) => o.remainingCapacity >= input.units);
  if (def.resources.selection === 'least_booked' || def.resources.selection === 'round_robin') {
    ranked = [...ranked].sort(
      (a, b) =>
        bookedCount(input.existingAllocations, a.resourceId!) - bookedCount(input.existingAllocations, b.resourceId!) ||
        a.resourceId!.localeCompare(b.resourceId!),
    );
  }
  const count = def.inventory === 'exclusive' ? input.needed : Math.max(1, def.resources.mode === 'multiple' ? def.resources.count : 1);
  if (ranked.length < count) {
    throw def.inventory === 'exclusive' ? errors.unavailable() : errors.capacity();
  }
  return ranked.slice(0, count).map((o) => o.resourceId);
}

export function buildAllocations(def: BookingDefinition, periods: Interval[], resourceIds: Array<string | null>, units: number): PlannedAllocation[] {
  const out: PlannedAllocation[] = [];
  periods.forEach((period, occurrence) => {
    for (const resourceId of resourceIds) {
      out.push({
        resourceId,
        period,
        blocked: expand(period, def.buffers.beforeMinutes, def.buffers.afterMinutes),
        quantity: def.inventory === 'exclusive' ? 1 : units,
        exclusive: def.inventory === 'exclusive' && resourceId !== null,
        occurrence,
      });
    }
  });
  return out;
}
