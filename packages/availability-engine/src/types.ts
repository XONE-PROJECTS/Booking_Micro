import type { BookingDefinition, Interval, WeeklyWindow } from '@universal-booking/core';

export interface ResourceInfo {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'maintenance' | 'archived';
  /** Concurrent units for capacity inventory, or maximum party size when matching guest capacity. */
  capacity: number | null;
  /** Stock for pooled inventory. */
  quantity: number;
  /** Weekly working windows; null or empty means "follow business hours". */
  schedule: WeeklyWindow[] | null;
  /** Recurring breaks subtracted from the schedule. */
  breaks?: WeeklyWindow[];
  sortOrder: number;
  attributes?: Record<string, unknown>;
}

export interface ClosedPeriod {
  targetType: 'business' | 'service' | 'resource';
  targetId: string | null;
  interval: Interval;
  /** "open" adds special availability, "closed" removes it (blackouts, holidays, maintenance). */
  kind: 'closed' | 'open';
  reason?: string;
}

export interface ExistingAllocation {
  resourceId: string | null;
  period: Interval;
  /** Period including buffers. */
  blocked: Interval;
  quantity: number;
  exclusive: boolean;
  bookingId?: string;
}

export interface CapacityOverride {
  resourceId: string | null;
  capacity: number;
  /** When set, the override applies only to this interval (inventory periods). */
  interval?: Interval;
}

export interface SessionRule {
  dayOfWeek?: number;
  date?: string;
  startTime: string;
  endTime: string;
  capacity?: number;
  resourceId?: string | null;
}

export interface AvailabilityContext {
  timezone: string;
  now: Date;
  definition: BookingDefinition;
  businessHours: WeeklyWindow[];
  serviceWindows: WeeklyWindow[];
  sessions: SessionRule[];
  resources: ResourceInfo[];
  periods: ClosedPeriod[];
  allocations: ExistingAllocation[];
  capacities: CapacityOverride[];
  /** Capacity used when the service books without resources. */
  serviceCapacity?: number | null;
  /** Local date -> number of bookings already made for the service on that date. */
  dailyBookedCounts?: Record<string, number>;
}

export interface RecurrenceInput {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval?: number;
  count: number;
}

export interface AvailabilityRequest {
  startDate?: string;
  endDate?: string;
  startTime?: string;
  startAt?: string;
  durationMinutes?: number;
  quantity?: number;
  participants?: Record<string, number>;
  resourceIds?: string[];
  recurrence?: RecurrenceInput;
}

export interface DurationResult {
  periods: Interval[];
  units: {
    minutes: number;
    hours: number;
    days: number;
    nights: number;
    sessions: number;
  };
  /** Local dates of every night (accommodation) or day (rentals) covered, for per-date pricing. */
  dates: string[];
}

export interface CandidateResult {
  available: boolean;
  remaining: number;
  reason?: string;
}

export interface ResourceOption {
  resourceId: string | null;
  resourceName?: string;
  available: boolean;
  remainingCapacity: number;
  reasons: string[];
}

export interface RangeAvailability {
  available: boolean;
  duration: DurationResult;
  unitsRequested: number;
  options: ResourceOption[];
  reasons: string[];
}

export interface SlotResource {
  resourceId: string | null;
  remaining: number;
}

export interface Slot {
  start: string;
  end: string;
  localStart: string;
  localEnd: string;
  available: boolean;
  remaining: number;
  resources: SlotResource[];
}

export interface CalendarDay {
  date: string;
  available: boolean;
  remaining: number;
}
