import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { PricingResult } from '@universal-booking/pricing-engine';
import type { BookingPolicy } from '@universal-booking/booking-engine';
import { money, pk, tenantFk, timestamps, tstz, tstzrange } from './columns';
import { formDefinitions, workflowDefinitions } from './config';
import { services, serviceVersions } from './catalog';
import { customers } from './customers';
import { resources } from './resources';
import { tenantIdColumn as tenantId } from './tenancy';

export const bookingPaymentStatuses = ['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'] as const;

export const bookings = pgTable(
  'bookings',
  {
    id: pk(),
    tenantId: tenantId(),
    reference: text('reference').notNull(),
    customerId: uuid('customer_id'),
    serviceId: uuid('service_id').notNull(),
    serviceVersionId: uuid('service_version_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    status: text('status').notNull(),
    statusCategory: text('status_category').notNull(),
    workflowStep: integer('workflow_step').notNull().default(0),
    source: text('source', { enum: ['portal', 'embed', 'admin', 'api', 'integration'] }).notNull(),
    startAt: tstz('start_at').notNull(),
    endAt: tstz('end_at').notNull(),
    timezone: text('timezone').notNull(),
    quantity: integer('quantity').notNull().default(1),
    participants: jsonb('participants').$type<Record<string, number>>().notNull().default({}),
    guestCount: integer('guest_count').notNull().default(0),
    currency: text('currency').notNull(),
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull().default('0'),
    feeTotal: money('fee_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    total: money('total').notNull(),
    depositAmount: money('deposit_amount').notNull().default('0'),
    refundableDeposit: money('refundable_deposit').notNull().default('0'),
    amountPaid: money('amount_paid').notNull().default('0'),
    amountRefunded: money('amount_refunded').notNull().default('0'),
    chargesTotal: money('charges_total').notNull().default('0'),
    paymentStatus: text('payment_status', { enum: bookingPaymentStatuses }).notNull().default('unpaid'),
    paymentRequired: boolean('payment_required').notNull().default(false),
    approvalRequired: boolean('approval_required').notNull().default(false),
    pricingSnapshot: jsonb('pricing_snapshot').$type<PricingResult>().notNull(),
    policySnapshot: jsonb('policy_snapshot').$type<BookingPolicy>().notNull(),
    termsAcceptance: jsonb('terms_acceptance').$type<{ version: string; acceptedAt: string; text?: string } | null>(),
    discountId: uuid('discount_id'),
    promoCode: text('promo_code'),
    customerNotes: text('customer_notes'),
    accessTokenHash: text('access_token_hash'),
    holdExpiresAt: tstz('hold_expires_at'),
    autoCancelAt: tstz('auto_cancel_at'),
    confirmedAt: tstz('confirmed_at'),
    cancelledAt: tstz('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    checkedInAt: tstz('checked_in_at'),
    completedAt: tstz('completed_at'),
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    externalReference: text('external_reference'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid('created_by_id'),
    lockVersion: integer('lock_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('bookings_reference_uq').on(t.tenantId, t.reference),
    unique('bookings_tenant_id_uq').on(t.tenantId, t.id),
    index('bookings_tenant_start_idx').on(t.tenantId, t.startAt),
    index('bookings_tenant_status_idx').on(t.tenantId, t.status),
    index('bookings_customer_idx').on(t.tenantId, t.customerId),
    index('bookings_hold_expiry_idx').on(t.holdExpiresAt).where(sql`${t.holdExpiresAt} is not null`),
    tenantFk('bookings_customer_fk', t.tenantId, t.customerId, customers),
    tenantFk('bookings_service_fk', t.tenantId, t.serviceId, services),
    tenantFk('bookings_service_version_fk', t.tenantId, t.serviceVersionId, serviceVersions),
    tenantFk('bookings_workflow_fk', t.tenantId, t.workflowId, workflowDefinitions),
    check('bookings_period', sql`${t.endAt} > ${t.startAt}`),
  ],
);

export const bookingItems = pgTable(
  'booking_items',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    serviceVersionId: uuid('service_version_id').notNull(),
    startAt: tstz('start_at').notNull(),
    endAt: tstz('end_at').notNull(),
    quantity: integer('quantity').notNull().default(1),
    participants: jsonb('participants').$type<Record<string, number>>().notNull().default({}),
    options: jsonb('options').$type<{ id: string; name: string; quantity: number; price: string }[]>().notNull().default([]),
    pricingSnapshot: jsonb('pricing_snapshot').$type<PricingResult>().notNull(),
    total: money('total').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('booking_items_tenant_id_uq').on(t.tenantId, t.id),
    tenantFk('booking_items_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade'),
    tenantFk('booking_items_service_version_fk', t.tenantId, t.serviceVersionId, serviceVersions),
  ],
);

/**
 * Inventory consumed by a booking. Exclusive rows are protected by a GiST exclusion constraint on
 * (resource_id, blocked_period) while held or active; capacity and pooled rows are guarded by row locks.
 */
export const bookingAllocations = pgTable(
  'booking_allocations',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    bookingItemId: uuid('booking_item_id'),
    serviceId: uuid('service_id').notNull(),
    resourceId: uuid('resource_id'),
    period: tstzrange('period').notNull(),
    /** period widened by buffer and turnaround time. */
    blockedPeriod: tstzrange('blocked_period').notNull(),
    quantity: integer('quantity').notNull().default(1),
    exclusive: boolean('exclusive').notNull().default(false),
    status: text('status', { enum: ['held', 'active', 'released'] }).notNull().default('held'),
    expiresAt: tstz('expires_at'),
    occurrence: integer('occurrence').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    releasedAt: tstz('released_at'),
  },
  (t) => [
    index('booking_allocations_booking_idx').on(t.bookingId),
    index('booking_allocations_service_idx').on(t.tenantId, t.serviceId, t.status),
    index('booking_allocations_blocked_gist').using('gist', t.blockedPeriod),
    tenantFk('booking_allocations_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade'),
    tenantFk('booking_allocations_item_fk', t.tenantId, t.bookingItemId, bookingItems, 'cascade'),
    tenantFk('booking_allocations_resource_fk', t.tenantId, t.resourceId, resources),
    check('booking_allocations_quantity', sql`${t.quantity} >= 1`),
  ],
);

export const bookingGuests = pgTable(
  'booking_guests',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    guestType: text('guest_type'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [tenantFk('booking_guests_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade')],
);

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: pk(),
    tenantId: tenantId(),
    formId: uuid('form_id').notNull(),
    bookingId: uuid('booking_id'),
    customerId: uuid('customer_id'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('form_submissions_tenant_id_uq').on(t.tenantId, t.id),
    tenantFk('form_submissions_form_fk', t.tenantId, t.formId, formDefinitions),
    tenantFk('form_submissions_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade'),
  ],
);

/** One row per answered field, with the label as shown, for exports and reporting. */
export const bookingAnswers = pgTable(
  'booking_answers',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    submissionId: uuid('submission_id'),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    value: jsonb('value'),
  },
  (t) => [index('booking_answers_booking_idx').on(t.bookingId), tenantFk('booking_answers_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade')],
);

export const bookingHolds = pgTable(
  'booking_holds',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    status: text('status', { enum: ['active', 'converted', 'expired', 'released'] }).notNull().default('active'),
    expiresAt: tstz('expires_at').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    index('booking_holds_expiry_idx').on(t.status, t.expiresAt),
    tenantFk('booking_holds_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade'),
  ],
);

export const bookingStatusHistory = pgTable(
  'booking_status_history',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    action: text('action').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('booking_status_history_booking_idx').on(t.bookingId, t.createdAt), tenantFk('booking_status_history_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade')],
);

export const bookingNotes = pgTable(
  'booking_notes',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    authorId: uuid('author_id'),
    visibility: text('visibility', { enum: ['internal', 'customer'] }).notNull().default('internal'),
    body: text('body').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [tenantFk('booking_notes_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade')],
);

/** Charges added after booking: damage, late check-out, no-show and cancellation fees. */
export const bookingCharges = pgTable(
  'booking_charges',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    kind: text('kind', { enum: ['damage', 'late_fee', 'no_show', 'cancellation_fee', 'extra', 'other'] }).notNull(),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['open', 'paid', 'waived'] }).notNull().default('open'),
    createdById: uuid('created_by_id'),
    ...timestamps,
  },
  (t) => [tenantFk('booking_charges_booking_fk', t.tenantId, t.bookingId, bookings, 'cascade')],
);

export const bookingReferenceCounters = pgTable(
  'booking_reference_counters',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);
