import { and, eq, sql } from 'drizzle-orm';
import { createOpaqueToken, hashOpaqueToken } from '@universal-booking/auth';
import {
  errors,
  formatBookingReference,
  moneyString,
  newId,
  sumMoney,
  validateFormSubmission,
  type FormSchema,
} from '@universal-booking/core';
import { categoryOf, categoryRules, initialStatus } from '@universal-booking/workflow-engine';
import { releaseExpiredHolds, lockInventory } from './inventory';
import {
  bookingAllocations,
  bookingHolds,
  bookingItems,
  bookingReferenceCounters,
  bookingStatusHistory,
  bookings,
  customers,
  formDefinitions,
  isExclusionViolation,
  type Tx,
} from '@universal-booking/database';
import { persistFormAnswers } from './forms';
import { addGuests } from './guests-charges';
import type { CreateBookingInput } from '@universal-booking/contracts';
import type { AppContext } from '../../context';
import { emitEvent } from '../events/outbox';
import { eventForStatus } from '@universal-booking/contracts';
import { loadServiceVersion } from '../catalog/services';
import { quoteForService } from '../pricing/load';

async function nextReference(tx: Tx, tenantId: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = (await tx
    .insert(bookingReferenceCounters)
    .values({ tenantId, year, lastValue: 1 })
    .onConflictDoUpdate({
      target: [bookingReferenceCounters.tenantId, bookingReferenceCounters.year],
      set: { lastValue: sql`${bookingReferenceCounters.lastValue} + 1` },
    })
    .returning({ lastValue: bookingReferenceCounters.lastValue })) as { lastValue: number }[];
  return formatBookingReference(prefix, year, row?.lastValue ?? 1);
}

async function upsertCustomer(tx: Tx, tenantId: string, input: CreateBookingInput, userId?: string | null) {
  if (input.customerId) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
    if (!c) throw errors.notFound('Customer');
    return c.id;
  }
  if (!input.customer?.email && !input.customer?.phone)
    throw errors.validation('Customer contact details are required.', [{ path: 'customer', message: 'Required' }]);
  const email = input.customer.email?.toLowerCase();
  const [existing] = email
    ? await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), sql`lower(${customers.email}) = ${email}`))
    : [];
  if (existing) {
    await tx
      .update(customers)
      .set({ firstName: input.customer.firstName, lastName: input.customer.lastName, phone: input.customer.phone ?? existing.phone })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await tx.insert(customers).values({
    id,
    tenantId,
    userId: userId ?? null,
    type: userId ? 'registered' : 'guest',
    firstName: input.customer!.firstName,
    lastName: input.customer!.lastName,
    phone: input.customer!.phone,
    email: input.customer!.email,
    marketingConsent: input.customer!.marketingConsent ?? false,
  });
  return id;
}

