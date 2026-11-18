import { hmacSha256Hex, safeEqual } from '@universal-booking/core/node';
import { basicAuth, fromMinor, headerValue, requestJson, requireCredential, toMinor } from './http';
import { PaymentWebhookError, type PaymentProvider, type ProviderPaymentStatus } from './types';

// ---------------------------------------------------------------------------
// Offline providers: staff record the payment; nothing to verify remotely.
// ---------------------------------------------------------------------------

function offline(type: 'manual' | 'cash', label: string): PaymentProvider {
  return {
    type,
    label,
    online: false,
    credentialFields: [],
    async createPayment(input) {
      return { providerPaymentId: `${type}_${input.paymentId}`, status: 'pending' };
    },
    async verifyPayment() {
      return { status: 'pending' };
    },
    async refund(input) {
      return { providerRefundId: `${type}_refund_${input.providerPaymentId}_${Date.now()}`, status: 'succeeded' };
    },
    async verifyWebhook() {
      throw new PaymentWebhookError(`${label} payments do not receive webhooks.`);
    },
  };
}

export const manualProvider = offline('manual', 'Manual / bank transfer');
export const cashProvider = offline('cash', 'Cash');

// ---------------------------------------------------------------------------
// PayMongo (Philippines): Checkout Sessions API
// ---------------------------------------------------------------------------

const paymongoBase = 'https://api.paymongo.com/v1';

type PaymongoSession = {
  data: {
    id: string;
    attributes: {
      checkout_url?: string;
      status?: string;
      payments?: { id: string; attributes: { status: string; amount: number; currency: string; paid_at?: number } }[];
      payment_intent?: { id: string; attributes?: { status?: string } };
    };
  };
};

