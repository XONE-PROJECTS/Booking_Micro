import { and, eq } from 'drizzle-orm';
import { bookingAllocations, bookingHolds, bookings, bookingStatusHistory, type Tx } from '@universal-booking/database';
import type { IdentityContext } from '@universal-booking/core';
import { resolveTransition, type WorkflowDefinition } from '@universal-booking/workflow-engine';

export function transitionActor(identity: IdentityContext) {
  if (identity.principalType === 'anonymous') return { kind: 'system' as const };
  if (identity.permissions.includes('customer.self')) return { kind: 'customer' as const };
  return { kind: 'user' as const, identity };
}

export async function applyBookingTransition(
  tx: Tx,
  input: {
    row: typeof bookings.$inferSelect;
    workflow: WorkflowDefinition;
    action: string;
    identity: IdentityContext;
    reason?: string;
    now: Date;
  },
) {
  const resolved = resolveTransition(input.workflow, {
    from: input.row.status,
    action: input.action as never,
    actor: transitionActor(input.identity),
    guards: {
      paymentRequirementMet: input.row.paymentStatus === 'paid' || !input.row.paymentRequired,
      beforeStart: input.row.startAt > input.now,
      cancellationAllowed: true,
      resourcesAssigned: true,
    },
  });

  const allocPatch =
    resolved.inventory === 'activate'
      ? { status: 'active' as const, expiresAt: null }
      : resolved.inventory === 'release'
        ? { status: 'released' as const, releasedAt: input.now, expiresAt: null }
        : null;

  if (allocPatch) {
    await tx.update(bookingAllocations).set(allocPatch).where(eq(bookingAllocations.bookingId, input.row.id));
  }

  if (resolved.transition.to !== 'awaiting_payment' && resolved.inventory === 'activate') {
    await tx
      .update(bookingHolds)
      .set({ status: 'converted', resolvedAt: input.now })
      .where(and(eq(bookingHolds.bookingId, input.row.id), eq(bookingHolds.status, 'active')));
  }

  const [updated] = (await tx
    .update(bookings)
    .set({
      status: resolved.transition.to,
      statusCategory: resolved.toCategory,
      holdExpiresAt: resolved.inventory === 'activate' ? null : input.row.holdExpiresAt,
      updatedAt: input.now,
    })
    .where(eq(bookings.id, input.row.id))
    .returning()) as (typeof bookings.$inferSelect)[];

  await tx.insert(bookingStatusHistory).values({
    tenantId: input.row.tenantId,
    bookingId: input.row.id,
    fromStatus: input.row.status,
    toStatus: resolved.transition.to,
    action: input.action,
    actorType: input.identity.principalType,
    actorId: input.identity.principalId,
    reason: input.reason,
  });

  return { updated: updated!, resolved };
}