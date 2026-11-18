import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { BookingDefinition, FormSchema } from '@universal-booking/core';
import type { WorkflowDefinition } from '@universal-booking/workflow-engine';
import type { BookingPolicy } from '@universal-booking/booking-engine';
import { pk, tenantFk, timestamps, tstz } from './columns';
import { tenantIdColumn as tenantId } from './tenancy';

const versionStatus = ['draft', 'published', 'archived'] as const;

/**
 * Versioned configuration rows share a family id; each edit to a published version creates a new row.
 * Services and bookings pin the exact version row they were built from.
 */
export const formDefinitions = pgTable(
  'form_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    familyId: uuid('family_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: versionStatus }).notNull().default('draft'),
    schema: jsonb('schema').$type<FormSchema>().notNull(),
    publishedAt: tstz('published_at'),
    ...timestamps,
  },
  (t) => [unique('form_definitions_family_version_uq').on(t.tenantId, t.familyId, t.version), unique('form_definitions_tenant_id_uq').on(t.tenantId, t.id)],
);

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    familyId: uuid('family_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: versionStatus }).notNull().default('draft'),
    isDefault: boolean('is_default').notNull().default(false),
    definition: jsonb('definition').$type<WorkflowDefinition>().notNull(),
    publishedAt: tstz('published_at'),
    ...timestamps,
  },
  (t) => [unique('workflow_definitions_family_version_uq').on(t.tenantId, t.familyId, t.version), unique('workflow_definitions_tenant_id_uq').on(t.tenantId, t.id)],
);

/** Materialized from workflow_definitions.definition for reporting and filtering; the JSON stays authoritative. */
export const workflowStatuses = pgTable(
  'workflow_statuses',
  {
    id: pk(),
    tenantId: tenantId(),
    workflowId: uuid('workflow_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    category: text('category').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique('workflow_statuses_key_uq').on(t.workflowId, t.key), tenantFk('workflow_statuses_workflow_fk', t.tenantId, t.workflowId, workflowDefinitions, 'cascade')],
);

export const workflowTransitions = pgTable(
  'workflow_transitions',
  {
    id: pk(),
    tenantId: tenantId(),
    workflowId: uuid('workflow_id').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    action: text('action').notNull(),
    permissions: text('permissions').array().notNull(),
    guards: text('guards').array().notNull(),
    customerAllowed: boolean('customer_allowed').notNull().default(false),
  },
  (t) => [index('workflow_transitions_workflow_idx').on(t.workflowId), tenantFk('workflow_transitions_workflow_fk', t.tenantId, t.workflowId, workflowDefinitions, 'cascade')],
);

export const bookingPolicies = pgTable(
  'booking_policies',
  {
    id: pk(),
    tenantId: tenantId(),
    familyId: uuid('family_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: versionStatus }).notNull().default('draft'),
    isDefault: boolean('is_default').notNull().default(false),
    policy: jsonb('policy').$type<BookingPolicy>().notNull(),
    publishedAt: tstz('published_at'),
    ...timestamps,
  },
  (t) => [unique('booking_policies_family_version_uq').on(t.tenantId, t.familyId, t.version), unique('booking_policies_tenant_id_uq').on(t.tenantId, t.id)],
);

/** Reusable booking types ("custom booking types" in the admin), versioned like forms. */
export const bookingDefinitions = pgTable(
  'booking_definitions',
  {
    id: pk(),
    tenantId: tenantId(),
    familyId: uuid('family_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    strategy: text('strategy').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: versionStatus }).notNull().default('draft'),
    definition: jsonb('definition').$type<BookingDefinition>().notNull(),
    publishedAt: tstz('published_at'),
    ...timestamps,
  },
  (t) => [unique('booking_definitions_family_version_uq').on(t.tenantId, t.familyId, t.version), unique('booking_definitions_tenant_id_uq').on(t.tenantId, t.id)],
);
