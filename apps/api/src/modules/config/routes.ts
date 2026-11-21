import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { errors, isAppError, validateFormSubmission, type FormSchema } from '@universal-booking/core';
import { validateWorkflow, type WorkflowDefinition } from '@universal-booking/workflow-engine';
import { builtInPricingStrategies, formulaVariables } from '@universal-booking/pricing-engine';
import { bookingDefinitions, bookingPolicies, formDefinitions, services, tenantSettings, workflowDefinitions, workflowStatuses, workflowTransitions, type Tx } from '@universal-booking/database';
import { bookingDefinitionInput, definitionValidateInput, formInput, policyInput, previewInput, workflowInput } from '@universal-booking/contracts';
import { quoteForService } from '../pricing/load';
import { loadServiceVersion } from '../catalog/services';
import type { ServiceSnapshot } from '@universal-booking/database';
import { z } from 'zod';
import type { RouteBuilder } from '../../http/route';
import { familyIds, resolvePublished, versionedRoutes } from './versioned';
import { publishService } from '../catalog/services';
import { invalidateTenant } from '../tenancy/tenant-cache';

export async function materializeWorkflow(tx: Tx, tenantId: string, workflowId: string, def: WorkflowDefinition) {
  await tx.delete(workflowStatuses).where(eq(workflowStatuses.workflowId, workflowId));
  await tx.delete(workflowTransitions).where(eq(workflowTransitions.workflowId, workflowId));
  await tx.insert(workflowStatuses).values(def.statuses.map((s, i) => ({ tenantId, workflowId, key: s.key, label: s.label, category: s.category, color: s.color, sortOrder: i })));
  if (def.transitions.length) {
    await tx.insert(workflowTransitions).values(
      def.transitions.map((t) => ({ tenantId, workflowId, fromStatus: t.from, toStatus: t.to, action: t.action, permissions: t.permissions, guards: t.guards, customerAllowed: t.customerAllowed })),
    );
  }
}

async function referencedByServices(tx: Tx, column: AnyPgColumn, ids: string[], entity: string) {
  if (!ids.length) return;
  const [used] = await tx
    .select({ name: services.name })
    .from(services)
    .where(and(inArray(column, ids), sql`${services.status} <> 'archived'`))
    .limit(1);
  if (used) throw errors.conflict(`This ${entity} is used by the service "${used.name}". Change the service first.`);
}

