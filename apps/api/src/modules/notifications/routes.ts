import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { errors, newId, offsetOf, pageMeta } from '@universal-booking/core';
import { idParam, notificationTemplateInput, pageQuery } from '@universal-booking/contracts';
import { notificationTemplates } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';

export function registerNotificationRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/notification-templates',
    summary: 'List notification templates',
    tags: ['Notifications'],
    auth: 'user',
    permission: 'notifications.manage',
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const rows = await t.select().from(notificationTemplates).orderBy(desc(notificationTemplates.createdAt)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'post',
    path: '/notification-templates',
    summary: 'Create a notification template',
    tags: ['Notifications'],
    auth: 'user',
    permission: 'notifications.manage',
    body: notificationTemplateInput,
    async handler({ tx, tenant, body, audit }) {
      const id = newId();
      return tx(async (t) => {
        await t.insert(notificationTemplates).values({
          id,
          tenantId: tenant.id,
          key: body.key,
          channel: body.channel,
          locale: body.locale,
          subject: body.subject,
          body: body.body,
          active: body.active,
        });
        await audit({ action: 'notification_template.created', entityType: 'NotificationTemplate', entityId: id }, t);
        const [row] = await t.select().from(notificationTemplates).where(eq(notificationTemplates.id, id));
        return Reply.created(row);
      });
    },
  });

  route({
    method: 'patch',
    path: '/notification-templates/:id',
    summary: 'Update a notification template',
    tags: ['Notifications'],
    auth: 'user',
    permission: 'notifications.manage',
    params: idParam,
    body: z.object({
      key: z.string().regex(/^[a-z_]+\.[a-z_]+$/).optional(),
      channel: z.enum(['email', 'sms', 'in_app']).optional(),
      locale: z.string().max(20).optional(),
      subject: z.string().max(300).nullish(),
      body: z.string().min(1).max(20000).optional(),
      active: z.boolean().optional(),
    }),
    async handler({ tx, params, body, audit }) {
      return tx(async (t) => {
        const [existing] = await t.select().from(notificationTemplates).where(eq(notificationTemplates.id, params.id));
        if (!existing) throw errors.notFound('Notification template');
        await t
          .update(notificationTemplates)
          .set({
            key: body.key ?? existing.key,
            channel: body.channel ?? existing.channel,
            locale: body.locale ?? existing.locale,
            subject: body.subject === undefined ? existing.subject : body.subject,
            body: body.body ?? existing.body,
            active: body.active ?? existing.active,
          })
          .where(eq(notificationTemplates.id, params.id));
        await audit({ action: 'notification_template.updated', entityType: 'NotificationTemplate', entityId: params.id }, t);
        const [row] = await t.select().from(notificationTemplates).where(eq(notificationTemplates.id, params.id));
        return row;
      });
    },
  });
}