import { and, eq, inArray } from 'drizzle-orm';
import { dec, toLocalIso } from '@universal-booking/core';
import { availableActions, statusOf } from '@universal-booking/workflow-engine';
import { bookingAllocations, bookings, customers, resources, serviceVersions, workflowDefinitions } from '@universal-booking/database';
import type { Tx } from '@universal-booking/database';

export async function buildBookingView(tx: Tx, row: typeof bookings.$inferSelect, workflowDef?: { definition: Parameters<typeof statusOf>[0] }) {
  const [customer] = row.customerId ? await tx.select().from(customers).where(eq(customers.id, row.customerId)) : [];
  const allocations = await tx.select().from(bookingAllocations).where(eq(bookingAllocations.bookingId, row.id));
  const resourceIds = [...new Set(allocations.map((a) => a.resourceId).filter((x): x is string => !!x))];
  const resourceNames = resourceIds.length
    ? await tx.select({ id: resources.id, name: resources.name }).from(resources).where(inArray(resources.id, resourceIds))
    : [];
  const nameMap = new Map(resourceNames.map((r) => [r.id, r.name]));
  const [svcVer] = await tx.select({ version: serviceVersions.version }).from(serviceVersions).where(eq(serviceVersions.id, row.serviceVersionId));
  let actions: string[] = [];
  if (workflowDef) {
    try {
      actions = availableActions(workflowDef.definition, row.status);
    } catch {
      actions = [];
    }
  }
  const statusLabel = workflowDef ? statusOf(workflowDef.definition, row.status).label : row.status;
  const balanceDue = dec(row.total).minus(row.amountPaid).plus(row.amountRefunded).toFixed(4);
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel,
    statusCategory: row.statusCategory,
    source: row.source,
    service: { id: row.serviceId, name: '', version: svcVer?.version ?? 0 },
    customer: customer
      ? { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone }
      : null,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    localStart: toLocalIso(row.startAt, row.timezone),
    localEnd: toLocalIso(row.endAt, row.timezone),
    timezone: row.timezone,
    quantity: row.quantity,
    participants: row.participants,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    feeTotal: row.feeTotal,
    taxTotal: row.taxTotal,
    total: row.total,
    depositAmount: row.depositAmount,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded,
    chargesTotal: row.chargesTotal,
    balanceDue,
    amountDueNow: row.pricingSnapshot.amountDueNow,
    paymentStatus: row.paymentStatus,
    paymentRequired: row.paymentRequired,
    pricing: row.pricingSnapshot,
    allocations: allocations.map((a) => ({
      resourceId: a.resourceId,
      resourceName: a.resourceId ? (nameMap.get(a.resourceId) ?? null) : null,
      start: a.period.start.toISOString(),
      end: a.period.end.toISOString(),
      quantity: a.quantity,
      status: a.status,
    })),
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    availableActions: actions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadWorkflowForBooking(tx: Tx, workflowId: string) {
  const [wf] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, workflowId));
  return wf ?? null;
}