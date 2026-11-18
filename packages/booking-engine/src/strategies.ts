import {
  bookingDefinitionSchema,
  errors,
  strategyPresets,
  type BookingDefinition,
  type BookingDefinitionInput,
  type ErrorDetail,
} from '@universal-booking/core';
import {
  resolveDuration,
  resourcesNeeded,
  searchAvailability,
  unitsPerResource,
  type AvailabilityContext,
  type AvailabilityRequest,
  type DurationResult,
  type RangeAvailability,
} from '@universal-booking/availability-engine';
import { buildAllocations, selectResources, type PlannedAllocation } from '@universal-booking/resource-engine';

export interface ValidationResult {
  valid: boolean;
  errors: ErrorDetail[];
}

export interface BookingStrategy {
  type: string;
  label: string;
  description: string;
  preset: BookingDefinitionInput;
  /** Parses and checks a definition; throws CONFIGURATION_INVALID with details when incompatible. */
  validateConfiguration(config: unknown): BookingDefinition;
  calculateDuration(definition: BookingDefinition, input: AvailabilityRequest, timezone: string): DurationResult;
  calculateAvailability(ctx: AvailabilityContext, input: AvailabilityRequest): Promise<RangeAvailability>;
  validateReservation(ctx: AvailabilityContext, input: AvailabilityRequest): Promise<ValidationResult>;
  buildAllocation(ctx: AvailabilityContext, input: AvailabilityRequest, availability: RangeAvailability): Promise<PlannedAllocation[]>;
}

/** Capability rules shared by every strategy, including custom ones. */
export function compatibilityErrors(def: BookingDefinition): ErrorDetail[] {
  const e: ErrorDetail[] = [];
  const add = (path: string, message: string) => e.push({ path, message });
  const { dateSelection: ds, timeSelection: ts, duration: d } = def;

  if (ds === 'range' && ts === 'slot') add('timeSelection', 'Date-range bookings use "none" or "duration" time selection, not slots.');
  if (ts === 'none' && ds === 'range' && (d.mode !== 'date_based' || !['nights', 'days'].includes(d.unit))) {
    add('duration', 'Date-range bookings without time selection need a date-based duration in nights or days.');
  }
  if (d.mode === 'date_based' && ts !== 'none') add('duration.mode', 'Date-based durations require time selection "none".');
  if (ts !== 'none' && d.mode === 'fixed' && !d.minutes) add('duration.minutes', 'Timed bookings with a fixed duration need duration.minutes.');
  if (ts !== 'none' && d.mode === 'customer' && d.min === undefined) add('duration.min', 'Customer-selected durations need a minimum.');
  if (d.min !== undefined && d.max !== undefined && d.min > d.max) add('duration', 'Minimum duration cannot exceed the maximum.');
  if ((def.inventory === 'exclusive' || def.inventory === 'pooled') && def.resources.mode === 'none') {
    add('resources.mode', `${def.inventory === 'exclusive' ? 'Exclusive' : 'Pooled'} inventory needs resources.`);
  }
  if (def.resources.mode === 'multiple' && def.resources.count < 2) add('resources.count', 'Multiple-resource bookings need a count of at least 2.');
  if (def.quantity.min > def.quantity.max) add('quantity', 'Minimum quantity cannot exceed the maximum.');
  if (def.resources.matchGuestCapacity && !def.guests.enabled) add('resources.matchGuestCapacity', 'Matching guest capacity requires guests to be enabled.');
  if (def.guests.enabled && def.guests.maxTotal !== undefined && def.guests.minTotal > def.guests.maxTotal) add('guests', 'Minimum guests cannot exceed the maximum.');
  def.guests.types.forEach((g, i) => {
    if (g.min > g.max) add(`guests.types.${i}`, `Guest type "${g.key}" has min greater than max.`);
  });
  if (ds === 'recurring' && !def.recurrence.enabled) add('recurrence.enabled', 'Recurring date selection requires recurrence to be enabled.');
  if (def.approval.mode === 'conditional' && !def.approval.condition) add('approval.condition', 'Conditional approval needs a condition.');
  return e;
}

export class GenericStrategy implements BookingStrategy {
  constructor(
    readonly type: string,
    readonly label: string,
    readonly description: string,
    readonly preset: BookingDefinitionInput,
    private readonly extraRules: (def: BookingDefinition) => ErrorDetail[] = () => [],
  ) {}

