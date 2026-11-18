import pg from 'pg';
import { migrationUrl } from './env';
import { runMigrations } from '../migrate';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESET !== 'true') {
  throw new Error('Refusing to reset a production database. Set ALLOW_DB_RESET=true to override.');
}

const url = migrationUrl();
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
} finally {
  await pool.end();
}
await runMigrations(url);
console.log('Database reset and migrated. Run `npm run db:seed` next.');
