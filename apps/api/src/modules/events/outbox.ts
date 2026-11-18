import { outboxEvents, type Tx } from '@universal-booking/database';
import type { WebhookEventType } from '@universal-booking/contracts';

export interface OutboxEvent {
  tenantId: string;
  type: WebhookEventType | `internal.${string}`;
  aggregateType: 'booking' | 'payment' | 'resource' | 'service' | 'customer';
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Notification templates to send for this event (from workflow transition effects). */
  notify?: string[];
}

/** Records a domain event in the same transaction as the change; the dispatcher fans it out later. */
export async function emitEvent(tx: Tx, event: OutboxEvent): Promise<void> {
  await tx.insert(outboxEvents).values({
    tenantId: event.tenantId,
    eventType: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: { ...event.payload, ...(event.notify?.length ? { _notify: event.notify } : {}) },
  });
}
