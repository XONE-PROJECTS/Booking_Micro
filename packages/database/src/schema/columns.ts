import { customType, foreignKey, numeric, timestamp, uuid, type AnyPgColumn, type PgColumn } from 'drizzle-orm/pg-core';
import { newId, type Interval } from '@universal-booking/core';

export const pk = () => uuid('id').primaryKey().$defaultFn(newId);
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const money = (name: string) => numeric(name, { precision: 19, scale: 4 });

export const timestamps = {
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Parses Postgres timestamptz text (for example "2026-12-01 00:00:00+08") into a Date. */
export function parsePgTimestamp(value: string): Date {
  let v = value.trim().replace(/^"|"$/g, '').replace(' ', 'T');
  if (/[+-]\d{2}$/.test(v)) v += ':00';
  return new Date(v);
}

export function parseRange(value: string): Interval {
  const inner = value.trim().slice(1, -1);
  const [a, b] = inner.split(',');
  return { start: parsePgTimestamp(a!), end: parsePgTimestamp(b!) };
}

/** Half-open [start, end) timestamptz range. */
export const tstzrange = customType<{ data: Interval; driverData: string }>({
  dataType: () => 'tstzrange',
  toDriver: (v) => `[${v.start.toISOString()},${v.end.toISOString()})`,
  fromDriver: (v) => parseRange(v),
});

/**
 * Composite tenant foreign key: (tenant_id, x_id) -> target(tenant_id, id).
 * Targets declare a matching unique (tenant_id, id) constraint, so rows cannot link across tenants.
 */
export function tenantFk(
  name: string,
  tenantId: PgColumn,
  column: PgColumn,
  target: { tenantId: AnyPgColumn; id: AnyPgColumn },
  onDelete: 'cascade' | 'restrict' | 'no action' = 'restrict',
) {
  return foreignKey({ name, columns: [tenantId, column], foreignColumns: [target.tenantId, target.id] }).onDelete(onDelete);
}
