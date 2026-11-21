import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { discounts, fees, pricingRules, seasonalRates, taxes } from '@universal-booking/database';
import { nonNegativeMoney } from '@universal-booking/contracts';
import type { RouteBuilder } from '../../http/route';
import { crudRoutes } from '../../http/crud';

const id = z.uuid();

const pricingRuleInput = z.object({
  serviceId: id,
  resourceId: id.nullish(),
  kind: z.enum(['base', 'resource', 'dynamic']).default('base'),
  name: z.string().min(1).max(200),
  strategy: z.string().min(1).max(80),
  configuration: z.record(z.string(), z.unknown()).default({}),
  condition: z.record(z.string(), z.unknown()).nullish(),
  adjustmentPercent: z.string().nullish(),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

const seasonalInput = z.object({
  serviceId: id.nullish(),
  name: z.string().min(1).max(200),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  amount: nonNegativeMoney.nullish(),
  adjustmentPercent: z.string().nullish(),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

const discountInput = z.object({
  code: z.string().max(40).nullish(),
  name: z.string().min(1).max(200),
  type: z.enum(['percent', 'fixed']),
  value: nonNegativeMoney,
  maxAmount: nonNegativeMoney.nullish(),
  minSubtotal: nonNegativeMoney.nullish(),
  serviceIds: z.array(id).default([]),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  usageLimit: z.number().int().positive().nullish(),
  perCustomerLimit: z.number().int().positive().nullish(),
  automatic: z.boolean().default(false),
  active: z.boolean().default(true),
});

const taxInput = z.object({
  name: z.string().min(1).max(200),
  rate: z.string(),
  inclusive: z.boolean().default(false),
  serviceIds: z.array(id).default([]),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

const feeInput = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['percent', 'fixed']),
  value: nonNegativeMoney,
  serviceIds: z.array(id).default([]),
  active: z.boolean().default(true),
});

export function registerPricingAdminRoutes(route: RouteBuilder) {
  crudRoutes(route, {
    path: '/pricing/rules',
    tag: 'Pricing',
    entity: 'PricingRule',
    table: pricingRules,
    input: pricingRuleInput,
    readPermission: 'pricing.read',
    writePermission: 'pricing.manage',
    orderBy: [asc(pricingRules.priority)],
    filters: { serviceId: pricingRules.serviceId },
  });
  crudRoutes(route, {
    path: '/pricing/seasonal-rates',
    tag: 'Pricing',
    entity: 'SeasonalRate',
    table: seasonalRates,
    input: seasonalInput,
    readPermission: 'pricing.read',
    writePermission: 'pricing.manage',
    filters: { serviceId: seasonalRates.serviceId },
  });
  crudRoutes(route, {
    path: '/pricing/discounts',
    tag: 'Pricing',
    entity: 'Discount',
    table: discounts,
    input: discountInput,
    readPermission: 'pricing.read',
    writePermission: 'pricing.manage',
  });
  crudRoutes(route, {
    path: '/pricing/taxes',
    tag: 'Pricing',
    entity: 'Tax',
    table: taxes,
    input: taxInput,
    readPermission: 'pricing.read',
    writePermission: 'pricing.manage',
  });
  crudRoutes(route, {
    path: '/pricing/fees',
    tag: 'Pricing',
    entity: 'Fee',
    table: fees,
    input: feeInput,
    readPermission: 'pricing.read',
    writePermission: 'pricing.manage',
  });
}