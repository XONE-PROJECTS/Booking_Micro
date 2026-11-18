import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { pk, tenantFk, timestamps, tstz } from './columns';
import { tenantIdColumn as tenantId, tenants } from './tenancy';

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: pk(),
    tenantId: tenantId(),
    url: text('url').notNull(),
    description: text('description'),
    /** Signing secret sealed with ENCRYPTION_KEY. */
    secretEncrypted: text('secret_encrypted').notNull(),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastSuccessAt: tstz('last_success_at'),
    lastFailureAt: tstz('last_failure_at'),
    ...timestamps,
  },
  (t) => [unique('webhook_endpoints_tenant_id_uq').on(t.tenantId, t.id)],
);

export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: pk(),
    tenantId: tenantId(),
    endpointId: uuid('endpoint_id').notNull(),
    eventType: text('event_type').notNull(),
  },
  (t) => [unique('webhook_subscriptions_uq').on(t.endpointId, t.eventType), tenantFk('webhook_subscriptions_endpoint_fk', t.tenantId, t.endpointId, webhookEndpoints, 'cascade')],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    tenantId: tenantId(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed', 'dead'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    lastResponse: text('last_response'),
    durationMs: integer('duration_ms'),
    deliveredAt: tstz('delivered_at'),
    replayOf: uuid('replay_of'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('webhook_deliveries_event_endpoint_uq').on(t.endpointId, t.eventId, t.replayOf).nullsNotDistinct(),
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    tenantFk('webhook_deliveries_endpoint_fk', t.tenantId, t.endpointId, webhookEndpoints, 'cascade'),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** Public lookup part of the key, for example "ubk_live_ab12cd34". */
    prefix: text('prefix').notNull().unique(),
    keyHash: text('key_hash').notNull(),
    kind: text('kind', { enum: ['secret', 'publishable'] }).notNull().default('secret'),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: tstz('last_used_at'),
    expiresAt: tstz('expires_at'),
    revokedAt: tstz('revoked_at'),
    createdById: uuid('created_by_id'),
    ...timestamps,
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    /** Null for platform-level actions. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt), index('audit_logs_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);
