import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { errors, newId, offsetOf, pageMeta } from '@universal-booking/core';
import { formDefinitions, resources, serviceCategories, serviceOptions, serviceResources, services, serviceVersions } from '@universal-booking/database';
import { loadServiceVersion } from './services';
import { categoryInput, idParam, pageQuery, serviceInput, serviceOptionInput } from '@universal-booking/contracts';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { crudRoutes, slugify } from '../../http/crud';
import { listServiceVersions, publishService, resolveDefinition, serviceView, setServiceResources, validatePricing } from './services';

const serviceListQuery = pageQuery.extend({
  status: z.enum(['draft', 'published', 'archived']).optional(),
  categoryId: z.uuid().optional(),
  strategy: z.string().max(64).optional(),
});

export function registerCatalogRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/public/:businessSlug/services',
    summary: 'Published public catalog for the booking portal',
    tags: ['Public', 'Catalog'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const where = and(eq(services.status, 'published'), eq(services.visibility, 'public'), isNull(services.deletedAt));
        const rows = await t
          .select({
            id: services.id,
            name: services.name,
            slug: services.slug,
            shortDescription: services.shortDescription,
            imageUrl: services.imageUrl,
            currency: services.currency,
            basePrice: services.basePrice,
            categoryId: services.categoryId,
          })
          .from(services)
          .where(where)
          .orderBy(asc(services.sortOrder), asc(services.name))
          .limit(query.pageSize)
          .offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'get',
    path: '/public/:businessSlug/categories',
    summary: 'Public service categories',
    tags: ['Public', 'Catalog'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string() }),
    async handler({ tx }) {
      return tx(async (t) => {
        const rows = await t
          .select({ id: serviceCategories.id, name: serviceCategories.name, slug: serviceCategories.slug, parentId: serviceCategories.parentId, sortOrder: serviceCategories.sortOrder })
          .from(serviceCategories)
          .where(eq(serviceCategories.status, 'active'))
          .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
        return rows;
      });
    },
  });

  route({
    method: 'get',
    path: '/public/:businessSlug/services/:slug',
    summary: 'One public service by slug',
    tags: ['Public', 'Catalog'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), slug: z.string() }),
    async handler({ tx, params }) {
      return tx(async (t) => {
        const [s] = await t
          .select()
          .from(services)
          .where(and(eq(services.slug, params.slug), eq(services.status, 'published'), eq(services.visibility, 'public'), isNull(services.deletedAt)));
        if (!s) throw errors.notFound('Service');
        const { version } = await loadServiceVersion(t, s.id, { requirePublic: true });
        const options = await t
          .select({ id: serviceOptions.id, name: serviceOptions.name, price: serviceOptions.price, chargeType: serviceOptions.chargeType, maxQuantity: serviceOptions.maxQuantity, required: serviceOptions.required })
          .from(serviceOptions)
          .where(and(eq(serviceOptions.serviceId, s.id), eq(serviceOptions.status, 'active')))
          .orderBy(asc(serviceOptions.sortOrder));
        return { ...serviceView(s), definition: version.snapshot.definition, options };
      });
    },
  });

  route({
    method: 'get',
    path: '/public/:businessSlug/services/:slug/form',
    summary: 'Published booking form schema for a service',
    tags: ['Public', 'Catalog'],
    auth: 'none',
    tenant: 'public',
    params: z.object({ businessSlug: z.string(), slug: z.string() }),
    async handler({ tx, params }) {
      return tx(async (t) => {
        const [s] = await t
          .select({ id: services.id })
          .from(services)
          .where(and(eq(services.slug, params.slug), eq(services.status, 'published'), eq(services.visibility, 'public'), isNull(services.deletedAt)));
        if (!s) throw errors.notFound('Service');
        const { version } = await loadServiceVersion(t, s.id, { requirePublic: true });
        const formId = version.snapshot.formId;
        if (!formId) return { schema: { fields: [] } };
        const [form] = await t.select().from(formDefinitions).where(eq(formDefinitions.id, formId));
        if (!form) return { schema: { fields: [] } };
        return { formId, name: form.name, schema: form.schema };
      });
    },
  });
  crudRoutes(route, {
    path: '/service-categories',
    tag: 'Catalog',
    entity: 'Category',
    table: serviceCategories,
    input: categoryInput,
    readPermission: 'catalog.read',
    writePermission: 'catalog.manage',
    search: [serviceCategories.name],
    orderBy: [asc(serviceCategories.sortOrder), asc(serviceCategories.name)],
    filters: { parentId: serviceCategories.parentId, status: serviceCategories.status },
    toValues: (b, _c, _tx, existing) => ({ ...b, ...(b.name && !b.slug && !existing ? { slug: slugify(b.name) } : {}) }),
    beforeDelete: async (tx, row) => {
      const [used] = await tx.select({ id: services.id }).from(services).where(and(eq(services.categoryId, row.id), isNull(services.deletedAt))).limit(1);
      if (used) throw errors.conflict('This category still has services. Move or archive them first.');
    },
  });

  route({
    method: 'get',
    path: '/services',
    summary: 'List services',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.read',
    query: serviceListQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const conds: (SQL | undefined)[] = [isNull(services.deletedAt)];
        if (query.status) conds.push(eq(services.status, query.status));
        if (query.categoryId) conds.push(eq(services.categoryId, query.categoryId));
        if (query.strategy) conds.push(sql`${services.definition}->>'strategy' = ${query.strategy}`);
        if (query.search) conds.push(or(ilike(services.name, `%${query.search}%`), ilike(services.slug, `%${query.search}%`)));
        const where = and(...conds);
        const [{ count }] = (await t.select({ count: sql<number>`count(*)::int` }).from(services).where(where)) as [{ count: number }];
        const rows = await t.select().from(services).where(where).orderBy(asc(services.sortOrder), asc(services.name)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows.map((s) => serviceView(s)), pageMeta(query, count));
      });
    },
  });

  route({
    method: 'get',
    path: '/services/:id',
    summary: 'Get a service with its options and resources',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.read',
    params: idParam,
    async handler({ tx, params }) {
      return tx(async (t) => {
        const [s] = await t.select().from(services).where(and(eq(services.id, params.id), isNull(services.deletedAt)));
        if (!s) throw errors.notFound('Service');
        const options = await t.select().from(serviceOptions).where(eq(serviceOptions.serviceId, s.id)).orderBy(asc(serviceOptions.sortOrder));
        const links = await t
          .select({ resourceId: serviceResources.resourceId, allocationRule: serviceResources.allocationRule, priority: serviceResources.priority, name: resources.name, kind: resources.kind, status: resources.status })
          .from(serviceResources)
          .innerJoin(resources, eq(resources.id, serviceResources.resourceId))
          .where(eq(serviceResources.serviceId, s.id))
          .orderBy(asc(serviceResources.priority));
        return serviceView(s, { options, resources: links, resourceIds: links.map((l) => l.resourceId) });
      });
    },
  });

  route({
    method: 'post',
    path: '/services',
    summary: 'Create a service (draft)',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    body: serviceInput.extend({ publish: z.boolean().optional() }),
    async handler({ app, tx, tenant, body, identity, audit }) {
      return tx(async (t) => {
        const definition = await resolveDefinition(app, t, body);
        const pricing = validatePricing(app, body.pricing ?? { strategy: 'fixed', configuration: {} });
        const id = newId();
        const { resourceIds, publish, ...fields } = body;
        const [row] = await t
          .insert(services)
          .values({
            ...fields,
            id,
            tenantId: tenant.id,
            slug: body.slug ?? `${slugify(body.name)}-${id.slice(-4)}`,
            currency: body.currency ?? tenant.currency,
            definition,
            pricing,
          })
          .returning();
        if (resourceIds) await setServiceResources(t, tenant.id, id, resourceIds);
        await audit({ action: 'service.created', entityType: 'Service', entityId: id, changes: { name: body.name, strategy: definition.strategy } }, t);
        if (publish) {
          const published = await publishService(app, t, tenant, row!, identity.principalId);
          return Reply.created(serviceView(published.service));
        }
        return Reply.created(serviceView(row!));
      });
    },
  });

  route({
    method: 'patch',
    path: '/services/:id',
    summary: 'Edit the working copy of a service (publish to make changes bookable)',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    body: serviceInput.partial(),
    async handler({ app, tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [s] = await t.select().from(services).where(and(eq(services.id, params.id), isNull(services.deletedAt)));
        if (!s) throw errors.notFound('Service');
        const { resourceIds, definition: defInput, pricing: pricingInput, ...fields } = body;
        const definition = defInput || body.bookingDefinitionId ? await resolveDefinition(app, t, { definition: defInput, bookingDefinitionId: body.bookingDefinitionId }) : undefined;
        const pricing = pricingInput ? validatePricing(app, pricingInput) : undefined;
        const [row] = await t
          .update(services)
          .set({ ...fields, ...(definition ? { definition } : {}), ...(pricing ? { pricing } : {}), updatedAt: new Date() })
          .where(eq(services.id, s.id))
          .returning();
        if (resourceIds) await setServiceResources(t, tenant.id, s.id, resourceIds);
        await audit({ action: 'service.updated', entityType: 'Service', entityId: s.id, changes: body }, t);
        return serviceView(row!, { hasUnpublishedChanges: s.status === 'published' });
      });
    },
  });

  route({
    method: 'post',
    path: '/services/:id/publish',
    summary: 'Publish the service as a new immutable version',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    status: 200,
    async handler({ app, tx, tenant, params, identity, audit }) {
      return tx(async (t) => {
        const [s] = await t.select().from(services).where(and(eq(services.id, params.id), isNull(services.deletedAt)));
        if (!s) throw errors.notFound('Service');
        const result = await publishService(app, t, tenant, s, identity.principalId);
        await audit({ action: 'service.published', entityType: 'Service', entityId: s.id, changes: { version: result.version.version } }, t);
        return serviceView(result.service, { version: result.version });
      });
    },
  });

  route({
    method: 'post',
    path: '/services/:id/archive',
    summary: 'Stop offering a service (existing bookings are unaffected)',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    status: 200,
    async handler({ tx, params, audit }) {
      return tx(async (t) => {
        const [row] = await t.update(services).set({ status: 'archived', archivedAt: new Date() }).where(eq(services.id, params.id)).returning();
        if (!row) throw errors.notFound('Service');
        await audit({ action: 'service.archived', entityType: 'Service', entityId: row.id }, t);
        return serviceView(row);
      });
    },
  });

  route({
    method: 'post',
    path: '/services/:id/duplicate',
    summary: 'Copy a service, its options and resources into a new draft',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    async handler({ tx, tenant, params, audit }) {
      return tx(async (t) => {
        const [s] = await t.select().from(services).where(eq(services.id, params.id));
        if (!s) throw errors.notFound('Service');
        const id = newId();
        const { id: _id, createdAt: _c, updatedAt: _u, currentVersionId: _v, publishedAt: _p, archivedAt: _a, deletedAt: _d, ...rest } = s;
        const [copy] = await t
          .insert(services)
          .values({ ...rest, id, name: `${s.name} (copy)`, slug: `${s.slug}-copy-${id.slice(-4)}`, status: 'draft', currentVersion: 0 })
          .returning();
        const options = await t.select().from(serviceOptions).where(eq(serviceOptions.serviceId, s.id));
        if (options.length) {
          await t.insert(serviceOptions).values(options.map(({ id: _oid, createdAt: _oc, updatedAt: _ou, ...o }) => ({ ...o, id: newId(), serviceId: id })));
        }
        const links = await t.select().from(serviceResources).where(eq(serviceResources.serviceId, s.id));
        if (links.length) await t.insert(serviceResources).values(links.map((l) => ({ ...l, serviceId: id })));
        await audit({ action: 'service.duplicated', entityType: 'Service', entityId: id, changes: { from: s.id } }, t);
        return Reply.created(serviceView(copy!));
      });
    },
  });

  route({
    method: 'delete',
    path: '/services/:id',
    summary: 'Delete a service (soft delete; booked versions are retained)',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    status: 204,
    async handler({ tx, params, audit }) {
      await tx(async (t) => {
        const [row] = await t.update(services).set({ deletedAt: new Date(), status: 'archived' }).where(eq(services.id, params.id)).returning({ id: services.id });
        if (!row) throw errors.notFound('Service');
        await audit({ action: 'service.deleted', entityType: 'Service', entityId: row.id }, t);
      });
      return Reply.noContent();
    },
  });

  route({
    method: 'get',
    path: '/services/:id/versions',
    summary: 'Published versions of a service',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.read',
    params: idParam,
    async handler({ tx, params }) {
      return tx((t) => listServiceVersions(t, params.id));
    },
  });

  route({
    method: 'get',
    path: '/services/:id/versions/:version',
    summary: 'Snapshot of one published service version',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.read',
    params: z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }),
    async handler({ tx, params }) {
      const [row] = await tx((t) => t.select().from(serviceVersions).where(and(eq(serviceVersions.serviceId, params.id), eq(serviceVersions.version, params.version))));
      if (!row) throw errors.notFound('Service version');
      return row;
    },
  });

  route({
    method: 'put',
    path: '/services/:id/resources',
    summary: 'Replace the resources that can fulfil a service',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: idParam,
    body: z.object({ resourceIds: z.array(z.uuid()).max(500) }),
    status: 200,
    async handler({ tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [s] = await t.select({ id: services.id }).from(services).where(eq(services.id, params.id));
        if (!s) throw errors.notFound('Service');
        await setServiceResources(t, tenant.id, s.id, body.resourceIds);
        await audit({ action: 'service.resources_updated', entityType: 'Service', entityId: s.id, changes: body }, t);
        return { serviceId: s.id, resourceIds: body.resourceIds };
      });
    },
  });

  // Options (add-ons) nested under a service.
  const optionParams = z.object({ serviceId: z.uuid() });
  route({
    method: 'get',
    path: '/services/:serviceId/options',
    summary: 'List add-ons for a service',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.read',
    params: optionParams,
    async handler({ tx, params }) {
      return tx((t) => t.select().from(serviceOptions).where(eq(serviceOptions.serviceId, params.serviceId)).orderBy(asc(serviceOptions.sortOrder)));
    },
  });

  route({
    method: 'post',
    path: '/services/:serviceId/options',
    summary: 'Add an add-on to a service',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: optionParams,
    body: serviceOptionInput,
    async handler({ tx, tenant, params, body, audit }) {
      return tx(async (t) => {
        const [s] = await t.select({ id: services.id }).from(services).where(eq(services.id, params.serviceId));
        if (!s) throw errors.notFound('Service');
        const [row] = await t.insert(serviceOptions).values({ ...body, tenantId: tenant.id, serviceId: s.id }).returning();
        await audit({ action: 'service_option.created', entityType: 'ServiceOption', entityId: row!.id, changes: body }, t);
        return Reply.created(row);
      });
    },
  });

  route({
    method: 'patch',
    path: '/services/:serviceId/options/:id',
    summary: 'Update an add-on',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: optionParams.extend({ id: z.uuid() }),
    body: serviceOptionInput.partial(),
    async handler({ tx, params, body, audit }) {
      return tx(async (t) => {
        const [row] = await t
          .update(serviceOptions)
          .set({ ...body, updatedAt: new Date() })
          .where(and(eq(serviceOptions.id, params.id), eq(serviceOptions.serviceId, params.serviceId)))
          .returning();
        if (!row) throw errors.notFound('Option');
        await audit({ action: 'service_option.updated', entityType: 'ServiceOption', entityId: row.id, changes: body }, t);
        return row;
      });
    },
  });

  route({
    method: 'delete',
    path: '/services/:serviceId/options/:id',
    summary: 'Remove an add-on',
    tags: ['Catalog'],
    auth: 'user',
    permission: 'catalog.manage',
    params: optionParams.extend({ id: z.uuid() }),
    status: 204,
    async handler({ tx, params, audit }) {
      await tx(async (t) => {
        const [row] = await t.delete(serviceOptions).where(and(eq(serviceOptions.id, params.id), eq(serviceOptions.serviceId, params.serviceId))).returning({ id: serviceOptions.id });
        if (!row) throw errors.notFound('Option');
        await audit({ action: 'service_option.deleted', entityType: 'ServiceOption', entityId: row.id }, t);
      });
      return Reply.noContent();
    },
  });
}
