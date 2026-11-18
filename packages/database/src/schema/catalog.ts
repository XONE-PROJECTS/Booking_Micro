import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { BookingDefinition } from '@universal-booking/core';
import { money, pk, tenantFk, timestamps, tstz } from './columns';
import { bookingDefinitions, bookingPolicies, formDefinitions, workflowDefinitions } from './config';
import { resources } from './resources';
import { tenantIdColumn as tenantId } from './tenancy';

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: pk(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('service_categories_slug_uq').on(t.tenantId, t.slug),
    unique('service_categories_tenant_id_uq').on(t.tenantId, t.id),
    tenantFk('service_categories_parent_fk', t.tenantId, t.parentId, { tenantId: t.tenantId as AnyPgColumn, id: t.id as AnyPgColumn }),
  ],
);

/** Pricing configuration attached to a service and snapshotted into each published version. */
export interface ServicePricingConfig {
  strategy: string;
  configuration: Record<string, unknown>;
}

export const services = pgTable(
  'services',
  {
    id: pk(),
    tenantId: tenantId(),
    categoryId: uuid('category_id'),
    bookingDefinitionId: uuid('booking_definition_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    imageUrl: text('image_url'),
    gallery: jsonb('gallery').$type<string[]>().notNull().default([]),
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('public'),
    currency: text('currency').notNull().default('PHP'),
    basePrice: money('base_price').notNull().default('0'),
    /** Working copy of the booking definition; published versions hold the immutable snapshot. */
    definition: jsonb('definition').$type<BookingDefinition>().notNull(),
    pricing: jsonb('pricing').$type<ServicePricingConfig>().notNull().default({ strategy: 'fixed', configuration: {} }),
    formId: uuid('form_id'),
    workflowId: uuid('workflow_id'),
    policyId: uuid('policy_id'),
    currentVersionId: uuid('current_version_id'),
    currentVersion: integer('current_version').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: tstz('published_at'),
    archivedAt: tstz('archived_at'),
    ...timestamps,
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    unique('services_slug_uq').on(t.tenantId, t.slug),
    unique('services_tenant_id_uq').on(t.tenantId, t.id),
    index('services_tenant_status_idx').on(t.tenantId, t.status),
    tenantFk('services_category_fk', t.tenantId, t.categoryId, serviceCategories),
    tenantFk('services_booking_definition_fk', t.tenantId, t.bookingDefinitionId, bookingDefinitions),
    tenantFk('services_form_fk', t.tenantId, t.formId, formDefinitions),
    tenantFk('services_workflow_fk', t.tenantId, t.workflowId, workflowDefinitions),
    tenantFk('services_policy_fk', t.tenantId, t.policyId, bookingPolicies),
  ],
);

export interface ServiceSnapshot {
  name: string;
  currency: string;
  basePrice: string;
  definition: BookingDefinition;
  pricing: ServicePricingConfig;
  formId: string | null;
  workflowId: string | null;
  policyId: string | null;
  resourceIds: string[];
  options: { id: string; name: string; price: string; chargeType: string; maxQuantity: number | null; required: boolean }[];
}

export const serviceVersions = pgTable(
  'service_versions',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<ServiceSnapshot>().notNull(),
    publishedById: uuid('published_by_id'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('service_versions_version_uq').on(t.tenantId, t.serviceId, t.version),
    unique('service_versions_tenant_id_uq').on(t.tenantId, t.id),
    // Versions outlive service deletion attempts: bookings reference them.
    tenantFk('service_versions_service_fk', t.tenantId, t.serviceId, services, 'restrict'),
  ],
);

export const serviceOptions = pgTable(
  'service_options',
  {
    id: pk(),
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    price: money('price').notNull().default('0'),
    chargeType: text('charge_type', { enum: ['per_booking', 'per_unit', 'per_night', 'per_day', 'per_guest', 'per_session'] })
      .notNull()
      .default('per_booking'),
    maxQuantity: integer('max_quantity'),
    required: boolean('required').notNull().default(false),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [unique('service_options_tenant_id_uq').on(t.tenantId, t.id), tenantFk('service_options_service_fk', t.tenantId, t.serviceId, services, 'cascade')],
);

export const serviceResources = pgTable(
  'service_resources',
  {
    tenantId: tenantId(),
    serviceId: uuid('service_id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    allocationRule: text('allocation_rule', { enum: ['any', 'preferred', 'fixed'] }).notNull().default('any'),
    priority: integer('priority').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.resourceId] }),
    tenantFk('service_resources_service_fk', t.tenantId, t.serviceId, services, 'cascade'),
    tenantFk('service_resources_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
  ],
);