  validateConfiguration(config: unknown): BookingDefinition {
    const parsed = bookingDefinitionSchema.safeParse(config);
    if (!parsed.success) {
      throw errors.configuration(
        'The booking definition is invalid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const def = parsed.data;
    const problems = [...compatibilityErrors(def), ...this.extraRules(def)];
    if (def.strategy !== this.type) problems.push({ path: 'strategy', message: `Expected strategy "${this.type}".` });
    if (problems.length) throw errors.configuration('The booking definition has incompatible settings.', problems);
    return def;
  }

  calculateDuration(definition: BookingDefinition, input: AvailabilityRequest, timezone: string): DurationResult {
    return resolveDuration(definition, input, timezone);
  }

  async calculateAvailability(ctx: AvailabilityContext, input: AvailabilityRequest): Promise<RangeAvailability> {
    return searchAvailability(ctx, input);
  }

  async validateReservation(ctx: AvailabilityContext, input: AvailabilityRequest): Promise<ValidationResult> {
    const result = await this.calculateAvailability(ctx, input);
    return result.available
      ? { valid: true, errors: [] }
      : { valid: false, errors: result.reasons.map((r) => ({ code: r, message: describeReason(r) })) };
  }

  async buildAllocation(ctx: AvailabilityContext, input: AvailabilityRequest, availability: RangeAvailability): Promise<PlannedAllocation[]> {
    const def = ctx.definition;
    const resourceIds = selectResources({
      definition: def,
      options: availability.options,
      requestedResourceIds: input.resourceIds,
      needed: resourcesNeeded(def, input),
      units: unitsPerResource(def, input),
      existingAllocations: ctx.allocations,
    });
    return buildAllocations(def, availability.duration.periods, resourceIds, unitsPerResource(def, input));
  }
}

export function describeReason(code: string): string {
  switch (code) {
    case 'closed':
      return 'The selected time is outside opening hours or during a closure.';
    case 'conflict':
      return 'The selected resource is already booked for that time.';
    case 'capacity':
      return 'Not enough capacity remains for that time.';
    case 'lead_time':
      return 'This time is too soon to book.';
    case 'horizon':
      return 'This time is too far in advance to book.';
    case 'daily_capacity':
      return 'The daily booking limit has been reached for that date.';
    case 'no_resources':
      return 'No resources are available for this service.';
    default:
      return code;
  }
}

const rule = (cond: boolean, path: string, message: string): ErrorDetail[] => (cond ? [] : [{ path, message }]);

export const builtInBookingStrategies: BookingStrategy[] = [
  new GenericStrategy('appointment', 'Appointment', 'Time-slot bookings with staff or rooms (clinics, salons, consultants).', strategyPresets.appointment, (d) => [
    ...rule(d.timeSelection !== 'none', 'timeSelection', 'Appointments need slot or duration time selection.'),
    ...rule(d.dateSelection !== 'range', 'dateSelection', 'Appointments are booked on single or recurring dates.'),
  ]),
  new GenericStrategy('accommodation', 'Accommodation', 'Overnight stays with check-in and check-out dates (hotels, resorts).', strategyPresets.accommodation, (d) => [
    ...rule(d.dateSelection === 'range' && d.timeSelection === 'none', 'dateSelection', 'Accommodation uses date ranges without time selection.'),
    ...rule(d.duration.unit === 'nights', 'duration.unit', 'Accommodation is priced and booked per night.'),
    ...rule(d.inventory !== 'capacity', 'inventory', 'Accommodation uses exclusive or pooled room inventory.'),
  ]),
  new GenericStrategy('rental', 'Rental', 'Equipment, vehicle or facility rentals over a period.', strategyPresets.rental, (d) => [
    ...rule(d.dateSelection === 'range' || d.timeSelection === 'duration', 'dateSelection', 'Rentals need a date range or a customer-selected duration.'),
    ...rule(d.inventory !== 'capacity', 'inventory', 'Rentals use exclusive or pooled inventory.'),
  ]),
  new GenericStrategy('capacity', 'Capacity', 'Shared sessions limited by capacity (classes, tours, workshops).', strategyPresets.capacity, (d) => [
    ...rule(d.inventory === 'capacity', 'inventory', 'Capacity bookings use capacity inventory.'),
  ]),
  new GenericStrategy('event', 'Event', 'Scheduled events with tickets and participant limits.', strategyPresets.event, (d) => [
    ...rule(d.inventory === 'capacity', 'inventory', 'Events use capacity inventory.'),
    ...rule(d.timeSelection === 'slot', 'timeSelection', 'Events are booked into scheduled sessions.'),
  ]),
  new GenericStrategy('table', 'Table / Venue', 'Tables and venues matched to party size.', strategyPresets.table, (d) => [
    ...rule(d.timeSelection === 'slot', 'timeSelection', 'Table bookings use time slots.'),
    ...rule(d.inventory === 'exclusive', 'inventory', 'Tables are booked exclusively.'),
    ...rule(d.guests.enabled, 'guests.enabled', 'Table bookings need a party size.'),
  ]),
  new GenericStrategy('custom', 'Custom', 'Assembled from supported capabilities; no custom code.', strategyPresets.custom),
];

/**
 * Registry of booking strategies. Developers can register server-side plugins; administrators
 * can only compose the supported capabilities through the "custom" strategy.
 */
export class BookingStrategyRegistry {
  private readonly strategies = new Map<string, BookingStrategy>();

  constructor(initial: BookingStrategy[] = builtInBookingStrategies) {
    initial.forEach((s) => this.strategies.set(s.type, s));
  }

  register(plugin: BookingStrategy, options: { replace?: boolean } = {}): void {
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(plugin.type)) throw new Error(`Invalid strategy type "${plugin.type}"`);
    if (this.strategies.has(plugin.type) && !options.replace) throw new Error(`Strategy "${plugin.type}" is already registered`);
    this.strategies.set(plugin.type, plugin);
  }

  get(type: string): BookingStrategy {
    const s = this.strategies.get(type);
    if (!s) throw errors.configuration(`Unknown booking strategy "${type}".`);
    return s;
  }

  list(): BookingStrategy[] {
    return [...this.strategies.values()];
  }

  validate(config: unknown): BookingDefinition {
    const strategy = (config as { strategy?: unknown })?.strategy;
    if (typeof strategy !== 'string') throw errors.configuration('The booking definition needs a strategy.', [{ path: 'strategy', message: 'Required' }]);
    return this.get(strategy).validateConfiguration(config);
  }
}
