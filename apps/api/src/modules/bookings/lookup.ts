import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { hashOpaqueToken } from '@universal-booking/auth';
import type { bookingLookupInput } from '@universal-booking/contracts';
import { errors } from '@universal-booking/core';
import { bookings, customers, type Tx } from '@universal-booking/database';
import { buildBookingView, loadWorkflowForBooking } from './views';

type LookupBody = z.infer<typeof bookingLookupInput>;

export async function lookupBooking(t: Tx, tenantId: string, body: LookupBody) {
  const [row] = await t.select().from(bookings).where(and(eq(bookings.reference, body.reference), eq(bookings.tenantId, tenantId)));
  if (!row) throw errors.notFound('Booking');
  if (body.token) {
    if (row.accessTokenHash !== hashOpaqueToken(body.token)) throw errors.forbidden();
  } else if (body.email) {
    const [c] = row.customerId ? await t.select().from(customers).where(eq(customers.id, row.customerId)) : [];
    if (!c || c.email?.toLowerCase() !== body.email.toLowerCase()) throw errors.forbidden();
  } else throw errors.validation('Provide email or token.', [{ path: 'token', message: 'Required' }]);
  const wf = await loadWorkflowForBooking(t, row.workflowId);
  return buildBookingView(t, row, wf ?? undefined);
}