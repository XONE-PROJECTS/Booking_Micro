import { describe, expect, it } from 'vitest';
import { computeBookingPaymentStatus } from '../../src/modules/payments/amounts';

/** Simulates booking rollup after a manual payment is credited (no DB). */
describe('manual payment rollup', () => {
  const base = {
    total: '1000.0000',
    refundableDeposit: '0.0000',
    amountPaid: '0.0000',
    amountRefunded: '0.0000',
    paymentRequired: true,
  } as never;

  it('moves booking to paid when record covers obligation', () => {
    const credited = '1000.0000';
    expect(computeBookingPaymentStatus(base, credited)).toBe('paid');
  });

  it('stays partially_paid when deposit recorded', () => {
    const credited = '250.0000';
    expect(computeBookingPaymentStatus(base, credited)).toBe('partially_paid');
  });
});