import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { errors } from '@universal-booking/core';
import { describeReason } from '@universal-booking/booking-engine';
import { availabilityCalendar, listSlots, searchAvailability } from '@universal-booking/availability-engine';
import {
  availabilityExceptionInput,
  availabilityRuleInput,
  availabilitySearchInput,
  blackoutInput,
  calendarQuery,
  capacityInput,
  id,
  operatingHoursInput,
  slotsQuery,
} from '@universal-booking/contracts';
import { availabilityExceptions, availabilityRules, blackoutDates, capacityDefinitions, operatingHours, services } from '@universal-booking/database';
import type { HandlerContext } from '../../http/route';
import type { RouteBuilder } from '../../http/route';
import { crudRoutes } from '../../http/crud';
import { loadServiceVersion } from '../catalog/services';
import { loadAvailabilityContext } from './context';

type Ctx = HandlerContext<unknown, unknown, unknown>;

function parseParticipants(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return Object.fromEntries(
      raw.split(',').map((p) => {
        const [k, v] = p.split(':');
        return [k!.trim(), Number(v)];
      }),
    );
  }
}

async function buildCtx(c: Ctx, serviceId: string, start: Date, end: Date, requirePublic = false) {
  const { service, version } = await c.tx((t) => loadServiceVersion(t, serviceId, { requirePublic }));
  const snap = version.snapshot;
  const ctx = await c.tx((t) =>
    loadAvailabilityContext(t, {
      tenantId: c.tenant.id,
      timezone: c.tenant.timezone,
      now: c.app.now(),
      definition: snap.definition,
      serviceId: service.id,
      resourceIds: snap.resourceIds,
      window: { start, end },
    }),
  );
  return { service, snap, ctx };
}

function searchResponse(ctx: Awaited<ReturnType<typeof loadAvailabilityContext>>, body: z.infer<typeof availabilitySearchInput>) {
  const result = searchAvailability(ctx, body);
  return {
    available: result.available,
    reasons: result.reasons.map((code) => ({ code, message: describeReason(code) })),
    start: result.duration.periods[0]?.start.toISOString() ?? '',
    end: result.duration.periods.at(-1)?.end.toISOString() ?? '',
    units: result.duration.units,
    occurrences: result.duration.periods.map((p) => ({ start: p.start.toISOString(), end: p.end.toISOString() })),
    options: result.options,
  };
}

