import { z } from 'zod';
import { bookingDefinitionSchema, conditionSchema, formSchemaDefinition, permissionKeys } from '@universal-booking/core';
import { workflowDefinitionSchema } from '@universal-booking/workflow-engine';
import { policySchema } from '@universal-booking/booking-engine';
import {
  color,
  currency,
  dayOfWeek,
  email,
  httpsUrl,
  id,
  isoDateTime,
  localDate,
  localTime,
  moneyInput,
  nonNegativeMoney,
  pageQuery,
  phone,
  slug,
  timezone,
  weeklyWindow,
} from './common';
import { webhookEventTypes } from './events';

// ---------------------------------------------------------------------------
// Auth and identity
// ---------------------------------------------------------------------------

export const loginInput = z.object({ email, password: z.string().min(1).max(200), tenantSlug: slug.optional() });
export const registerCustomerInput = z.object({
  email,
  password: z.string().min(10).max(200),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  phone: phone.optional(),
});
export const switchTenantInput = z.object({ tenantId: id });
export const changePasswordInput = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) });

/** Host backends exchange their own user for a short-lived booking token (blueprint 4.4). */
export const tokenExchangeInput = z.object({
  subject: z.string().min(1).max(200).describe('Stable user id in the host system'),
  email: email.optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: phone.optional(),
  provider: z.string().min(1).max(100).default('host'),
  scopes: z.array(z.enum(['customer', 'staff'])).default(['customer']),
  ttlSeconds: z.number().int().min(60).max(3600).optional(),
});

// ---------------------------------------------------------------------------
// Tenancy, business, settings, branding
// ---------------------------------------------------------------------------

export const createTenantInput = z.object({
  name: z.string().min(2).max(120),
  slug,
  timezone: timezone.default('Asia/Manila'),
  currency: currency.default('PHP'),
  locale: z.string().max(20).default('en-PH'),
  owner: z.object({ email, name: z.string().min(1).max(120), password: z.string().min(10).max(200).optional() }).optional(),
});
export const updateTenantInput = z.object({ name: z.string().min(2).max(120).optional(), status: z.enum(['active', 'suspended', 'archived']).optional() });

export const businessProfileInput = z.object({
  displayName: z.string().min(1).max(120),
  legalName: z.string().max(200).nullish(),
  description: z.string().max(5000).nullish(),
  email: email.nullish(),
  phone: phone.nullish(),
  website: httpsUrl.nullish(),
  address: z.record(z.string(), z.string().max(200)).nullish(),
  taxId: z.string().max(60).nullish(),
  socialLinks: z.record(z.string(), httpsUrl).optional(),
});

