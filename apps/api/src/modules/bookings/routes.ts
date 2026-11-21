import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { errors, offsetOf, pageMeta } from '@universal-booking/core';
import { bookingChargeInput, bookingListQuery, bookingLookupInput, bookingTransitionInput, createBookingInput, guestInput, idParam, rescheduleInput } from '@universal-booking/contracts';
import { bookings, services } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { createBookingRecord } from './create';
import { rescheduleBooking } from './reschedule';
import { buildBookingView, loadWorkflowForBooking } from './views';
import { parseWorkflow } from '@universal-booking/workflow-engine';
import { emitEvent } from '../events/outbox';
import { eventForStatus } from '@universal-booking/contracts';
import { applyBookingTransition } from './transition';
import { lookupBooking } from './lookup';
import { assertGuestBookingToken, guestBookingIdentity } from './guest-access';
import { addCharge, addGuests, deleteGuest, listCharges, listGuests } from './guests-charges';

function bookingSource(identity: { source: string; permissions: string[] }): 'portal' | 'admin' | 'api' | 'integration' {
  if (identity.source === 'integration_token') return 'integration';
  if (identity.source === 'api_key') return 'api';
  if (identity.permissions.includes('bookings.create')) return 'admin';
  return 'portal';
}

function bookingActor(identity: { source: string; permissions: string[] }): 'customer' | 'staff' | 'integration' {
  if (identity.source === 'integration_token') return 'integration';
  if (identity.permissions.includes('bookings.create')) return 'staff';
  return 'customer';
}

