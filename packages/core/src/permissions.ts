export const permissionKeys = [
  'business.read',
  'business.manage',
  'settings.manage',
  'branding.manage',
  'catalog.read',
  'catalog.manage',
  'resources.read',
  'resources.manage',
  'availability.read',
  'availability.manage',
  'pricing.read',
  'pricing.manage',
  'forms.manage',
  'workflows.manage',
  'policies.manage',
  'bookings.read',
  'bookings.read_assigned',
  'bookings.create',
  'bookings.update',
  'bookings.confirm',
  'bookings.approve',
  'bookings.cancel',
  'bookings.reschedule',
  'bookings.check_in',
  'bookings.export',
  'customers.read',
  'customers.manage',
  'staff.manage',
  'payments.read',
  'payments.record',
  'payments.refund',
  'payments.configure',
  'notifications.manage',
  'integrations.manage',
  'reports.read',
  'audit.read',
  'files.upload',
  'customer.self',
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

export const systemRoles = ['business_admin', 'staff', 'customer'] as const;
export type SystemRole = (typeof systemRoles)[number];

const staffPermissions: PermissionKey[] = [
  'business.read',
  'catalog.read',
  'resources.read',
  'availability.read',
  'pricing.read',
  'bookings.read_assigned',
  'bookings.update',
  'bookings.check_in',
  'customers.read',
  'payments.read',
  'files.upload',
];

export const defaultRolePermissions: Record<SystemRole, { name: string; description: string; permissions: PermissionKey[] }> = {
  business_admin: {
    name: 'Business Administrator',
    description: 'Configures and manages everything inside one business.',
    permissions: permissionKeys.filter((p) => p !== 'customer.self'),
  },
  staff: {
    name: 'Staff / Operator',
    description: 'Handles assigned bookings, check-ins and schedules.',
    permissions: staffPermissions,
  },
  customer: {
    name: 'Customer',
    description: 'Books services and manages their own reservations.',
    permissions: ['customer.self'],
  },
};

/** Platform-level role; granted through users.is_platform_admin rather than tenant memberships. */
export const SUPER_ADMIN = 'super_admin';
