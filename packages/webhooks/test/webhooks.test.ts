import { describe, expect, it } from 'vitest';
import { assertSafeUrl, deliver, isPrivateAddress, nextAttemptAt, signPayload, verifySignature } from '../src';

describe('webhooks', () => {
  it('signs and verifies payloads with replay protection', () => {
    const header = signPayload('secret', '{"a":1}');
    expect(verifySignature('secret', '{"a":1}', header)).toBe(true);
    expect(verifySignature('secret', '{"a":2}', header)).toBe(false);
    expect(verifySignature('other', '{"a":1}', header)).toBe(false);
    const old = signPayload('secret', 'x', Math.floor(Date.now() / 1000) - 3600);
    expect(verifySignature('secret', 'x', old)).toBe(false);
  });

  it('classifies private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('blocks SSRF targets', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertSafeUrl('http://localhost:6767/')).rejects.toThrow();
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertSafeUrl('https://user:pw@8.8.8.8/')).rejects.toThrow();
    await expect(assertSafeUrl('https://8.8.8.8/hook')).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('http://localhost:9000/', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });

  it('delivers with signature headers', async () => {
    let seen: Headers | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await deliver({ url: 'https://8.8.8.8/hook', secret: 's', eventType: 'booking.created', deliveryId: 'd1', payload: { a: 1 } }, fakeFetch);
    expect(r.ok).toBe(true);
    expect(seen!.get('x-booking-event')).toBe('booking.created');
    expect(verifySignature('s', JSON.stringify({ a: 1 }), seen!.get('x-booking-signature')!)).toBe(true);
  });

  it('backs off and gives up', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(nextAttemptAt(1, now)!.getTime()).toBeGreaterThanOrEqual(now.getTime() + 60_000);
    expect(nextAttemptAt(99, now)).toBeNull();
  });
});
