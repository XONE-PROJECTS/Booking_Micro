import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export interface DatabaseOptions {
  url: string;
  poolMax?: number;
  /**
   * Role switched to inside tenant transactions (SET LOCAL ROLE) so row-level security applies even when
   * the connection user owns the tables or is a superuser. Null disables the switch.
   */
  rlsRole?: string | null;
  applicationName?: string;
  statementTimeoutMs?: number;
}

export interface DatabaseClient {
  db: Database;
  pool: pg.Pool;
  /** Runs fn in a transaction scoped to one tenant; RLS limits every statement to that tenant. */
  tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs fn in a transaction that may read across tenants (platform admin, jobs, public slug lookup). */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const identifier = /^[a-z_][a-z0-9_]*$/;

export function createDatabase(options: DatabaseOptions): DatabaseClient {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? 'universal-booking',
    statement_timeout: options.statementTimeoutMs ?? 15_000,
  });
  const db = drizzle(pool, { schema });
  const role = options.rlsRole ?? null;
  if (role && !identifier.test(role)) throw new Error(`Invalid RLS role name "${role}"`);

  return {
    db,
    pool,
    tenant(tenantId, fn) {
      return db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.bypass_rls', 'off', true)`);
        return fn(tx);
      });
    },
    system(fn) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.bypass_rls', 'on', true), set_config('app.tenant_id', '', true)`);
        return fn(tx);
      });
    },
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}

/** True when a Postgres error is the allocation exclusion constraint (double booking). */
export function isExclusionViolation(error: unknown): boolean {
  const e = findPgError(error);
  return e?.code === '23P01';
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = findPgError(error);
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}

export function isSerializationFailure(error: unknown): boolean {
  const e = findPgError(error);
  return e?.code === '40001' || e?.code === '40P01';
}

function findPgError(error: unknown): { code?: string; constraint?: string } | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    if (typeof current === 'object' && current !== null && 'code' in current && typeof (current as { code: unknown }).code === 'string') {
      return current as { code?: string; constraint?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
