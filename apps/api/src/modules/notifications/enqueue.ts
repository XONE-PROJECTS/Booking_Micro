import { and, eq, inArray } from 'drizzle-orm';
import { newId } from '@universal-booking/core';
import {
  bookings,
  customers,
  membershipRoles,
  notificationLogs,
  notificationTemplates,
  rolePermissions,
  tenantMemberships,
  type Tx,
} from '@universal-booking/database';

async function staffUserIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, tenantMemberships.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, 'active'),
        inArray(rolePermissions.permissionKey, ['bookings.read', 'bookings.approve', 'bookings.manage']),
      ),
    );
  return rows.map((r) => r.userId);
}

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
    for (const channel of ['email', 'sms', 'in_app'] as const) {
      const [tpl] = await tx
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, input.tenantId),
            eq(notificationTemplates.key, templateKey),
            eq(notificationTemplates.channel, channel),
            eq(notificationTemplates.active, true),
          ),
        );
      if (!tpl) continue;

      if (channel === 'in_app') {
        if (!templateKey.startsWith('staff.')) continue;
        const userIds = await staffUserIds(tx, input.tenantId);
        if (!userIds.length) continue;
        for (const userId of userIds) {
          await tx.insert(notificationLogs).values({
            id: newId(),
            tenantId: input.tenantId,
            templateKey,
            channel,
            recipient: userId,
            subject: tpl.subject,
            status: 'queued',
            bookingId,
          });
        }
        continue;
      }

      const to =
        channel === 'email' ? (recipient?.includes('@') ? recipient : null) : recipient && !recipient.includes('@') ? recipient : null;
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
