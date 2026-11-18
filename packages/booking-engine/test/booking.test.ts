import { describe, expect, it } from 'vitest';
import { AppError, presetDefinition, zoned } from '@universal-booking/core';
import type { AvailabilityContext } from '@universal-booking/availability-engine';
import { defaultWorkflow } from '@universal-booking/workflow-engine';
import { BookingStrategyRegistry, defaultPolicy, evaluateCancellation, evaluateReschedule, parsePolicy, planReservation, type PricingSetup } from '../src';

const tz = 'Asia/Manila';
const registry = new BookingStrategyRegistry();

const pricing: PricingSetup = {
  currency: 'PHP',
  basePrice: '3000',
  rules: [{ strategy: 'nightly', configuration: {} }],
  seasonalRates: [],
  components: [],
  options: [],
  discount: null,
  taxes: [],
  fees: [],
  dynamicRules: [],
};

function hotel(over: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    timezone: tz,
    now: new Date('2026-11-01T00:00:00Z'),
    definition: registry.get('accommodation').validateConfiguration(presetDefinition('accommodation')),
    businessHours: [],
    serviceWindows: [],
    sessions: [],
    resources: [
      { id: 'r101', name: '101', status: 'active', capacity: 2, quantity: 1, schedule: null, sortOrder: 1 },
      { id: 'r102', name: '102', status: 'active', capacity: 4, quantity: 1, schedule: null, sortOrder: 2 },
    ],
    periods: [],
    allocations: [],
    capacities: [],
    ...over,
  };
}

describe('strategy registry', () => {
  it('validates every built-in preset', () => {
    for (const s of registry.list()) expect(() => s.validateConfiguration(s.preset)).not.toThrow();
  });
  it('rejects incompatible combinations', () => {
    const bad = { ...presetDefinition('accommodation'), timeSelection: 'slot' };
    try {
      registry.validate(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('CONFIGURATION_INVALID');
    }
  });
  it('refuses duplicate plugin registration unless replacing', () => {
    const s = registry.get('custom');
    expect(() => registry.register(s)).toThrow();
    expect(() => new BookingStrategyRegistry().register(s, { replace: true })).not.toThrow();
  });
});

describe('planReservation', () => {
  it('plans a hotel stay with deposit and an awaiting-payment status', async () => {
    const plan = await planReservation({
      strategy: registry.get('accommodation'),
      availability: hotel(),
      request: { startDate: '2026-12-01', endDate: '2026-12-03', participants: { adults: 3 } },
      pricing,
      workflow: defaultWorkflow,
      policy: defaultPolicy,
      actor: 'customer',
    });
    expect(plan.resourceIds).toEqual(['r102']);
    expect(plan.pricing.total).toBe('6000.00');
    expect(plan.position.status.key).toBe('awaiting_payment');
    expect(plan.allocations[0]!.exclusive).toBe(true);
  });

  it('rejects overlapping stays as unavailable', async () => {
    const busy = (id: string) => ({ resourceId: id, period: { start: zoned('2026-12-01', '00:00', tz), end: zoned('2026-12-05', '00:00', tz) }, blocked: { start: zoned('2026-12-01', '00:00', tz), end: zoned('2026-12-05', '00:00', tz) }, quantity: 1, exclusive: true });
    await expect(
      planReservation({
        strategy: registry.get('accommodation'),
        availability: hotel({ allocations: [busy('r101'), busy('r102')] }),
        request: { startDate: '2026-12-02', endDate: '2026-12-03', participants: { adults: 1 } },
        pricing,
        workflow: defaultWorkflow,
        policy: defaultPolicy,
        actor: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
  });

  it('validates guest counts and customer resource selection', async () => {
    await expect(
      planReservation({
        strategy: registry.get('accommodation'),
        availability: hotel(),
        request: { startDate: '2026-12-01', endDate: '2026-12-02', participants: { adults: 0, pets: 2 } },
        pricing,
        workflow: defaultWorkflow,
        policy: defaultPolicy,
        actor: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('applies the policy minimum notice', async () => {
    await expect(
      planReservation({
        strategy: registry.get('accommodation'),
        availability: hotel({ now: zoned('2026-11-30', '12:00', tz) }),
        request: { startDate: '2026-12-01', endDate: '2026-12-02', participants: { adults: 1 } },
        pricing,
        workflow: defaultWorkflow,
        policy: parsePolicy({ minNoticeMinutes: 48 * 60 }),
        actor: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });
});

describe('policies', () => {
  const start = new Date('2026-12-10T06:00:00Z');
  it('uses refund tiers', () => {
    const early = evaluateCancellation(defaultPolicy, { start, now: new Date('2026-12-07T00:00:00Z'), total: '1000', paid: '1000', currency: 'PHP' });
    expect(early.refundAmount).toBe('1000.00');
    expect(early.customerAllowed).toBe(true);
    const mid = evaluateCancellation(defaultPolicy, { start, now: new Date('2026-12-09T00:00:00Z'), total: '1000', paid: '1000', currency: 'PHP' });
    expect(mid.refundAmount).toBe('500.00');
    const late = evaluateCancellation(defaultPolicy, { start, now: new Date('2026-12-10T00:00:00Z'), total: '1000', paid: '1000', currency: 'PHP' });
    expect(late.customerAllowed).toBe(false);
    expect(late.refundAmount).toBe('0.00');
  });
  it('limits reschedules for customers but not staff', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    expect(evaluateReschedule(defaultPolicy, { start, now, rescheduleCount: 2, actor: 'customer' }).allowed).toBe(false);
    expect(evaluateReschedule(defaultPolicy, { start, now, rescheduleCount: 2, actor: 'staff' }).allowed).toBe(true);
  });
});