export const tenantSettingsInput = z.object({
  timezone: timezone.optional(),
  currency: currency.optional(),
  locale: z.string().max(20).optional(),
  weekStartsOn: dayOfWeek.optional(),
  bookingReferencePrefix: z
    .string()
    .regex(/^[A-Z0-9]{2,10}$/)
    .optional(),
  holdMinutes: z.number().int().min(1).max(1440).optional(),
  guestBookingEnabled: z.boolean().optional(),
  defaultWorkflowId: id.nullish(),
  defaultPolicyId: id.nullish(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const brandingInput = z.object({
  logoUrl: httpsUrl.nullish(),
  faviconUrl: httpsUrl.nullish(),
  primaryColor: color.optional(),
  accentColor: color.optional(),
  backgroundColor: color.optional(),
  textColor: color.optional(),
  fontFamily: z
    .string()
    .max(120)
    .regex(/^[\w\s,"'-]+$/)
    .optional(),
  borderRadius: z
    .string()
    .regex(/^\d+(\.\d+)?(rem|px)$/)
    .optional(),
  whiteLabel: z.boolean().optional(),
  portal: z
    .object({
      headerText: z.string().max(200).optional(),
      footerText: z.string().max(1000).optional(),
      catalogLayout: z.enum(['grid', 'list']).optional(),
      heroTitle: z.string().max(200).optional(),
      heroSubtitle: z.string().max(500).optional(),
      confirmationMessage: z.string().max(2000).optional(),
      termsUrl: httpsUrl.optional(),
      privacyUrl: httpsUrl.optional(),
      showPrices: z.boolean().optional(),
      steps: z.array(z.string().max(40)).max(10).optional(),
    })
    .optional(),
  embedAllowedOrigins: z.array(z.url().max(300)).max(50).optional(),
});

export const domainInput = z.object({
  domain: z
    .string()
    .max(253)
    .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'Invalid domain'),
  isPrimary: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Staff, roles and memberships
// ---------------------------------------------------------------------------

export const roleInput = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,40}$/)
    .optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.array(z.enum(permissionKeys)).max(permissionKeys.length),
});

export const staffInput = z.object({
  email,
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200).optional(),
  roleKeys: z.array(z.string()).min(1).default(['staff']),
  displayName: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  phone: phone.optional(),
  avatarUrl: httpsUrl.optional(),
  bookable: z.boolean().default(false).describe('Create a staff resource so customers can book this person'),
});
export const updateStaffInput = staffInput.omit({ email: true, password: true }).partial().extend({ status: z.enum(['active', 'inactive']).optional() });

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const categoryInput = z.object({
  name: z.string().min(1).max(120),
  slug: slug.optional(),
  parentId: id.nullish(),
  description: z.string().max(2000).nullish(),
  imageUrl: httpsUrl.nullish(),
  sortOrder: z.number().int().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const servicePricingInput = z.object({
  strategy: z.string().min(1).max(64),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

export const serviceInput = z.object({
  name: z.string().min(1).max(160),
  slug: slug.optional(),
  categoryId: id.nullish(),
  bookingDefinitionId: id.nullish(),
  shortDescription: z.string().max(300).nullish(),
  description: z.string().max(20000).nullish(),
  imageUrl: httpsUrl.nullish(),
  gallery: z.array(httpsUrl).max(20).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  currency: currency.optional(),
  basePrice: nonNegativeMoney.optional(),
  definition: bookingDefinitionSchema.optional(),
  pricing: servicePricingInput.optional(),
  formId: id.nullish(),
  workflowId: id.nullish(),
  policyId: id.nullish(),
  resourceIds: z.array(id).max(500).optional(),
  sortOrder: z.number().int().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const serviceOptionInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullish(),
  price: nonNegativeMoney,
  chargeType: z.enum(['per_booking', 'per_unit', 'per_night', 'per_day', 'per_guest', 'per_session']).default('per_booking'),
  maxQuantity: z.number().int().min(1).nullish(),
  required: z.boolean().default(false),
  sortOrder: z.number().int().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const bookingDefinitionInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  definition: bookingDefinitionSchema,
});

export const definitionValidateInput = z.object({ definition: z.unknown() });

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const resourceKind = z.enum(['room', 'staff', 'equipment', 'table', 'venue', 'vehicle', 'seat', 'other']);

export const resourceCategoryInput = z.object({ name: z.string().min(1).max(120), slug: slug.optional(), kind: resourceKind.optional(), description: z.string().max(2000).nullish() });

export const resourceInput = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).nullish(),
  kind: resourceKind.optional(),
  categoryId: id.nullish(),
  description: z.string().max(5000).nullish(),
  status: z.enum(['active', 'inactive', 'maintenance', 'archived']).optional(),
  capacity: z.number().int().min(1).max(100000).nullish(),
  quantity: z.number().int().min(1).max(100000).optional(),
  sortOrder: z.number().int().optional(),
  imageUrl: httpsUrl.nullish(),
  attributes: z.record(z.string().max(60), z.unknown()).optional(),
  serviceIds: z.array(id).optional(),
});

export const scheduleInput = z.object({
  work: z.array(weeklyWindow).max(50),
  breaks: z.array(weeklyWindow).max(50).default([]),
});

export const maintenanceInput = z
  .object({ reason: z.string().min(1).max(500), startsAt: isoDateTime, endsAt: isoDateTime, status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional() })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const assignmentInput = z.object({ staffProfileId: id, role: z.string().max(60).optional(), startsAt: isoDateTime.optional(), endsAt: isoDateTime.optional() });

export const resourceCalendarQuery = z.object({ from: localDate, to: localDate });

// ---------------------------------------------------------------------------
// Availability configuration
// ---------------------------------------------------------------------------

export const operatingHoursInput = z.object({ hours: z.array(weeklyWindow.extend({ label: z.string().max(60).optional() })).max(50) });

export const availabilityRuleInput = z.object({
  serviceId: id,
  kind: z.enum(['window', 'session']).default('window'),
  dayOfWeek,
  startTime: localTime,
  endTime: localTime,
  capacity: z.number().int().min(1).nullish(),
  resourceId: id.nullish(),
  label: z.string().max(80).nullish(),
  effectiveFrom: localDate.nullish(),
  effectiveTo: localDate.nullish(),
});

export const availabilityExceptionInput = z
  .object({
    targetType: z.enum(['business', 'service', 'resource']),
    targetId: id.nullish(),
    kind: z.enum(['closed', 'open']).default('closed'),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: z.string().max(300).nullish(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .refine((v) => v.targetType === 'business' || !!v.targetId, { message: 'targetId is required', path: ['targetId'] });

export const blackoutInput = z
  .object({ serviceId: id.nullish(), resourceId: id.nullish(), startDate: localDate, endDate: localDate, reason: z.string().max(300).nullish() })
  .refine((v) => v.endDate >= v.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] });

export const capacityInput = z.object({ serviceId: id, resourceId: id.nullish(), capacity: z.number().int().min(0).max(1_000_000) });

export const inventoryPeriodInput = z
  .object({ serviceId: id.nullish(), resourceId: id.nullish(), startsAt: isoDateTime, endsAt: isoDateTime, quantity: z.number().int().min(0) })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] });

