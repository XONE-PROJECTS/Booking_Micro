import { eq } from 'drizzle-orm';
import { errors, newId } from '@universal-booking/core';
import { bookings, customers, payments, type Tx } from '@universal-booking/database';
import type { CreateCheckoutInput } from '@universal-booking/contracts';
import type { AppContext } from '../../context';
import { resolvePayableAmount } from './amounts';
import { providerContext, resolveCheckoutProvider } from './providers';

export async function createCheckout(
  app: AppContext,
  tx: Tx,
  tenantId: string,
  bookingId: string,
  body: CreateCheckoutInput,
  urls: { success: string; cancel: string },
) {
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) throw errors.notFound('Booking');

  const amount = resolvePayableAmount(booking, body.amount);
  if (Number(amount) <= 0) throw errors.validation('Nothing is due for this booking.', [{ path: 'amount', message: 'Zero balance' }]);

  const providerRow = await resolveCheckoutProvider(tx, tenantId, body.providerId);
  const adapter = app.paymentProviders.get(providerRow.provider);
  if (!adapter.online) throw errors.validation('This provider does not support online checkout.', [{ path: 'providerId', message: 'Offline provider' }]);

  const [customer] = booking.customerId ? await tx.select().from(customers).where(eq(customers.id, booking.customerId)) : [];
  const paymentId = newId();
  const ctx = providerContext(app, providerRow);
  const created = await adapter.createPayment(
    {
      paymentId,
      bookingReference: booking.reference,
      amount,
      currency: booking.currency,
      description: `Booking ${booking.reference}`,
      customer: {
        name: customer ? `${customer.firstName} ${customer.lastName ?? ''}`.trim() : 'Guest',
        email: customer?.email,
        phone: customer?.phone,
      },
      successUrl: urls.success,
      cancelUrl: urls.cancel,
      methods: body.method ? [body.method] : undefined,
      metadata: { payment_id: paymentId, booking_id: bookingId, tenant_id: tenantId },
    },
    ctx,
  );

  await tx.insert(payments).values({
    id: paymentId,
    tenantId,
    bookingId: booking.id,
    providerId: providerRow.id,
    provider: providerRow.provider,
    method: body.method,
    kind: body.amount === 'due_now' ? 'deposit' : 'full',
    amount,
    currency: booking.currency,
    status: created.status === 'succeeded' ? 'succeeded' : 'pending',
    providerPaymentId: created.providerPaymentId,
    checkoutUrl: created.checkoutUrl,
    expiresAt: created.expiresAt,
  });

  const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  return row!;
}

export function checkoutUrls(app: AppContext, tenantSlug: string, body: CreateCheckoutInput, bookingId: string) {
  const portal = app.env.PORTAL_APP_URL.replace(/\/$/, '');
  return {
    success: body.successUrl ?? `${portal}/${tenantSlug}/bookings/${bookingId}?paid=1`,
    cancel: body.cancelUrl ?? `${portal}/${tenantSlug}/bookings/${bookingId}?cancelled=1`,
  };
}