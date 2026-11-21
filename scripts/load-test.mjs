#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'k6', 'booking.js');
const r = spawnSync('k6', ['run', script], { stdio: 'inherit', env: { ...process.env, API_URL: process.env.API_URL ?? 'http://localhost:6767' } });
process.exit(r.status ?? (r.error ? 1 : 0));