import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { errors, offsetOf, pageMeta, newId } from '@universal-booking/core';
import {
  createCheckoutInput,
  idParam,
  pageQuery,
  paymentProviderInput,
  paymentView,
  recordPaymentInput,
  refundInput,
} from '@universal-booking/contracts';
import { bookings, paymentProviders, payments, refunds } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { createCheckout, checkoutUrls } from './checkout';
import { recordManualPayment } from './record';
import { paymentView as toPaymentView } from './view';
import { ensureSingleDefault, providerContext, scrubProvider } from './providers';
import { dec } from '@universal-booking/core';
export function registerPaymentRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/payment-providers',
    summary: 'List configured payment providers',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.configure',
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const rows = await t.select().from(paymentProviders).orderBy(desc(paymentProviders.createdAt)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows.map(scrubProvider), pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'post',
    path: '/payment-providers',
    summary: 'Add a payment provider configuration',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.configure',
    body: paymentProviderInput,
    async handler({ app, tx, tenant, body, audit }) {
      const id = newId();
      return tx(async (t) => {
        await t.insert(paymentProviders).values({
          id,
          tenantId: tenant.id,
          provider: body.provider,
          name: body.name,
          mode: body.mode,
          status: body.status,
          isDefault: body.isDefault,
          credentialsEncrypted: body.credentials ? app.secrets.encryptJson(body.credentials) : null,
          settings: body.settings,
        });
        await ensureSingleDefault(t, tenant.id, id, body.isDefault);
        await audit({ action: 'payment_provider.created', entityType: 'PaymentProvider', entityId: id }, t);
        const [row] = await t.select().from(paymentProviders).where(eq(paymentProviders.id, id));
        return Reply.created(scrubProvider(row!));
      });
    },
  });

  route({
    method: 'patch',
    path: '/payment-providers/:id',
    summary: 'Update a payment provider',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.configure',
    params: idParam,
    body: z.object({
      provider: z.enum(['manual', 'cash', 'paymongo', 'xendit', 'stripe']).optional(),
      name: z.string().min(1).max(80).optional(),
      mode: z.enum(['test', 'live']).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      isDefault: z.boolean().optional(),
      credentials: z.record(z.string(), z.string().max(500)).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }),
    async handler({ app, tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [existing] = await t.select().from(paymentProviders).where(eq(paymentProviders.id, params.id));
        if (!existing) throw errors.notFound('Payment provider');
        const patch: Record<string, unknown> = { updatedAt: app.now() };
        if (body.name !== undefined) patch.name = body.name;
        if (body.mode !== undefined) patch.mode = body.mode;
        if (body.status !== undefined) patch.status = body.status;
        if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
        if (body.settings !== undefined) patch.settings = body.settings;
        if (body.credentials !== undefined) patch.credentialsEncrypted = app.secrets.encryptJson(body.credentials);
        await t.update(paymentProviders).set(patch).where(eq(paymentProviders.id, params.id));
        if (body.isDefault) await ensureSingleDefault(t, tenant.id, params.id, true);
        await audit({ action: 'payment_provider.updated', entityType: 'PaymentProvider', entityId: params.id }, t);
        const [row] = await t.select().from(paymentProviders).where(eq(paymentProviders.id, params.id));
        return scrubProvider(row!);
      });
    },
  });

  route({
    method: 'get',
    path: '/payments',
    summary: 'List tenant payments (reconciliation)',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.read',
    query: pageQuery.extend({
      status: z.string().max(40).optional(),
      provider: z.string().max(40).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    async handler({ tx, query }) {
      return tx(async (t) => {
        const conds = [sql`true`];
        if (query.status) conds.push(eq(payments.status, query.status as typeof payments.$inferSelect.status));
        if (query.provider) conds.push(eq(payments.provider, query.provider));
        const where = and(...conds);
        const rows = await t.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows.map(toPaymentView), pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'get',
    path: '/bookings/:id/payments',
    summary: 'List payments for a booking',
    tags: ['Payments'],
    auth: 'user',
    anyPermission: ['payments.read', 'bookings.read'],
    params: idParam,
    async handler({ tx, params }) {
      return tx(async (t) => {
        const rows = await t.select().from(payments).where(eq(payments.bookingId, params.id)).orderBy(desc(payments.createdAt));
        return rows.map(toPaymentView);
      });
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/payments/record',
    summary: 'Record a manual or cash payment',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.record',
    params: idParam,
    body: recordPaymentInput,
    response: paymentView,
    async handler({ app, tx, tenant, identity, params, body, audit }) {
      return tx(async (t) => {
        const result = await recordManualPayment(app, t, tenant.id, params.id, body, identity.principalId);
        await audit({ action: 'payment.recorded', entityType: 'Payment', entityId: result.payment.id, changes: { amount: body.amount } }, t);
        return Reply.created(toPaymentView(result.payment));
      });
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/payments/checkout',
    summary: 'Start an online payment checkout session',
    tags: ['Payments'],
    auth: 'userOrApiKey',
    anyPermission: ['payments.record', 'customer.self'],
    params: idParam,
    body: createCheckoutInput,
    response: paymentView,
    async handler({ app, tx, tenant, params, body }) {
      return tx(async (t) => {
        const row = await createCheckout(app, t, tenant.id, params.id, body, checkoutUrls(app, tenant.slug, body, params.id));
        return Reply.created(toPaymentView(row));
      });
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/bookings/:id/checkout',
    summary: 'Public checkout for a guest booking',
    tags: ['Public', 'Payments'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), id: z.uuid() }),
    body: createCheckoutInput,
    response: paymentView,
    async handler({ app, tx, tenant, params, body }) {
      return tx(async (t) => {
        const row = await createCheckout(app, t, tenant.id, params.id, body, checkoutUrls(app, tenant.slug, body, params.id));
        return Reply.created(toPaymentView(row));
      });
    },
  });

  route({
    method: 'post',
    path: '/bookings/:bookingId/payments/:paymentId/refund',
    summary: 'Refund a payment',
    tags: ['Payments'],
    auth: 'user',
    permission: 'payments.refund',
    params: z.object({ bookingId: z.uuid(), paymentId: z.uuid() }),
    body: refundInput,
    async handler({ app, tx, tenant, identity, params, body, audit }) {
      return tx(async (t) => {
        const [payment] = await t
          .select()
          .from(payments)
          .where(and(eq(payments.id, params.paymentId), eq(payments.bookingId, params.bookingId)));
        if (!payment) throw errors.notFound('Payment');
        if (payment.status !== 'succeeded') throw errors.policy('Only successful payments can be refunded.');
        if (dec(body.amount).greaterThan(dec(payment.amount).minus(payment.amountRefunded))) {
          throw errors.policy('Refund amount exceeds the remaining paid balance.');
        }

        const adapter = app.paymentProviders.get(payment.provider);
        const [providerRow] = payment.providerId ? await t.select().from(paymentProviders).where(eq(paymentProviders.id, payment.providerId)) : [];
        let providerRefundId = `manual_refund_${Date.now()}`;
        if (providerRow && payment.providerPaymentId) {
          const result = await adapter.refund(
            {
              providerPaymentId: payment.providerPaymentId,
              amount: body.amount,
              currency: payment.currency,
              reason: body.reason,
            },
            providerContext(app, providerRow),
          );
          providerRefundId = result.providerRefundId;
        }

        const refundId = newId();
        await t.insert(refunds).values({
          id: refundId,
          tenantId: tenant.id,
          paymentId: payment.id,
          bookingId: params.bookingId,
          amount: body.amount,
          reason: body.reason,
          status: 'succeeded',
          providerRefundId,
          createdById: identity.principalId,
        });
        await t
          .update(payments)
          .set({ amountRefunded: dec(payment.amountRefunded).plus(body.amount).toFixed(4), status: 'partially_refunded' })
          .where(eq(payments.id, payment.id));
        const [booking] = await t.select().from(bookings).where(eq(bookings.id, params.bookingId));
        if (booking) {
          await t
            .update(bookings)
            .set({ amountRefunded: dec(booking.amountRefunded).plus(body.amount).toFixed(4), paymentStatus: 'partially_refunded', updatedAt: app.now() })
            .where(eq(bookings.id, booking.id));
        }
        await audit({ action: 'payment.refunded', entityType: 'Payment', entityId: payment.id, changes: { amount: body.amount } }, t);
        return Reply.created({ id: refundId, amount: body.amount, status: 'succeeded' });
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/payments/webhooks/:provider',
    summary: 'Payment provider webhook (signature verified)',
    tags: ['Integrations', 'Payments'],
    auth: 'none',
    tenant: 'none',
    params: z.object({ provider: z.enum(['manual', 'cash', 'paymongo', 'xendit', 'stripe']) }),
    async handler({ app, req, params }) {
      const rawBody = req.rawBody?.toString('utf8') ?? '';
      if (!rawBody) throw errors.badRequest('Webhook body is required.');
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
      const { handleProviderWebhook } = await import('./webhook-handler');
      return handleProviderWebhook(app, params.provider, rawBody, headers);
    },
  });
}