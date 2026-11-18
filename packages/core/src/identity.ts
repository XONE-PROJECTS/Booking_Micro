import type { PermissionKey } from './permissions';

export type AuthenticationSource = 'internal' | 'external' | 'api_key' | 'integration_token' | 'guest_token' | 'anonymous';

/** Normalized identity produced by every authentication adapter. */
export interface IdentityContext {
  principalId: string | null;
  principalType: 'user' | 'api_key' | 'customer' | 'anonymous';
  tenantId: string | null;
  roles: string[];
  permissions: PermissionKey[];
  source: AuthenticationSource;
  isPlatformAdmin: boolean;
  customerId?: string | null;
  /** For guest booking-access tokens: the single booking this identity may access. */
  bookingId?: string | null;
  email?: string | null;
}

export const anonymousIdentity = (tenantId: string | null = null): IdentityContext => ({
  principalId: null,
  principalType: 'anonymous',
  tenantId,
  roles: [],
  permissions: [],
  source: 'anonymous',
  isPlatformAdmin: false,
});

export function hasPermission(identity: IdentityContext, permission: PermissionKey): boolean {
  return identity.isPlatformAdmin || identity.permissions.includes(permission);
}
