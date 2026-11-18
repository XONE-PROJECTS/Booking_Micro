import { and, eq, sql } from 'drizzle-orm';
import { defaultRolePermissions, newId, permissionKeys, systemRoles, type PermissionKey } from '@universal-booking/core';
import { defaultWorkflow, type WorkflowDefinition } from '@universal-booking/workflow-engine';
import { defaultPolicy } from '@universal-booking/booking-engine';
import type { Executor } from './client';
import {
  bookingPolicies,
  businessProfiles,
  membershipRoles,
  notificationTemplates,
  permissions,
  rolePermissions,
  roles,
  tenantBranding,
  tenantMemberships,
  tenants,
  tenantSettings,
  workflowDefinitions,
  workflowStatuses,
  workflowTransitions,
} from './schema';

const permissionGroups: Record<string, string> = {
  business: 'Business',
  settings: 'Settings',
  branding: 'Branding',
  catalog: 'Catalog',
  resources: 'Resources',
  availability: 'Availability',
  pricing: 'Pricing',
  forms: 'Forms',
  workflows: 'Workflows',
  policies: 'Policies',
  bookings: 'Bookings',
  customers: 'Customers',
  staff: 'Staff',
  payments: 'Payments',
  notifications: 'Notifications',
  integrations: 'Integrations',
  reports: 'Reports',
  audit: 'Audit',
  files: 'Files',
  customer: 'Customer self-service',
};

export function describePermission(key: PermissionKey): { group: string; description: string } {
  const [group, action] = key.split('.') as [string, string];
  return { group: permissionGroups[group] ?? group, description: `${action.replace(/_/g, ' ')} ${group.replace(/_/g, ' ')}` };
}

/** Upserts the global permission catalog. Safe to run on every start. */
export async function syncPermissions(db: Executor): Promise<void> {
  await db
    .insert(permissions)
    .values(permissionKeys.map((key) => ({ key, ...describePermission(key) })))
    .onConflictDoUpdate({ target: permissions.key, set: { group: sql`excluded."group"`, description: sql`excluded.description` } });
}

export interface DefaultTemplate {
  key: string;
  channel: 'email' | 'sms' | 'in_app';
  subject?: string;
  body: string;
}

export const defaultNotificationTemplates: DefaultTemplate[] = [
  { key: 'booking.created', channel: 'email', subject: 'We received your booking {{booking.reference}}', body: 'Hi {{customer.firstName}},\n\nThank you for booking {{service.name}} for {{booking.start}}.\nReference: {{booking.reference}}\nStatus: {{booking.status}}\nTotal: {{booking.total}}\n\nManage your booking: {{links.manage}}\n\n{{business.name}}' },
  { key: 'booking.confirmed', channel: 'email', subject: 'Booking confirmed: {{booking.reference}}', body: 'Hi {{customer.firstName}},\n\nYour booking for {{service.name}} on {{booking.start}} is confirmed.\nReference: {{booking.reference}}\nTotal: {{booking.total}} (paid {{booking.amountPaid}})\n\nManage your booking: {{links.manage}}\n\n{{business.name}}' },
  { key: 'booking.confirmed', channel: 'sms', body: '{{business.name}}: booking {{booking.reference}} confirmed for {{booking.start}}.' },
  { key: 'booking.pending', channel: 'email', subject: 'Booking {{booking.reference}} is awaiting approval', body: 'Hi {{customer.firstName}},\n\nYour request for {{service.name}} on {{booking.start}} is awaiting approval. We will let you know soon.\n\n{{business.name}}' },
  { key: 'booking.rejected', channel: 'email', subject: 'Booking {{booking.reference}} could not be accepted', body: 'Hi {{customer.firstName}},\n\nUnfortunately we could not accept your booking for {{service.name}} on {{booking.start}}.\n{{booking.reason}}\n\n{{business.name}}' },
  { key: 'booking.cancelled', channel: 'email', subject: 'Booking {{booking.reference}} cancelled', body: 'Hi {{customer.firstName}},\n\nYour booking for {{service.name}} on {{booking.start}} was cancelled.\n{{booking.reason}}\n\n{{business.name}}' },
  { key: 'booking.cancelled', channel: 'sms', body: '{{business.name}}: booking {{booking.reference}} was cancelled.' },
  { key: 'booking.rescheduled', channel: 'email', subject: 'Booking {{booking.reference}} rescheduled', body: 'Hi {{customer.firstName}},\n\nYour booking for {{service.name}} is now on {{booking.start}}.\n\n{{business.name}}' },
  { key: 'booking.expired', channel: 'email', subject: 'Booking {{booking.reference}} expired', body: 'Hi {{customer.firstName}},\n\nYour booking hold for {{service.name}} expired before payment was completed.\n\n{{business.name}}' },
  { key: 'booking.reminder', channel: 'email', subject: 'Reminder: {{service.name}} on {{booking.start}}', body: 'Hi {{customer.firstName}},\n\nThis is a reminder of your booking {{booking.reference}} for {{service.name}} on {{booking.start}}.\n\n{{business.name}}' },
  { key: 'booking.reminder', channel: 'sms', body: '{{business.name}} reminder: {{service.name}} on {{booking.start}} (ref {{booking.reference}}).' },
  { key: 'booking.checked_in', channel: 'email', subject: 'Welcome! You are checked in', body: 'Hi {{customer.firstName}},\n\nYou are checked in for {{service.name}}. Enjoy!\n\n{{business.name}}' },
  { key: 'booking.completed', channel: 'email', subject: 'Thank you for visiting {{business.name}}', body: 'Hi {{customer.firstName}},\n\nThank you for choosing {{business.name}}. We hope to see you again.\n' },
  { key: 'payment.succeeded', channel: 'email', subject: 'Payment received for {{booking.reference}}', body: 'Hi {{customer.firstName}},\n\nWe received your payment of {{payment.amount}} for booking {{booking.reference}}.\n\n{{business.name}}' },
  { key: 'payment.failed', channel: 'email', subject: 'Payment failed for {{booking.reference}}', body: 'Hi {{customer.firstName}},\n\nYour payment for booking {{booking.reference}} did not go through. You can try again here: {{links.manage}}\n\n{{business.name}}' },
  { key: 'staff.booking_created', channel: 'in_app', subject: 'New booking {{booking.reference}}', body: '{{customer.name}} booked {{service.name}} for {{booking.start}}.' },
  { key: 'staff.approval_required', channel: 'in_app', subject: 'Approval needed: {{booking.reference}}', body: '{{customer.name}} requested {{service.name}} for {{booking.start}}.' },
];

