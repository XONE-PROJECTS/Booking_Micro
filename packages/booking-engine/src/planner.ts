import {
  dayOfWeek,
  dec,
  errors,
  evaluateCondition,
  guestTotal,
  toLocalDate,
  type BookingDefinition,
  type ErrorDetail,
} from '@universal-booking/core';
import type { AvailabilityContext, AvailabilityRequest, DurationResult, RangeAvailability } from '@universal-booking/availability-engine';
import { calculatePrice, PricingStrategyRegistry, type PricingInput, type PricingResult } from '@universal-booking/pricing-engine';
import type { PlannedAllocation } from '@universal-booking/resource-engine';
import { creationPosition, type PipelinePosition, type WorkflowDefinition } from '@universal-booking/workflow-engine';
import type { BookingPolicy } from './policies';
import { describeReason, type BookingStrategy } from './strategies';

export type PricingSetup = Pick<
  PricingInput,
  'currency' | 'basePrice' | 'rules' | 'seasonalRates' | 'components' | 'options' | 'discount' | 'taxes' | 'fees' | 'dynamicRules'
> & { occupancyRate?: number };

export interface PlanInput {
  strategy: BookingStrategy;
  availability: AvailabilityContext;
  request: AvailabilityRequest;
  pricing: PricingSetup;
  workflow: WorkflowDefinition;
  policy: BookingPolicy;
  actor: 'customer' | 'staff' | 'integration';
  /** Extra facts for conditional approval and workflow steps (customer attributes, answers). */
  facts?: Record<string, unknown>;
  pricingRegistry?: PricingStrategyRegistry;
}

export interface ReservationPlan {
  definition: BookingDefinition;
  duration: DurationResult;
  availability: RangeAvailability;
  allocations: PlannedAllocation[];
  resourceIds: string[];
  pricing: PricingResult;
  paymentRequired: boolean;
  approvalRequired: boolean;
  position: PipelinePosition;
  facts: Record<string, unknown>;
}

/** Applies the stricter of the definition's and the policy's booking-window limits. */
export function effectiveDefinition(def: BookingDefinition, policy: BookingPolicy): BookingDefinition {
  return {
    ...def,
    limits: {
      ...def.limits,
      leadTimeMinutes: Math.max(def.limits.leadTimeMinutes, policy.minNoticeMinutes ?? 0),
      horizonDays: Math.min(def.limits.horizonDays, policy.maxHorizonDays ?? def.limits.horizonDays),
    },
  };
}

export function validateRequestShape(def: BookingDefinition, req: AvailabilityRequest, actor: PlanInput['actor']): ErrorDetail[] {
  const e: ErrorDetail[] = [];
  const quantity = req.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < def.quantity.min || quantity > def.quantity.max) {
    e.push({ path: 'quantity', message: `Quantity must be between ${def.quantity.min} and ${def.quantity.max}.` });
  }
  if (def.guests.enabled) {
    const p = req.participants ?? {};
    for (const t of def.guests.types) {
      const n = Number(p[t.key] ?? 0);
      if (!Number.isInteger(n) || n < t.min || n > t.max) e.push({ path: `participants.${t.key}`, message: `${t.label} must be between ${t.min} and ${t.max}.` });
    }
    const known = new Set(def.guests.types.map((t) => t.key));
    for (const k of Object.keys(p)) if (known.size && !known.has(k)) e.push({ path: `participants.${k}`, message: `Unknown guest type "${k}".` });
    const total = guestTotal(def, p);
    const maxTotal = def.guests.maxTotal !== undefined ? def.guests.maxTotal * Math.max(1, quantity) : undefined;
    if (total < def.guests.minTotal) e.push({ path: 'participants', message: `At least ${def.guests.minTotal} guests are required.` });
    if (maxTotal !== undefined && total > maxTotal) e.push({ path: 'participants', message: `At most ${maxTotal} guests are allowed.` });
  }
  if (req.resourceIds?.length && actor === 'customer' && !def.resources.customerSelects) {
    e.push({ path: 'resourceIds', message: 'Resources are assigned automatically for this service.' });
  }
  return e;
}

