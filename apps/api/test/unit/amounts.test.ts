import { describe, expect, it } from 'vitest';
import { computeBookingPaymentStatus, resolvePayableAmount } from '../../src/modules/payments/amounts';

const booking = {
  total: '1000.0000',
  refundableDeposit: '200.0000',
  amountPaid: '300.0000',
  amountRefunded: '0.0000',
  pricingSnapshot: { amountDueNow: '400.0000' },
} as never;

describe('resolvePayableAmount', () => {
  it('uses amountDueNow for due_now', () => {
    expect(resolvePayableAmount(booking, 'due_now')).toBe('400.0000');
  });
  it('uses balance for balance mode', () => {
    expect(resolvePayableAmount(booking, 'balance')).toBe('700.0000');
  });
  it('uses remaining obligation for full', () => {
    expect(resolvePayableAmount(booking, 'full')).toBe('900.0000');
  });
});

describe('computeBookingPaymentStatus', () => {
  it('marks unpaid when nothing paid', () => {
    expect(computeBookingPaymentStatus(booking, '0')).toBe('unpaid');
  });
  it('marks partially_paid below obligation', () => {
    expect(computeBookingPaymentStatus(booking, '500.0000')).toBe('partially_paid');
  });
  it('marks paid at or above total plus deposit', () => {
    expect(computeBookingPaymentStatus(booking, '1200.0000')).toBe('paid');
  });
});