/** Saves a workflow definition row and its materialized statuses and transitions. */
export async function insertWorkflow(
  db: Executor,
  input: { tenantId: string; definition: WorkflowDefinition; familyId?: string; version?: number; status?: 'draft' | 'published'; isDefault?: boolean; description?: string },
): Promise<string> {
  const id = newId();
  await db.insert(workflowDefinitions).values({
    id,
    tenantId: input.tenantId,
    familyId: input.familyId ?? id,
    name: input.definition.name,
    description: input.description,
    version: input.version ?? 1,
    status: input.status ?? 'published',
    isDefault: input.isDefault ?? false,
    definition: input.definition,
    publishedAt: input.status === 'draft' ? null : new Date(),
  });
  await db.insert(workflowStatuses).values(
    input.definition.statuses.map((s, i) => ({ tenantId: input.tenantId, workflowId: id, key: s.key, label: s.label, category: s.category, color: s.color, sortOrder: i })),
  );
  if (input.definition.transitions.length) {
    await db.insert(workflowTransitions).values(
      input.definition.transitions.map((t) => ({
        tenantId: input.tenantId,
        workflowId: id,
        fromStatus: t.from,
        toStatus: t.to,
        action: t.action,
        permissions: t.permissions,
        guards: t.guards,
        customerAllowed: t.customerAllowed,
      })),
    );
  }
  return id;
}

export interface ProvisionTenantInput {
  slug: string;
  name: string;
  timezone?: string;
  currency?: string;
  locale?: string;
  /** Existing user who becomes the Business Administrator. */
  ownerUserId?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  roleIds: Record<string, string>;
  workflowId: string;
  policyId: string;
  membershipId?: string;
}

/**
 * Creates a tenant with everything it needs to take bookings: settings, branding, profile,
 * system roles with default permissions, the default workflow and policy, and notification templates.
 * Run inside a system transaction.
 */
export async function provisionTenant(db: Executor, input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  const tenantId = newId();
  await db.insert(tenants).values({ id: tenantId, slug: input.slug, name: input.name });
  await db.insert(businessProfiles).values({ tenantId, displayName: input.name });

  const roleIds: Record<string, string> = {};
  for (const key of systemRoles) {
    const def = defaultRolePermissions[key];
    const id = newId();
    roleIds[key] = id;
    await db.insert(roles).values({ id, tenantId, key, name: def.name, description: def.description, isSystem: true });
    await db.insert(rolePermissions).values(def.permissions.map((permissionKey) => ({ tenantId, roleId: id, permissionKey })));
  }

  const workflowId = await insertWorkflow(db, { tenantId, definition: defaultWorkflow, isDefault: true, description: 'Default booking lifecycle.' });
  const policyId = newId();
  await db.insert(bookingPolicies).values({ id: policyId, tenantId, familyId: policyId, name: 'Standard policy', policy: defaultPolicy, status: 'published', isDefault: true, publishedAt: new Date() });

  await db.insert(tenantSettings).values({
    tenantId,
    timezone: input.timezone ?? 'Asia/Manila',
    currency: input.currency ?? 'PHP',
    locale: input.locale ?? 'en-PH',
    defaultWorkflowId: workflowId,
    defaultPolicyId: policyId,
  });
  await db.insert(tenantBranding).values({ tenantId, portal: { catalogLayout: 'grid', showPrices: true, heroTitle: input.name } });
  await db.insert(notificationTemplates).values(defaultNotificationTemplates.map((t) => ({ tenantId, key: t.key, channel: t.channel, subject: t.subject, body: t.body, locale: input.locale ?? 'en-PH' })));

  let membershipId: string | undefined;
  if (input.ownerUserId) membershipId = await addMember(db, tenantId, input.ownerUserId, roleIds.business_admin!);
  return { tenantId, roleIds, workflowId, policyId, membershipId };
}

export async function addMember(db: Executor, tenantId: string, userId: string, roleId: string): Promise<string> {
  const existing = await db.select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
  const membershipId = existing[0]?.id ?? newId();
  if (!existing[0]) await db.insert(tenantMemberships).values({ id: membershipId, tenantId, userId });
  await db.insert(membershipRoles).values({ tenantId, membershipId, roleId }).onConflictDoNothing();
  return membershipId;
}
