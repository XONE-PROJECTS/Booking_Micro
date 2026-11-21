import { and, eq, sql } from 'drizzle-orm';
import { anonymousIdentity, dec, errors } from '@universal-booking/core';
import {
  bookingAllocations,
  bookings,
  customers,
  isUniqueViolation,
  paymentTransactions,
  payments,
  type Tx,
} from '@universal-booking/database';
import { availableActions, parseWorkflow } from '@universal-booking/workflow-engine';
import type { AppContext } from '../../context';
import { emitEvent } from '../events/outbox';
import { applyBookingTransition } from '../bookings/transition';
import { loadWorkflowForBooking } from '../bookings/views';
import { computeBookingPaymentStatus } from './amounts';

export interface ApplyPaymentInput {
  tenantId: string;
  paymentId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'expired';
  amount?: string;
  currency?: string;
  paidAt?: Date;
  provider: string;
  providerPaymentId?: string;
  providerEventId?: string;
  txType: 'manual' | 'verify' | 'webhook' | 'create';
  raw?: Record<string, unknown>;
}

export async function applyPaymentOutcome(app: AppContext, tx: Tx, input: ApplyPaymentInput) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
  if (!payment) throw errors.notFound('Payment');
  if (payment.tenantId !== input.tenantId) throw errors.forbidden();

  if (input.providerEventId) {
    try {
      await tx.insert(paymentTransactions).values({
        tenantId: input.tenantId,
        paymentId: payment.id,
        provider: input.provider,
        type: input.txType,
        status: input.status,
        amount: input.amount ?? payment.amount,
        providerEventId: input.providerEventId,
        providerReference: input.providerPaymentId,
        data: input.raw ?? {},
      });
    } catch (e) {
      if (isUniqueViolation(e, 'payment_transactions_event_uq')) return { payment, booking: await loadBooking(tx, payment.bookingId), duplicate: true as const };
      throw e;
    }
  } else {
    await tx.insert(paymentTransactions).values({
      tenantId: input.tenantId,
      paymentId: payment.id,
      provider: input.provider,
      type: input.txType,
      status: input.status,
      amount: input.amount ?? payment.amount,
      providerReference: input.providerPaymentId,
      data: input.raw ?? {},
    });
  }

  const now = app.now();
  let nextStatus = payment.status;
  if (input.status === 'succeeded') nextStatus = 'succeeded';
  else if (input.status === 'failed') nextStatus = 'failed';
  else if (input.status === 'expired') nextStatus = 'expired';
  else if (input.status === 'cancelled') nextStatus = 'cancelled';

  if (input.amount && input.currency && input.currency !== payment.currency) {
    throw errors.policy('Payment currency does not match the booking.');
  }
  if (input.amount && input.status === 'succeeded' && dec(input.amount).greaterThan(dec(payment.amount).plus('0.01'))) {
    throw errors.policy('Payment amount exceeds the expected charge.');
  }

  const [updatedPayment] = (await tx
    .update(payments)
    .set({
      status: nextStatus,
      paidAt: input.status === 'succeeded' ? (input.paidAt ?? now) : payment.paidAt,
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
      lastCheckedAt: now,
      failureReason: input.status === 'failed' ? 'Provider reported failure' : payment.failureReason,
      updatedAt: now,
    })
    .where(eq(payments.id, payment.id))
    .returning()) as (typeof payments.$inferSelect)[];

  let booking = await loadBooking(tx, payment.bookingId);
  if (!booking) throw errors.notFound('Booking');

  if (input.status === 'succeeded') {
    booking = await handleLatePaymentAfterHold(tx, booking, now);
    const credited = dec(booking.amountPaid).plus(input.amount ?? payment.amount).toFixed(4);
    const paymentStatus = computeBookingPaymentStatus(booking, credited);
    const [updatedBooking] = (await tx
      .update(bookings)
      .set({ amountPaid: credited, paymentStatus, updatedAt: now })
      .where(eq(bookings.id, booking.id))
      .returning()) as (typeof bookings.$inferSelect)[];
    booking = updatedBooking!;

    await emitEvent(tx, {
      tenantId: input.tenantId,
      type: 'payment.succeeded',
      aggregateType: 'payment',
      aggregateId: payment.id,
      payload: { bookingId: booking.id, reference: booking.reference, amount: input.amount ?? payment.amount },
    });

    booking = await tryAutoPaymentTransition(app, tx, booking);
    app.realtime.publish(input.tenantId, 'bookings', 'payment.succeeded', { bookingId: booking.id, paymentId: payment.id });
    app.realtime.publish(input.tenantId, 'dashboard', 'dashboard.updated', { metric: 'payments' });
  } else if (input.status === 'failed') {
    await emitEvent(tx, {
      tenantId: input.tenantId,
      type: 'payment.failed',
      aggregateType: 'payment',
      aggregateId: payment.id,
      payload: { bookingId: booking.id, reference: booking.reference },
    });
  }

  return { payment: updatedPayment!, booking, duplicate: false as const };
}

