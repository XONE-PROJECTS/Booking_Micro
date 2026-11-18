import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { money, pk, tenantFk, timestamps, tstz } from './columns';
import { bookings } from './bookings';
import { tenantIdColumn as tenantId } from './tenancy';

export const paymentProviderTypes = ['manual', 'cash', 'paymongo', 'xendit', 'stripe'] as const;

export const paymentProviders = pgTable(
  'payment_providers',
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    mode: text('mode', { enum: ['test', 'live'] }).notNull().default('test'),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    isDefault: boolean('is_default').notNull().default(false),
    /** Secret credentials sealed with ENCRYPTION_KEY (SecretBox). Never returned by the API. */
    credentialsEncrypted: text('credentials_encrypted'),
    /** Non-secret settings (enabled methods, instructions). */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('payment_providers_tenant_id_uq').on(t.tenantId, t.id)],
);

export const paymentStatuses = ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded', 'requires_review'] as const;

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    providerId: uuid('provider_id'),
    provider: text('provider').notNull(),
    method: text('method'),
    kind: text('kind', { enum: ['deposit', 'full', 'balance', 'charge', 'other'] }).notNull().default('full'),
    amount: money('amount').notNull(),
    amountRefunded: money('amount_refunded').notNull().default('0'),
    currency: text('currency').notNull(),
    status: text('status', { enum: paymentStatuses }).notNull().default('pending'),
    providerPaymentId: text('provider_payment_id'),
    checkoutUrl: text('checkout_url'),
    reference: text('reference'),
    idempotencyKey: text('idempotency_key'),
    expiresAt: tstz('expires_at'),
    paidAt: tstz('paid_at'),
    lastCheckedAt: tstz('last_checked_at'),
    failureReason: text('failure_reason'),
    recordedById: uuid('recorded_by_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('payments_tenant_id_uq').on(t.tenantId, t.id),
    index('payments_booking_idx').on(t.tenantId, t.bookingId),
    index('payments_status_idx').on(t.status, t.lastCheckedAt),
    uniqueIndex('payments_provider_payment_uq').on(t.provider, t.providerPaymentId).where(sql`${t.providerPaymentId} is not null`),
    tenantFk('payments_booking_fk', t.tenantId, t.bookingId, bookings),
    tenantFk('payments_provider_fk', t.tenantId, t.providerId, paymentProviders),
  ],
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: pk(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id').notNull(),
    provider: text('provider').notNull(),
    type: text('type', { enum: ['create', 'verify', 'webhook', 'refund', 'manual', 'recheck'] }).notNull(),
    status: text('status').notNull(),
    amount: money('amount'),
    providerEventId: text('provider_event_id'),
    providerReference: text('provider_reference'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payment_transactions_payment_idx').on(t.paymentId),
    // A provider event is processed once, however many times the webhook is delivered.
    uniqueIndex('payment_transactions_event_uq').on(t.provider, t.providerEventId).where(sql`${t.providerEventId} is not null`),
    tenantFk('payment_transactions_payment_fk', t.tenantId, t.paymentId, payments, 'cascade'),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: pk(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id').notNull(),
    bookingId: uuid('booking_id').notNull(),
    amount: money('amount').notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] }).notNull().default('pending'),
    providerRefundId: text('provider_refund_id'),
    createdById: uuid('created_by_id'),
    ...timestamps,
  },
  (t) => [tenantFk('refunds_payment_fk', t.tenantId, t.paymentId, payments), tenantFk('refunds_booking_fk', t.tenantId, t.bookingId, bookings)],
);
