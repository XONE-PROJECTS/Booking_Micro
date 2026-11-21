import { and, eq } from 'drizzle-orm';
import type { OptionSelection } from '@universal-booking/pricing-engine';
import {
  discounts,
  fees,
  priceComponents,
  pricingRules,
  seasonalRates,
  taxes,
  type Tx,
} from '@universal-booking/database';
import type { ServiceSnapshot } from '@universal-booking/database';
import type { AvailabilityRequest } from '@universal-booking/availability-engine';
import { parsePolicy, planReservation } from '@universal-booking/booking-engine';
import { parseWorkflow } from '@universal-booking/workflow-engine';
import { workflowDefinitions, bookingPolicies } from '@universal-booking/database';
import { errors } from '@universal-booking/core';
import { loadAvailabilityContext } from '../availability/context';
import type { AppContext } from '../../context';

export async function loadPublishedConfig(tx: Tx, snap: ServiceSnapshot) {
  const [wf] = snap.workflowId ? await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, snap.workflowId)) : [];
  const [pol] = snap.policyId ? await tx.select().from(bookingPolicies).where(eq(bookingPolicies.id, snap.policyId)) : [];
  if (!wf) throw errors.configuration('This service has no workflow.');
  if (!pol) throw errors.configuration('This service has no booking policy.');
  return { workflow: parseWorkflow(wf.definition), policy: parsePolicy(pol.policy) };
}

export async function loadPricingRows(tx: Tx, tenantId: string, serviceId: string) {
  const [rules, seasonal, components, taxRows, feeRows] = await Promise.all([
    tx.select().from(pricingRules).where(and(eq(pricingRules.serviceId, serviceId), eq(pricingRules.active, true))),
    tx.select().from(seasonalRates).where(and(eq(seasonalRates.serviceId, serviceId), eq(seasonalRates.active, true))),
    tx.select().from(priceComponents).where(and(eq(priceComponents.serviceId, serviceId), eq(priceComponents.active, true))),
    tx.select().from(taxes).where(eq(taxes.active, true)),
    tx.select().from(fees).where(eq(fees.active, true)),
  ]);
  const serviceTaxes = taxRows.filter((t) => !t.serviceIds.length || t.serviceIds.includes(serviceId));
  const serviceFees = feeRows.filter((f) => !f.serviceIds.length || f.serviceIds.includes(serviceId));
  return { rules, seasonal, components, taxes: serviceTaxes, fees: serviceFees };
}

export function optionSelections(snap: ServiceSnapshot, selected: { id: string; quantity: number }[] | undefined): OptionSelection[] {
  if (!selected?.length) return [];
  const map = new Map(snap.options.map((o) => [o.id, o]));
  return selected
    .map((s) => {
      const o = map.get(s.id);
      if (!o) return null;
      return { id: o.id, name: o.name, price: o.price, chargeType: o.chargeType as OptionSelection['chargeType'], quantity: s.quantity };
    })
    .filter((x): x is OptionSelection => !!x);
}

export async function quoteForService(
  app: AppContext,
  tx: Tx,
  input: {
    tenantId: string;
    timezone: string;
    snap: ServiceSnapshot;
    serviceId: string;
    request: AvailabilityRequest;
    promoCode?: string;
    options?: { id: string; quantity: number }[];
    actor: 'customer' | 'staff' | 'integration';
  },
) {
  const { workflow, policy } = await loadPublishedConfig(tx, input.snap);
  const strategy = app.bookingStrategies.get(input.snap.definition.strategy);
  const serviceId = input.serviceId;
  const start = input.request.startDate ? new Date(`${input.request.startDate}T00:00:00Z`) : app.now();
  const end = input.request.endDate ? new Date(`${input.request.endDate}T23:59:59Z`) : new Date(start.getTime() + 7 * 86_400_000);
  const ctx = await loadAvailabilityContext(tx, {
    tenantId: input.tenantId,
    timezone: input.timezone,
    now: app.now(),
    definition: input.snap.definition,
    serviceId,
    resourceIds: input.snap.resourceIds,
    window: { start, end },
  });
  const pricingRows = await loadPricingRows(tx, input.tenantId, serviceId);
  let discount = null as { code?: string | null; name: string; type: 'percent' | 'fixed'; value: string; maxAmount?: string | null } | null;
  if (input.promoCode) {
    const [d] = await tx.select().from(discounts).where(and(eq(discounts.code, input.promoCode.toUpperCase()), eq(discounts.active, true)));
    discount = d ?? null;
  }
  const plan = await planReservation({
    strategy,
    availability: { ...ctx, definition: input.snap.definition },
    request: { ...input.request, serviceId },
    pricing: {
      currency: input.snap.currency,
      basePrice: input.snap.basePrice,
      rules: pricingRows.rules.map((r) => ({ id: r.id, strategy: r.strategy, configuration: r.configuration, resourceId: r.resourceId, priority: r.priority })),
      seasonalRates: pricingRows.seasonal.map((s) => ({ id: s.id, name: s.name, startsOn: s.startsOn, endsOn: s.endsOn, daysOfWeek: s.daysOfWeek, amount: s.amount, adjustmentPercent: s.adjustmentPercent ? Number(s.adjustmentPercent) : null })),
      components: pricingRows.components.map((c) => ({
        name: c.name,
        calculationType: c.calculationType,
        amount: c.amount,
        includedGuests: c.includedGuests ?? undefined,
        guestType: c.guestType ?? undefined,
        perUnitOf: c.perUnitOf ?? undefined,
      })),
      options: optionSelections(input.snap, input.options),
      discount: discount ? { code: discount.code, name: discount.name, type: discount.type, value: discount.value, maxAmount: discount.maxAmount } : null,
      taxes: pricingRows.taxes.map((t) => ({ name: t.name, rate: String(t.rate), inclusive: t.inclusive })),
      fees: pricingRows.fees.map((f) => ({ name: f.name, type: f.type, value: f.value })),
      dynamicRules: pricingRows.rules
        .filter((r) => r.kind === 'dynamic' && r.condition)
        .map((r) => ({ name: r.name, condition: r.condition!, adjustmentPercent: Number(r.adjustmentPercent ?? 0) })),
    },
    workflow,
    policy,
    actor: input.actor,
    pricingRegistry: app.pricingStrategies,
  });
  return { plan, workflow, policy, pricingRows };
}