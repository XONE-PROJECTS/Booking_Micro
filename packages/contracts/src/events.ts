export const webhookEventTypes = [
  'booking.created',
  'booking.pending',
  'booking.confirmed',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.completed',
  'booking.expired',
  'booking.rejected',
  'booking.checked_in',
  'booking.no_show',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'resource.updated',
  'availability.changed',
  'customer.created',
] as const;

export type WebhookEventType = (typeof webhookEventTypes)[number];

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  tenantId: string;
  createdAt: string;
  data: T;
}

/** Status key -> event emitted when a booking enters it (default workflow names). */
export const statusEvents: Record<string, WebhookEventType> = {
  pending: 'booking.pending',
  confirmed: 'booking.confirmed',
  cancelled: 'booking.cancelled',
  rejected: 'booking.rejected',
  expired: 'booking.expired',
  completed: 'booking.completed',
  checked_in: 'booking.checked_in',
  no_show: 'booking.no_show',
};

/** Fallback for tenant-defined statuses, by status category. */
export const categoryEvents: Record<string, WebhookEventType | undefined> = {
  pending: 'booking.pending',
  active: 'booking.confirmed',
  in_service: 'booking.checked_in',
  completed: 'booking.completed',
  cancelled: 'booking.cancelled',
};

export function eventForStatus(statusKey: string, category: string): WebhookEventType | undefined {
  return statusEvents[statusKey] ?? categoryEvents[category];
}
