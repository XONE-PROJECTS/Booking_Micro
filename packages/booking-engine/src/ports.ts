import type { AvailabilityContext } from '@universal-booking/availability-engine';
import type { PlannedAllocation } from '@universal-booking/resource-engine';

/**
 * Application-level ports. The booking engine depends only on these interfaces;
 * the API wires database, payment and notification adapters behind them.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface InventoryLockTarget {
  kind: 'resource' | 'service_capacity' | 'service_daily';
  id: string;
}

export interface ReservationStore {
  /** Locks inventory rows in a deterministic order inside the current transaction. */
  lockInventory(targets: InventoryLockTarget[]): Promise<void>;
  /** Loads schedules, closures, capacities and live allocations after locks are held. */
  loadAvailabilityContext(serviceId: string, window: { start: Date; end: Date }): Promise<AvailabilityContext>;
  /** Releases expired holds that would otherwise block the given resources. */
  releaseExpiredHolds(resourceIds: string[], now: Date): Promise<number>;
  insertAllocations(bookingId: string, itemId: string, allocations: PlannedAllocation[], hold: { id: string; expiresAt: Date } | null): Promise<void>;
}

export interface DomainEventPublisher {
  /** Writes to the transactional outbox; must run in the same transaction as the state change. */
  publish(event: { type: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }): Promise<void>;
}

/** Orders lock targets so concurrent transactions acquire them identically. */
export function orderLockTargets(targets: InventoryLockTarget[]): InventoryLockTarget[] {
  const seen = new Set<string>();
  return targets
    .filter((t) => {
      const key = `${t.kind}:${t.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
}
