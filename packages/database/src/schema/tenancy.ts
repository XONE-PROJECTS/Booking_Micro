import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pk, tenantFk, timestamps, tstz } from './columns';

export const tenants = pgTable('tenants', {
  id: pk(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended', 'archived'] }).notNull().default('active'),
  ...timestamps,
  deletedAt: tstz('deleted_at'),
});

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
export { tenantId as tenantIdColumn };

export const businessProfiles = pgTable(
  'business_profiles',
  {
    id: pk(),
    tenantId: tenantId(),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name'),
    description: text('description'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    address: jsonb('address').$type<Record<string, string>>(),
    taxId: text('tax_id'),
    socialLinks: jsonb('social_links').$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('business_profiles_tenant_uq').on(t.tenantId)],
);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Asia/Manila'),
  currency: text('currency').notNull().default('PHP'),
  locale: text('locale').notNull().default('en-PH'),
  weekStartsOn: integer('week_starts_on').notNull().default(0),
  bookingReferencePrefix: text('booking_reference_prefix').notNull().default('BOOK'),
  holdMinutes: integer('hold_minutes').notNull().default(10),
  guestBookingEnabled: boolean('guest_booking_enabled').notNull().default(true),
  defaultWorkflowId: uuid('default_workflow_id'),
  defaultPolicyId: uuid('default_policy_id'),
  extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export interface PortalSettings {
  headerText?: string;
  footerText?: string;
  catalogLayout?: 'grid' | 'list';
  heroTitle?: string;
  heroSubtitle?: string;
  confirmationMessage?: string;
  termsUrl?: string;
  privacyUrl?: string;
  showPrices?: boolean;
  steps?: string[];
}

export const tenantBranding = pgTable('tenant_branding', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  primaryColor: text('primary_color').notNull().default('#2563eb'),
  accentColor: text('accent_color').notNull().default('#f59e0b'),
  backgroundColor: text('background_color').notNull().default('#ffffff'),
  textColor: text('text_color').notNull().default('#0f172a'),
  fontFamily: text('font_family').notNull().default('Inter, system-ui, sans-serif'),
  borderRadius: text('border_radius').notNull().default('0.5rem'),
  whiteLabel: boolean('white_label').notNull().default(false),
  portal: jsonb('portal').$type<PortalSettings>().notNull().default({}),
  embedAllowedOrigins: text('embed_allowed_origins').array().notNull().default(sql`'{}'::text[]`),
  ...timestamps,
});

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: pk(),
    tenantId: tenantId(),
    domain: text('domain').notNull(),
    status: text('status', { enum: ['pending', 'verified', 'failed'] }).notNull().default('pending'),
    verificationToken: text('verification_token').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: tstz('verified_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('tenant_domains_domain_uq').on(sql`lower(${t.domain})`)],
);

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    status: text('status', { enum: ['active', 'disabled', 'invited'] }).notNull().default('active'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    locale: text('locale'),
    emailVerifiedAt: tstz('email_verified_at'),
    lastLoginAt: tstz('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Tenant the session is scoped to. Not named tenant_id so login can rotate tokens before a tenant context exists. */
    tenantScope: uuid('tenant_scope').references(() => tenants.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['active', 'invited', 'disabled'] }).notNull().default('active'),
    invitedById: uuid('invited_by_id'),
    ...timestamps,
  },
  (t) => [unique('tenant_memberships_tenant_user_uq').on(t.tenantId, t.userId), unique('tenant_memberships_tenant_id_uq').on(t.tenantId, t.id), index('tenant_memberships_user_idx').on(t.userId)],
);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  group: text('group').notNull(),
  description: text('description').notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('roles_tenant_key_uq').on(t.tenantId, t.key), unique('roles_tenant_id_uq').on(t.tenantId, t.id)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] }), tenantFk('role_permissions_role_fk', t.tenantId, t.roleId, roles, 'cascade')],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    tenantId: tenantId(),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    tenantFk('membership_roles_membership_fk', t.tenantId, t.membershipId, tenantMemberships, 'cascade'),
    tenantFk('membership_roles_role_fk', t.tenantId, t.roleId, roles, 'cascade'),
  ],
);

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    email: text('email'),
    claims: jsonb('claims').$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: tstz('last_seen_at'),
    ...timestamps,
  },
  (t) => [unique('external_identities_subject_uq').on(t.tenantId, t.provider, t.subject)],
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
