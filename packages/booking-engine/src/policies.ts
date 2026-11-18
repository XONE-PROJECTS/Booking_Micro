import { z } from 'zod';
import { dec, percentOf, roundMoney, moneyString, Decimal } from '@universal-booking/core';

export const policySchema = z.object({
  cancellation: z
    .object({
      allowed: z.boolean().default(true),
      /** Customers cannot cancel within this many hours of the start. Staff can still cancel. */
      deadlineHours: z.number().min(0).default(24),
      /** Refund tiers, matched by the largest hoursBefore that is still satisfied. */
      refundTiers: z
        .array(z.object({ hoursBefore: z.number().min(0), refundPercent: z.number().min(0).max(100) }))
        .default([
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 50 },
          { hoursBefore: 0, refundPercent: 0 },
        ]),
      cancellationFee: z.object({ type: z.enum(['none', 'fixed', 'percent']), value: z.number().min(0) }).default({ type: 'none', value: 0 }),
    })
    .default({
      allowed: true,
      deadlineHours: 24,
      refundTiers: [
        { hoursBefore: 48, refundPercent: 100 },
        { hoursBefore: 24, refundPercent: 50 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
      cancellationFee: { type: 'none', value: 0 },
    }),
  reschedule: z
    .object({ allowed: z.boolean().default(true), deadlineHours: z.number().min(0).default(24), maxTimes: z.number().int().min(0).default(2) })
    .default({ allowed: true, deadlineHours: 24, maxTimes: 2 }),
  deposit: z
    .object({ type: z.enum(['none', 'percent', 'fixed']).default('percent'), value: z.number().min(0).default(30) })
    .default({ type: 'percent', value: 30 }),
  minNoticeMinutes: z.number().int().min(0).optional(),
  maxHorizonDays: z.number().int().min(1).optional(),
  noShow: z
    .object({ graceMinutes: z.number().int().min(0).default(30), chargePercent: z.number().min(0).max(100).default(100), autoMark: z.boolean().default(false) })
    .default({ graceMinutes: 30, chargePercent: 100, autoMark: false }),
  checkIn: z
    .object({ earliestMinutesBefore: z.number().int().min(0).default(1440), requireFullPayment: z.boolean().default(false), instructions: z.string().max(2000).optional() })
    .default({ earliestMinutesBefore: 1440, requireFullPayment: false }),
  terms: z
    .object({ text: z.string().max(20_000).default(''), version: z.string().max(40).default('1'), requireAcceptance: z.boolean().default(false) })
    .default({ text: '', version: '1', requireAcceptance: false }),
});

export type BookingPolicy = z.infer<typeof policySchema>;
export const defaultPolicy: BookingPolicy = policySchema.parse({});

export function parsePolicy(input: unknown): BookingPolicy {
  return policySchema.parse(input ?? {});
}

const hoursUntil = (start: Date, now: Date) => (start.getTime() - now.getTime()) / 3_600_000;

export interface CancellationEvaluation {
  allowed: boolean;
  /** Whether a customer (not staff) may cancel now. */
  customerAllowed: boolean;
  refundPercent: number;
  refundAmount: string;
  feeAmount: string;
  reason?: string;
}

export function evaluateCancellation(
  policy: BookingPolicy,
  input: { start: Date; now: Date; total: string; paid: string; currency: string },
): CancellationEvaluation {
  const c = policy.cancellation;
  const hours = hoursUntil(input.start, input.now);
  const tier = [...c.refundTiers].sort((a, b) => b.hoursBefore - a.hoursBefore).find((t) => hours >= t.hoursBefore);
  const refundPercent = hours < 0 ? 0 : (tier?.refundPercent ?? 0);
  const fee =
    c.cancellationFee.type === 'fixed'
      ? dec(c.cancellationFee.value)
      : c.cancellationFee.type === 'percent'
        ? percentOf(input.total, c.cancellationFee.value)
        : new Decimal(0);
  const refund = Decimal.max(percentOf(input.paid, refundPercent).minus(fee), 0);
  const customerAllowed = c.allowed && hours >= c.deadlineHours;
  return {
    allowed: true,
    customerAllowed,
    refundPercent,
    refundAmount: moneyString(Decimal.min(refund, dec(input.paid)), input.currency),
    feeAmount: moneyString(roundMoney(fee, input.currency), input.currency),
    reason: customerAllowed ? undefined : !c.allowed ? 'Cancellations are not allowed for this booking.' : `Cancellations close ${c.deadlineHours} hours before the start.`,
  };
}

export function evaluateReschedule(
  policy: BookingPolicy,
  input: { start: Date; now: Date; rescheduleCount: number; actor: 'customer' | 'staff' },
): { allowed: boolean; reason?: string } {
  if (input.actor === 'staff') return { allowed: true };
  const r = policy.reschedule;
  if (!r.allowed) return { allowed: false, reason: 'Rescheduling is not allowed for this booking.' };
  if (input.rescheduleCount >= r.maxTimes) return { allowed: false, reason: `This booking can be rescheduled at most ${r.maxTimes} times.` };
  if (hoursUntil(input.start, input.now) < r.deadlineHours) return { allowed: false, reason: `Rescheduling closes ${r.deadlineHours} hours before the start.` };
  return { allowed: true };
}

export function noShowCharge(policy: BookingPolicy, total: string, currency: string): string {
  return moneyString(percentOf(total, policy.noShow.chargePercent), currency);
}

export function checkInAllowed(policy: BookingPolicy, input: { start: Date; now: Date; fullyPaid: boolean }): { allowed: boolean; reason?: string } {
  if (policy.checkIn.requireFullPayment && !input.fullyPaid) return { allowed: false, reason: 'Full payment is required before check-in.' };
  const earliest = input.start.getTime() - policy.checkIn.earliestMinutesBefore * 60_000;
  if (input.now.getTime() < earliest) return { allowed: false, reason: 'Check-in is not open yet.' };
  return { allowed: true };
}
