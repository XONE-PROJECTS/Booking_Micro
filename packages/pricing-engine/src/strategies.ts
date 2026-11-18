import { z } from 'zod';
import { compileExpression, dec, errors, ExpressionError, Decimal } from '@universal-booking/core';
import type { BaseUnit, PricingInput, PricingStrategy } from './types';

const amount = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Must be a number');

function parse<T>(schema: z.ZodType<T>, config: unknown, type: string): T {
  const r = schema.safeParse(config ?? {});
  if (!r.success) {
    throw errors.configuration(`Invalid ${type} pricing configuration`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

const qty = (input: PricingInput) => dec(Math.max(1, input.quantity));
const priceOf = (input: PricingInput, cfgAmount?: string) => dec(cfgAmount ?? input.basePrice);

function simple(type: string, label: string, units: (input: PricingInput) => number): PricingStrategy {
  const schema = z.object({ amount: amount.optional() });
  return {
    type,
    validate: (c) => void parse(schema, c, type),
    calculate(input, config) {
      const cfg = parse(schema, config, type);
      return [{ label, unitAmount: priceOf(input, cfg.amount), quantity: dec(units(input)).times(qty(input)) }];
    },
  };
}

const fixed = simple('fixed', 'Base price', () => 1);
const daily = simple('daily', 'Daily rate', (i) => i.units.days);
const perSession = simple('per_session', 'Session', (i) => i.units.sessions);
const perResource: PricingStrategy = {
  type: 'per_resource',
  validate: (c) => void parse(z.object({ amount: amount.optional() }), c, 'per_resource'),
  calculate(input, config) {
    const cfg = parse(z.object({ amount: amount.optional() }), config, 'per_resource');
    return [{ label: 'Per resource', unitAmount: priceOf(input, cfg.amount), quantity: dec(Math.max(1, input.resourceIds.length)) }];
  },
};

const hourlySchema = z.object({ amount: amount.optional(), minimumHours: z.number().min(0).optional(), roundToMinutes: z.number().int().min(1).optional() });
const hourly: PricingStrategy = {
  type: 'hourly',
  validate: (c) => void parse(hourlySchema, c, 'hourly'),
  calculate(input, config) {
    const cfg = parse(hourlySchema, config, 'hourly');
    const round = cfg.roundToMinutes ?? 60;
    const billedMinutes = Math.ceil(input.units.minutes / round) * round;
    const hours = Math.max(cfg.minimumHours ?? 0, billedMinutes / 60);
    return [{ label: 'Hourly rate', unitAmount: priceOf(input, cfg.amount), quantity: dec(hours).times(qty(input)) }];
  },
};

const nightlySchema = z.object({ amount: amount.optional(), weekendAmount: amount.optional(), weekendDays: z.array(z.number().int().min(0).max(6)).optional() });
const nightly: PricingStrategy = {
  type: 'nightly',
  validate: (c) => void parse(nightlySchema, c, 'nightly'),
  calculate(input, config) {
    const cfg = parse(nightlySchema, config, 'nightly');
    const weekend = new Set(cfg.weekendDays ?? [5, 6]);
    const dates = input.dates.length ? input.dates : [input.context.startDate];
    return dates.map<BaseUnit>((date) => {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const unit = cfg.weekendAmount && weekend.has(dow) ? dec(cfg.weekendAmount) : priceOf(input, cfg.amount);
      return { label: 'Night', date, unitAmount: unit, quantity: qty(input) };
    });
  },
};

const perPersonSchema = z.object({ amount: amount.optional(), guestTypes: z.record(z.string(), amount).optional() });
const perPerson: PricingStrategy = {
  type: 'per_person',
  validate: (c) => void parse(perPersonSchema, c, 'per_person'),
  calculate(input, config) {
    const cfg = parse(perPersonSchema, config, 'per_person');
    if (cfg.guestTypes && Object.keys(cfg.guestTypes).length) {
      return Object.entries(cfg.guestTypes)
        .filter(([key]) => (input.guests[key] ?? 0) > 0)
        .map(([key, price]) => ({ label: `Per person (${key})`, unitAmount: dec(price), quantity: dec(input.guests[key] ?? 0) }));
    }
    return [{ label: 'Per person', unitAmount: priceOf(input, cfg.amount), quantity: dec(Math.max(1, input.guestTotal || input.quantity)) }];
  },
};

const tieredSchema = z.object({
  basis: z.enum(['quantity', 'guests', 'hours', 'days', 'nights', 'sessions']).default('quantity'),
  mode: z.enum(['volume', 'graduated']).default('volume'),
  tiers: z.array(z.object({ upTo: z.number().positive().nullable(), unitAmount: amount })).min(1),
});
const tiered: PricingStrategy = {
  type: 'tiered',
  validate: (c) => void parse(tieredSchema, c, 'tiered'),
  calculate(input, config) {
    const cfg = parse(tieredSchema, config, 'tiered');
    const basis =
      cfg.basis === 'quantity' ? input.quantity : cfg.basis === 'guests' ? input.guestTotal : input.units[cfg.basis];
    const tiers = [...cfg.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    if (cfg.mode === 'volume') {
      const tier = tiers.find((t) => t.upTo === null || basis <= t.upTo) ?? tiers[tiers.length - 1]!;
      return [{ label: `Tiered (${cfg.basis})`, unitAmount: dec(tier.unitAmount), quantity: dec(basis) }];
    }
    const units: BaseUnit[] = [];
    let remaining = basis;
    let floor = 0;
    for (const t of tiers) {
      if (remaining <= 0) break;
      const cap = t.upTo === null ? remaining : Math.min(remaining, t.upTo - floor);
      if (cap > 0) units.push({ label: `Tier ${floor + 1}-${t.upTo ?? '+'}`, unitAmount: dec(t.unitAmount), quantity: dec(cap) });
      remaining -= cap;
      floor = t.upTo ?? floor;
    }
    return units;
  },
};

export const formulaVariables = ['base', 'quantity', 'guests', 'nights', 'days', 'hours', 'minutes', 'sessions', 'resources', 'lead_days', 'day_of_week', 'occupancy'] as const;

const formulaSchema = z.object({ formula: z.string().min(1).max(500), label: z.string().max(100).optional() });
const customFormula: PricingStrategy = {
  type: 'custom_formula',
  validate(c) {
    const cfg = parse(formulaSchema, c, 'custom_formula');
    try {
      compileExpression(cfg.formula, formulaVariables);
    } catch (e) {
      if (e instanceof ExpressionError) throw errors.configuration(`Invalid formula: ${e.message}`, [{ path: 'formula', message: e.message }]);
      throw e;
    }
  },
  calculate(input, config) {
    const cfg = parse(formulaSchema, config, 'custom_formula');
    const value = compileExpression(cfg.formula, formulaVariables).evaluate({
      base: input.basePrice,
      quantity: input.quantity,
      guests: input.guestTotal,
      nights: input.units.nights,
      days: input.units.days,
      hours: input.units.hours,
      minutes: input.units.minutes,
      sessions: input.units.sessions,
      resources: input.resourceIds.length,
      lead_days: input.context.leadDays,
      day_of_week: input.context.startDayOfWeek,
      occupancy: input.context.occupancyRate ?? 0,
    });
    return [{ label: cfg.label ?? 'Price', unitAmount: Decimal.max(value, 0), quantity: dec(1) }];
  },
};

export const builtInPricingStrategies: PricingStrategy[] = [fixed, hourly, daily, nightly, perPerson, perResource, perSession, tiered, customFormula];

export class PricingStrategyRegistry {
  private readonly strategies = new Map<string, PricingStrategy>();

  constructor(initial: PricingStrategy[] = builtInPricingStrategies) {
    initial.forEach((s) => this.register(s));
  }

  register(strategy: PricingStrategy): void {
    this.strategies.set(strategy.type, strategy);
  }

  get(type: string): PricingStrategy {
    const s = this.strategies.get(type);
    if (!s) throw errors.configuration(`Unknown pricing strategy "${type}"`);
    return s;
  }

  has(type: string): boolean {
    return this.strategies.has(type);
  }

  types(): string[] {
    return [...this.strategies.keys()];
  }
}
