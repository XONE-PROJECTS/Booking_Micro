import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { pk, tenantFk, timestamps, tstz } from './columns';
import { tenantIdColumn as tenantId, tenantMemberships } from './tenancy';

const resourceKinds = ['room', 'staff', 'equipment', 'table', 'venue', 'vehicle', 'seat', 'other'] as const;

export const resourceCategories = pgTable(
  'resource_categories',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: resourceKinds }).notNull().default('other'),
    description: text('description'),
    ...timestamps,
  },
  (t) => [unique('resource_categories_slug_uq').on(t.tenantId, t.slug), unique('resource_categories_tenant_id_uq').on(t.tenantId, t.id)],
);

export const resources = pgTable(
  'resources',
  {
    id: pk(),
    tenantId: tenantId(),
    categoryId: uuid('category_id'),
    name: text('name').notNull(),
    code: text('code'),
    kind: text('kind', { enum: resourceKinds }).notNull().default('other'),
    description: text('description'),
    status: text('status', { enum: ['active', 'inactive', 'maintenance', 'archived'] }).notNull().default('active'),
    /** Maximum guests or participants this resource holds (room occupancy, table seats, class size). */
    capacity: integer('capacity'),
    /** Identical units in a pool (for example 10 kayaks). */
    quantity: integer('quantity').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    imageUrl: text('image_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    unique('resources_tenant_id_uq').on(t.tenantId, t.id),
    index('resources_tenant_status_idx').on(t.tenantId, t.status),
    tenantFk('resources_category_fk', t.tenantId, t.categoryId, resourceCategories),
    check('resources_quantity_positive', sql`${t.quantity} >= 1`),
  ],
);

export const resourceAttributes = pgTable(
  'resource_attributes',
  {
    id: pk(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
  },
  (t) => [unique('resource_attributes_key_uq').on(t.resourceId, t.key), tenantFk('resource_attributes_resource_fk', t.tenantId, t.resourceId, resources, 'cascade')],
);

/** Weekly working hours and breaks in the business time zone. */
export const resourceSchedules = pgTable(
  'resource_schedules',
  {
    id: pk(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id').notNull(),
    kind: text('kind', { enum: ['work', 'break'] }).notNull().default('work'),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    ...timestamps,
  },
  (t) => [
    index('resource_schedules_resource_idx').on(t.resourceId),
    tenantFk('resource_schedules_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('resource_schedules_dow', sql`${t.dayOfWeek} between 0 and 6`),
  ],
);

export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: pk(),
    tenantId: tenantId(),
    membershipId: uuid('membership_id'),
    /** The bookable resource representing this staff member, when they can be booked. */
    resourceId: uuid('resource_id'),
    displayName: text('display_name').notNull(),
    title: text('title'),
    bio: text('bio'),
    email: text('email'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('staff_profiles_tenant_id_uq').on(t.tenantId, t.id),
    tenantFk('staff_profiles_membership_fk', t.tenantId, t.membershipId, tenantMemberships),
    tenantFk('staff_profiles_resource_fk', t.tenantId, t.resourceId, resources),
  ],
);

/** Staff responsible for a resource over a period (a housekeeper for a wing, an instructor for a court). */
export const resourceAssignments = pgTable(
  'resource_assignments',
  {
    id: pk(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id').notNull(),
    staffProfileId: uuid('staff_profile_id').notNull(),
    role: text('role'),
    startsAt: tstz('starts_at'),
    endsAt: tstz('ends_at'),
    ...timestamps,
  },
  (t) => [
    tenantFk('resource_assignments_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    tenantFk('resource_assignments_staff_fk', t.tenantId, t.staffProfileId, staffProfiles, 'cascade'),
  ],
);

export const resourceMaintenance = pgTable(
  'resource_maintenance',
  {
    id: pk(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id').notNull(),
    reason: text('reason').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    status: text('status', { enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] }).notNull().default('scheduled'),
    createdById: uuid('created_by_id'),
    ...timestamps,
  },
  (t) => [
    index('resource_maintenance_resource_idx').on(t.resourceId, t.startsAt),
    tenantFk('resource_maintenance_resource_fk', t.tenantId, t.resourceId, resources, 'cascade'),
    check('resource_maintenance_range', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
