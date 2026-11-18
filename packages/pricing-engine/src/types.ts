import type { Condition, Decimal } from '@universal-booking/core';

export interface PricingRuleInput {
  id?: string;
  strategy: string;
  configuration: Record<string, unknown>;
  resourceId?: string | null;
  priority?: number;
}

export interface SeasonalRateInput {
  id?: string;
  name: string;
  startsOn: string;
  endsOn: string;
  daysOfWeek?: number[] | null;
  /** Absolute unit price for matching dates. */
  amount?: string | null;
  /** Percentage change, for example 20 for +20% or -10 for a 10% reduction. */
  adjustmentPercent?: number | null;
}

export type ComponentCalculation = 'fixed' | 'percent' | 'per_unit' | 'per_guest' | 'per_extra_guest' | 'security_deposit';

export interface PriceComponentInput {
  name: string;
  calculationType: ComponentCalculation;
  amount: string;
  /** For per_extra_guest: guests included before the charge applies. */
  includedGuests?: number;
  /** Restricts guest-based charges to one guest type, for example "children". */
  guestType?: string;
  /** Multiplies by nights/days/sessions when set. */
  perUnitOf?: 'nights' | 'days' | 'hours' | 'sessions' | null;
}

export type OptionChargeType = 'per_booking' | 'per_unit' | 'per_night' | 'per_day' | 'per_guest' | 'per_session';

export interface OptionSelection {
  id: string;
  name: string;
  price: string;
  chargeType: OptionChargeType;
  quantity: number;
}

export interface DiscountInput {
  code?: string | null;
  name: string;
  type: 'percent' | 'fixed';
  value: string;
  maxAmount?: string | null;
}

export interface TaxInput {
  name: string;
  rate: string;
  inclusive: boolean;
}

export interface FeeInput {
  name: string;
  type: 'percent' | 'fixed';
  value: string;
}

export interface DepositInput {
  type: 'none' | 'percent' | 'fixed';
  value: string;
}

export interface DynamicRuleInput {
  name: string;
  condition: Condition;
  adjustmentPercent: number;
}

export interface PricingContext {
  occupancyRate?: number;
  leadDays: number;
  startDayOfWeek: number;
  startDate: string;
}

export interface PricingInput {
  currency: string;
  basePrice: string;
  units: { minutes: number; hours: number; days: number; nights: number; sessions: number };
  dates: string[];
  quantity: number;
  guests: Record<string, number>;
  guestTotal: number;
  resourceIds: string[];
  rules: PricingRuleInput[];
  seasonalRates: SeasonalRateInput[];
  components: PriceComponentInput[];
  options: OptionSelection[];
  discount?: DiscountInput | null;
  taxes: TaxInput[];
  fees: FeeInput[];
  deposit: DepositInput;
  paymentMode: 'none' | 'deposit' | 'full' | 'pay_later';
  dynamicRules: DynamicRuleInput[];
  context: PricingContext;
}

export interface BaseUnit {
  label: string;
  date?: string;
  unitAmount: Decimal;
  quantity: Decimal;
}

export interface PricingStrategy {
  type: string;
  /** Throws when the configuration is invalid. */
  validate(config: unknown): void;
  calculate(input: PricingInput, config: Record<string, unknown>): BaseUnit[] | Promise<BaseUnit[]>;
}

export type LineKind = 'base' | 'resource_adjustment' | 'seasonal' | 'dynamic' | 'addon' | 'component' | 'discount' | 'fee' | 'tax' | 'deposit';

export interface PricingLine {
  kind: LineKind;
  label: string;
  quantity: string;
  unitAmount: string;
  amount: string;
  date?: string;
}

export interface PricingResult {
  version: 1;
  currency: string;
  strategy: string;
  lines: PricingLine[];
  baseSubtotal: string;
  addonsTotal: string;
  subtotal: string;
  discountTotal: string;
  feeTotal: string;
  taxTotal: string;
  taxIncluded: string;
  total: string;
  refundableDeposit: string;
  depositAmount: string;
  amountDueNow: string;
  amountDueLater: string;
}