export const paymongoProvider: PaymentProvider = {
  type: 'paymongo',
  label: 'PayMongo',
  online: true,
  credentialFields: [
    { key: 'secretKey', label: 'Secret key', secret: true, required: true },
    { key: 'webhookSecret', label: 'Webhook signing secret', secret: true, required: true },
  ],
  async createPayment(input, ctx) {
    const auth = basicAuth(requireCredential(ctx, 'secretKey'));
    const methods = input.methods?.length ? input.methods : ((ctx.settings.methods as string[] | undefined) ?? ['gcash', 'paymaya', 'card', 'grab_pay', 'qrph']);
    const body = {
      data: {
        attributes: {
          line_items: [{ name: input.description.slice(0, 255), amount: toMinor(input.amount, input.currency), currency: input.currency, quantity: 1 }],
          payment_method_types: methods,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          reference_number: input.bookingReference,
          description: input.description.slice(0, 255),
          billing: { name: input.customer.name, email: input.customer.email ?? undefined, phone: input.customer.phone ?? undefined },
          send_email_receipt: false,
          metadata: { payment_id: input.paymentId, ...input.metadata },
        },
      },
    };
    const res = await requestJson<PaymongoSession>(ctx, `${paymongoBase}/checkout_sessions`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { providerPaymentId: res.data.id, status: 'pending', checkoutUrl: res.data.attributes.checkout_url, raw: { id: res.data.id } };
  },
  async verifyPayment(id, ctx) {
    const res = await requestJson<PaymongoSession>(ctx, `${paymongoBase}/checkout_sessions/${encodeURIComponent(id)}`, { headers: { authorization: basicAuth(requireCredential(ctx, 'secretKey')) } });
    const paid = res.data.attributes.payments?.find((p) => p.attributes.status === 'paid');
    if (paid) {
      return {
        status: 'succeeded',
        amount: fromMinor(paid.attributes.amount, paid.attributes.currency),
        currency: paid.attributes.currency,
        paidAt: paid.attributes.paid_at ? new Date(paid.attributes.paid_at * 1000) : new Date(),
        providerReference: paid.id,
      };
    }
    const status: ProviderPaymentStatus = res.data.attributes.status === 'expired' ? 'expired' : 'pending';
    return { status };
  },
  async refund(input, ctx) {
    const res = await requestJson<{ data: { id: string; attributes: { status: string } } }>(ctx, `${paymongoBase}/refunds`, {
      method: 'POST',
      headers: { authorization: basicAuth(requireCredential(ctx, 'secretKey')), 'content-type': 'application/json' },
      body: JSON.stringify({ data: { attributes: { amount: toMinor(input.amount, input.currency), payment_id: input.providerReference ?? input.providerPaymentId, reason: 'requested_by_customer', notes: input.reason } } }),
    });
    return { providerRefundId: res.data.id, status: res.data.attributes.status === 'succeeded' ? 'succeeded' : 'pending' };
  },
  async verifyWebhook({ rawBody, headers }, ctx) {
    const header = headerValue(headers, 'paymongo-signature');
    if (!header) throw new PaymentWebhookError('Missing Paymongo-Signature header.');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const expected = hmacSha256Hex(requireCredential(ctx, 'webhookSecret'), `${parts.t}.${rawBody}`);
    const given = ctx.mode === 'live' ? parts.li : parts.te;
    if (!given || !safeEqual(expected, given)) throw new PaymentWebhookError('Invalid PayMongo signature.');
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) throw new PaymentWebhookError('Stale PayMongo webhook.');
    const event = JSON.parse(rawBody) as { data: { id: string; attributes: { type: string; data: { id: string; attributes: Record<string, unknown> } } } };
    const type = event.data.attributes.type;
    const resource = event.data.attributes.data;
    if (type === 'checkout_session.payment.paid') {
      const payments = (resource.attributes.payments as { id: string; attributes: { amount: number; currency: string } }[] | undefined) ?? [];
      const p = payments[0];
      return {
        eventId: event.data.id,
        type,
        providerPaymentId: resource.id,
        status: 'succeeded',
        amount: p ? fromMinor(p.attributes.amount, p.attributes.currency) : undefined,
        currency: p?.attributes.currency,
        providerReference: p?.id,
      };
    }
    if (type === 'payment.failed') {
      const sessionId = (resource.attributes.metadata as Record<string, string> | undefined)?.checkout_session_id;
      if (!sessionId) return null;
      return { eventId: event.data.id, type, providerPaymentId: sessionId, status: 'failed' };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Xendit (Southeast Asia): Invoices API
// ---------------------------------------------------------------------------

const xenditBase = 'https://api.xendit.co';
type XenditInvoice = { id: string; status: string; invoice_url?: string; amount?: number; paid_amount?: number; currency?: string; paid_at?: string; expiry_date?: string; payment_id?: string };

const xenditStatus = (s: string): ProviderPaymentStatus => (s === 'PAID' || s === 'SETTLED' ? 'succeeded' : s === 'EXPIRED' ? 'expired' : 'pending');

export const xenditProvider: PaymentProvider = {
  type: 'xendit',
  label: 'Xendit',
  online: true,
  credentialFields: [
    { key: 'secretKey', label: 'Secret API key', secret: true, required: true },
    { key: 'callbackToken', label: 'Webhook verification token', secret: true, required: true },
  ],
  async createPayment(input, ctx) {
    const res = await requestJson<XenditInvoice>(ctx, `${xenditBase}/v2/invoices`, {
      method: 'POST',
      headers: { authorization: basicAuth(requireCredential(ctx, 'secretKey')), 'content-type': 'application/json' },
      body: JSON.stringify({
        external_id: input.paymentId,
        amount: Number(input.amount),
        currency: input.currency,
        description: input.description,
        payer_email: input.customer.email ?? undefined,
        customer: { given_names: input.customer.name, email: input.customer.email ?? undefined, mobile_number: input.customer.phone ?? undefined },
        success_redirect_url: input.successUrl,
        failure_redirect_url: input.cancelUrl,
        invoice_duration: input.expiresAt ? Math.max(300, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)) : undefined,
        payment_methods: input.methods,
        metadata: input.metadata,
      }),
    });
    return { providerPaymentId: res.id, status: 'pending', checkoutUrl: res.invoice_url, expiresAt: res.expiry_date ? new Date(res.expiry_date) : undefined };
  },
  async verifyPayment(id, ctx) {
    const res = await requestJson<XenditInvoice>(ctx, `${xenditBase}/v2/invoices/${encodeURIComponent(id)}`, { headers: { authorization: basicAuth(requireCredential(ctx, 'secretKey')) } });
    return {
      status: xenditStatus(res.status),
      amount: res.paid_amount !== undefined ? String(res.paid_amount) : undefined,
      currency: res.currency,
      paidAt: res.paid_at ? new Date(res.paid_at) : undefined,
      providerReference: res.payment_id ?? res.id,
    };
  },
  async refund(input, ctx) {
    const res = await requestJson<{ id: string; status: string }>(ctx, `${xenditBase}/refunds`, {
      method: 'POST',
      headers: { authorization: basicAuth(requireCredential(ctx, 'secretKey')), 'content-type': 'application/json', 'idempotency-key': `${input.providerPaymentId}-${input.amount}` },
      body: JSON.stringify({ invoice_id: input.providerPaymentId, amount: Number(input.amount), currency: input.currency, reason: 'REQUESTED_BY_CUSTOMER' }),
    });
    return { providerRefundId: res.id, status: res.status === 'SUCCEEDED' ? 'succeeded' : res.status === 'FAILED' ? 'failed' : 'pending' };
  },
  async verifyWebhook({ rawBody, headers }, ctx) {
    const token = headerValue(headers, 'x-callback-token');
    if (!token || !safeEqual(token, requireCredential(ctx, 'callbackToken'))) throw new PaymentWebhookError('Invalid Xendit callback token.');
    const body = JSON.parse(rawBody) as XenditInvoice & { external_id?: string; id: string; updated?: string };
    const status = xenditStatus(body.status);
    if (status === 'pending') return null;
    return {
      eventId: `${body.id}:${body.status}`,
      type: `invoice.${body.status.toLowerCase()}`,
      providerPaymentId: body.id,
      status,
      amount: body.paid_amount !== undefined ? String(body.paid_amount) : undefined,
      currency: body.currency,
      providerReference: body.payment_id,
    };
  },
};

// ---------------------------------------------------------------------------
// Stripe: Checkout Sessions API
// ---------------------------------------------------------------------------

const stripeBase = 'https://api.stripe.com/v1';
type StripeSession = { id: string; url?: string; status?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string | null; expires_at?: number };

export const stripeProvider: PaymentProvider = {
  type: 'stripe',
  label: 'Stripe',
  online: true,
  credentialFields: [
    { key: 'secretKey', label: 'Secret key', secret: true, required: true },
    { key: 'webhookSecret', label: 'Webhook signing secret', secret: true, required: true },
  ],
  async createPayment(input, ctx) {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.paymentId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toMinor(input.amount, input.currency)),
      'line_items[0][price_data][product_data][name]': input.description.slice(0, 250),
      'metadata[payment_id]': input.paymentId,
      'metadata[booking_reference]': input.bookingReference,
    });
    if (input.customer.email) form.set('customer_email', input.customer.email);
    if (input.expiresAt) form.set('expires_at', String(Math.max(Math.floor(Date.now() / 1000) + 1800, Math.floor(input.expiresAt.getTime() / 1000))));
    const res = await requestJson<StripeSession>(ctx, `${stripeBase}/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${requireCredential(ctx, 'secretKey')}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': input.paymentId },
      body: form,
    });
    return { providerPaymentId: res.id, status: 'pending', checkoutUrl: res.url, expiresAt: res.expires_at ? new Date(res.expires_at * 1000) : undefined };
  },
  async verifyPayment(id, ctx) {
    const res = await requestJson<StripeSession>(ctx, `${stripeBase}/checkout/sessions/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${requireCredential(ctx, 'secretKey')}` } });
    const currency = (res.currency ?? 'usd').toUpperCase();
    if (res.payment_status === 'paid') {
      return { status: 'succeeded', amount: res.amount_total !== undefined ? fromMinor(res.amount_total, currency) : undefined, currency, paidAt: new Date(), providerReference: res.payment_intent ?? undefined };
    }
    return { status: res.status === 'expired' ? 'expired' : 'pending' };
  },
  async refund(input, ctx) {
    const form = new URLSearchParams({ amount: String(toMinor(input.amount, input.currency)) });
    if (input.providerReference) form.set('payment_intent', input.providerReference);
    const res = await requestJson<{ id: string; status: string }>(ctx, `${stripeBase}/refunds`, {
      method: 'POST',
      headers: { authorization: `Bearer ${requireCredential(ctx, 'secretKey')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    return { providerRefundId: res.id, status: res.status === 'succeeded' ? 'succeeded' : res.status === 'failed' ? 'failed' : 'pending' };
  },
  async verifyWebhook({ rawBody, headers }, ctx) {
    const header = headerValue(headers, 'stripe-signature');
    if (!header) throw new PaymentWebhookError('Missing Stripe-Signature header.');
    const pairs = header.split(',').map((p) => p.split('=') as [string, string]);
    const t = pairs.find(([k]) => k === 't')?.[1];
    const sigs = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
    const expected = hmacSha256Hex(requireCredential(ctx, 'webhookSecret'), `${t}.${rawBody}`);
    if (!t || !sigs.some((s) => safeEqual(s, expected))) throw new PaymentWebhookError('Invalid Stripe signature.');
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new PaymentWebhookError('Stale Stripe webhook.');
    const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: StripeSession } };
    const s = event.data.object;
    const currency = (s.currency ?? 'usd').toUpperCase();
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status !== 'paid') return null;
      return { eventId: event.id, type: event.type, providerPaymentId: s.id, status: 'succeeded', amount: s.amount_total !== undefined ? fromMinor(s.amount_total, currency) : undefined, currency, providerReference: s.payment_intent ?? undefined };
    }
    if (event.type === 'checkout.session.expired') return { eventId: event.id, type: event.type, providerPaymentId: s.id, status: 'expired' };
    if (event.type === 'checkout.session.async_payment_failed') return { eventId: event.id, type: event.type, providerPaymentId: s.id, status: 'failed' };
    return null;
  },
};
