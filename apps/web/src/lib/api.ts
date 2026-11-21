const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6767/api/v1';

export type Envelope<T> = { success: boolean; data: T; meta?: Record<string, unknown> };

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: 30 }, headers: authHeaders(token) });
  const json = (await res.json()) as Envelope<T>;
  if (!json.success) throw new Error('API error');
  return json.data;
}

export async function apiPost<T>(path: string, body: unknown, idempotencyKey?: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(token),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope<T>;
  if (!json.success) throw new Error(JSON.stringify(json));
  return json.data;
}