import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { errors, newId, presetDefinition, type BookingDefinition } from '@universal-booking/core';
import {
  bookingDefinitions,
  bookingPolicies,
  formDefinitions,
  resources,
  serviceOptions,
  serviceResources,
  services,
  serviceVersions,
  workflowDefinitions,
  type ServicePricingConfig,
  type ServiceSnapshot,
  type Tx,
} from '@universal-booking/database';
import type { AppContext, TenantInfo } from '../../context';
import { resolvePublished } from '../config/versioned';

export type ServiceRow = typeof services.$inferSelect;

export function validatePricing(app: AppContext, pricing: ServicePricingConfig): ServicePricingConfig {
  app.pricingStrategies.get(pricing.strategy).validate(pricing.configuration);
  return pricing;
}

/** Resolves the definition for a new or edited service: explicit definition, a reusable booking type, or a preset. */
export async function resolveDefinition(app: AppContext, tx: Tx, input: { definition?: unknown; bookingDefinitionId?: string | null }, fallback?: BookingDefinition): Promise<BookingDefinition> {
  if (input.definition) return app.bookingStrategies.validate(input.definition);
  if (input.bookingDefinitionId) {
    const row = await resolvePublished(tx, bookingDefinitions, input.bookingDefinitionId);
    if (!row) throw errors.validation('The booking type must be published before it is used.', [{ path: 'bookingDefinitionId', message: 'Not published' }]);
    return app.bookingStrategies.validate(row.definition);
  }
  return fallback ?? presetDefinition('appointment');
}

export async function setServiceResources(tx: Tx, tenantId: string, serviceId: string, resourceIds: string[]) {
  if (resourceIds.length) {
    const found = await tx.select({ id: resources.id }).from(resources).where(inArray(resources.id, resourceIds));
    if (found.length !== new Set(resourceIds).size) throw errors.validation('One or more resources do not exist.', [{ path: 'resourceIds', message: 'Unknown resource' }]);
  }
  await tx.delete(serviceResources).where(eq(serviceResources.serviceId, serviceId));
  if (resourceIds.length) {
    await tx.insert(serviceResources).values([...new Set(resourceIds)].map((resourceId, priority) => ({ tenantId, serviceId, resourceId, priority })));
  }
}

async function requirePublished(tx: Tx, table: typeof formDefinitions | typeof workflowDefinitions | typeof bookingPolicies, id: string | null, label: string): Promise<string | null> {
  if (!id) return null;
  const row = await resolvePublished(tx, table, id);
  if (!row) throw errors.configuration(`The ${label} must be published before the service can be published.`, [{ path: `${label}Id`, message: 'Not published' }]);
  return row.id as string;
}

/**
 * Publishes the service's working copy as an immutable version. Bookings pin the version,
 * so later edits never change existing reservations.
 */
export async function publishService(app: AppContext, tx: Tx, tenant: TenantInfo, service: ServiceRow, publishedById: string | null) {
  const definition = app.bookingStrategies.validate(service.definition);
  validatePricing(app, service.pricing);
  const links = await tx
    .select({ resourceId: serviceResources.resourceId })
    .from(serviceResources)
    .where(eq(serviceResources.serviceId, service.id))
    .orderBy(asc(serviceResources.priority));
  if ((definition.inventory === 'exclusive' || definition.inventory === 'pooled') && !links.length) {
    throw errors.configuration('Assign at least one resource before publishing this service.', [{ path: 'resourceIds', message: 'Required' }]);
  }
  const options = await tx
    .select()
    .from(serviceOptions)
    .where(and(eq(serviceOptions.serviceId, service.id), eq(serviceOptions.status, 'active')))
    .orderBy(asc(serviceOptions.sortOrder));

  const snapshot: ServiceSnapshot = {
    name: service.name,
    currency: service.currency,
    basePrice: service.basePrice,
    definition,
    pricing: service.pricing,
    formId: await requirePublished(tx, formDefinitions, service.formId, 'form'),
    workflowId: await requirePublished(tx, workflowDefinitions, service.workflowId ?? tenant.defaultWorkflowId, 'workflow'),
    policyId: await requirePublished(tx, bookingPolicies, service.policyId ?? tenant.defaultPolicyId, 'policy'),
    resourceIds: links.map((l) => l.resourceId),
    options: options.map((o) => ({ id: o.id, name: o.name, price: o.price, chargeType: o.chargeType, maxQuantity: o.maxQuantity, required: o.required })),
  };
  const [{ v }] = (await tx.select({ v: max(serviceVersions.version) }).from(serviceVersions).where(eq(serviceVersions.serviceId, service.id))) as [{ v: number | null }];
  const version = (v ?? 0) + 1;
  const id = newId();
  await tx.insert(serviceVersions).values({ id, tenantId: tenant.id, serviceId: service.id, version, snapshot, publishedById });
  const [row] = await tx
    .update(services)
    .set({ currentVersionId: id, currentVersion: version, status: 'published', publishedAt: new Date(), archivedAt: null })
    .where(eq(services.id, service.id))
    .returning();
  return { service: row!, version: { id, version, snapshot } };
}

export async function loadServiceVersion(tx: Tx, serviceId: string, opts: { requirePublic?: boolean } = {}) {
  const [service] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!service || service.deletedAt) throw errors.notFound('Service');
  if (opts.requirePublic && (service.status !== 'published' || service.visibility !== 'public')) throw errors.notFound('Service');
  if (!service.currentVersionId) throw errors.validation('This service has not been published yet.');
  if (service.status === 'archived') throw errors.validation('This service is no longer offered.');
  const [version] = await tx.select().from(serviceVersions).where(eq(serviceVersions.id, service.currentVersionId));
  return { service, version: version! };
}

export function serviceView(s: ServiceRow, extra: Record<string, unknown> = {}) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    status: s.status,
    visibility: s.visibility,
    categoryId: s.categoryId,
    bookingDefinitionId: s.bookingDefinitionId,
    shortDescription: s.shortDescription,
    description: s.description,
    imageUrl: s.imageUrl,
    gallery: s.gallery,
    currency: s.currency,
    basePrice: s.basePrice,
    definition: s.definition,
    pricing: s.pricing,
    formId: s.formId,
    workflowId: s.workflowId,
    policyId: s.policyId,
    currentVersion: s.currentVersion,
    currentVersionId: s.currentVersionId,
    sortOrder: s.sortOrder,
    attributes: s.attributes,
    publishedAt: s.publishedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...extra,
  };
}

export async function listServiceVersions(tx: Tx, serviceId: string) {
  return tx
    .select({ id: serviceVersions.id, version: serviceVersions.version, createdAt: serviceVersions.createdAt, publishedById: serviceVersions.publishedById })
    .from(serviceVersions)
    .where(eq(serviceVersions.serviceId, serviceId))
    .orderBy(desc(serviceVersions.version));
}