export function registerAvailabilityRoutes(route: RouteBuilder) {
  crudRoutes(route, {
    path: '/availability/rules',
    tag: 'Availability',
    entity: 'AvailabilityRule',
    table: availabilityRules,
    input: availabilityRuleInput,
    readPermission: 'availability.read',
    writePermission: 'availability.manage',
    filters: { serviceId: availabilityRules.serviceId },
    toValues: (b) => b,
    only: ['list', 'get', 'create', 'update', 'delete'],
  });

  crudRoutes(route, {
    path: '/availability/exceptions',
    tag: 'Availability',
    entity: 'AvailabilityException',
    table: availabilityExceptions,
    input: availabilityExceptionInput,
    readPermission: 'availability.read',
    writePermission: 'availability.manage',
    toValues: (b) => ({ ...b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) }),
    only: ['list', 'get', 'create', 'update', 'delete'],
  });

  crudRoutes(route, {
    path: '/availability/blackouts',
    tag: 'Availability',
    entity: 'Blackout',
    table: blackoutDates,
    input: blackoutInput,
    readPermission: 'availability.read',
    writePermission: 'availability.manage',
    toValues: (b) => b,
    only: ['list', 'get', 'create', 'delete'],
  });

  crudRoutes(route, {
    path: '/availability/capacity',
    tag: 'Availability',
    entity: 'Capacity',
    table: capacityDefinitions,
    input: capacityInput,
    readPermission: 'availability.read',
    writePermission: 'availability.manage',
    filters: { serviceId: capacityDefinitions.serviceId },
    toValues: (b) => b,
    only: ['list', 'get', 'create', 'update', 'delete'],
  });

  route({
    method: 'get',
    path: '/availability/operating-hours',
    summary: 'List business-wide opening hours',
    tags: ['Availability'],
    auth: 'user',
    permission: 'availability.read',
    async handler({ tx, tenant }) {
      return tx((t) => t.select().from(operatingHours).where(eq(operatingHours.tenantId, tenant.id)).orderBy(asc(operatingHours.dayOfWeek)));
    },
  });

  route({
    method: 'put',
    path: '/availability/operating-hours',
    summary: 'Replace business-wide opening hours',
    tags: ['Availability'],
    auth: 'user',
    permission: 'availability.manage',
    body: operatingHoursInput,
    async handler({ tx, tenant, body, audit }) {
      return tx(async (t) => {
        await t.delete(operatingHours).where(eq(operatingHours.tenantId, tenant.id));
        if (body.hours.length) {
          await t.insert(operatingHours).values(body.hours.map((h) => ({ tenantId: tenant.id, dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime, label: h.label })));
        }
        await audit({ action: 'operating_hours.updated', entityType: 'OperatingHours', entityId: tenant.id }, t);
        return { count: body.hours.length };
      });
    },
  });

  route({
    method: 'post',
    path: '/availability/search',
    summary: 'Search whether a service can be booked',
    tags: ['Availability'],
    auth: 'user',
    permission: 'availability.read',
    body: availabilitySearchInput,
    async handler(c) {
      const body = c.body;
      const end = body.endDate ? new Date(`${body.endDate}T23:59:59Z`) : c.app.now();
      const start = body.startDate ? new Date(`${body.startDate}T00:00:00Z`) : c.app.now();
      const { ctx } = await buildCtx(c, body.serviceId, start, end);
      return searchResponse(ctx, body);
    },
  });

  route({
    method: 'post',
    path: '/public/:businessSlug/availability/search',
    summary: 'Public availability search',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    body: availabilitySearchInput.omit({ serviceId: true }).extend({ serviceId: id.optional(), serviceSlug: z.string().optional() }),
    async handler(c) {
      let serviceId = c.body.serviceId;
      if (!serviceId) {
        if (!c.body.serviceSlug) throw errors.validation('Provide serviceId or serviceSlug.', [{ path: 'serviceSlug', message: 'Required when serviceId is omitted' }]);
        const [s] = await c.tx((t) => t.select({ id: services.id }).from(services).where(eq(services.slug, c.body.serviceSlug!)));
        if (!s) throw errors.notFound('Service');
        serviceId = s.id;
      }
      const body = { ...c.body, serviceId };
      const end = body.endDate ? new Date(`${body.endDate}T23:59:59Z`) : c.app.now();
      const start = body.startDate ? new Date(`${body.startDate}T00:00:00Z`) : c.app.now();
      const { ctx } = await buildCtx(c, serviceId, start, end, true);
      return searchResponse(ctx, body);
    },
  });

  route({
    method: 'get',
    path: '/availability/slots',
    summary: 'List bookable time slots on one date',
    tags: ['Availability'],
    auth: 'user',
    permission: 'availability.read',
    query: slotsQuery,
    async handler(c) {
      const q = c.query;
      const start = new Date(`${q.date}T00:00:00Z`);
      const end = new Date(`${q.date}T23:59:59Z`);
      const { ctx } = await buildCtx(c, q.serviceId, start, end);
      return listSlots(ctx, { ...q, date: q.date, participants: parseParticipants(q.participants), resourceIds: q.resourceId ? [q.resourceId] : undefined });
    },
  });

  route({
    method: 'get',
    path: '/public/:businessSlug/availability/slots',
    summary: 'Public slots for one date',
    tags: ['Public'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    query: slotsQuery,
    async handler(c) {
      const q = c.query;
      const start = new Date(`${q.date}T00:00:00Z`);
      const end = new Date(`${q.date}T23:59:59Z`);
      const { ctx } = await buildCtx(c, q.serviceId, start, end, true);
      return listSlots(ctx, { ...q, date: q.date, participants: parseParticipants(q.participants), resourceIds: q.resourceId ? [q.resourceId] : undefined });
    },
  });

  route({
    method: 'get',
    path: '/availability/calendar',
    summary: 'Per-date availability summary',
    tags: ['Availability'],
    auth: 'user',
    permission: 'availability.read',
    query: calendarQuery,
    async handler(c) {
      const q = c.query;
      const start = new Date(`${q.from}T00:00:00Z`);
      const end = new Date(`${q.to}T23:59:59Z`);
      const { ctx } = await buildCtx(c, q.serviceId, start, end);
      return availabilityCalendar(ctx, { serviceId: q.serviceId, from: q.from, to: q.to, quantity: q.quantity, participants: parseParticipants(q.participants) });
    },
  });
}