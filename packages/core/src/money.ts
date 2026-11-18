import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

const zeroDecimalCurrencies = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF']);
const threeDecimalCurrencies = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']);

export function minorUnits(currency: string): number {
  const c = currency.toUpperCase();
  if (zeroDecimalCurrencies.has(c)) return 0;
  if (threeDecimalCurrencies.has(c)) return 3;
  return 2;
}

export type MoneyInput = Decimal.Value;

export function dec(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  return new Decimal(value);
}

export function roundMoney(value: MoneyInput, currency: string): Decimal {
  return dec(value).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_UP);
}

/** Fixed-point string used in API payloads, for example "10500.00". */
export function moneyString(value: MoneyInput, currency: string): string {
  return roundMoney(value, currency).toFixed(minorUnits(currency));
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

export function percentOf(value: MoneyInput, percent: MoneyInput): Decimal {
  return dec(value).times(dec(percent)).dividedBy(100);
}

export function formatMoney(value: MoneyInput, currency: string, locale = 'en-PH'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minorUnits(currency),
    maximumFractionDigits: minorUnits(currency),
  }).format(roundMoney(value, currency).toNumber());
}
