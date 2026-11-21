import { and, eq } from 'drizzle-orm';
import { hashOpaqueToken } from '@universal-booking/auth';
import type { IdentityContext } from '@universal-booking/core';
import { errors } from '@universal-booking/core';
import { bookings, type Tx } from '@universal-booking/database';

export async function assertGuestBookingToken(t: Tx, tenantId: string, bookingId: string, token: string) {
  const [row] = await t.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)));
  if (!row) throw errors.notFound('Booking');
  if (row.accessTokenHash !== hashOpaqueToken(token)) throw errors.forbidden();
  return row;
}

export function guestBookingIdentity(tenantId: string, bookingId: string): IdentityContext {
  return {
    principalId: null,
    principalType: 'customer',
    tenantId,
    roles: ['customer'],
    permissions: ['customer.self'],
    source: 'guest_token',
    isPlatformAdmin: false,
    bookingId,
  };
}