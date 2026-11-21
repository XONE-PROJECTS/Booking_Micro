import { getAdminToken } from './auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6767/api/v1';

type Envelope<T> = { success: boolean; data: T; meta?: { pagination?: unknown } };

export type AuthSession = {
  accessToken: string;
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenant: { id: string; slug: string; name: string } | null;
  permissions: string[];
};

function headers(token?: string | null, extra?: Record<string, string>): HeadersInit {
  const t = token ?? getAdminToken();
  return {
    'content-type': 'application/json',
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    ...extra,
  };
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as Envelope<T> & { error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? JSON.stringify(json));
  return json.data;
}

export async function adminGetList<T = Record<string, unknown>>(path: string, token?: string | null): Promise<T[]> {
  const res = await fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });
  const json = (await res.json()) as Envelope<T[]> & { error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? 'Request failed');
  return (json.data ?? []) as T[];
}

export async function adminFetchReport(path: string, token?: string | null): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/csv')) return { csv: await res.text() };
  const json = (await res.json()) as Envelope<Record<string, unknown>> & { error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? 'Request failed');
  if (json.data && typeof json.data === 'object' && 'csv' in json.data) return json.data;
  return json.data;
}

export async function adminGet<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });
  return parse<T>(res);
}

export async function adminPost<T>(path: string, body: unknown, token?: string | null, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: headers(token, idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    body: JSON.stringify(body),
  });
  return parse<T>(res);
}

export async function adminPatch<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'PATCH', headers: headers(token), body: JSON.stringify(body) });
  return parse<T>(res);
}

export async function adminPut<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'PUT', headers: headers(token), body: JSON.stringify(body) });
  return parse<T>(res);
}

export async function adminDelete(path: string, token?: string | null): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE', headers: headers(token) });
  if (!res.ok && res.status !== 204) await parse(res);
}

export async function adminLogin(body: { email: string; password: string; tenantSlug?: string }) {
  return adminPost<AuthSession>('/auth/login', { ...body, tokenTransport: 'body' }, null);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function bookingsToCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return 'reference,status,startAt,total\n';
  const keys = ['reference', 'status', 'startAt', 'endAt', 'total', 'paymentStatus', 'customerId'];
  const header = keys.join(',');
  const lines = rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n');
}