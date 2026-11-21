import type { Router } from 'express';
import type { AppContext } from '../context';
import { createRouteBuilder } from '../http/route';
import { registerIdentityRoutes } from '../modules/identity/routes';
import { registerTenancyRoutes } from '../modules/tenancy/routes';
import { registerStaffRoutes } from '../modules/staff/routes';
import { registerConfigRoutes } from '../modules/config/routes';
import { registerCatalogRoutes } from '../modules/catalog/routes';
import { registerResourceRoutes } from '../modules/resources/routes';
import { registerAvailabilityRoutes } from '../modules/availability/routes';
import { registerPricingRoutes } from '../modules/pricing/routes';
import { registerBookingRoutes } from '../modules/bookings/routes';
import { registerCustomerRoutes } from '../modules/customers/routes';
import { registerIntegrationRoutes } from '../modules/integrations/routes';
import { registerPaymentRoutes } from '../modules/payments/routes';
import { registerNotificationRoutes } from '../modules/notifications/routes';
import { registerReportRoutes } from '../modules/reports/routes';
import { registerFileRoutes } from '../modules/files/routes';

export function registerRoutes(app: AppContext, router: Router): void {
  const route = createRouteBuilder(app, router);
  registerIdentityRoutes(route);
  registerTenancyRoutes(route);
  registerStaffRoutes(route);
  registerConfigRoutes(route);
  registerCatalogRoutes(route);
  registerResourceRoutes(route);
  registerAvailabilityRoutes(route);
  registerPricingRoutes(route);
  registerCustomerRoutes(route);
  registerIntegrationRoutes(route);
  registerPaymentRoutes(route);
  registerNotificationRoutes(route);
  registerReportRoutes(route);
  registerFileRoutes(route);
  registerBookingRoutes(route);

  route({
    method: 'get',
    path: '/meta/openapi.json',
    summary: 'OpenAPI 3.1 document for this API',
    tags: ['Meta'],
    auth: 'none',
    tenant: 'none',
    status: 200,
    async handler({ app: a }) {
      return a.registry.document({
        title: a.env.APP_NAME,
        version: '0.1.0',
        description: 'Universal Booking API — industry-independent reservations, availability, and payments.',
        serverUrl: `${a.env.APP_URL}${a.env.API_PREFIX}`,
      });
    },
  });
}