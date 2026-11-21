import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { errors } from '@universal-booking/core';
import { assignmentInput, idParam, maintenanceInput, resourceCategoryInput, resourceInput, scheduleInput } from '@universal-booking/contracts';
import { resourceAssignments, resourceCategories, resourceMaintenance, resourceSchedules, resources, serviceResources, staffProfiles } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { crudRoutes, slugify } from '../../http/crud';
import { Reply } from '../../http/envelope';

export function registerResourceRoutes(route: RouteBuilder) {
  crudRoutes(route, {
    path: '/resource-categories',
    tag: 'Resources',
    entity: 'ResourceCategory',
    table: resourceCategories,
    input: resourceCategoryInput,
    readPermission: 'resources.read',
    writePermission: 'resources.manage',
    search: [resourceCategories.name],
    toValues: (b, _c, _tx, existing) => ({ ...b, slug: b.slug ?? (existing?.slug ?? slugify(b.name)) }),
  });

  crudRoutes(route, {
    path: '/resources',
    tag: 'Resources',
    entity: 'Resource',
    table: resources,
    input: resourceInput,
    readPermission: 'resources.read',
    writePermission: 'resources.manage',
    search: [resources.name, resources.code],
    softDelete: resources.deletedAt,
    orderBy: [resources.sortOrder, resources.name],
    toValues: (b) => ({ ...b, attributes: b.attributes ?? {} }),
    afterWrite: async (tx, row, c, op) => {
      const body = c.body as { serviceIds?: string[] };
      if (op !== 'delete' && body.serviceIds) {
        await tx.delete(serviceResources).where(eq(serviceResources.resourceId, row.id));
        if (body.serviceIds.length) {
          await tx.insert(serviceResources).values(body.serviceIds.map((serviceId, priority) => ({ tenantId: c.tenant.id, serviceId, resourceId: row.id, priority })));
        }
      }
    },
  });

  route({
    method: 'put',
    path: '/resources/:id/schedule',
    summary: 'Replace weekly work hours and breaks',
    tags: ['Resources'],
    auth: 'user',
    permission: 'resources.manage',
    params: idParam,
    body: scheduleInput,
    async handler({ tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [r] = await t.select({ id: resources.id }).from(resources).where(eq(resources.id, params.id));
        if (!r) throw errors.notFound('Resource');
        await t.delete(resourceSchedules).where(eq(resourceSchedules.resourceId, params.id));
        const rows = [
          ...body.work.map((w) => ({ tenantId: tenant.id, resourceId: params.id, kind: 'work' as const, dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
          ...body.breaks.map((w) => ({ tenantId: tenant.id, resourceId: params.id, kind: 'break' as const, dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
        ];
        if (rows.length) await t.insert(resourceSchedules).values(rows);
        await audit({ action: 'resource.schedule_updated', entityType: 'Resource', entityId: params.id }, t);
        return { resourceId: params.id, work: body.work.length, breaks: body.breaks.length };
      });
    },
  });

  crudRoutes(route, {
    path: '/resource-maintenance',
    tag: 'Resources',
    entity: 'Maintenance',
    table: resourceMaintenance,
    input: maintenanceInput,
    readPermission: 'resources.read',
    writePermission: 'resources.manage',
    filters: { resourceId: resourceMaintenance.resourceId },
    toValues: (b) => b,
    only: ['list', 'get', 'create', 'update', 'delete'],
  });

  route({
    method: 'post',
    path: '/resources/:id/assignments',
    summary: 'Assign staff to a resource',
    tags: ['Resources'],
    auth: 'user',
    permission: 'resources.manage',
    params: idParam,
    body: assignmentInput,
    async handler({ tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [r] = await t.select({ id: resources.id }).from(resources).where(eq(resources.id, params.id));
        if (!r) throw errors.notFound('Resource');
        const [staff] = await t.select({ id: staffProfiles.id }).from(staffProfiles).where(eq(staffProfiles.id, body.staffProfileId));
        if (!staff) throw errors.notFound('Staff member');
        const [row] = (await t
          .insert(resourceAssignments)
          .values({ tenantId: tenant.id, resourceId: params.id, staffProfileId: body.staffProfileId, role: body.role, startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null })
          .returning()) as (typeof resourceAssignments.$inferSelect)[];
        await audit({ action: 'resource.assignment_created', entityType: 'ResourceAssignment', entityId: row!.id }, t);
        return Reply.created(row);
      });
    },
  });

  route({
    method: 'delete',
    path: '/resources/:id/assignments/:assignmentId',
    summary: 'Remove a staff assignment',
    tags: ['Resources'],
    auth: 'user',
    permission: 'resources.manage',
    params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
    status: 204,
    async handler({ tx, params, audit }) {
      await tx(async (t) => {
        const [row] = await t
          .delete(resourceAssignments)
          .where(and(eq(resourceAssignments.id, params.assignmentId), eq(resourceAssignments.resourceId, params.id)))
          .returning({ id: resourceAssignments.id });
        if (!row) throw errors.notFound('Assignment');
        await audit({ action: 'resource.assignment_deleted', entityType: 'ResourceAssignment', entityId: row.id }, t);
      });
      return Reply.noContent();
    },
  });
}