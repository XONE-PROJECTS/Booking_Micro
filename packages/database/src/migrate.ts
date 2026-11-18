import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies all pending versioned migrations (schema, then RLS, constraints and roles). */
export async function runMigrations(url: string, folder = migrationsFolder): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
