import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hmacSha256Hex, safeEqual } from '@universal-booking/core/node';

// ---------------------------------------------------------------------------
// Signing (Stripe-style): X-Booking-Signature: t=<unix>,v1=<hex hmac of "t.body">
// ---------------------------------------------------------------------------

export const SIGNATURE_HEADER = 'x-booking-signature';
export const EVENT_HEADER = 'x-booking-event';
export const DELIVERY_HEADER = 'x-booking-delivery';

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** For receivers (and the SDK): verifies signature and rejects stale timestamps to stop replays. */
export function verifySignature(secret: string, body: string, header: string | undefined, toleranceSeconds = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  return safeEqual(hmacSha256Hex(secret, `${t}.${body}`), parts.v1);
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const blockedV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return blockedV4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

/** Rejects non-http(s) URLs, embedded credentials, and hosts that resolve to private or reserved networks. */
export async function assertSafeUrl(raw: string, options: { allowPrivate?: boolean; requireHttps?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only http and https URLs are allowed.');
  if (options.requireHttps && url.protocol !== 'https:') throw new UnsafeUrlError('Webhook URLs must use https.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs must not contain credentials.');
  if (options.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeUrlError('Internal hosts are not allowed.');
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new UnsafeUrlError('Host could not be resolved.');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError('URLs that resolve to private networks are not allowed.');
  return url;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Minutes to wait before attempt n+1 (index = attempts already made - 1). */
export const retrySchedule = [1, 5, 30, 120, 360, 720, 1440];
export const maxAttempts = retrySchedule.length + 1;

export function nextAttemptAt(attempts: number, now = new Date()): Date | null {
  const minutes = retrySchedule[attempts - 1];
  if (minutes === undefined) return null;
  const jitter = Math.floor(Math.random() * 30_000);
  return new Date(now.getTime() + minutes * 60_000 + jitter);
}

export interface DeliveryRequest {
  url: string;
  secret: string;
  eventType: string;
  deliveryId: string;
  payload: unknown;
  timeoutMs?: number;
  allowPrivate?: boolean;
}

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error?: string;
  responseSnippet?: string;
  durationMs: number;
}

export async function deliver(req: DeliveryRequest, fetchImpl: typeof fetch = fetch): Promise<DeliveryResult> {
  const started = Date.now();
  try {
    await assertSafeUrl(req.url, { allowPrivate: req.allowPrivate });
    const body = JSON.stringify(req.payload);
    const res = await fetchImpl(req.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(req.timeoutMs ?? 10_000),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'UniversalBooking-Webhooks/1.0',
        [SIGNATURE_HEADER]: signPayload(req.secret, body),
        [EVENT_HEADER]: req.eventType,
        [DELIVERY_HEADER]: req.deliveryId,
      },
      body,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.status >= 200 && res.status < 300, status: res.status, responseSnippet: text.slice(0, 1000), durationMs: Date.now() - started };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
  }
}
