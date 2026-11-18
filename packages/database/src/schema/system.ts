import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { pk, timestamps, tstz } from './columns';
import { tenantIdColumn as tenantId, users } from './tenancy';

/** Transactional outbox: written in the same transaction as the change it describes. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: pk(),
    tenantId: tenantId(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'processed', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: tstz('available_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    lastError: text('last_error'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('outbox_events_pending_idx').on(t.status, t.availableAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    /** HTTP method and route template. */
    scope: text('scope').notNull(),
    principal: text('principal').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['in_progress', 'completed'] }).notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedUntil: tstz('locked_until'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('idempotency_keys_uq').on(t.tenantId, t.scope, t.principal, t.key), index('idempotency_keys_expiry_idx').on(t.expiresAt)],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: pk(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    channel: text('channel', { enum: ['email', 'sms', 'in_app'] }).notNull(),
    locale: text('locale').notNull().default('en-PH'),
    subject: text('subject'),
    body: text('body').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [unique('notification_templates_uq').on(t.tenantId, t.key, t.channel, t.locale)],
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: pk(),
    tenantId: tenantId(),
    templateKey: text('template_key').notNull(),
    channel: text('channel').notNull(),
    recipient: text('recipient').notNull(),
    subject: text('subject'),
    status: text('status', { enum: ['queued', 'sent', 'failed', 'skipped'] }).notNull().default('queued'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    bookingId: uuid('booking_id'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
  },
  (t) => [index('notification_logs_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: tstz('read_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('in_app_notifications_user_idx').on(t.tenantId, t.userId, t.readAt)],
);

export const fileAttachments = pgTable(
  'file_attachments',
  {
    id: pk(),
    tenantId: tenantId(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    driver: text('driver').notNull(),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('private'),
    uploadedById: uuid('uploaded_by_id'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [index('file_attachments_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);
