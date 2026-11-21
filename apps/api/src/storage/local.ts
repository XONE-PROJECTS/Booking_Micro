import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { errors } from '@universal-booking/core';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function storeLocalFile(
  baseDir: string,
  input: { tenantId: string; filename: string; mime: string; size: number; stream: Readable; maxBytes: number },
): Promise<{ path: string; urlPath: string }> {
  if (input.size > input.maxBytes) throw errors.validation('File is too large.', [{ path: 'file', message: 'Exceeds limit' }]);
  if (!allowed.has(input.mime)) throw errors.validation('File type is not allowed.', [{ path: 'file', message: input.mime }]);
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const dir = path.join(baseDir, input.tenantId);
  await mkdir(dir, { recursive: true });
  const rel = `${input.tenantId}/${Date.now()}-${safe}`;
  const full = path.join(baseDir, rel);
  await pipeline(input.stream, createWriteStream(full));
  const st = await stat(full);
  if (st.size > input.maxBytes) throw errors.validation('File is too large.', [{ path: 'file', message: 'Exceeds limit' }]);
  return { path: full, urlPath: `/files/${rel}` };
}

export async function readLocalFile(storedPath: string, baseDir: string): Promise<Buffer> {
  const base = path.resolve(baseDir);
  const full = path.resolve(storedPath);
  if (!full.startsWith(base)) throw errors.forbidden();
  return readFile(full);
}

export function streamLocalFile(storedPath: string, baseDir: string) {
  const base = path.resolve(baseDir);
  const full = path.resolve(storedPath);
  if (!full.startsWith(base)) throw errors.forbidden();
  return createReadStream(full);
}
