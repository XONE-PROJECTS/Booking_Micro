import type { AppContext } from '../context';
import { cleanupExpiredHolds } from './hold-cleanup';
import { deliverDueWebhooks, fanOutOutbox } from './outbox-dispatch';
import { deliverQueuedNotifications, recheckPendingPayments } from './notifications';
import { enqueueBookingReminders } from './reminders';

export const JOB_NAMES = [
  'hold.cleanup',
  'outbox.fanout',
  'webhooks.deliver',
  'notifications.deliver',
  'notifications.reminders',
  'payments.recheck',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export async function runJob(ctx: AppContext, name: JobName): Promise<unknown> {
  switch (name) {
    case 'hold.cleanup':
      return cleanupExpiredHolds(ctx);
    case 'outbox.fanout':
      return fanOutOutbox(ctx);
    case 'webhooks.deliver':
      return deliverDueWebhooks(ctx);
    case 'notifications.deliver':
      return deliverQueuedNotifications(ctx);
    case 'notifications.reminders':
      return enqueueBookingReminders(ctx);
    case 'payments.recheck':
      return recheckPendingPayments(ctx);
    default:
      return null;
  }
}