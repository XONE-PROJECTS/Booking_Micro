import { z } from 'zod';
import { id, money } from './common';

export const pricingLine = z.object({ kind: z.string(), label: z.string(), quantity: z.string(), unitAmount: money, amount: money, date: z.string().optional() });

export const pricingResult = z.object({
  version: z.literal(1),
  currency: z.string(),
  strategy: z.string(),
  lines: z.array(pricingLine),
  baseSubtotal: money,
  addonsTotal: money,
  subtotal: money,
  discountTotal: money,
  feeTotal: money,
  taxTotal: money,
  taxIncluded: money,
  total: money,
  refundableDeposit: money,
  depositAmount: money,
  amountDueNow: money,
  amountDueLater: money,
});

export const resourceOption = z.object({ resourceId: id.nullable(), resourceName: z.string().optional(), available: z.boolean(), remainingCapacity: z.number(), reasons: z.array(z.string()) });

export const availabilityResult = z.object({
  available: z.boolean(),
  reasons: z.array(z.object({ code: z.string(), message: z.string() })),
  start: z.string(),
  end: z.string(),
  units: z.object({ minutes: z.number(), hours: z.number(), days: z.number(), nights: z.number(), sessions: z.number() }),
  occurrences: z.array(z.object({ start: z.string(), end: z.string() })),
  options: z.array(resourceOption),
  pricing: pricingResult.nullable(),
});

export const slot = z.object({
  start: z.string(),
  end: z.string(),
  localStart: z.string(),
  localEnd: z.string(),
  available: z.boolean(),
  remaining: z.number(),
  resources: z.array(z.object({ resourceId: id.nullable(), remaining: z.number() })),
});

export const calendarDay = z.object({ date: z.string(), available: z.boolean(), remaining: z.number() });

export const bookingAllocationView = z.object({
  resourceId: id.nullable(),
  resourceName: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  quantity: z.number(),
  status: z.string(),
});

export const bookingView = z.object({
  id,
  reference: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  statusCategory: z.string(),
  source: z.string(),
  service: z.object({ id, name: z.string(), version: z.number() }),
  customer: z.object({ id, firstName: z.string(), lastName: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  startAt: z.string(),
  endAt: z.string(),
  localStart: z.string(),
  localEnd: z.string(),
  timezone: z.string(),
  quantity: z.number(),
  participants: z.record(z.string(), z.number()),
  currency: z.string(),
  subtotal: money,
  discountTotal: money,
  feeTotal: money,
  taxTotal: money,
  total: money,
  depositAmount: money,
  amountPaid: money,
  amountRefunded: money,
  chargesTotal: money,
  balanceDue: money,
  amountDueNow: money,
  paymentStatus: z.string(),
  paymentRequired: z.boolean(),
  pricing: pricingResult,
  allocations: z.array(bookingAllocationView),
  holdExpiresAt: z.string().nullable(),
  availableActions: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  accessToken: z.string().optional().describe('Returned once on creation for guest bookings; required for guest lookup'),
});

export const serviceView = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  visibility: z.string(),
  categoryId: id.nullable(),
  shortDescription: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  currency: z.string(),
  basePrice: money,
  definition: z.record(z.string(), z.unknown()),
  pricing: z.object({ strategy: z.string(), configuration: z.record(z.string(), z.unknown()) }),
  currentVersion: z.number(),
});

export const authSession = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  csrfToken: z.string().optional(),
  user: z.object({ id, email: z.string(), name: z.string(), isPlatformAdmin: z.boolean() }),
  tenant: z.object({ id, slug: z.string(), name: z.string() }).nullable(),
  memberships: z.array(z.object({ tenantId: id, slug: z.string(), name: z.string(), roles: z.array(z.string()) })),
  permissions: z.array(z.string()),
});

export const genericObject = z.record(z.string(), z.unknown());
