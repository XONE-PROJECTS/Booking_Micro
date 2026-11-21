import { loadEnv } from '@universal-booking/config';
import { runMigrations } from '@universal-booking/database';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const env = loadEnv();
await runMigrations(env.DATABASE_URL, path.join(root, 'packages/database/migrations'));
console.log('Migrations applied.');
