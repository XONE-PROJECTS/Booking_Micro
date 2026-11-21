import { eq } from 'drizzle-orm';
import { AppError, errors } from '@universal-booking/core';
import { PaymentWebhookError } from '@universal-booking/payment-providers';
import { paymentProviders, payments, type Tx } from '@universal-booking/database';
import type { AppContext } from '../../context';
import { applyPaymentOutcome, loadPaymentByProviderRef } from './apply';
import { providerContext, type ProviderRow } from './providers';

function parsePaymentId(rawBody: string): string | undefined {
  try {
    const json = JSON.parse(rawBody) as { data?: { attributes?: { metadata?: { payment_id?: string } } } };
    return json.data?.attributes?.metadata?.payment_id;
  } catch {
    return undefined;
  }
}

async function providerRowForPayment(tx: Tx, payment: typeof payments.$inferSelect): Promise<ProviderRow> {
  if (!payment.providerId) throw errors.configuration('Payment has no provider configured.');
  const [row] = await tx.select().from(paymentProviders).where(eq(paymentProviders.id, payment.providerId));
  if (!row) throw errors.notFound('Payment provider');
  return row;
}

export async function handleProviderWebhook(
  app: AppContext,
  providerType: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
) {
  if (!app.paymentProviders.has(providerType)) throw errors.notFound('Payment provider');

  const paymentId = parsePaymentId(rawBody);

  return app.db.system(async (sysTx) => {
    let payment = paymentId ? (await sysTx.select().from(payments).where(eq(payments.id, paymentId)))[0] : undefined;

    const adapter = app.paymentProviders.get(providerType);

    if (!payment) {
      try {
        const unverified = await adapter.verifyWebhook({ rawBody, headers }, { credentials: {}, settings: {}, mode: 'test' });
        if (unverified?.providerPaymentId) {
          payment = await loadPaymentByProviderRef(sysTx, providerType, unverified.providerPaymentId);
        }
      } catch {
        // signature check will run again once credentials are loaded
      }
    }
    if (!payment) throw errors.notFound('Payment');

    const providerRow = await providerRowForPayment(sysTx, payment);
    let verified;
    try {
      verified = await adapter.verifyWebhook({ rawBody, headers }, providerContext(app, providerRow));
    } catch (e) {
      if (e instanceof PaymentWebhookError) throw new AppError('UNAUTHENTICATED', e.message);
      throw e;
    }
    if (!verified) return { handled: false as const };

    const status =
      verified.status === 'succeeded' ? 'succeeded' : verified.status === 'failed' ? 'failed' : verified.status === 'expired' ? 'expired' : 'cancelled';

    return app.db.tenant(payment.tenantId, async (tx) => {
      const outcome = await applyPaymentOutcome(app, tx, {
        tenantId: payment!.tenantId,
        paymentId: payment!.id,
        status,
        amount: verified.amount,
        currency: verified.currency,
        paidAt: verified.status === 'succeeded' ? new Date() : undefined,
        provider: providerType,
        providerPaymentId: verified.providerPaymentId,
        providerEventId: verified.eventId,
        txType: 'webhook',
        raw: (verified.raw as Record<string, unknown>) ?? {},
      });
      return { handled: true as const, duplicate: outcome.duplicate, paymentId: payment!.id };
    });
  });
}