import { dec, minorUnits } from '@universal-booking/core';
import { PaymentProviderError, type ProviderContext } from './types';

export async function requestJson<T = Record<string, unknown>>(
  ctx: ProviderContext,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams },
): Promise<T> {
  const f = ctx.fetch ?? fetch;
  const res = await f(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep text
  }
  if (!res.ok) throw new PaymentProviderError(`Provider request failed with ${res.status}`, res.status, body);
  return body as T;
}

export const basicAuth = (user: string, password = '') => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/** Decimal amount -> integer minor units (centavos, cents). */
export const toMinor = (amount: string, currency: string): number => dec(amount).times(10 ** minorUnits(currency)).toDecimalPlaces(0).toNumber();

export const fromMinor = (amount: number, currency: string): string => dec(amount).dividedBy(10 ** minorUnits(currency)).toFixed(minorUnits(currency));

export function requireCredential(ctx: ProviderContext, key: string): string {
  const v = ctx.credentials[key];
  if (!v) throw new PaymentProviderError(`Missing provider credential "${key}"`);
  return v;
}

export function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}
