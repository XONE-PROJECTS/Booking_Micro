import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { newId } from '@universal-booking/core';
import {
  outboxEvents,
  webhookDeliveries,
  webhookEndpoints,
  webhookSubscriptions,
} from '@universal-booking/database';
import { deliver, maxAttempts, nextAttemptAt } from '@universal-booking/webhooks';
import type { AppContext } from '../context';
import { enqueueNotificationsFromOutbox } from '../modules/notifications/enqueue';

const BATCH = 50;

/** Fans pending outbox rows into webhook delivery jobs. */
export async function fanOutOutbox(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  return ctx.db.system(async (tx) => {
    const pending = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'pending'), lte(outboxEvents.availableAt, now)))
      .orderBy(outboxEvents.createdAt)
      .limit(BATCH);
    if (!pending.length) return 0;

    let enqueued = 0;
    for (const event of pending) {
      if (event.eventType.startsWith('internal.')) {
        await ctx.db.tenant(event.tenantId, (tenantTx) =>
          enqueueNotificationsFromOutbox(tenantTx, {
            tenantId: event.tenantId,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
          }),
        );
        await tx.update(outboxEvents).set({ status: 'processed', processedAt: now }).where(eq(outboxEvents.id, event.id));
        continue;
      }
      const subs = await tx
        .select({ endpointId: webhookSubscriptions.endpointId })
        .from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.tenantId, event.tenantId), eq(webhookSubscriptions.eventType, event.eventType)));
      await ctx.db.tenant(event.tenantId, (tenantTx) =>
        enqueueNotificationsFromOutbox(tenantTx, {
          tenantId: event.tenantId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
        }),
      );

      for (const sub of subs) {
        const deliveryId = newId();
        await tx.insert(webhookDeliveries).values({
          id: deliveryId,
          tenantId: event.tenantId,
          endpointId: sub.endpointId,
          eventId: event.id,
          eventType: event.eventType,
          payload: {
            id: event.id,
            type: event.eventType,
            created: event.createdAt.toISOString(),
            data: event.payload,
            aggregate: { type: event.aggregateType, id: event.aggregateId },
          },
        });
        enqueued++;
      }
      await tx.update(outboxEvents).set({ status: 'processed', processedAt: now }).where(eq(outboxEvents.id, event.id));
    }
    if (enqueued) ctx.log.debug({ events: pending.length, deliveries: enqueued }, 'outbox fan-out');
    return pending.length;
  });
}

/** Delivers due webhook HTTP calls with retries. */
export async function deliverDueWebhooks(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const allowPrivate = ctx.env.NODE_ENV === 'development';
  return ctx.db.system(async (tx) => {
    const due = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now)))
      .orderBy(webhookDeliveries.nextAttemptAt)
      .limit(BATCH);
    if (!due.length) return 0;

    const endpointIds = [...new Set(due.map((d) => d.endpointId))];
    const endpoints = await tx.select().from(webhookEndpoints).where(inArray(webhookEndpoints.id, endpointIds));
    const endpointMap = new Map(endpoints.map((e) => [e.id, e]));

    for (const d of due) {
      const endpoint = endpointMap.get(d.endpointId);
      if (!endpoint || endpoint.status !== 'active') {
        await tx.update(webhookDeliveries).set({ status: 'dead', lastError: 'Endpoint inactive or missing' }).where(eq(webhookDeliveries.id, d.id));
        continue;
      }
      const secret = ctx.secrets.decryptJson<{ secret: string }>(endpoint.secretEncrypted).secret;
      const result = await deliver({
        url: endpoint.url,
        secret,
        eventType: d.eventType,
        deliveryId: d.id,
        payload: d.payload,
        allowPrivate,
      });
      const attempts = d.attempts + 1;
      if (result.ok) {
        await tx
          .update(webhookDeliveries)
          .set({
            status: 'succeeded',
            attempts,
            deliveredAt: now,
            lastStatusCode: result.status,
            lastResponse: result.responseSnippet,
            durationMs: result.durationMs,
          })
          .where(eq(webhookDeliveries.id, d.id));
        await tx
          .update(webhookEndpoints)
          .set({ consecutiveFailures: 0, lastSuccessAt: now })
          .where(eq(webhookEndpoints.id, endpoint.id));
      } else {
        const next = nextAttemptAt(attempts, now);
        const dead = attempts >= maxAttempts || !next;
        await tx
          .update(webhookDeliveries)
          .set({
            status: dead ? 'dead' : 'pending',
            attempts,
            nextAttemptAt: next ?? now,
            lastStatusCode: result.status,
            lastError: result.error ?? `HTTP ${result.status}`,
            lastResponse: result.responseSnippet,
            durationMs: result.durationMs,
          })
          .where(eq(webhookDeliveries.id, d.id));
        await tx
          .update(webhookEndpoints)
          .set({
            consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
            lastFailureAt: now,
          })
          .where(eq(webhookEndpoints.id, endpoint.id));
      }
    }
    return due.length;
  });
}