import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional; variables may come from the environment.
}

export function migrationUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (or MIGRATION_DATABASE_URL) to run database scripts.');
  return url;
}
