/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { AppError, errors, offsetOf, pageMeta, type PaginationQuery, type PermissionKey } from '@universal-booking/core';
import { idParam, pageQuery } from '@universal-booking/contracts';
import type { Tx } from '@universal-booking/database';
import type { HandlerContext, RouteBuilder } from './route';
import { Reply } from './envelope';

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn };
type Ctx = HandlerContext<any, any, any>;

export interface CrudOptions<T extends TenantTable> {
  path: string;
  tag: string;
  entity: string;
  table: T;
  input: z.ZodType<any>;
  updateInput?: z.ZodType<any>;
  readPermission: PermissionKey;
  writePermission: PermissionKey;
  search?: PgColumn[];
  orderBy?: (PgColumn | SQL)[];
  /** Query parameters that filter by equality, for example { serviceId: table.serviceId }. */
  filters?: Record<string, PgColumn>;
  softDelete?: PgColumn;
  toValues?: (input: any, c: Ctx, tx: Tx, existing?: any) => Promise<Record<string, unknown>> | Record<string, unknown>;
  view?: (row: any) => unknown;
  afterWrite?: (tx: Tx, row: any, c: Ctx, op: 'create' | 'update' | 'delete') => Promise<void>;
  beforeDelete?: (tx: Tx, row: any, c: Ctx) => Promise<void>;
  only?: ('list' | 'get' | 'create' | 'update' | 'delete')[];
}

