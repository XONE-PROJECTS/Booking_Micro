import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { errors, newId, offsetOf, pageMeta } from '@universal-booking/core';
import { randomToken } from '@universal-booking/core/node';
import { generateApiKey } from '@universal-booking/auth';
import { apiKeyInput, idParam, pageQuery, webhookEndpointInput } from '@universal-booking/contracts';
import { apiKeys, webhookDeliveries, webhookEndpoints, webhookSubscriptions } from '@universal-booking/database';
import { newId as newDeliveryId } from '@universal-booking/core';
import { assertSafeUrl } from '@universal-booking/webhooks';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';

export function registerIntegrationRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/integrations/webhooks',
    summary: 'List webhook endpoints',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const rows = await t.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)).limit(query.pageSize).offset(offsetOf(query));
        const enriched = await Promise.all(
          rows.map(async (row) => {
            const subs = await t.select({ eventType: webhookSubscriptions.eventType }).from(webhookSubscriptions).where(eq(webhookSubscriptions.endpointId, row.id));
            return { ...row, events: subs.map((s) => s.eventType), secretEncrypted: undefined };
          }),
        );
        return Reply.paged(enriched, pageMeta(query, enriched.length));
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/webhooks',
    summary: 'Register a webhook endpoint',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    body: webhookEndpointInput,
    async handler({ app, tx, tenant, body, audit }) {
      await assertSafeUrl(body.url, { requireHttps: app.env.NODE_ENV === 'production' });
      const secret = randomToken(24);
      const id = newId();
      return tx(async (t) => {
        await t.insert(webhookEndpoints).values({
          id,
          tenantId: tenant.id,
          url: body.url,
          description: body.description,
          secretEncrypted: app.secrets.encryptJson({ secret }),
          status: body.status,
        });
        for (const eventType of body.events) {
          await t.insert(webhookSubscriptions).values({ tenantId: tenant.id, endpointId: id, eventType });
        }
        await audit({ action: 'webhook.created', entityType: 'WebhookEndpoint', entityId: id }, t);
        return Reply.created({ id, url: body.url, events: body.events, signingSecret: secret });
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/webhooks/:id/test',
    summary: 'Send a test event to a webhook endpoint',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    params: idParam,
    body: z.object({ eventType: z.string().max(80).default('booking.created') }),
    async handler({ app, tx, tenant, params, body, audit }) {
      const { emitEvent } = await import('../events/outbox');
      return tx(async (t) => {
        const [ep] = await t.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, params.id));
        if (!ep) throw errors.notFound('Webhook endpoint');
        await emitEvent(t, {
          tenantId: tenant.id,
          type: 'booking.created',
          aggregateType: 'booking',
          aggregateId: newId(),
          payload: { test: true, endpointId: ep.id, eventType: body.eventType, sentAt: app.now().toISOString() },
        });
        await audit({ action: 'webhook.test', entityType: 'WebhookEndpoint', entityId: ep.id, changes: { eventType: body.eventType } }, t);
        return { queued: true, eventType: body.eventType };
      });
    },
  });

  route({
    method: 'delete',
    path: '/integrations/webhooks/:id',
    summary: 'Remove a webhook endpoint',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    params: idParam,
    status: 204,
    async handler({ tx, params, audit }) {
      await tx(async (t) => {
        const n = await t.delete(webhookEndpoints).where(eq(webhookEndpoints.id, params.id)).returning({ id: webhookEndpoints.id });
        if (!n.length) throw errors.notFound('Webhook endpoint');
        await audit({ action: 'webhook.deleted', entityType: 'WebhookEndpoint', entityId: params.id }, t);
      });
      return undefined;
    },
  });

  route({
    method: 'get',
    path: '/integrations/api-keys',
    summary: 'List API keys (prefix only)',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const rows = await t
          .select({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            kind: apiKeys.kind,
            scopes: apiKeys.scopes,
            lastUsedAt: apiKeys.lastUsedAt,
            expiresAt: apiKeys.expiresAt,
            revokedAt: apiKeys.revokedAt,
            createdAt: apiKeys.createdAt,
          })
          .from(apiKeys)
          .where(isNull(apiKeys.revokedAt))
          .orderBy(desc(apiKeys.createdAt))
          .limit(query.pageSize)
          .offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/api-keys',
    summary: 'Create an API key (shown once)',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    body: apiKeyInput,
    async handler({ tx, tenant, identity, body, audit }) {
      const generated = generateApiKey(body.kind);
      const id = newId();
      return tx(async (t) => {
        await t.insert(apiKeys).values({
          id,
          tenantId: tenant.id,
          name: body.name,
          prefix: generated.prefix,
          keyHash: generated.hash,
          kind: body.kind,
          scopes: body.scopes,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          createdById: identity.principalId,
        });
        await audit({ action: 'api_key.created', entityType: 'ApiKey', entityId: id, changes: { prefix: generated.prefix } }, t);
        return Reply.created({ id, name: body.name, prefix: generated.prefix, key: generated.key, kind: body.kind, scopes: body.scopes });
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/api-keys/:id/revoke',
    summary: 'Revoke an API key',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    params: idParam,
    body: z.object({}).optional(),
    async handler({ tx, params, audit, app }) {
      return tx(async (t) => {
        const [row] = (await t
          .update(apiKeys)
          .set({ revokedAt: app.now() })
          .where(and(eq(apiKeys.id, params.id), isNull(apiKeys.revokedAt)))
          .returning()) as (typeof apiKeys.$inferSelect)[];
        if (!row) throw errors.notFound('API key');
        await audit({ action: 'api_key.revoked', entityType: 'ApiKey', entityId: params.id }, t);
        return { id: row.id, revokedAt: row.revokedAt };
      });
    },
  });

  route({
    method: 'get',
    path: '/integrations/webhooks/deliveries',
    summary: 'Webhook delivery history',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    query: pageQuery,
    async handler({ tx, query }) {
      return tx(async (t) => {
        const rows = await t.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(query.pageSize).offset(offsetOf(query));
        return Reply.paged(rows, pageMeta(query, rows.length));
      });
    },
  });

  route({
    method: 'post',
    path: '/integrations/webhooks/deliveries/:id/replay',
    summary: 'Re-queue a webhook delivery for retry',
    tags: ['Integrations'],
    auth: 'user',
    permission: 'integrations.manage',
    params: idParam,
    async handler({ tx, app, params, audit }) {
      return tx(async (t) => {
        const [row] = await t.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, params.id));
        if (!row) throw errors.notFound('Delivery');
        const replayId = newDeliveryId();
        await t.insert(webhookDeliveries).values({
          id: replayId,
          tenantId: row.tenantId,
          endpointId: row.endpointId,
          eventId: row.eventId,
          eventType: row.eventType,
          payload: row.payload,
          status: 'pending',
          nextAttemptAt: app.now(),
          replayOf: row.id,
        });
        await audit({ action: 'webhook.replay', entityType: 'WebhookDelivery', entityId: replayId, changes: { replayOf: row.id } }, t);
        return Reply.created({ id: replayId, replayOf: row.id, status: 'pending' });
      });
    },
  });
}