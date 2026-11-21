import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAppContext } from '../bootstrap';
import { registerRoutes } from '../routes';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main() {
  const ctx = await createAppContext();
  const router = express.Router();
  registerRoutes(ctx, router);
  const doc = ctx.registry.document({
    title: ctx.env.APP_NAME,
    version: '0.1.0',
    serverUrl: `${ctx.env.APP_URL}${ctx.env.API_PREFIX}`,
  });
  const out = path.join(root, 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2), 'utf8');
  console.log(`Wrote ${out} (${ctx.registry.routes.length} operations)`);
  await ctx.db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});