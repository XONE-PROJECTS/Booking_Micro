import { eq } from 'drizzle-orm';
import { dec, errors, newId } from '@universal-booking/core';
import { bookings, payments, type Tx } from '@universal-booking/database';
import type { RecordPaymentInput } from '@universal-booking/contracts';
import type { AppContext } from '../../context';
import { applyPaymentOutcome } from './apply';
import { resolvePayableAmount } from './amounts';

export async function recordManualPayment(
  app: AppContext,
  tx: Tx,
  tenantId: string,
  bookingId: string,
  body: RecordPaymentInput,
  recordedById: string | null,
) {
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) throw errors.notFound('Booking');

  const amount = String(body.amount);
  if (dec(amount).greaterThan(dec(resolvePayableAmount(booking, 'full')))) {
    throw errors.policy('Recorded amount is greater than the balance due.');
  }

  const paymentId = newId();
  const providerPaymentId = `${body.provider}_${paymentId}`;
  await tx.insert(payments).values({
    id: paymentId,
    tenantId,
    bookingId: booking.id,
    provider: body.provider ?? 'manual',
    method: body.method ?? 'cash',
    kind: body.kind ?? 'full',
    amount,
    currency: booking.currency,
    status: 'pending',
    providerPaymentId,
    reference: body.reference ?? null,
    recordedById,
    metadata: body.notes ? { notes: body.notes } : {},
  });

  const result = await applyPaymentOutcome(app, tx, {
    tenantId,
    paymentId,
    status: 'succeeded',
    amount,
    currency: booking.currency,
    paidAt: app.now(),
    provider: body.provider ?? 'manual',
    providerPaymentId,
    providerEventId: `manual_${paymentId}`,
    txType: 'manual',
    raw: { notes: body.notes },
  });

  const [paymentRow] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  return { ...result, payment: paymentRow! };
}