export function registerConfigRoutes(route: RouteBuilder) {
  // -------------------------------------------------------------------------
  // Strategy catalogs
  // -------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/strategies/booking',
    summary: 'Booking strategies with their default definitions',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'catalog.read',
    async handler({ app }) {
      return app.bookingStrategies.list().map((s) => ({ type: s.type, label: s.label, description: s.description, preset: s.preset }));
    },
  });

  route({
    method: 'get',
    path: '/strategies/pricing',
    summary: 'Pricing strategies',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'pricing.read',
    async handler({ app }) {
      const builtIn = new Set(builtInPricingStrategies.map((s) => s.type));
      return { strategies: app.pricingStrategies.types().map((type) => ({ type, builtIn: builtIn.has(type) })), formulaVariables };
    },
  });

  route({
    method: 'post',
    path: '/booking-definitions/validate',
    summary: 'Validate a booking definition against its strategy',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'catalog.read',
    body: definitionValidateInput,
    status: 200,
    async handler({ app, body }) {
      try {
        const definition = app.bookingStrategies.validate(body.definition);
        return { valid: true, errors: [], definition };
      } catch (e) {
        if (isAppError(e)) return { valid: false, errors: e.details.length ? e.details : [{ message: e.message }] };
        throw e;
      }
    },
  });

  route({
    method: 'post',
    path: '/config/preview',
    summary: 'Simulate availability and pricing for a draft booking configuration',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'catalog.read',
    body: previewInput.extend({ serviceId: z.uuid().optional() }),
    async handler({ app, tx, tenant, body }) {
      const definition = app.bookingStrategies.validate(body.definition);
      if (!body.serviceId || !body.request) {
        return { definition, valid: true, note: 'Provide serviceId and request to simulate availability and pricing.' };
      }
      const { version, service } = await tx((t) => loadServiceVersion(t, body.serviceId!));
      const snap: ServiceSnapshot = {
        ...version.snapshot,
        definition,
        currency: body.currency,
        basePrice: body.basePrice ?? version.snapshot.basePrice,
        workflowId: body.workflowId ?? version.snapshot.workflowId,
        policyId: body.policyId ?? version.snapshot.policyId,
        formId: body.formId ?? version.snapshot.formId,
      };
      const { plan, workflow, policy } = await tx((t) =>
        quoteForService(app, t, {
          tenantId: tenant.id,
          timezone: tenant.timezone,
          snap,
          serviceId: service.id,
          request: body.request!,
          actor: 'staff',
        }),
      );
      return {
        availability: plan.availability,
        pricing: plan.pricing,
        paymentRequired: plan.paymentRequired,
        approvalRequired: plan.approvalRequired,
        workflowId: snap.workflowId,
        policy,
        workflow: workflow ? { statuses: workflow.statuses.length, transitions: workflow.transitions.length } : null,
      };
    },
  });

  route({
    method: 'post',
    path: '/workflows/validate',
    summary: 'Validate a workflow definition without saving it',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'workflows.manage',
    body: z.object({ definition: z.unknown() }),
    status: 200,
    async handler({ body }) {
      const result = validateWorkflow(body.definition);
      return { valid: result.valid, errors: result.errors };
    },
  });

  route({
    method: 'post',
    path: '/forms/:id/test',
    summary: 'Validate sample answers against a form',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'forms.manage',
    params: z.object({ id: z.uuid() }),
    body: z.object({ answers: z.record(z.string(), z.unknown()) }),
    status: 200,
    async handler({ tx, params, body }) {
      const [form] = await tx((t) => t.select().from(formDefinitions).where(eq(formDefinitions.id, params.id)));
      if (!form) throw errors.notFound('Form');
      return validateFormSubmission(form.schema as FormSchema, body.answers);
    },
  });

  // -------------------------------------------------------------------------
  // Versioned configuration
  // -------------------------------------------------------------------------
  versionedRoutes(route, {
    path: '/forms',
    tag: 'Configuration',
    entity: 'Form',
    table: formDefinitions,
    input: formInput,
    readPermission: 'catalog.read',
    writePermission: 'forms.manage',
    toValues: (b) => ({ name: b.name, description: b.description ?? null, schema: b.schema }),
    beforeArchive: async (tx, row) => referencedByServices(tx, services.formId, await familyIds(tx, formDefinitions, row.id), 'form'),
  });

  versionedRoutes(route, {
    path: '/workflows',
    tag: 'Configuration',
    entity: 'Workflow',
    table: workflowDefinitions,
    input: workflowInput,
    readPermission: 'catalog.read',
    writePermission: 'workflows.manage',
    toValues: (b) => {
      const result = validateWorkflow(b.definition);
      if (!result.valid) throw errors.configuration('The workflow definition is invalid.', result.errors);
      return { name: result.definition!.name, description: b.description ?? null, definition: result.definition! };
    },
    afterSave: async (tx, row) => materializeWorkflow(tx, row.tenantId, row.id, row.definition),
    afterPublish: async (tx, row, c, body) => {
      const [settings] = await tx.select({ defaultWorkflowId: tenantSettings.defaultWorkflowId }).from(tenantSettings);
      const family = await familyIds(tx, workflowDefinitions, row.id);
      const wasDefault = !!settings?.defaultWorkflowId && family.includes(settings.defaultWorkflowId);
      if (body?.isDefault || wasDefault) {
        await tx.update(workflowDefinitions).set({ isDefault: false }).where(eq(workflowDefinitions.isDefault, true));
        await tx.update(workflowDefinitions).set({ isDefault: true }).where(eq(workflowDefinitions.id, row.id));
        await tx.update(tenantSettings).set({ defaultWorkflowId: row.id }).where(eq(tenantSettings.tenantId, c.tenant.id));
        invalidateTenant(c.tenant);
      }
    },
    beforeArchive: async (tx, row) => {
      const family = await familyIds(tx, workflowDefinitions, row.id);
      const [settings] = await tx.select({ id: tenantSettings.defaultWorkflowId }).from(tenantSettings);
      if (settings?.id && family.includes(settings.id)) throw errors.conflict('The default workflow cannot be archived. Choose another default first.');
      await referencedByServices(tx, services.workflowId, family, 'workflow');
    },
  });

  versionedRoutes(route, {
    path: '/policies',
    tag: 'Configuration',
    entity: 'Policy',
    table: bookingPolicies,
    input: policyInput,
    readPermission: 'catalog.read',
    writePermission: 'policies.manage',
    toValues: (b) => ({ name: b.name, description: b.description ?? null, policy: b.policy }),
    afterPublish: async (tx, row, c, body) => {
      const [settings] = await tx.select({ defaultPolicyId: tenantSettings.defaultPolicyId }).from(tenantSettings);
      const family = await familyIds(tx, bookingPolicies, row.id);
      const wasDefault = !!settings?.defaultPolicyId && family.includes(settings.defaultPolicyId);
      if (body?.isDefault || wasDefault) {
        await tx.update(bookingPolicies).set({ isDefault: false }).where(eq(bookingPolicies.isDefault, true));
        await tx.update(bookingPolicies).set({ isDefault: true }).where(eq(bookingPolicies.id, row.id));
        await tx.update(tenantSettings).set({ defaultPolicyId: row.id }).where(eq(tenantSettings.tenantId, c.tenant.id));
        invalidateTenant(c.tenant);
      }
    },
    beforeArchive: async (tx, row) => {
      const family = await familyIds(tx, bookingPolicies, row.id);
      const [settings] = await tx.select({ id: tenantSettings.defaultPolicyId }).from(tenantSettings);
      if (settings?.id && family.includes(settings.id)) throw errors.conflict('The default policy cannot be archived. Choose another default first.');
      await referencedByServices(tx, services.policyId, family, 'policy');
    },
  });

  versionedRoutes(route, {
    path: '/booking-definitions',
    tag: 'Configuration',
    entity: 'BookingDefinition',
    table: bookingDefinitions,
    input: bookingDefinitionInput,
    readPermission: 'catalog.read',
    writePermission: 'catalog.manage',
    toValues: (b, c) => {
      const definition = c.app.bookingStrategies.validate(b.definition);
      return { name: b.name, description: b.description ?? null, strategy: definition.strategy, definition };
    },
  });

  const builderBody = z.object({
    serviceId: z.uuid(),
    definition: z.unknown().optional(),
    workflowId: z.uuid().nullish(),
    policyId: z.uuid().nullish(),
    formId: z.uuid().nullish(),
    resourceIds: z.array(z.uuid()).optional(),
    request: previewInput.shape.request.optional(),
  });

  route({
    method: 'post',
    path: '/config/builder/validate',
    summary: 'Validate a draft service configuration before publish',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'catalog.manage',
    body: builderBody,
    async handler({ app, tx, body }) {
      const errors: { message: string }[] = [];
      if (body.definition) {
        try {
          app.bookingStrategies.validate(body.definition);
        } catch (e) {
          if (isAppError(e)) errors.push(...(e.details.length ? e.details.map((d) => ({ message: d.message })) : [{ message: e.message }]));
        }
      }
      if (body.workflowId) {
        const row = await tx((t) => resolvePublished(t, workflowDefinitions, body.workflowId!));
        if (!row) errors.push({ message: 'Workflow is not published.' });
        else {
          const wf = validateWorkflow(row.definition);
          if (!wf.valid) errors.push(...wf.errors.map((m) => ({ message: typeof m === 'string' ? m : m.message })));
        }
      }
      if (body.formId) {
        const row = await tx((t) => resolvePublished(t, formDefinitions, body.formId!));
        if (!row) errors.push({ message: 'Form is not published.' });
      }
      return { valid: errors.length === 0, errors };
    },
  });

  route({
    method: 'post',
    path: '/config/builder/publish',
    summary: 'Publish a service after builder validation',
    tags: ['Configuration'],
    auth: 'user',
    permission: 'catalog.manage',
    body: builderBody,
    async handler({ app, tx, tenant, identity, body, audit }) {
      const res = await tx(async (t) => {
        const [svc] = await t.select().from(services).where(eq(services.id, body.serviceId));
        if (!svc) throw errors.notFound('Service');
        if (body.definition) {
          const definition = app.bookingStrategies.validate(body.definition);
          await t.update(services).set({ definition, updatedAt: new Date() }).where(eq(services.id, svc.id));
        }
        if (body.resourceIds) await (await import('../catalog/services')).setServiceResources(t, tenant.id, svc.id, body.resourceIds);
        const [fresh] = await t.select().from(services).where(eq(services.id, svc.id));
        const published = await publishService(app, t, tenant, fresh!, identity.principalId ?? null);
        await audit({ action: 'service.published', entityType: 'Service', entityId: svc.id, changes: { version: published.version.version } }, t);
        return { serviceId: svc.id, version: published.version.version, currentVersionId: published.version.id };
      });
      return res;
    },
  });
}
