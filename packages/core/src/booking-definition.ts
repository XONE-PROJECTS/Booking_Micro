import { z } from 'zod';
import { conditionSchema } from './conditions';

export const builtInStrategies = ['appointment', 'accommodation', 'rental', 'capacity', 'event', 'table', 'custom'] as const;
export type BuiltInStrategy = (typeof builtInStrategies)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const guestTypeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(60),
  min: z.number().int().min(0).default(0),
  max: z.number().int().min(0).default(20),
  countsTowardCapacity: z.boolean().default(true),
});

export const bookingDefinitionSchema = z.object({
  strategy: z.string().min(1).max(64),
  dateSelection: z.enum(['single', 'range', 'recurring']),
  timeSelection: z.enum(['slot', 'duration', 'none']),
  inventory: z.enum(['exclusive', 'pooled', 'capacity']),
  duration: z.object({
    mode: z.enum(['fixed', 'customer', 'date_based']),
    unit: z.enum(['minutes', 'hours', 'days', 'nights']).default('minutes'),
    /** Fixed length in minutes (fixed mode with minute/hour units). */
    minutes: z.number().int().min(5).max(60 * 24 * 31).optional(),
    /** Bounds in the selected unit for customer-selected or date-based durations. */
    min: z.number().int().min(1).optional(),
    max: z.number().int().min(1).optional(),
    /** Step in minutes for customer-selected durations. */
    stepMinutes: z.number().int().min(5).optional(),
  }),
  slotIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  checkInTime: hhmm.default('14:00'),
  checkOutTime: hhmm.default('12:00'),
  buffers: z.object({ beforeMinutes: z.number().int().min(0).max(1440).default(0), afterMinutes: z.number().int().min(0).max(1440).default(0) }).default({ beforeMinutes: 0, afterMinutes: 0 }),
  guests: z
    .object({
      enabled: z.boolean().default(false),
      types: z.array(guestTypeSchema).max(10).default([]),
      minTotal: z.number().int().min(0).default(0),
      maxTotal: z.number().int().min(1).optional(),
    })
    .default({ enabled: false, types: [], minTotal: 0 }),
  quantity: z.object({ min: z.number().int().min(1).default(1), max: z.number().int().min(1).default(1) }).default({ min: 1, max: 1 }),
  resources: z
    .object({
      mode: z.enum(['required', 'optional', 'multiple', 'none']),
      count: z.number().int().min(1).max(50).default(1),
      customerSelects: z.boolean().default(false),
      /** Only offer resources whose capacity fits the party size (tables, rooms). */
      matchGuestCapacity: z.boolean().default(false),
      selection: z.enum(['first_available', 'least_booked', 'round_robin']).default('first_available'),
    })
    .default({ mode: 'required', count: 1, customerSelects: false, matchGuestCapacity: false, selection: 'first_available' }),
  limits: z
    .object({
      leadTimeMinutes: z.number().int().min(0).default(0),
      horizonDays: z.number().int().min(1).max(3650).default(365),
      cutoffMinutes: z.number().int().min(0).optional(),
      dailyCapacity: z.number().int().min(1).optional(),
      perCustomer: z.object({ max: z.number().int().min(1), periodDays: z.number().int().min(1) }).optional(),
    })
    .default({ leadTimeMinutes: 0, horizonDays: 365 }),
  recurrence: z
    .object({
      enabled: z.boolean().default(false),
      frequencies: z.array(z.enum(['daily', 'weekly', 'monthly'])).default(['weekly']),
      maxOccurrences: z.number().int().min(2).max(104).default(12),
    })
    .default({ enabled: false, frequencies: ['weekly'], maxOccurrences: 12 }),
  approval: z
    .object({ mode: z.enum(['automatic', 'manual', 'conditional']).default('automatic'), condition: conditionSchema.optional() })
    .default({ mode: 'automatic' }),
  payment: z
    .object({ mode: z.enum(['none', 'deposit', 'full', 'pay_later']).default('pay_later') })
    .default({ mode: 'pay_later' }),
  hold: z.object({ minutes: z.number().int().min(1).max(1440).default(10) }).default({ minutes: 10 }),
  formId: z.uuid().nullable().optional(),
  workflowId: z.uuid().nullable().optional(),
  policyId: z.uuid().nullable().optional(),
  /** Free-form settings for developer-registered strategy plugins. */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type BookingDefinition = z.infer<typeof bookingDefinitionSchema>;
export type BookingDefinitionInput = z.input<typeof bookingDefinitionSchema>;

export function parseBookingDefinition(input: unknown): BookingDefinition {
  return bookingDefinitionSchema.parse(input);
}

const adultsChildren = [
  { key: 'adults', label: 'Adults', min: 1, max: 10, countsTowardCapacity: true },
  { key: 'children', label: 'Children', min: 0, max: 10, countsTowardCapacity: true },
];

export const strategyPresets: Record<BuiltInStrategy, BookingDefinitionInput> = {
  appointment: {
    strategy: 'appointment',
    dateSelection: 'single',
    timeSelection: 'slot',
    inventory: 'exclusive',
    duration: { mode: 'fixed', unit: 'minutes', minutes: 30 },
    resources: { mode: 'required', count: 1, customerSelects: true, matchGuestCapacity: false, selection: 'least_booked' },
    limits: { leadTimeMinutes: 60, horizonDays: 90 },
    payment: { mode: 'pay_later' },
  },
  accommodation: {
    strategy: 'accommodation',
    dateSelection: 'range',
    timeSelection: 'none',
    inventory: 'exclusive',
    duration: { mode: 'date_based', unit: 'nights', min: 1, max: 30 },
    checkInTime: '14:00',
    checkOutTime: '12:00',
    guests: { enabled: true, types: adultsChildren, minTotal: 1, maxTotal: 6 },
    quantity: { min: 1, max: 5 },
    resources: { mode: 'required', count: 1, customerSelects: false, matchGuestCapacity: true, selection: 'first_available' },
    limits: { leadTimeMinutes: 0, horizonDays: 365 },
    payment: { mode: 'deposit' },
  },
  rental: {
    strategy: 'rental',
    dateSelection: 'range',
    timeSelection: 'none',
    inventory: 'pooled',
    duration: { mode: 'date_based', unit: 'days', min: 1, max: 30 },
    quantity: { min: 1, max: 10 },
    resources: { mode: 'required', count: 1, customerSelects: false, matchGuestCapacity: false, selection: 'first_available' },
    payment: { mode: 'full' },
  },
  capacity: {
    strategy: 'capacity',
    dateSelection: 'single',
    timeSelection: 'slot',
    inventory: 'capacity',
    duration: { mode: 'fixed', unit: 'minutes', minutes: 60 },
    guests: { enabled: true, types: [{ key: 'participants', label: 'Participants', min: 1, max: 20, countsTowardCapacity: true }], minTotal: 1 },
    resources: { mode: 'none', count: 1, customerSelects: false, matchGuestCapacity: false, selection: 'first_available' },
    payment: { mode: 'pay_later' },
  },
  event: {
    strategy: 'event',
    dateSelection: 'single',
    timeSelection: 'slot',
    inventory: 'capacity',
    duration: { mode: 'fixed', unit: 'minutes', minutes: 120 },
    guests: { enabled: true, types: [{ key: 'participants', label: 'Participants', min: 1, max: 10, countsTowardCapacity: true }], minTotal: 1 },
    resources: { mode: 'none', count: 1, customerSelects: false, matchGuestCapacity: false, selection: 'first_available' },
    payment: { mode: 'full' },
  },
  table: {
    strategy: 'table',
    dateSelection: 'single',
    timeSelection: 'slot',
    inventory: 'exclusive',
    duration: { mode: 'fixed', unit: 'minutes', minutes: 90 },
    slotIntervalMinutes: 30,
    guests: { enabled: true, types: [{ key: 'guests', label: 'Guests', min: 1, max: 20, countsTowardCapacity: true }], minTotal: 1 },
    resources: { mode: 'required', count: 1, customerSelects: false, matchGuestCapacity: true, selection: 'first_available' },
    buffers: { beforeMinutes: 0, afterMinutes: 15 },
    payment: { mode: 'none' },
  },
  custom: {
    strategy: 'custom',
    dateSelection: 'single',
    timeSelection: 'slot',
    inventory: 'exclusive',
    duration: { mode: 'fixed', unit: 'minutes', minutes: 60 },
    resources: { mode: 'required', count: 1, customerSelects: false, matchGuestCapacity: false, selection: 'first_available' },
  },
};

export function presetDefinition(strategy: BuiltInStrategy): BookingDefinition {
  return parseBookingDefinition(strategyPresets[strategy]);
}

export function guestTotal(def: BookingDefinition, participants: Record<string, number> | undefined): number {
  if (!participants) return 0;
  const types = def.guests.types;
  if (!types.length) return Object.values(participants).reduce((a, b) => a + (Number(b) || 0), 0);
  return types.reduce((sum, t) => sum + (Number(participants[t.key]) || 0), 0);
}

export function capacityGuestTotal(def: BookingDefinition, participants: Record<string, number> | undefined): number {
  if (!participants) return 0;
  const types = def.guests.types;
  if (!types.length) return guestTotal(def, participants);
  return types.filter((t) => t.countsTowardCapacity).reduce((sum, t) => sum + (Number(participants[t.key]) || 0), 0);
}