export function crudRoutes<T extends TenantTable>(route: RouteBuilder, o: CrudOptions<T>): void {
  const t = o.table as any;
  const enabled = (op: NonNullable<CrudOptions<T>['only']>[number]) => !o.only || o.only.includes(op);
  const view = o.view ?? ((r: unknown) => r);
  const filterKeys = Object.keys(o.filters ?? {});
  const listQuery = pageQuery.extend(Object.fromEntries(filterKeys.map((k) => [k, z.string().max(100).optional()])));

  const baseWhere = (c: Ctx) => and(eq(t.tenantId, c.tenant.id), o.softDelete ? isNull(o.softDelete) : undefined);

  async function findOrThrow(tx: Tx, c: Ctx, id: string) {
    const [row] = await tx.select().from(t).where(and(baseWhere(c), eq(t.id, id)));
    if (!row) throw errors.notFound(o.entity);
    return row;
  }

  if (enabled('list')) {
    route({
      method: 'get',
      path: o.path,
      summary: `List ${o.entity.toLowerCase()} records`,
      tags: [o.tag],
      auth: 'user',
      permission: o.readPermission,
      query: listQuery,
      async handler(c) {
        const q = c.query as PaginationQuery & Record<string, string | undefined>;
        const pg: PaginationQuery = { page: q.page, pageSize: q.pageSize };
        return c.tx(async (tx) => {
          const conditions: (SQL | undefined)[] = [baseWhere(c)];
          if (q.search && o.search?.length) conditions.push(or(...o.search.map((col) => ilike(col, `%${q.search!.replace(/[%_]/g, '\\$&')}%`))));
          for (const k of filterKeys) {
            const v = (q as Record<string, string | undefined>)[k];
            if (v !== undefined) conditions.push(v === 'null' ? isNull(o.filters![k]!) : eq(o.filters![k]!, v));
          }
          const where = and(...conditions);
          const [{ count }] = (await tx.select({ count: sql<number>`count(*)::int` }).from(t).where(where)) as [{ count: number }];
          const sortColumn = q.sort?.replace(/^-/, '');
          const sortable = sortColumn && sortColumn in t && (t[sortColumn] as PgColumn | undefined);
          const order: (PgColumn | SQL)[] = sortable ? [q.sort!.startsWith('-') ? desc(sortable) : asc(sortable)] : (o.orderBy ?? [desc(t.createdAt ?? t.id)]);
          const rows = await tx
            .select()
            .from(t)
            .where(where)
            .orderBy(...order)
            .limit(pg.pageSize)
            .offset(offsetOf(pg));
          return Reply.paged(rows.map(view), pageMeta(pg, count));
        });
      },
    });
  }

  if (enabled('get')) {
    route({
      method: 'get',
      path: `${o.path}/:id`,
      summary: `Get one ${o.entity.toLowerCase()}`,
      tags: [o.tag],
      auth: 'user',
      permission: o.readPermission,
      params: idParam,
      async handler(c) {
        return c.tx(async (tx) => view(await findOrThrow(tx, c, c.params.id)));
      },
    });
  }

  if (enabled('create')) {
    route({
      method: 'post',
      path: o.path,
      summary: `Create ${o.entity.toLowerCase()}`,
      tags: [o.tag],
      auth: 'user',
      permission: o.writePermission,
      body: o.input,
      async handler(c) {
        return c.tx(async (tx) => {
          const values = o.toValues ? await o.toValues(c.body, c, tx) : c.body;
          const inserted = (await tx.insert(t).values({ ...values, tenantId: c.tenant.id }).returning()) as any[];
          const row = inserted[0];
          if (!row) throw new AppError('INTERNAL_ERROR', 'Insert failed.');
          await o.afterWrite?.(tx, row, c, 'create');
          await c.audit({ action: `${o.entity.toLowerCase()}.created`, entityType: o.entity, entityId: (row as any).id, changes: c.body as Record<string, unknown> }, tx);
          return Reply.created(view(row));
        });
      },
    });
  }

  if (enabled('update')) {
    const updateSchema = o.updateInput ?? (o.input instanceof z.ZodObject ? o.input.partial() : o.input);
    route({
      method: 'patch',
      path: `${o.path}/:id`,
      summary: `Update ${o.entity.toLowerCase()}`,
      tags: [o.tag],
      auth: 'user',
      permission: o.writePermission,
      params: idParam,
      body: updateSchema,
      async handler(c) {
        return c.tx(async (tx) => {
          const existing = await findOrThrow(tx, c, c.params.id);
          const values = o.toValues ? await o.toValues(c.body, c, tx, existing) : c.body;
          const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
          delete clean.tenantId;
          delete clean.id;
          const [row] = Object.keys(clean).length
            ? await tx
                .update(t)
                .set(clean)
                .where(and(eq(t.tenantId, c.tenant.id), eq(t.id, c.params.id)))
                .returning()
            : [existing];
          await o.afterWrite?.(tx, row, c, 'update');
          await c.audit({ action: `${o.entity.toLowerCase()}.updated`, entityType: o.entity, entityId: c.params.id, changes: c.body as Record<string, unknown> }, tx);
          return view(row);
        });
      },
    });
  }

  if (enabled('delete')) {
    route({
      method: 'delete',
      path: `${o.path}/:id`,
      summary: `Delete ${o.entity.toLowerCase()}`,
      tags: [o.tag],
      auth: 'user',
      permission: o.writePermission,
      params: idParam,
      status: 204,
      async handler(c) {
        await c.tx(async (tx) => {
          const row = await findOrThrow(tx, c, c.params.id);
          await o.beforeDelete?.(tx, row, c);
          if (o.softDelete) {
            await tx
              .update(t)
              .set({ [o.softDelete.name === 'deleted_at' ? 'deletedAt' : 'archivedAt']: new Date() })
              .where(and(eq(t.tenantId, c.tenant.id), eq(t.id, c.params.id)));
          } else {
            await tx.delete(t).where(and(eq(t.tenantId, c.tenant.id), eq(t.id, c.params.id)));
          }
          await o.afterWrite?.(tx, row, c, 'delete');
          await c.audit({ action: `${o.entity.toLowerCase()}.deleted`, entityType: o.entity, entityId: c.params.id }, tx);
        });
        return Reply.noContent();
      },
    });
  }
}

export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'item'
  );
}
