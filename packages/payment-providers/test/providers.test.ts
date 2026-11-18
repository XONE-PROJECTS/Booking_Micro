import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '@universal-booking/core/node';
import { fromMinor, paymongoProvider, stripeProvider, toMinor, xenditProvider, type ProviderContext } from '../src';

const ctx = (credentials: Record<string, string>, fetchImpl?: typeof fetch): ProviderContext => ({ credentials, settings: {}, mode: 'test', fetch: fetchImpl });

describe('payment providers', () => {
  it('converts minor units', () => {
    expect(toMinor('1500.50', 'PHP')).toBe(150050);
    expect(fromMinor(150050, 'PHP')).toBe('1500.50');
    expect(toMinor('1000', 'JPY')).toBe(1000);
  });

  it('verifies PayMongo webhook signatures', async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      data: { id: 'evt_1', attributes: { type: 'checkout_session.payment.paid', data: { id: 'cs_1', attributes: { payments: [{ id: 'pay_1', attributes: { amount: 150000, currency: 'PHP' } }] } } } },
    });
    const te = hmacSha256Hex('whsec', `${t}.${body}`);
    const ev = await paymongoProvider.verifyWebhook({ rawBody: body, headers: { 'paymongo-signature': `t=${t},te=${te},li=` } }, ctx({ secretKey: 'sk', webhookSecret: 'whsec' }));
    expect(ev).toMatchObject({ eventId: 'evt_1', providerPaymentId: 'cs_1', status: 'succeeded', amount: '1500.00', providerReference: 'pay_1' });
    await expect(paymongoProvider.verifyWebhook({ rawBody: body, headers: { 'paymongo-signature': `t=${t},te=bad,li=` } }, ctx({ secretKey: 'sk', webhookSecret: 'whsec' }))).rejects.toThrow();
  });

  it('verifies Stripe webhook signatures', async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_s', type: 'checkout.session.completed', data: { object: { id: 'cs_s', payment_status: 'paid', amount_total: 2500, currency: 'usd', payment_intent: 'pi_1' } } });
    const v1 = hmacSha256Hex('whsec_s', `${t}.${body}`);
    const ev = await stripeProvider.verifyWebhook({ rawBody: body, headers: { 'Stripe-Signature': `t=${t},v1=${v1}` } }, ctx({ secretKey: 'sk', webhookSecret: 'whsec_s' }));
    expect(ev).toMatchObject({ providerPaymentId: 'cs_s', amount: '25.00', currency: 'USD', providerReference: 'pi_1' });
  });

  it('verifies Xendit callback tokens', async () => {
    const body = JSON.stringify({ id: 'inv_1', status: 'PAID', paid_amount: 1500, currency: 'PHP' });
    const ev = await xenditProvider.verifyWebhook({ rawBody: body, headers: { 'x-callback-token': 'tok' } }, ctx({ secretKey: 'sk', callbackToken: 'tok' }));
    expect(ev).toMatchObject({ providerPaymentId: 'inv_1', status: 'succeeded', amount: '1500' });
    await expect(xenditProvider.verifyWebhook({ rawBody: body, headers: { 'x-callback-token': 'nope' } }, ctx({ secretKey: 'sk', callbackToken: 'tok' }))).rejects.toThrow();
  });

  it('creates PayMongo checkout sessions with minor-unit amounts', async () => {
    let sent: { attributes: { line_items: { amount: number }[] } } | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)).data;
      return new Response(JSON.stringify({ data: { id: 'cs_new', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_new' } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await paymongoProvider.createPayment(
      { paymentId: 'p1', bookingReference: 'BOOK-2026-000001', amount: '3500.00', currency: 'PHP', description: 'Deluxe Room', customer: { name: 'Juan' }, successUrl: 'https://x/ok', cancelUrl: 'https://x/cancel' },
      ctx({ secretKey: 'sk', webhookSecret: 'w' }, fakeFetch),
    );
    expect(r.checkoutUrl).toContain('cs_new');
    expect(sent!.attributes.line_items[0]!.amount).toBe(350000);
  });
});
