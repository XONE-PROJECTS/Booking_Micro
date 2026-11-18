import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { pk, tenantFk, timestamps, tstz } from './columns';
import { services } from './catalog';
import { resources } from './resources';
import { tenantIdColumn as tenantId } from './tenancy';

/** Business-wide opening hours (weekly, local time). */
export const operatingHours = pgTable(
  'operating_hours',
  {
    id: pk(),
    tenantId: tenantId(),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    label: text('label'),
    ...timestamps,
  },
  (t) => [index('operating_hours_tenant_idx').on(t.tenantId), check('operating_hours_dow', sql`${t.dayOfWeek} between 0 and 6`)],
);

/**
 * Service-level weekly rules. kind "window" narrows when a service can be booked;
 * kind "session" defines scheduled sessions with their own capacity (classes, tours, events).
 */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    kind: text('kind', { enum: ['window', 'session'] }).notNull().default('window'),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    capacity: integer('capacity'),
    resourceId: uuid('resource_id'),
    label: text('label'),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    ...timestamps,
  },
  (t) => [
    index('availability_rules_service_idx').on(t.serviceId),
    tenantFk('availability_rules_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('availability_rules_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('availability_rules_dow', sql`${t.dayOfWeek} between 0 and 6`),
  ],
);

/** One-off closures or extra openings for the business, a service or a resource. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: pk(),
    tenantId: tenantId(),
    targetType: text('target_type', { enum: ['business', 'service', 'resource'] }).notNull(),
    targetId: uuid('target_id'),
    kind: text('kind', { enum: ['closed', 'open'] }).notNull().default('closed'),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    reason: text('reason'),
    ...timestamps,
  },
  (t) => [index('availability_exceptions_lookup_idx').on(t.tenantId, t.targetType, t.startsAt), check('availability_exceptions_range', sql`${t.endsAt} > ${t.startsAt}`)],
);

/** Whole-day closures expressed in local dates (holidays, private events). */
export const blackoutDates = pgTable(
  'blackout_dates',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id'),
    resourceId: uuid('resource_id'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: text('reason'),
    ...timestamps,
  },
  (t) => [
    index('blackout_dates_tenant_idx').on(t.tenantId, t.startDate),
    tenantFk('blackout_dates_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('blackout_dates_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('blackout_dates_range', sql`${t.endDate} >= ${t.startDate}`),
  ],
);

/**
 * Capacity per service (and optionally per resource). Also the lock row for capacity bookings:
 * reservations lock it with SELECT ... FOR UPDATE before recounting usage.
 */
export const capacityDefinitions = pgTable(
  'capacity_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    resourceId: uuid('resource_id'),
    capacity: integer('capacity').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('capacity_definitions_target_uq').on(t.tenantId, t.serviceId, t.resourceId).nullsNotDistinct(),
    tenantFk('capacity_definitions_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('capacity_definitions_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('capacity_definitions_nonnegative', sql`${t.capacity} >= 0`),
  ],
);

/** Date-bounded stock overrides for pooled inventory (for example 5 kayaks during repairs). */
export const inventoryPeriods = pgTable(
  'inventory_periods',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id'),
    resourceId: uuid('resource_id'),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    quantity: integer('quantity').notNull(),
    ...timestamps,
  },
  (t) => [
    index('inventory_periods_lookup_idx').on(t.tenantId, t.resourceId, t.startsAt),
    tenantFk('inventory_periods_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('inventory_periods_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('inventory_periods_range', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Recurrence of a booking series; each occurrence is an allocation of the parent booking. */
export const recurrenceRules = pgTable('recurrence_rules', {
  id: pk(),
  tenantId: tenantId(),
  bookingId: uuid('booking_id').notNull(),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
  interval: integer('interval').notNull().default(1),
  count: integer('count'),
  until: date('until'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
