/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { errors, newId, type PermissionKey } from '@universal-booking/core';
import { idParam } from '@universal-booking/contracts';
import type { Tx } from '@universal-booking/database';
import type { HandlerContext, RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';

type VersionedTable = PgTable & {
  id: PgColumn;
  tenantId: PgColumn;
  familyId: PgColumn;
  version: PgColumn;
  status: PgColumn;
  name: PgColumn;
  publishedAt: PgColumn;
  createdAt: PgColumn;
};

type Ctx = HandlerContext<any, any, any>;

export interface VersionedOptions {
  path: string;
  tag: string;
  entity: string;
  table: VersionedTable;
  input: z.ZodType<any>;
  readPermission: PermissionKey;
  writePermission: PermissionKey;
  /** Maps the request body to table columns, after validation. */
  toValues: (body: any, c: Ctx) => Record<string, unknown> | Promise<Record<string, unknown>>;
  afterSave?: (tx: Tx, row: any, c: Ctx) => Promise<void>;
  afterPublish?: (tx: Tx, row: any, c: Ctx, body: any) => Promise<void>;
  /** Blocks archiving rows still referenced elsewhere. */
  beforeArchive?: (tx: Tx, row: any) => Promise<void>;
}

/** Latest published row of the family that `id` belongs to; configuration references follow their family. */
export async function resolvePublished<T extends VersionedTable>(tx: Tx, table: T, id: string): Promise<any | null> {
  const t = table as any;
  const [row] = await tx.select({ familyId: t.familyId }).from(t).where(eq(t.id, id));
  if (!row) return null;
  const [latest] = await tx
    .select()
    .from(t)
    .where(and(eq(t.familyId, row.familyId), eq(t.status, 'published')))
    .orderBy(desc(t.version))
    .limit(1);
  return latest ?? null;
}

export function versionedRoutes(route: RouteBuilder, o: VersionedOptions): void {
  const t = o.table as any;
  const lower = o.entity.toLowerCase();

  async function load(tx: Tx, id: string) {
    const [row] = await tx.select().from(t).where(eq(t.id, id));
    if (!row) throw errors.notFound(o.entity);
    return row;
  }

  route({
    method: 'get',
    path: o.path,
    summary: `List ${lower}s (latest version of each)`,
    tags: [o.tag],
    auth: 'user',
    permission: o.readPermission,
    query: z.object({ status: z.enum(['draft', 'published', 'archived']).optional(), allVersions: z.coerce.boolean().default(false) }),
    async handler(c) {
      return c.tx(async (tx) => {
        const where = c.query.status ? eq(t.status, c.query.status) : undefined;
        const rows = await tx
          .select()
          .from(t)
          .where(where)
          .orderBy(asc(t.name), desc(t.version));
        if (c.query.allVersions) return rows;
        const seen = new Set<string>();
        return rows.filter((r: any) => (seen.has(r.familyId) ? false : (seen.add(r.familyId), true)));
      });
    },
  });

  route({
    method: 'get',
    path: `${o.path}/:id`,
    summary: `Get a ${lower} version`,
    tags: [o.tag],
    auth: 'user',
    permission: o.readPermission,
    params: idParam,
    async handler(c) {
      return c.tx((tx) => load(tx, c.params.id));
    },
  });

  route({
    method: 'get',
    path: `${o.path}/:id/versions`,
    summary: `Version history of a ${lower}`,
    tags: [o.tag],
    auth: 'user',
    permission: o.readPermission,
    params: idParam,
    async handler(c) {
      return c.tx(async (tx) => {
        const row = await load(tx, c.params.id);
        return tx
          .select({ id: t.id, version: t.version, status: t.status, name: t.name, publishedAt: t.publishedAt, createdAt: t.createdAt })
          .from(t)
          .where(eq(t.familyId, row.familyId))
          .orderBy(desc(t.version));
      });
    },
  });

  route({
    method: 'post',
    path: o.path,
    summary: `Create a ${lower} (draft)`,
    tags: [o.tag],
    auth: 'user',
    permission: o.writePermission,
    body: o.input.and(z.object({ publish: z.boolean().optional() })),
    async handler(c) {
      return c.tx(async (tx) => {
        const values = await o.toValues(c.body, c);
        const id = newId();
        const publish = c.body.publish === true;
        const [row] = (await tx
          .insert(t)
          .values({ ...values, id, familyId: id, tenantId: c.tenant.id, version: 1, status: publish ? 'published' : 'draft', publishedAt: publish ? new Date() : null })
          .returning()) as any[];
        await o.afterSave?.(tx, row, c);
        if (publish) await o.afterPublish?.(tx, row, c, c.body);
        await c.audit({ action: `${lower}.created`, entityType: o.entity, entityId: id, changes: { name: (row as any).name, published: publish } }, tx);
        return Reply.created(row);
      });
    },
  });

  route({
    method: 'patch',
    path: `${o.path}/:id`,
    summary: `Edit a ${lower}. Editing a published version creates a new draft version.`,
    tags: [o.tag],
    auth: 'user',
    permission: o.writePermission,
    params: idParam,
    body: o.input,
    async handler(c) {
      return c.tx(async (tx) => {
        const current = await load(tx, c.params.id);
        if (current.status === 'archived') throw errors.conflict(`Archived ${lower}s cannot be edited.`);
        const values = await o.toValues(c.body, c);
        if (current.status === 'draft') {
          const [row] = (await tx
            .update(t)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(t.id, current.id))
            .returning()) as any[];
          await o.afterSave?.(tx, row, c);
          await c.audit({ action: `${lower}.updated`, entityType: o.entity, entityId: current.id }, tx);
          return row;
        }
        const [existingDraft] = await tx
          .select()
          .from(t)
          .where(and(eq(t.familyId, current.familyId), eq(t.status, 'draft')));
        if (existingDraft) {
          const [row] = (await tx
            .update(t)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(t.id, existingDraft.id))
            .returning()) as any[];
          await o.afterSave?.(tx, row, c);
          return row;
        }
        const [{ v }] = (await tx
          .select({ v: max(t.version) })
          .from(t)
          .where(eq(t.familyId, current.familyId))) as [{ v: number }];
        const [row] = (await tx
          .insert(t)
          .values({ ...values, id: newId(), familyId: current.familyId, tenantId: c.tenant.id, version: (v ?? 0) + 1, status: 'draft' })
          .returning()) as any[];
        await o.afterSave?.(tx, row, c);
        await c.audit({ action: `${lower}.version_created`, entityType: o.entity, entityId: (row as any).id, changes: { familyId: current.familyId, version: (row as any).version } }, tx);
        return Reply.created(row);
      });
    },
  });

  route({
    method: 'post',
    path: `${o.path}/:id/publish`,
    summary: `Publish a ${lower} version (previous published versions are archived; existing bookings keep theirs)`,
    tags: [o.tag],
    auth: 'user',
    permission: o.writePermission,
    params: idParam,
    body: z.object({ isDefault: z.boolean().optional() }).optional(),
    status: 200,
    async handler(c) {
      return c.tx(async (tx) => {
        const current = await load(tx, c.params.id);
        if (current.status === 'archived') throw errors.conflict(`Archived ${lower}s cannot be published.`);
        await tx
          .update(t)
          .set({ status: 'archived' })
          .where(and(eq(t.familyId, current.familyId), eq(t.status, 'published'), sql`${t.id} <> ${current.id}`));
        const [row] = (await tx
          .update(t)
          .set({ status: 'published', publishedAt: current.publishedAt ?? new Date() })
          .where(eq(t.id, current.id))
          .returning()) as any[];
        await o.afterPublish?.(tx, row, c, c.body ?? {});
        await c.audit({ action: `${lower}.published`, entityType: o.entity, entityId: current.id, changes: { version: current.version } }, tx);
        return row;
      });
    },
  });

  route({
    method: 'post',
    path: `${o.path}/:id/archive`,
    summary: `Archive every version of a ${lower}`,
    tags: [o.tag],
    auth: 'user',
    permission: o.writePermission,
    params: idParam,
    status: 200,
    async handler(c) {
      return c.tx(async (tx) => {
        const current = await load(tx, c.params.id);
        await o.beforeArchive?.(tx, current);
        await tx.update(t).set({ status: 'archived' }).where(eq(t.familyId, current.familyId));
        await c.audit({ action: `${lower}.archived`, entityType: o.entity, entityId: current.id }, tx);
        return { id: current.id, familyId: current.familyId, status: 'archived' };
      });
    },
  });

  route({
    method: 'delete',
    path: `${o.path}/:id`,
    summary: `Delete a draft ${lower} version`,
    tags: [o.tag],
    auth: 'user',
    permission: o.writePermission,
    params: idParam,
    status: 204,
    async handler(c) {
      await c.tx(async (tx) => {
        const current = await load(tx, c.params.id);
        if (current.status !== 'draft') throw errors.conflict(`Only draft ${lower}s can be deleted. Archive published ones instead.`);
        await tx.delete(t).where(eq(t.id, current.id));
        await c.audit({ action: `${lower}.deleted`, entityType: o.entity, entityId: current.id }, tx);
      });
      return Reply.noContent();
    },
  });
}

export async function familyIds(tx: Tx, table: VersionedTable, id: string): Promise<string[]> {
  const t = table as any;
  const [row] = await tx.select({ familyId: t.familyId }).from(t).where(eq(t.id, id));
  if (!row) return [];
  const rows = await tx.select({ id: t.id }).from(t).where(eq(t.familyId, row.familyId));
  return rows.map((r: any) => r.id);
}