export async function createBookingRecord(
  app: AppContext,
  tx: Tx,
  input: {
    tenantId: string;
    timezone: string;
    referencePrefix: string;
    holdMinutes: number;
    body: CreateBookingInput;
    actor: 'customer' | 'staff' | 'integration';
    source: 'portal' | 'admin' | 'api' | 'integration';
    customerUserId?: string | null;
    createdById?: string | null;
  },
) {
  const { service, version } = await loadServiceVersion(tx, input.body.serviceId, { requirePublic: input.actor === 'customer' });
  const snap = version.snapshot;

  if (input.body.termsAccepted === false && snap.policyId) {
    // policy terms checked later via snapshot at booking time
  }

  const [formRow] = snap.formId ? await tx.select().from(formDefinitions).where(eq(formDefinitions.id, snap.formId)) : [];
  if (formRow) {
    const check = validateFormSubmission(formRow.schema as FormSchema, input.body.answers ?? {});
    if (!check.valid)
      throw errors.validation(
        'Form answers are invalid.',
        check.errors.map((e) => ({ path: e.path, message: e.message })),
      );
  }

  const { plan, workflow, policy } = await quoteForService(app, tx, {
    tenantId: input.tenantId,
    timezone: input.timezone,
    snap,
    serviceId: service.id,
    request: input.body,
    promoCode: input.body.promoCode,
    options: input.body.options?.map((o) => ({ id: o.id, quantity: o.quantity ?? 1 })),
    actor: input.actor,
  });

  if (!plan.availability.available) throw errors.unavailable();

  const resourceIds = plan.resourceIds;
  await releaseExpiredHolds(tx, input.tenantId, resourceIds, app.now());
  await lockInventory(tx, resourceIds);

  const customerId = await upsertCustomer(tx, input.tenantId, input.body, input.customerUserId);
  const reference = await nextReference(tx, input.tenantId, input.referencePrefix);
  const bookingId = newId();
  const itemId = newId();
  const startAt = plan.duration.periods[0]!.start;
  const endAt = plan.duration.periods.at(-1)!.end;
  const status = plan.position.status;
  const statusCategory = categoryOf(workflow, status.key);
  const holdExpires =
    input.body.hold || plan.paymentRequired || plan.approvalRequired ? new Date(app.now().getTime() + input.holdMinutes * 60_000) : null;

  let accessToken: string | undefined;
  let accessTokenHash: string | null = null;
  if (!input.customerUserId && input.actor === 'customer') {
    const tok = createOpaqueToken(32);
    accessToken = tok.token;
    accessTokenHash = hashOpaqueToken(tok.token);
  }

  const initialCategory = categoryOf(workflow, initialStatus(workflow).key);
  const inventoryStatus = categoryRules[initialCategory].inventory === 'none' ? 'active' : holdExpires ? 'held' : 'active';

  const guestToken = accessToken;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await tx.insert(bookings).values({
        id: bookingId,
        tenantId: input.tenantId,
        reference,
        customerId,
        serviceId: service.id,
        serviceVersionId: version.id,
        workflowId: snap.workflowId!,
        status: status.key,
        statusCategory,
        workflowStep: plan.position.stepIndex,
        source: input.source,
        startAt,
        endAt,
        timezone: input.timezone,
        quantity: input.body.quantity ?? 1,
        participants: input.body.participants ?? {},
        guestCount: Object.values(input.body.participants ?? {}).reduce((a, b) => a + b, 0),
        currency: snap.currency,
        subtotal: plan.pricing.subtotal,
        discountTotal: plan.pricing.discountTotal,
        feeTotal: plan.pricing.feeTotal,
        taxTotal: plan.pricing.taxTotal,
        total: plan.pricing.total,
        depositAmount: plan.pricing.depositAmount,
        refundableDeposit: plan.pricing.refundableDeposit,
        pricingSnapshot: plan.pricing,
        policySnapshot: policy,
        paymentRequired: plan.paymentRequired,
        approvalRequired: plan.approvalRequired,
        paymentStatus: 'unpaid',
        customerNotes: input.body.notes,
        accessTokenHash,
        holdExpiresAt: holdExpires,
        externalReference: input.body.externalReference,
        metadata: input.body.metadata ?? {},
        createdById: input.createdById,
      });

      await tx.insert(bookingItems).values({
        id: itemId,
        tenantId: input.tenantId,
        bookingId,
        serviceId: service.id,
        serviceVersionId: version.id,
        startAt,
        endAt,
        quantity: input.body.quantity ?? 1,
        participants: input.body.participants ?? {},
        pricingSnapshot: plan.pricing,
        total: plan.pricing.total,
      });

      for (const alloc of plan.allocations) {
        await tx.insert(bookingAllocations).values({
          tenantId: input.tenantId,
          bookingId,
          bookingItemId: itemId,
          serviceId: service.id,
          resourceId: alloc.resourceId,
          period: alloc.period,
          blockedPeriod: alloc.blocked,
          quantity: alloc.quantity,
          exclusive: alloc.exclusive,
          status: inventoryStatus,
          expiresAt: inventoryStatus === 'held' ? holdExpires : null,
          occurrence: alloc.occurrence,
        });
      }

      if (holdExpires) {
        await tx.insert(bookingHolds).values({ tenantId: input.tenantId, bookingId, expiresAt: holdExpires, status: 'active' });
      }

      if (formRow) {
        await persistFormAnswers(tx, {
          tenantId: input.tenantId,
          bookingId,
          customerId,
          formId: formRow.id,
          schema: formRow.schema as FormSchema,
          answers: input.body.answers ?? {},
        });
      }
      if (input.body.guests?.length) {
        await addGuests(tx, input.tenantId, bookingId, input.body.guests);
      }

      const extraLines =
        input.body.items?.filter(
          (li) => li.serviceId && (li.serviceId !== service.id || (li.startDate && li.startDate !== input.body.startDate)),
        ) ?? [];
      for (const line of extraLines) {
        const { service: svc2, version: ver2 } = await loadServiceVersion(tx, line.serviceId, {
          requirePublic: input.actor === 'customer',
        });
        const snap2 = ver2.snapshot;
        const { plan: plan2 } = await quoteForService(app, tx, {
          tenantId: input.tenantId,
          timezone: input.timezone,
          snap: snap2,
          serviceId: svc2.id,
          request: { ...input.body, ...line, serviceId: svc2.id },
          promoCode: line.promoCode ?? input.body.promoCode,
          options: line.options?.map((o) => ({ id: o.id, quantity: o.quantity ?? 1 })),
          actor: input.actor,
        });
        if (!plan2.availability.available) throw errors.unavailable();
        const extraItemId = newId();
        const exStart = plan2.duration.periods[0]!.start;
        const exEnd = plan2.duration.periods.at(-1)!.end;
        await tx.insert(bookingItems).values({
          id: extraItemId,
          tenantId: input.tenantId,
          bookingId,
          serviceId: svc2.id,
          serviceVersionId: ver2.id,
          startAt: exStart,
          endAt: exEnd,
          quantity: line.quantity ?? 1,
          participants: line.participants ?? {},
          pricingSnapshot: plan2.pricing,
          total: plan2.pricing.total,
        });
        for (const alloc of plan2.allocations) {
          await tx.insert(bookingAllocations).values({
            tenantId: input.tenantId,
            bookingId,
            bookingItemId: extraItemId,
            serviceId: svc2.id,
            resourceId: alloc.resourceId,
            period: alloc.period,
            blockedPeriod: alloc.blocked,
            quantity: alloc.quantity,
            exclusive: alloc.exclusive,
            status: inventoryStatus,
            expiresAt: inventoryStatus === 'held' ? holdExpires : null,
            occurrence: alloc.occurrence,
          });
        }
        await tx
          .update(bookings)
          .set({
            subtotal: moneyString(sumMoney([plan.pricing.subtotal, plan2.pricing.subtotal]), snap.currency),
            total: moneyString(sumMoney([plan.pricing.total, plan2.pricing.total]), snap.currency),
            endAt: endAt > exEnd ? endAt : exEnd,
          })
          .where(eq(bookings.id, bookingId));
      }

      await tx.insert(bookingStatusHistory).values({
        tenantId: input.tenantId,
        bookingId,
        toStatus: status.key,
        action: 'submit',
        actorType: input.actor,
        actorId: input.createdById,
      });

      const ev = eventForStatus(status.key, statusCategory) ?? 'booking.created';
      const notify = [...plan.position.notifications];
      if (!notify.includes('staff.booking_created')) notify.push('staff.booking_created');
      if (plan.approvalRequired && !notify.includes('staff.approval_required')) notify.push('staff.approval_required');
      await emitEvent(tx, {
        tenantId: input.tenantId,
        type: ev,
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: { reference, serviceId: service.id, status: status.key },
        notify,
      });

      const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      app.realtime.publish(input.tenantId, 'bookings', 'booking.created', { id: bookingId, reference });
      app.realtime.publish(input.tenantId, 'availability', 'availability.changed', { serviceId: service.id });
      return { row: row!, accessToken: guestToken, serviceName: service.name, serviceVersion: version.version };
    } catch (e) {
      if (attempt < 2 && isExclusionViolation(e)) continue;
      throw e;
    }
  }
  throw errors.unavailable();
}
