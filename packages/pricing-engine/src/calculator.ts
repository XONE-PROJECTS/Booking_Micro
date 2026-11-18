import { dec, evaluateCondition, moneyString, percentOf, roundMoney, sumMoney, Decimal } from '@universal-booking/core';
import { PricingStrategyRegistry } from './strategies';
import type { BaseUnit, PricingInput, PricingLine, PricingResult, PricingRuleInput, SeasonalRateInput } from './types';

const defaultRegistry = new PricingStrategyRegistry();

function dayOfWeekOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function matchingSeason(rates: SeasonalRateInput[], date: string): SeasonalRateInput | undefined {
  const dow = dayOfWeekOf(date);
  return rates.find((r) => date >= r.startsOn && date <= r.endsOn && (!r.daysOfWeek?.length || r.daysOfWeek.includes(dow)));
}

/** Picks the base rule: highest priority rule that is not resource-specific. */
export function selectBaseRule(rules: PricingRuleInput[]): PricingRuleInput {
  const base = rules
    .filter((r) => !r.resourceId && r.strategy !== 'resource_adjustment')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return base ?? { strategy: 'fixed', configuration: {} };
}

/**
 * Server-authoritative price calculation in the blueprint's fixed order:
 * base, multiplier, resource adjustment, seasonal and time, add-ons, discounts, taxes and fees, deposit, final amount.
 */