async function handleLatePaymentAfterHold(tx: Tx, booking: typeof bookings.$inferSelect, now: Date) {
  if (!booking.holdExpiresAt || booking.holdExpiresAt > now) return booking;
  const held = await tx
    .select()
    .from(bookingAllocations)
    .where(and(eq(bookingAllocations.bookingId, booking.id), eq(bookingAllocations.status, 'held')));
  if (!held.length) return booking;
  const released = await tx
    .select({ id: bookingAllocations.id })
    .from(bookingAllocations)
    .where(
      and(
        eq(bookingAllocations.bookingId, booking.id),
        eq(bookingAllocations.status, 'released'),
      ),
    );
  if (released.length) {
    const meta = { ...(booking.metadata as Record<string, unknown>), requiresReview: true, latePayment: true };
    const [row] = await tx.update(bookings).set({ metadata: meta, updatedAt: now }).where(eq(bookings.id, booking.id)).returning();
    return row ?? booking;
  }
  await tx
    .update(bookingAllocations)
    .set({ status: 'active', expiresAt: null })
    .where(and(eq(bookingAllocations.bookingId, booking.id), eq(bookingAllocations.status, 'held')));
  return booking;
}

async function loadBooking(tx: Tx, bookingId: string) {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  return row ?? null;
}

async function tryAutoPaymentTransition(app: AppContext, tx: Tx, booking: typeof bookings.$inferSelect) {
  const wfRow = await loadWorkflowForBooking(tx, booking.workflowId);
  if (!wfRow) return booking;
  const workflow = parseWorkflow(wfRow.definition);
  const actions = availableActions(workflow, booking.status);
  const action = actions.includes('pay') ? 'pay' : actions.includes('confirm') ? 'confirm' : null;
  if (!action) return booking;
  try {
    const { updated } = await applyBookingTransition(tx, {
      row: booking,
      workflow,
      action,
      identity: anonymousIdentity(),
      reason: 'Payment received',
      now: app.now(),
    });
    await emitEvent(tx, {
      tenantId: booking.tenantId,
      type: 'booking.confirmed',
      aggregateType: 'booking',
      aggregateId: booking.id,
      payload: { reference: booking.reference, action, automatic: true },
    });
    return updated;
  } catch {
    return booking;
  }
}

export async function loadPaymentByProviderRef(tx: Tx, provider: string, providerPaymentId: string) {
  const [row] = await tx.select().from(payments).where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId)));
  return row ?? null;
}

export async function loadPaymentWithCustomer(tx: Tx, paymentId: string) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) return null;
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, payment.bookingId));
  const [customer] = booking?.customerId ? await tx.select().from(customers).where(eq(customers.id, booking.customerId)) : [];
  return { payment, booking: booking!, customer: customer ?? null };
}