export function registerBookingRoutes(route: RouteBuilder) {
  route({
    method: 'post',
    path: '/bookings',
    summary: 'Create a booking (hold or confirm path via workflow)',
    tags: ['Bookings'],
    auth: 'userOrApiKey',
    anyPermission: ['bookings.create', 'customer.self'],
    body: createBookingInput,
    idempotent: true,
    async handler({ app, tx, tenant, identity, body, audit }) {
      const result = await tx((t) =>
        createBookingRecord(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          referencePrefix: tenant.referencePrefix,
          holdMinutes: body.hold ? tenant.holdMinutes : tenant.holdMinutes,
          body,
          actor: bookingActor(identity),
          source: bookingSource(identity),
          customerUserId: identity.customerId ? identity.principalId : null,
          createdById: identity.principalId,
        }),
      );
      await audit({ action: 'booking.created', entityType: 'Booking', entityId: result.row.id, changes: { reference: result.row.reference } });
      const wf = await tx((t) => loadWorkflowForBooking(t, result.row.workflowId));
      const view = await tx((t) => buildBookingView(t, result.row, wf ?? undefined));
      view.service = { id: result.row.serviceId, name: result.serviceName, version: result.serviceVersion };
      if (result.accessToken) (view as { accessToken?: string }).accessToken = result.accessToken;
      return Reply.created(view);
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/bookings',
    summary: 'Create a booking from the public portal',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: createBookingInput
      .omit({ serviceId: true })
      .extend({ serviceId: z.uuid().optional(), serviceSlug: z.string().optional() })
      .refine((b) => b.serviceId || b.serviceSlug, { message: 'serviceId or serviceSlug is required' }),
    idempotent: true,
    async handler({ app, tx, tenant, body, audit, req }) {
      if (!tenant.guestBookingEnabled) throw errors.forbidden('Guest booking is disabled for this business.');
      let resolved = body;
      if (!body.serviceId && body.serviceSlug) {
        const [s] = await tx((t) => t.select({ id: services.id }).from(services).where(eq(services.slug, body.serviceSlug!)));
        if (!s) throw errors.notFound('Service');
        resolved = { ...body, serviceId: s.id };
      }
      if (!resolved.serviceId) throw errors.badRequest('serviceId or serviceSlug is required');
      const bookingBody = { ...resolved, serviceId: resolved.serviceId };
      const result = await tx((t) =>
        createBookingRecord(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          referencePrefix: tenant.referencePrefix,
          holdMinutes: tenant.holdMinutes,
          body: bookingBody,
          actor: 'customer',
          source: 'portal',
        }),
      );
      await audit({ action: 'booking.created', entityType: 'Booking', entityId: result.row.id, changes: { reference: result.row.reference, ip: req.ip } });
      const wf = await tx((t) => loadWorkflowForBooking(t, result.row.workflowId));
      const view = await tx((t) => buildBookingView(t, result.row, wf ?? undefined));
      view.service = { id: result.row.serviceId, name: result.serviceName, version: result.serviceVersion };
      if (result.accessToken) (view as { accessToken?: string }).accessToken = result.accessToken;
      return Reply.created(view);
    },
  });

  route({
    method: 'get',
    path: '/bookings',
    summary: 'List bookings',
    tags: ['Bookings'],
    auth: 'user',
    anyPermission: ['bookings.read', 'bookings.read_assigned'],
    query: bookingListQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const conds = [sql`true`];
        if (query.status) conds.push(inArray(bookings.status, query.status.split(',')));
        if (query.serviceId) conds.push(eq(bookings.serviceId, query.serviceId));
        if (query.customerId) conds.push(eq(bookings.customerId, query.customerId));
        if (query.from) conds.push(gte(bookings.startAt, new Date(`${query.from}T00:00:00Z`)));
        if (query.to) conds.push(lte(bookings.startAt, new Date(`${query.to}T23:59:59Z`)));
        const where = and(...conds);
        const [{ count }] = (await t.select({ count: sql<number>`count(*)::int` }).from(bookings).where(where)) as [{ count: number }];
        const rows = await t.select().from(bookings).where(where).orderBy(desc(bookings.startAt)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, count));
      });
    },
  });

  route({
    method: 'get',
    path: '/bookings/:id',
    summary: 'Get one booking',
    tags: ['Bookings'],
    auth: 'userOrApiKey',
    anyPermission: ['bookings.read', 'bookings.read_assigned', 'customer.self'],
    params: idParam,
    async handler({ tx, identity, params }) {
      return tx(async (t) => {
        const [row] = await t.select().from(bookings).where(eq(bookings.id, params.id));
        if (!row) throw errors.notFound('Booking');
        if (identity.bookingId && identity.bookingId !== row.id) throw errors.forbidden();
        if (identity.customerId && row.customerId !== identity.customerId) throw errors.forbidden();
        const wf = await loadWorkflowForBooking(t, row.workflowId);
        const view = await buildBookingView(t, row, wf ?? undefined);
        const [svc] = await t.select({ name: services.name }).from(services).where(eq(services.id, row.serviceId));
        view.service.name = svc?.name ?? '';
        return view;
      });
    },
  });

  route({
    method: 'post',
    path: '/bookings/lookup',
    summary: 'Look up a booking by reference and email or access token',
    tags: ['Bookings'],
    auth: 'none',
    tenant: 'required',
    body: bookingLookupInput,
    async handler({ tx, tenant, body }) {
      return tx(async (t) => lookupBooking(t, tenant.id, body));
    },
  });

  const guestTokenBody = bookingTransitionInput.extend({ token: z.string().min(16).max(200) });
  const guestRescheduleBody = rescheduleInput.extend({ token: z.string().min(16).max(200) });

  route({
    method: 'get',
    path: '/public/:businessSlug/bookings/:id',
    summary: 'Guest booking detail using access token',
    tags: ['Public', 'Bookings'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), id: z.uuid() }),
    query: z.object({ token: z.string().min(16) }),
    async handler({ tx, tenant, params, query }) {
      return tx(async (t) => {
        await assertGuestBookingToken(t, tenant.id, params.id, query.token);
        const [row] = await t.select().from(bookings).where(eq(bookings.id, params.id));
        const wf = await loadWorkflowForBooking(t, row!.workflowId);
        return buildBookingView(t, row!, wf ?? undefined);
      });
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/bookings/:id/transitions/:action',
    summary: 'Guest workflow action with booking access token',
    tags: ['Public', 'Bookings'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), id: z.uuid(), action: z.string() }),
    body: guestTokenBody,
    async handler({ app, tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const row = await assertGuestBookingToken(t, tenant.id, params.id, body.token);
        const identity = guestBookingIdentity(tenant.id, row.id);
        const wfRow = await loadWorkflowForBooking(t, row.workflowId);
        if (!wfRow) throw errors.configuration('Workflow missing.');
        const workflow = parseWorkflow(wfRow.definition);
        const { updated, resolved } = await applyBookingTransition(t, {
          row,
          workflow,
          action: params.action,
          identity,
          reason: body.reason,
          now: app.now(),
        });
        await audit({ action: `booking.${params.action}`, entityType: 'Booking', entityId: row.id, changes: { guest: true } }, t);
        app.realtime.publish(tenant.id, 'bookings', `booking.${params.action}`, { id: row.id, reference: row.reference });
        return buildBookingView(t, updated, wfRow);
      });
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/bookings/:id/reschedule',
    summary: 'Guest reschedule with booking access token',
    tags: ['Public', 'Bookings'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), id: z.uuid() }),
    body: guestRescheduleBody,
    async handler({ app, tx, tenant, params, body, audit }) {
      const { token, ...rescheduleBody } = body;
      return tx(async (t) => {
        await assertGuestBookingToken(t, tenant.id, params.id, token);
        const updated = await rescheduleBooking(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          bookingId: params.id,
          body: rescheduleBody,
          actor: 'customer',
        });
        await audit({ action: 'booking.rescheduled', entityType: 'Booking', entityId: params.id, changes: { guest: true } }, t);
        const wf = await loadWorkflowForBooking(t, updated.workflowId);
        return buildBookingView(t, updated, wf ?? undefined);
      });
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/bookings/lookup',
    summary: 'Public booking lookup by reference and email or token',
    tags: ['Public', 'Bookings'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: bookingLookupInput,
    async handler({ tx, tenant, body }) {
      return tx(async (t) => lookupBooking(t, tenant.id, body));
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/transitions/:action',
    summary: 'Apply a workflow action (cancel, approve, confirm, …)',
    tags: ['Bookings'],
    auth: 'userOrApiKey',
    params: z.object({ id: z.uuid(), action: z.string() }),
    body: bookingTransitionInput,
    async handler({ app, tx, identity, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [row] = await t.select().from(bookings).where(eq(bookings.id, params.id));
        if (!row) throw errors.notFound('Booking');
        const wfRow = await loadWorkflowForBooking(t, row.workflowId);
        if (!wfRow) throw errors.configuration('Workflow missing.');
        const workflow = parseWorkflow(wfRow.definition);
        const { updated, resolved } = await applyBookingTransition(t, {
          row,
          workflow,
          action: params.action,
          identity,
          reason: body.reason,
          now: app.now(),
        });
        const ev = eventForStatus(resolved.transition.to, resolved.toCategory);
        if (ev) {
          await emitEvent(t, {
            tenantId: tenant.id,
            type: ev,
            aggregateType: 'booking',
            aggregateId: row.id,
            payload: { reference: row.reference, action: params.action, reason: body.reason },
            notify: resolved.transition.effects
              ?.filter((e): e is { type: 'notify'; template: string } => e.type === 'notify' && !!e.template)
              .map((e) => e.template),
          });
        }
        await audit({ action: `booking.${params.action}`, entityType: 'Booking', entityId: row.id, changes: { reason: body.reason } }, t);
        app.realtime.publish(tenant.id, 'bookings', `booking.${params.action}`, { id: row.id, reference: row.reference });
        return buildBookingView(t, updated, wfRow);
      });
    },
  });

  route({
    method: 'get',
    path: '/bookings/:id/guests',
    summary: 'List guests on a booking',
    tags: ['Bookings'],
    auth: 'user',
    permission: 'bookings.read',
    params: idParam,
    async handler({ tx, tenant, params }) {
      return tx(async (t) => listGuests(t, tenant.id, params.id));
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/guests',
    summary: 'Add guests to a booking',
    tags: ['Bookings'],
    auth: 'user',
    permission: 'bookings.update',
    params: idParam,
    body: z.object({ guests: z.array(guestInput).min(1).max(100) }),
    async handler({ tx, tenant, params, body }) {
      return tx(async (t) => addGuests(t, tenant.id, params.id, body.guests));
    },
  });

  route({
    method: 'delete',
    path: '/bookings/:id/guests/:guestId',
    summary: 'Remove a guest',
    tags: ['Bookings'],
    auth: 'user',
    permission: 'bookings.update',
    params: z.object({ id: z.uuid(), guestId: z.uuid() }),
    status: 204,
    async handler({ tx, tenant, params }) {
      await tx(async (t) => deleteGuest(t, tenant.id, params.id, params.guestId));
      return null;
    },
  });

  route({
    method: 'get',
    path: '/bookings/:id/charges',
    summary: 'List charges on a booking',
    tags: ['Bookings'],
    auth: 'user',
    permission: 'bookings.read',
    params: idParam,
    async handler({ tx, tenant, params }) {
      return tx(async (t) => listCharges(t, tenant.id, params.id));
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/charges',
    summary: 'Add a charge to a booking',
    tags: ['Bookings'],
    auth: 'user',
    permission: 'bookings.update',
    params: idParam,
    body: bookingChargeInput,
    async handler({ tx, tenant, identity, params, body, audit }) {
      return tx(async (t) => {
        const row = await addCharge(t, tenant.id, params.id, body, identity.principalId);
        await audit({ action: 'booking.charge_added', entityType: 'Booking', entityId: params.id, changes: { amount: body.amount } }, t);
        return row;
      });
    },
  });

  route({
    method: 'post',
    path: '/bookings/:id/reschedule',
    summary: 'Reschedule a booking (re-validates availability)',
    tags: ['Bookings'],
    auth: 'userOrApiKey',
    anyPermission: ['bookings.reschedule', 'customer.self'],
    params: idParam,
    body: rescheduleInput,
    async handler({ app, tx, tenant, identity, params, body, audit }) {
      const actor = identity.permissions.includes('customer.self') && !identity.permissions.includes('bookings.reschedule') ? 'customer' : 'staff';
      return tx(async (t) => {
        const updated = await rescheduleBooking(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          bookingId: params.id,
          body,
          actor,
        });
        await audit({ action: 'booking.rescheduled', entityType: 'Booking', entityId: params.id, changes: { reason: body.reason } }, t);
        const wf = await loadWorkflowForBooking(t, updated.workflowId);
        return buildBookingView(t, updated, wf ?? undefined);
      });
    },
  });
}