export function buildFacts(def: BookingDefinition, req: AvailabilityRequest, duration: DurationResult, totals: { total?: string }, extra: Record<string, unknown> = {}, now = new Date()) {
  const start = duration.periods[0]!.start;
  return {
    ...extra,
    total: totals.total !== undefined ? Number(totals.total) : undefined,
    quantity: req.quantity ?? 1,
    guests: { total: guestTotal(def, req.participants), ...(req.participants ?? {}) },
    nights: duration.units.nights,
    days: duration.units.days,
    hours: duration.units.hours,
    sessions: duration.units.sessions,
    leadDays: Math.floor((start.getTime() - now.getTime()) / 86_400_000),
  };
}

export async function quoteReservation(input: Omit<PlanInput, 'workflow'>, availability: RangeAvailability, resourceIds: string[]): Promise<PricingResult> {
  const def = input.availability.definition;
  const req = input.request;
  const tz = input.availability.timezone;
  const start = availability.duration.periods[0]!.start;
  const startDate = toLocalDate(start, tz);
  return calculatePrice(
    {
      ...input.pricing,
      units: availability.duration.units,
      dates: availability.duration.dates,
      quantity: req.quantity ?? 1,
      guests: req.participants ?? {},
      guestTotal: guestTotal(def, req.participants),
      resourceIds,
      deposit: { type: input.policy.deposit.type, value: String(input.policy.deposit.value) },
      paymentMode: def.payment.mode,
      context: {
        occupancyRate: input.pricing.occupancyRate,
        leadDays: Math.floor((start.getTime() - input.availability.now.getTime()) / 86_400_000),
        startDayOfWeek: dayOfWeek(startDate),
        startDate,
      },
    },
    input.pricingRegistry,
  );
}

/**
 * Pure reservation planning: validates the request, checks availability, selects resources,
 * builds allocations, prices the booking and decides the first workflow status.
 * The caller persists the plan inside a transaction after locking the affected inventory.
 */
export async function planReservation(input: PlanInput): Promise<ReservationPlan> {
  const def = effectiveDefinition(input.availability.definition, input.policy);
  const ctx: AvailabilityContext = { ...input.availability, definition: def };
  const shapeErrors = validateRequestShape(def, input.request, input.actor);
  if (shapeErrors.length) throw errors.validation('The booking request is invalid.', shapeErrors);

  const availability = await input.strategy.calculateAvailability(ctx, input.request);
  if (!availability.available) {
    const details = availability.reasons.map((r) => ({ code: r, message: describeReason(r) }));
    if (availability.reasons.includes('capacity')) throw errors.capacity(undefined, details);
    if (availability.reasons.some((r) => ['lead_time', 'horizon', 'daily_capacity'].includes(r))) {
      throw errors.policy(details[0]?.message ?? 'This time cannot be booked.', details);
    }
    throw errors.unavailable(undefined, details);
  }

  const allocations = await input.strategy.buildAllocation(ctx, input.request, availability);
  const resourceIds = [...new Set(allocations.map((a) => a.resourceId).filter((x): x is string => !!x))];
  const pricing = await quoteReservation({ ...input, availability: ctx }, availability, resourceIds);

  const facts = buildFacts(def, input.request, availability.duration, pricing, input.facts, ctx.now);
  const approvalRequired = def.approval.mode === 'manual' || (def.approval.mode === 'conditional' && evaluateCondition(def.approval.condition, facts));
  const paymentRequired = (def.payment.mode === 'full' || def.payment.mode === 'deposit') && dec(pricing.amountDueNow).greaterThan(0);
  const position = creationPosition(input.workflow, { paymentRequired, approvalRequired, facts });

  return { definition: def, duration: availability.duration, availability, allocations, resourceIds, pricing, paymentRequired, approvalRequired, position, facts };
}
