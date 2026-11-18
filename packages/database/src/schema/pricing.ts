import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Condition } from '@universal-booking/core';
import { money, pk, tenantFk, timestamps, tstz } from './columns';
import { services } from './catalog';
import { resources } from './resources';
import { tenantIdColumn as tenantId } from './tenancy';

/**
 * Pricing rules for a service. The highest-priority rule without a resource is the base strategy;
 * resource rules adjust the base for specific resources; kind "dynamic" holds conditional adjustments.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    resourceId: uuid('resource_id'),
    kind: text('kind', { enum: ['base', 'resource', 'dynamic'] }).notNull().default('base'),
    name: text('name').notNull(),
    strategy: text('strategy').notNull(),
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull().default({}),
    condition: jsonb('condition').$type<Condition>(),
    adjustmentPercent: numeric('adjustment_percent', { precision: 9, scale: 4 }),
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('pricing_rules_service_idx').on(t.serviceId),
    tenantFk('pricing_rules_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('pricing_rules_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
  ],
);

export const priceComponents = pgTable(
  'price_components',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    name: text('name').notNull(),
    calculationType: text('calculation_type', { enum: ['fixed', 'percent', 'per_unit', 'per_guest', 'per_extra_guest', 'security_deposit'] }).notNull(),
    amount: money('amount').notNull(),
    includedGuests: integer('included_guests'),
    guestType: text('guest_type'),
    perUnitOf: text('per_unit_of', { enum: ['nights', 'days', 'hours', 'sessions'] }),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [tenantFk('price_components_service_fk', t.tenantId, t.serviceId, services, 'cascade')],
);

export const seasonalRates = pgTable(
  'seasonal_rates',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id'),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    daysOfWeek: integer('days_of_week').array(),
    amount: money('amount'),
    adjustmentPercent: numeric('adjustment_percent', { precision: 9, scale: 4 }),
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('seasonal_rates_lookup_idx').on(t.tenantId, t.startsOn), tenantFk('seasonal_rates_service_fk', t.tenantId, t.serviceId, services, 'cascade')],
);

export const discounts = pgTable(
  'discounts',
  {
    id: pk(),
    tenantId: tenantId(),
    code: text('code'),
    name: text('name').notNull(),
    type: text('type', { enum: ['percent', 'fixed'] }).notNull(),
    value: money('value').notNull(),
    maxAmount: money('max_amount'),
    minSubtotal: money('min_subtotal'),
    serviceIds: uuid('service_ids').array().notNull().default(sql`'{}'::uuid[]`),
    startsAt: tstz('starts_at'),
    endsAt: tstz('ends_at'),
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    perCustomerLimit: integer('per_customer_limit'),
    automatic: boolean('automatic').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('discounts_code_uq').on(t.tenantId, sql`upper(${t.code})`).where(sql`${t.code} is not null`)],
);

export const taxes = pgTable('taxes', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  rate: numeric('rate', { precision: 7, scale: 4 }).notNull(),
  inclusive: boolean('inclusive').notNull().default(false),
  serviceIds: uuid('service_ids').array().notNull().default(sql`'{}'::uuid[]`),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/** Service charges and booking fees applied after discounts and before taxes. */
export const fees = pgTable('fees', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  type: text('type', { enum: ['percent', 'fixed'] }).notNull(),
  value: money('value').notNull(),
  serviceIds: uuid('service_ids').array().notNull().default(sql`'{}'::uuid[]`),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});
