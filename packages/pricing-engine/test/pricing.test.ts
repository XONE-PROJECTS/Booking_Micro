import { describe, expect, it } from 'vitest';
import { calculatePrice, PricingStrategyRegistry, type PricingInput } from '../src';

const base = (over: Partial<PricingInput> = {}): PricingInput => ({
  currency: 'PHP',
  basePrice: '1000',
  units: { minutes: 0, hours: 0, days: 0, nights: 0, sessions: 1 },
  dates: [],
  quantity: 1,
  guests: {},
  guestTotal: 0,
  resourceIds: [],
  rules: [],
  seasonalRates: [],
  components: [],
  options: [],
  discount: null,
  taxes: [],
  fees: [],
  deposit: { type: 'none', value: '0' },
  paymentMode: 'full',
  dynamicRules: [],
  context: { leadDays: 10, startDayOfWeek: 2, startDate: '2026-12-01' },
  ...over,
});

describe('pricing calculator', () => {
  it('prices nights with weekend rates and a season in the fixed order', async () => {
    // 2026-12-03 is a Thursday, 12-04 Friday, 12-05 Saturday.
    const r = await calculatePrice(
      base({
        units: { minutes: 0, hours: 0, days: 0, nights: 3, sessions: 0 },
        dates: ['2026-12-03', '2026-12-04', '2026-12-05'],
        guests: { adults: 2, children: 1 },
        guestTotal: 3,
        rules: [{ strategy: 'nightly', configuration: { amount: '3000', weekendAmount: '3500' } }],
        seasonalRates: [{ name: 'Holiday', startsOn: '2026-12-05', endsOn: '2026-12-31', adjustmentPercent: 20 }],
        components: [{ name: 'Extra guest', calculationType: 'per_extra_guest', amount: '500', includedGuests: 2, perUnitOf: 'nights' }],
        options: [{ id: 'bf', name: 'Breakfast', price: '250', chargeType: 'per_guest', quantity: 1 }],
        discount: { name: 'Promo', code: 'SAVE10', type: 'percent', value: '10' },
        fees: [{ name: 'Service charge', type: 'percent', value: '10' }],
        taxes: [{ name: 'VAT', rate: '12', inclusive: false }],
        deposit: { type: 'percent', value: '30' },
        paymentMode: 'deposit',
      }),
    );
    // Base 3000 + 3500 + 3500*1.2 = 10700; extra guest 500*3 = 1500; breakfast 250*3 = 750.
    expect(r.baseSubtotal).toBe('10700.00');
    expect(r.addonsTotal).toBe('2250.00');
    expect(r.subtotal).toBe('12950.00');
    expect(r.discountTotal).toBe('1295.00');
    expect(r.feeTotal).toBe('1165.50');
    expect(r.taxTotal).toBe('1538.46');
    expect(r.total).toBe('14358.96');
    expect(r.depositAmount).toBe('4307.69');
    expect(r.amountDueNow).toBe('4307.69');
    expect(r.amountDueLater).toBe('10051.27');
    const lineSum = r.lines.reduce((s, l) => s + Number(l.amount), 0);
    expect(lineSum.toFixed(2)).toBe(r.total);
  });

  it('reports inclusive tax without adding it', async () => {
    const r = await calculatePrice(base({ taxes: [{ name: 'VAT', rate: '12', inclusive: true }] }));
    expect(r.total).toBe('1000.00');
    expect(r.taxIncluded).toBe('107.14');
  });

  it('applies graduated tiers', async () => {
    const r = await calculatePrice(
      base({ quantity: 15, rules: [{ strategy: 'tiered', configuration: { mode: 'graduated', tiers: [{ upTo: 10, unitAmount: 100 }, { upTo: null, unitAmount: 80 }] } }] }),
    );
    expect(r.baseSubtotal).toBe('1400.00');
  });

  it('applies volume tiers', async () => {
    const r = await calculatePrice(base({ quantity: 15, rules: [{ strategy: 'tiered', configuration: { tiers: [{ upTo: 10, unitAmount: 100 }, { upTo: null, unitAmount: 80 }] } }] }));
    expect(r.baseSubtotal).toBe('1200.00');
  });

  it('prices per person by guest type', async () => {
    const r = await calculatePrice(base({ guests: { adult: 2, child: 1 }, guestTotal: 3, rules: [{ strategy: 'per_person', configuration: { guestTypes: { adult: 1500, child: 750 } } }] }));
    expect(r.baseSubtotal).toBe('3750.00');
  });

  it('evaluates custom formulas safely', async () => {
    const r = await calculatePrice(base({ guestTotal: 6, units: { minutes: 0, hours: 0, days: 0, nights: 2, sessions: 0 }, rules: [{ strategy: 'custom_formula', configuration: { formula: 'base * nights + max(0, guests - 4) * 300' } }] }));
    expect(r.baseSubtotal).toBe('2600.00');
    const registry = new PricingStrategyRegistry();
    expect(() => registry.get('custom_formula').validate({ formula: 'require("fs")' })).toThrow();
  });

  it('bills hourly with rounding and minimums', async () => {
    const r = await calculatePrice(base({ basePrice: '200', units: { minutes: 70, hours: 70 / 60, days: 0, nights: 0, sessions: 1 }, rules: [{ strategy: 'hourly', configuration: { roundToMinutes: 30, minimumHours: 1 } }] }));
    expect(r.baseSubtotal).toBe('300.00');
  });

  it('applies resource adjustments and caps fixed discounts at the subtotal', async () => {
    const r = await calculatePrice(base({ resourceIds: ['suite'], rules: [{ strategy: 'fixed', configuration: {} }, { strategy: 'fixed', resourceId: 'suite', configuration: { mode: 'delta', amount: 500 } }], discount: { name: 'Big', type: 'fixed', value: '99999' } }));
    expect(r.baseSubtotal).toBe('1500.00');
    expect(r.total).toBe('0.00');
  });

  it('adds refundable security deposits to the amount due now only', async () => {
    const r = await calculatePrice(base({ components: [{ name: 'Security deposit', calculationType: 'security_deposit', amount: '2000' }] }));
    expect(r.total).toBe('1000.00');
    expect(r.refundableDeposit).toBe('2000.00');
    expect(r.amountDueNow).toBe('3000.00');
  });

  it('applies dynamic rules by condition', async () => {
    const r = await calculatePrice(base({ context: { leadDays: 1, startDayOfWeek: 2, startDate: '2026-12-01', occupancyRate: 0.9 }, dynamicRules: [{ name: 'High demand', condition: { field: 'occupancyRate', op: 'gte', value: 0.8 }, adjustmentPercent: 15 }] }));
    expect(r.baseSubtotal).toBe('1150.00');
  });
});
