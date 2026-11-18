import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { pk, tenantFk, timestamps, tstz } from './columns';
import { tenantIdColumn as tenantId, users } from './tenancy';

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type', { enum: ['registered', 'guest'] }).notNull().default('guest'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    locale: text('locale'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    emailVerifiedAt: tstz('email_verified_at'),
    ...timestamps,
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    unique('customers_tenant_id_uq').on(t.tenantId, t.id),
    index('customers_email_idx').on(t.tenantId, sql`lower(${t.email})`),
    index('customers_user_idx').on(t.userId),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    label: text('label'),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country'),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [tenantFk('customer_addresses_customer_fk', t.tenantId, t.customerId, customers, 'cascade')],
);

export const customerNotes = pgTable(
  'customer_notes',
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [tenantFk('customer_notes_customer_fk', t.tenantId, t.customerId, customers, 'cascade')],
);

export const customerAttributeDefinitions = pgTable(
  'customer_attribute_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: ['text', 'number', 'boolean', 'date', 'select'] }).notNull(),
    options: jsonb('options').$type<{ value: string; label: string }[]>(),
    required: boolean('required').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('customer_attribute_definitions_key_uq').on(t.tenantId, t.key)],
);

/** Hashed tokens for guest booking lookup and passwordless customer access. */
export const customerAccessTokens = pgTable(
  'customer_access_tokens',
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    bookingId: uuid('booking_id'),
    purpose: text('purpose', { enum: ['booking_access', 'magic_link', 'email_verification'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [tenantFk('customer_access_tokens_customer_fk', t.tenantId, t.customerId, customers, 'cascade')],
);
