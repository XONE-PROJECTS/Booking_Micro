import { and, eq } from 'drizzle-orm';
import { newId } from '@universal-booking/core';
import { bookings, customers, notificationLogs, notificationTemplates, type Tx } from '@universal-booking/database';

export async function enqueueNotificationsFromOutbox(
  tx: Tx,
  input: { tenantId: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> },
) {
  const notify = input.payload._notify;
  if (!Array.isArray(notify) || !notify.length) return;
  const keys = notify.filter((k): k is string => typeof k === 'string');
  if (!keys.length) return;

  let recipient: string | null = null;
  let bookingId: string | null = null;
  if (input.aggregateType === 'booking') {
    bookingId = input.aggregateId;
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.aggregateId));
    if (booking?.customerId) {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, booking.customerId));
      recipient = customer?.email ?? customer?.phone ?? null;
    }
  }

  for (const templateKey of keys) {
    for (const channel of ['email', 'sms'] as const) {
      const [tpl] = await tx
        .select()
        .from(notificationTemplates)
        .where(and(eq(notificationTemplates.tenantId, input.tenantId), eq(notificationTemplates.key, templateKey), eq(notificationTemplates.channel, channel), eq(notificationTemplates.active, true)));
      if (!tpl) continue;
      const to = channel === 'email' ? (recipient?.includes('@') ? recipient : null) : recipient && !recipient.includes('@') ? recipient : null;
      if (!to) {
        await tx.insert(notificationLogs).values({
          id: newId(),
          tenantId: input.tenantId,
          templateKey,
          channel,
          recipient: to ?? 'unknown',
          subject: tpl.subject,
          status: 'skipped',
          error: 'No recipient',
          bookingId,
        });
        continue;
      }
      await tx.insert(notificationLogs).values({
        id: newId(),
        tenantId: input.tenantId,
        templateKey,
        channel,
        recipient: to,
        subject: tpl.subject,
        status: 'queued',
        bookingId,
      });
    }
  }
}