import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { quoteInput } from '@universal-booking/contracts';
import { errors } from '@universal-booking/core';
import { services } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { loadServiceVersion } from '../catalog/services';
import { quoteForService } from './load';
import { registerPricingAdminRoutes } from './admin-routes';

export function registerPricingRoutes(route: RouteBuilder) {
  registerPricingAdminRoutes(route);
  route({
    method: 'post',
    path: '/pricing/quote',
    summary: 'Price a booking request without reserving inventory',
    tags: ['Pricing'],
    auth: 'userOrApiKey',
    anyPermission: ['pricing.read', 'bookings.create', 'customer.self'],
    body: quoteInput,
    async handler({ app, tx, tenant, identity, body }) {
      const actor = identity.permissions.includes('bookings.create') ? 'staff' : identity.source === 'integration_token' ? 'integration' : 'customer';
      const { version } = await tx((t) => loadServiceVersion(t, body.serviceId));
      const { plan } = await tx((t) =>
        quoteForService(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          snap: version.snapshot,
          serviceId: body.serviceId,
          request: body,
          promoCode: body.promoCode,
          options: body.options,
          actor,
        }),
      );
      return { pricing: plan.pricing, available: plan.availability.available, paymentRequired: plan.paymentRequired, approvalRequired: plan.approvalRequired };
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/pricing/quote',
    summary: 'Public price quote',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: quoteInput
      .omit({ serviceId: true })
      .extend({ serviceId: z.uuid().optional(), serviceSlug: z.string().optional() })
      .refine((b) => b.serviceId || b.serviceSlug, { message: 'serviceId or serviceSlug is required' }),
    async handler({ app, tx, tenant, body }) {
      let serviceId = body.serviceId;
      if (!serviceId && body.serviceSlug) {
        const [s] = await tx((t) => t.select({ id: services.id }).from(services).where(eq(services.slug, body.serviceSlug!)));
        if (!s) throw errors.notFound('Service');
        serviceId = s.id;
      }
      if (!serviceId) throw errors.badRequest('serviceId or serviceSlug is required');
      const { version } = await tx((t) => loadServiceVersion(t, serviceId, { requirePublic: true }));
      const { plan } = await tx((t) =>
        quoteForService(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          snap: version.snapshot,
          serviceId,
          request: { ...body, serviceId },
          promoCode: body.promoCode,
          options: body.options?.map((o) => ({ id: o.id, quantity: o.quantity ?? 1 })),
          actor: 'customer',
        }),
      );
      return { pricing: plan.pricing, available: plan.availability.available };
    },
  });
}