export async function calculatePrice(input: PricingInput, registry: PricingStrategyRegistry = defaultRegistry): Promise<PricingResult> {
  const c = input.currency;
  const m = (v: Decimal.Value) => moneyString(v, c);
  const lines: PricingLine[] = [];

  // 1-2. Base price and duration or quantity multiplier.
  const baseRule = selectBaseRule(input.rules);
  const strategy = registry.get(baseRule.strategy);
  const units: BaseUnit[] = await strategy.calculate(input, baseRule.configuration);

  // 3. Resource-specific adjustment.
  const resourceRules = input.rules.filter((r) => r.resourceId && input.resourceIds.includes(r.resourceId));
  for (const rule of resourceRules) {
    const cfg = rule.configuration as { mode?: 'override' | 'delta' | 'percent'; amount?: string | number };
    const value = dec(cfg.amount ?? 0);
    for (const u of units) {
      if (cfg.mode === 'override') u.unitAmount = value;
      else if (cfg.mode === 'percent') u.unitAmount = u.unitAmount.plus(percentOf(u.unitAmount, value));
      else u.unitAmount = u.unitAmount.plus(value);
    }
  }

  for (const u of units) {
    lines.push({ kind: 'base', label: u.label, date: u.date, quantity: u.quantity.toString(), unitAmount: m(u.unitAmount), amount: m(u.unitAmount.times(u.quantity)) });
  }

  // 4. Seasonal and time-based adjustments, applied per dated unit (or the start date).
  for (const u of units) {
    const date = u.date ?? input.context.startDate;
    const season = matchingSeason(input.seasonalRates, date);
    if (!season) continue;
    const before = u.unitAmount;
    if (season.amount !== null && season.amount !== undefined && season.amount !== '') u.unitAmount = dec(season.amount);
    else if (season.adjustmentPercent) u.unitAmount = before.plus(percentOf(before, season.adjustmentPercent));
    const delta = u.unitAmount.minus(before).times(u.quantity);
    if (!delta.isZero()) lines.push({ kind: 'seasonal', label: `${season.name}${u.date ? ` (${u.date})` : ''}`, quantity: '1', unitAmount: m(delta), amount: m(delta), date: u.date });
  }

  let baseSubtotal = sumMoney(units.map((u) => roundMoney(u.unitAmount.times(u.quantity), c)));

  for (const rule of input.dynamicRules) {
    if (!evaluateCondition(rule.condition, input.context)) continue;
    const delta = roundMoney(percentOf(baseSubtotal, rule.adjustmentPercent), c);
    if (delta.isZero()) continue;
    lines.push({ kind: 'dynamic', label: rule.name, quantity: '1', unitAmount: m(delta), amount: m(delta) });
    baseSubtotal = baseSubtotal.plus(delta);
  }
  baseSubtotal = Decimal.max(baseSubtotal, 0);

  // 5. Additional services: add-ons and price components (extra-person charges and similar).
  const nightsOrDays = Math.max(input.units.nights, input.units.days, 1);
  let addonsTotal = new Decimal(0);
  for (const o of input.options) {
    const multiplier =
      o.chargeType === 'per_night' || o.chargeType === 'per_day'
        ? nightsOrDays
        : o.chargeType === 'per_guest'
          ? Math.max(1, input.guestTotal)
          : o.chargeType === 'per_session'
            ? input.units.sessions
            : o.chargeType === 'per_unit'
              ? Math.max(1, input.quantity)
              : 1;
    const q = dec(o.quantity).times(multiplier);
    const amount = roundMoney(dec(o.price).times(q), c);
    addonsTotal = addonsTotal.plus(amount);
    lines.push({ kind: 'addon', label: o.name, quantity: q.toString(), unitAmount: m(o.price), amount: m(amount) });
  }

  let refundableDeposit = new Decimal(0);
  for (const comp of input.components) {
    const perUnit = comp.perUnitOf ? Math.max(1, input.units[comp.perUnitOf]) : 1;
    const guests = comp.guestType ? (input.guests[comp.guestType] ?? 0) : input.guestTotal;
    let amount: Decimal;
    let q: Decimal;
    switch (comp.calculationType) {
      case 'fixed':
        q = dec(perUnit);
        amount = dec(comp.amount).times(q);
        break;
      case 'percent':
        q = dec(1);
        amount = percentOf(baseSubtotal, comp.amount);
        break;
      case 'per_unit':
        q = dec(Math.max(1, input.quantity) * perUnit);
        amount = dec(comp.amount).times(q);
        break;
      case 'per_guest':
        q = dec(guests * perUnit);
        amount = dec(comp.amount).times(q);
        break;
      case 'per_extra_guest': {
        const extra = Math.max(0, guests - (comp.includedGuests ?? 0) * Math.max(1, input.quantity));
        q = dec(extra * perUnit);
        amount = dec(comp.amount).times(q);
        break;
      }
      case 'security_deposit':
        refundableDeposit = refundableDeposit.plus(roundMoney(dec(comp.amount).times(Math.max(1, input.quantity)), c));
        continue;
    }
    amount = roundMoney(amount, c);
    if (amount.isZero()) continue;
    addonsTotal = addonsTotal.plus(amount);
    lines.push({ kind: 'component', label: comp.name, quantity: q.toString(), unitAmount: m(comp.amount), amount: m(amount) });
  }

  const subtotal = baseSubtotal.plus(addonsTotal);

  // 6. Discounts (never below zero).
  let discountTotal = new Decimal(0);
  if (input.discount) {
    const d = input.discount;
    discountTotal = d.type === 'percent' ? percentOf(subtotal, d.value) : dec(d.value);
    if (d.maxAmount) discountTotal = Decimal.min(discountTotal, dec(d.maxAmount));
    discountTotal = roundMoney(Decimal.min(discountTotal, subtotal), c);
    if (!discountTotal.isZero()) {
      lines.push({ kind: 'discount', label: d.code ? `${d.name} (${d.code})` : d.name, quantity: '1', unitAmount: m(discountTotal.negated()), amount: m(discountTotal.negated()) });
    }
  }
  const discounted = subtotal.minus(discountTotal);

  // 7. Fees (service charges) then taxes. Inclusive taxes are reported but not added.
  let feeTotal = new Decimal(0);
  for (const f of input.fees) {
    const amount = roundMoney(f.type === 'percent' ? percentOf(discounted, f.value) : dec(f.value), c);
    feeTotal = feeTotal.plus(amount);
    lines.push({ kind: 'fee', label: f.name, quantity: '1', unitAmount: m(amount), amount: m(amount) });
  }
  const taxable = discounted.plus(feeTotal);
  let taxTotal = new Decimal(0);
  let taxIncluded = new Decimal(0);
  for (const t of input.taxes) {
    if (t.inclusive) {
      const included = roundMoney(taxable.minus(taxable.dividedBy(dec(1).plus(dec(t.rate).dividedBy(100)))), c);
      taxIncluded = taxIncluded.plus(included);
      lines.push({ kind: 'tax', label: `${t.name} (included)`, quantity: '1', unitAmount: m(included), amount: m(0) });
    } else {
      const amount = roundMoney(percentOf(taxable, t.rate), c);
      taxTotal = taxTotal.plus(amount);
      lines.push({ kind: 'tax', label: t.name, quantity: '1', unitAmount: m(amount), amount: m(amount) });
    }
  }
  const total = roundMoney(taxable.plus(taxTotal), c);

  // 8. Deposit and 9. final payable amounts.
  let depositAmount = new Decimal(0);
  let amountDueNow = new Decimal(0);
  if (input.paymentMode === 'full') {
    amountDueNow = total;
  } else if (input.paymentMode === 'deposit') {
    const dep = input.deposit;
    depositAmount = dep.type === 'fixed' ? dec(dep.value) : dep.type === 'percent' ? percentOf(total, dep.value) : total;
    depositAmount = roundMoney(Decimal.min(depositAmount, total), c);
    amountDueNow = depositAmount;
    if (!depositAmount.isZero()) lines.push({ kind: 'deposit', label: 'Deposit due now', quantity: '1', unitAmount: m(depositAmount), amount: m(0) });
  }
  if (input.paymentMode === 'full' || input.paymentMode === 'deposit') amountDueNow = amountDueNow.plus(refundableDeposit);

  return {
    version: 1,
    currency: c,
    strategy: baseRule.strategy,
    lines,
    baseSubtotal: m(baseSubtotal),
    addonsTotal: m(addonsTotal),
    subtotal: m(subtotal),
    discountTotal: m(discountTotal),
    feeTotal: m(feeTotal),
    taxTotal: m(taxTotal),
    taxIncluded: m(taxIncluded),
    total: m(total),
    refundableDeposit: m(refundableDeposit),
    depositAmount: m(depositAmount),
    amountDueNow: m(amountDueNow),
    amountDueLater: m(Decimal.max(total.plus(refundableDeposit).minus(amountDueNow), 0)),
  };
}
