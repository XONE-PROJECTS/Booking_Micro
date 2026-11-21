import { eq } from 'drizzle-orm';
import { errors } from '@universal-booking/core';
import { customerInput, customerNoteInput, idParam } from '@universal-booking/contracts';
import { customerNotes, customers } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { crudRoutes } from '../../http/crud';

export function registerCustomerRoutes(route: RouteBuilder) {
  crudRoutes(route, {
    path: '/customers',
    tag: 'Customers',
    entity: 'Customer',
    table: customers,
    input: customerInput,
    readPermission: 'customers.read',
    writePermission: 'customers.manage',
    search: [customers.firstName, customers.lastName, customers.email],
    softDelete: customers.deletedAt,
    toValues: (b) => ({
      firstName: b.firstName,
      lastName: b.lastName,
      email: b.email,
      phone: b.phone,
      locale: b.locale,
      attributes: b.attributes ?? {},
      marketingConsent: b.marketingConsent ?? false,
      type: 'registered',
    }),
  });

  route({
    method: 'post',
    path: '/customers/:id/notes',
    summary: 'Add an internal customer note',
    tags: ['Customers'],
    auth: 'user',
    permission: 'customers.manage',
    params: idParam,
    body: customerNoteInput,
    async handler({ tx, tenant, identity, params, body, audit }) {
      return tx(async (t) => {
        const [c] = await t.select({ id: customers.id }).from(customers).where(eq(customers.id, params.id));
        if (!c) throw errors.notFound('Customer');
        const [note] = (await t
          .insert(customerNotes)
          .values({ tenantId: tenant.id, customerId: params.id, authorId: identity.principalId, body: body.body })
          .returning()) as (typeof customerNotes.$inferSelect)[];
        await audit({ action: 'customer.note_added', entityType: 'Customer', entityId: params.id }, t);
        return Reply.created(note);
      });
    },
  });
}