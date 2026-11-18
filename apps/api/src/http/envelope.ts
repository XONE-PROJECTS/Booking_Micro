import type { Response } from 'express';
import type { PageMeta } from '@universal-booking/core';

/** Explicit response from a route handler (status codes, pagination, headers or non-JSON bodies). */
export class Reply {
  constructor(
    readonly status: number,
    readonly data: unknown,
    readonly options: { meta?: Record<string, unknown>; headers?: Record<string, string>; raw?: { contentType: string; body: string | Buffer } } = {},
  ) {}

  static created(data: unknown) {
    return new Reply(201, data);
  }
  static accepted(data: unknown) {
    return new Reply(202, data);
  }
  static noContent() {
    return new Reply(204, null);
  }
  static paged(items: unknown[], pagination: PageMeta) {
    return new Reply(200, items, { meta: { pagination } });
  }
  static csv(filename: string, body: string) {
    return new Reply(200, null, { raw: { contentType: 'text/csv; charset=utf-8', body }, headers: { 'content-disposition': `attachment; filename="${filename}"` } });
  }
}

export function meta(res: Response, extra?: Record<string, unknown>) {
  return { requestId: res.req.ctx?.requestId ?? 'unknown', timestamp: new Date().toISOString(), ...extra };
}

export function send(res: Response, status: number, data: unknown, extraMeta?: Record<string, unknown>) {
  if (status === 204) {
    res.status(204).end();
    return;
  }
  res.status(status).json({ success: true, data, meta: meta(res, extraMeta) });
}

export function sendReply(res: Response, reply: Reply) {
  for (const [k, v] of Object.entries(reply.options.headers ?? {})) res.setHeader(k, v);
  if (reply.options.raw) {
    res.status(reply.status).type(reply.options.raw.contentType).send(reply.options.raw.body);
    return;
  }
  send(res, reply.status, reply.data, reply.options.meta);
}

/** Minimal RFC 4180 CSV writer. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Neutralize spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}