// ---------------------------------------------------------------------------
// Availability queries (blueprint 8.3)
// ---------------------------------------------------------------------------

export const participantsInput = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.number().int().min(0).max(10000));
export const recurrenceInput = z.object({ frequency: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(12).default(1), count: z.number().int().min(2).max(104) });

export const availabilitySearchInput = z.object({
  serviceId: id,
  startDate: localDate.optional(),
  endDate: localDate.optional(),
  startTime: localTime.optional(),
  startAt: isoDateTime.optional(),
  durationMinutes: z.number().int().min(5).max(60 * 24 * 31).optional(),
  quantity: z.number().int().min(1).max(10000).default(1),
  participants: participantsInput.optional(),
  resourceIds: z.array(id).max(50).optional(),
  recurrence: recurrenceInput.optional(),
});

export const slotsQuery = z.object({
  serviceId: id,
  date: localDate,
  durationMinutes: z.coerce.number().int().min(5).optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  resourceId: id.optional(),
  participants: z
    .string()
    .optional()
    .describe('JSON object or "key:n,key:n", for example "adults:2,children:1"'),
});

export const calendarQuery = z.object({
  serviceId: id,
  from: localDate,
  to: localDate,
  quantity: z.coerce.number().int().min(1).default(1),
  participants: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export const pricingRuleInput = z.object({
  serviceId: id,
  resourceId: id.nullish(),
  kind: z.enum(['base', 'resource', 'dynamic']).default('base'),
  name: z.string().min(1).max(120),
  strategy: z.string().min(1).max(64),
  configuration: z.record(z.string(), z.unknown()).default({}),
  condition: conditionSchema.nullish(),
  adjustmentPercent: z.number().min(-100).max(1000).nullish(),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const priceComponentInput = z.object({
  serviceId: id,
  name: z.string().min(1).max(120),
  calculationType: z.enum(['fixed', 'percent', 'per_unit', 'per_guest', 'per_extra_guest', 'security_deposit']),
  amount: nonNegativeMoney,
  includedGuests: z.number().int().min(0).nullish(),
  guestType: z.string().max(40).nullish(),
  perUnitOf: z.enum(['nights', 'days', 'hours', 'sessions']).nullish(),
  active: z.boolean().default(true),
});

export const seasonalRateInput = z
  .object({
    serviceId: id.nullish(),
    name: z.string().min(1).max(120),
    startsOn: localDate,
    endsOn: localDate,
    daysOfWeek: z.array(dayOfWeek).max(7).nullish(),
    amount: nonNegativeMoney.nullish(),
    adjustmentPercent: z.number().min(-100).max(1000).nullish(),
    priority: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn must not be before startsOn', path: ['endsOn'] })
  .refine((v) => v.amount != null || v.adjustmentPercent != null, { message: 'Set amount or adjustmentPercent', path: ['amount'] });

export const discountInput = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,40}$/)
    .nullish(),
  name: z.string().min(1).max(120),
  type: z.enum(['percent', 'fixed']),
  value: nonNegativeMoney,
  maxAmount: nonNegativeMoney.nullish(),
  minSubtotal: nonNegativeMoney.nullish(),
  serviceIds: z.array(id).default([]),
  startsAt: isoDateTime.nullish(),
  endsAt: isoDateTime.nullish(),
  usageLimit: z.number().int().min(1).nullish(),
  perCustomerLimit: z.number().int().min(1).nullish(),
  automatic: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const taxInput = z.object({
  name: z.string().min(1).max(80),
  rate: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v), 'Invalid rate'),
  inclusive: z.boolean().default(false),
  serviceIds: z.array(id).default([]),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const feeInput = z.object({ name: z.string().min(1).max(80), type: z.enum(['percent', 'fixed']), value: nonNegativeMoney, serviceIds: z.array(id).default([]), active: z.boolean().default(true) });

export const optionSelectionInput = z.object({ id, quantity: z.number().int().min(1).max(1000).default(1) });

export const quoteInput = availabilitySearchInput.extend({
  options: z.array(optionSelectionInput).max(50).optional(),
  promoCode: z.string().max(40).optional(),
});

// ---------------------------------------------------------------------------
// Bookings (blueprint 8.4)
// ---------------------------------------------------------------------------

export const customerDetailsInput = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: email.optional(),
  phone: phone.optional(),
  marketingConsent: z.boolean().optional(),
});

export const guestInput = z.object({
  guestType: z.string().max(40).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: email.optional(),
  phone: phone.optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const createBookingInput = quoteInput.extend({
  customerId: id.optional().describe('Staff and integrations only'),
  customer: customerDetailsInput.optional(),
  guests: z.array(guestInput).max(100).optional(),
  answers: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(2000).optional(),
  termsAccepted: z.boolean().optional(),
  externalReference: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  hold: z.boolean().default(false).describe('Create a held booking that must be confirmed with /bookings/{id}/confirm'),
});

export const bookingTransitionInput = z.object({ reason: z.string().max(1000).optional(), notify: z.boolean().default(true) });

export const rescheduleInput = z.object({
  startDate: localDate.optional(),
  endDate: localDate.optional(),
  startTime: localTime.optional(),
  startAt: isoDateTime.optional(),
  durationMinutes: z.number().int().min(5).optional(),
  resourceIds: z.array(id).max(50).optional(),
  reason: z.string().max(1000).optional(),
});

export const assignResourcesInput = z.object({ resourceIds: z.array(id).min(1).max(50) });
export const bookingNoteInput = z.object({ body: z.string().min(1).max(5000), visibility: z.enum(['internal', 'customer']).default('internal') });
export const bookingChargeInput = z.object({
  kind: z.enum(['damage', 'late_fee', 'no_show', 'cancellation_fee', 'extra', 'other']),
  description: z.string().min(1).max(500),
  amount: nonNegativeMoney,
});
export const updateBookingInput = z.object({
  customerNotes: z.string().max(2000).nullish(),
  externalReference: z.string().max(120).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
});

export const bookingListQuery = pageQuery.extend({
  status: z.string().max(200).optional().describe('Comma-separated status keys'),
  serviceId: id.optional(),
  resourceId: id.optional(),
  customerId: id.optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  paymentStatus: z.string().max(100).optional(),
  source: z.string().max(40).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const bookingLookupInput = z.object({
  reference: z.string().min(4).max(40),
  email: email.optional(),
  token: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerInput = customerDetailsInput.extend({
  locale: z.string().max(20).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  addresses: z
    .array(
      z.object({
        label: z.string().max(60).optional(),
        line1: z.string().min(1).max(200),
        line2: z.string().max(200).optional(),
        city: z.string().max(100).optional(),
        region: z.string().max(100).optional(),
        postalCode: z.string().max(20).optional(),
        country: z.string().max(60).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
});
export const customerNoteInput = z.object({ body: z.string().min(1).max(5000) });
export const customerAttributeInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'boolean', 'date', 'select']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  required: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Forms, workflows, policies
// ---------------------------------------------------------------------------

export const formInput = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).nullish(), schema: formSchemaDefinition });
export const workflowInput = z.object({ description: z.string().max(1000).nullish(), definition: workflowDefinitionSchema, isDefault: z.boolean().optional() });
export const policyInput = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).nullish(), policy: policySchema, isDefault: z.boolean().optional() });

export const previewInput = z.object({
  definition: bookingDefinitionSchema,
  pricing: servicePricingInput.optional(),
  basePrice: nonNegativeMoney.optional(),
  currency: currency.default('PHP'),
  formId: id.nullish(),
  workflowId: id.nullish(),
  policyId: id.nullish(),
  request: availabilitySearchInput.omit({ serviceId: true }).optional(),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const paymentProviderInput = z.object({
  provider: z.enum(['manual', 'cash', 'paymongo', 'xendit', 'stripe']),
  name: z.string().min(1).max(80),
  mode: z.enum(['test', 'live']).default('test'),
  status: z.enum(['active', 'disabled']).default('active'),
  isDefault: z.boolean().default(false),
  credentials: z.record(z.string(), z.string().max(500)).optional().describe('Write-only; encrypted at rest'),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const recordPaymentInput = z.object({
  amount: moneyInput.refine((v) => Number(v) > 0, 'Must be positive'),
  method: z.enum(['cash', 'bank_transfer', 'card_terminal', 'gcash', 'maya', 'check', 'other']).default('cash'),
  provider: z.enum(['manual', 'cash']).default('manual'),
  kind: z.enum(['deposit', 'full', 'balance', 'charge', 'other']).default('full'),
  reference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export const createCheckoutInput = z.object({
  providerId: id.optional(),
  amount: z.enum(['due_now', 'balance', 'full']).default('due_now'),
  method: z.string().max(40).optional(),
  successUrl: z.url().max(2000).optional(),
  cancelUrl: z.url().max(2000).optional(),
});

export const refundInput = z.object({ amount: moneyInput.refine((v) => Number(v) > 0, 'Must be positive'), reason: z.string().max(500).optional() });

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export const webhookEndpointInput = z.object({
  url: z.url().max(2000),
  description: z.string().max(300).optional(),
  events: z.array(z.enum(webhookEventTypes)).min(1),
  status: z.enum(['active', 'disabled']).default('active'),
});

export const apiKeyInput = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['secret', 'publishable']).default('secret'),
  scopes: z.array(z.enum(permissionKeys)).default([]),
  expiresAt: isoDateTime.nullish(),
});

export const notificationTemplateInput = z.object({
  key: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  channel: z.enum(['email', 'sms', 'in_app']),
  locale: z.string().max(20).default('en-PH'),
  subject: z.string().max(300).nullish(),
  body: z.string().min(1).max(20000),
  active: z.boolean().default(true),
});

export const reportQuery = z.object({
  from: localDate,
  to: localDate,
  serviceId: id.optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  format: z.enum(['json', 'csv']).default('json'),
});
