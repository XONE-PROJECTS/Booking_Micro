import { z } from 'zod';
import { isValidTimeZone } from '@universal-booking/core';

export const id = z.uuid();
export const slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:mm');
export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d{1,15}(\.\d{1,4})?$/.test(v), 'Must be a decimal amount');
export const nonNegativeMoney = moneyInput.refine((v) => !v.startsWith('-'), 'Must not be negative');
export const money = z.string().describe('Decimal amount as a string, for example "10500.00"');
export const currency = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase());
export const timezone = z.string().refine(isValidTimeZone, 'Unknown IANA time zone');
export const email = z.email().max(254).transform((v) => v.toLowerCase());
export const phone = z
  .string()
  .max(32)
  .regex(/^[+0-9 ()-]{5,32}$/, 'Invalid phone number');
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #2563eb');
export const httpsUrl = z.url().max(2000);
export const dayOfWeek = z.number().int().min(0).max(6);
export const isoDateTime = z.iso.datetime({ offset: true });

export const weeklyWindow = z.object({ dayOfWeek, startTime: localTime, endTime: localTime });

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(200).optional(),
  sort: z.string().max(60).optional(),
});

export const meta = z.object({ requestId: z.string(), timestamp: z.string() });
export const pageMeta = z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() });

export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, meta });
}

export function pagedEnvelope<T extends z.ZodType>(item: T) {
  return z.object({ success: z.literal(true), data: z.array(item), meta: meta.extend({ pagination: pageMeta }) });
}

export const errorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string().optional(), code: z.string().optional(), message: z.string() })).optional(),
  }),
  meta,
});

export const idParam = z.object({ id });
export const reasonInput = z.object({ reason: z.string().max(1000).optional() });
