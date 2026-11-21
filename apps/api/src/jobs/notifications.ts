import { and, eq } from 'drizzle-orm';
import { toLocalIso } from '@universal-booking/core';
import { renderTemplate, textToHtml } from '@universal-booking/notification-providers';
import { bookings, businessProfiles, customers, notificationLogs, notificationTemplates, services } from '@universal-booking/database';
import type { AppContext } from '../context';

const BATCH = 50;

export async function deliverQueuedNotifications(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  return ctx.db.system(async (sysTx) => {
    const due = await sysTx
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.status, 'queued')))
      .limit(BATCH);
    if (!due.length) return 0;

    for (const log of due) {
      await ctx.db.tenant(log.tenantId, async (tx) => {
        const [tpl] = await tx
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.tenantId, log.tenantId),
              eq(notificationTemplates.key, log.templateKey),
              eq(notificationTemplates.channel, log.channel as 'email' | 'sms' | 'in_app'),
              eq(notificationTemplates.active, true),
            ),
          );
        if (!tpl) {
          await tx.update(notificationLogs).set({ status: 'skipped', error: 'Template missing' }).where(eq(notificationLogs.id, log.id));
          return;
        }

        const vars: Record<string, unknown> = { templateKey: log.templateKey };
        if (log.bookingId) {
          const [booking] = await tx.select().from(bookings).where(eq(bookings.id, log.bookingId));
          if (booking) {
            vars.reference = booking.reference;
            vars.total = booking.total;
            vars.amountDueNow = booking.pricingSnapshot.amountDueNow;
            vars.localStart = toLocalIso(booking.startAt, booking.timezone);
            vars.booking = {
              reference: booking.reference,
              total: booking.total,
              localStart: toLocalIso(booking.startAt, booking.timezone),
            };
            const [svc] = await tx.select({ name: services.name }).from(services).where(eq(services.id, booking.serviceId));
            vars['service.name'] = svc?.name ?? '';
            vars.service = { name: svc?.name ?? '' };
            if (booking.customerId) {
              const [c] = await tx.select().from(customers).where(eq(customers.id, booking.customerId));
              if (c) {
                vars.customerName = `${c.firstName} ${c.lastName ?? ''}`.trim();
                vars.customerEmail = c.email;
                vars['customer.firstName'] = c.firstName;
                vars.customer = { firstName: c.firstName, lastName: c.lastName, email: c.email };
              }
            }
          }
        }
        const [profile] = await tx.select().from(businessProfiles).where(eq(businessProfiles.tenantId, log.tenantId));
        const businessName = profile?.displayName ?? profile?.legalName ?? 'Universal Booking';
        vars.businessName = businessName;
        vars.business = { name: businessName };
        vars['business.name'] = businessName;

        const subject = tpl.subject ? renderTemplate(tpl.subject, vars) : log.templateKey;
        const text = renderTemplate(tpl.body, vars);
        try {
          if (log.channel === 'email') {
            const html = textToHtml(text, { name: String(vars.businessName) });
            const sent = await ctx.notifier.email.send({ to: log.recipient, subject, text, html });
            await tx
              .update(notificationLogs)
              .set({ status: 'sent', provider: sent.provider, providerMessageId: sent.messageId, sentAt: now, attempts: log.attempts + 1 })
              .where(eq(notificationLogs.id, log.id));
          } else {
            const sent = await ctx.notifier.sms.send({ to: log.recipient, text });
            await tx
              .update(notificationLogs)
              .set({ status: 'sent', provider: sent.provider, providerMessageId: sent.messageId, sentAt: now, attempts: log.attempts + 1 })
              .where(eq(notificationLogs.id, log.id));
          }
        } catch (e) {
          await tx
            .update(notificationLogs)
            .set({ status: 'failed', error: e instanceof Error ? e.message : String(e), attempts: log.attempts + 1 })
            .where(eq(notificationLogs.id, log.id));
        }
      });
    }
    return due.length;
  });
}

export { recheckPendingPayments } from './payments-recheck';