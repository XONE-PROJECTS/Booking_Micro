import Decimal from 'decimal.js';
import { dec } from '@universal-booking/core';
import type { CreateCheckoutInput } from '@universal-booking/contracts';
import type { bookings } from '@universal-booking/database';

type BookingRow = typeof bookings.$inferSelect;

/** Resolves how much a checkout or record should collect for a booking. */
export function resolvePayableAmount(booking: BookingRow, mode: CreateCheckoutInput['amount']): string {
  const snap = booking.pricingSnapshot;
  const totalOwed = dec(booking.total).plus(booking.refundableDeposit);
  const balanceDue = dec(booking.total).minus(booking.amountPaid).plus(booking.amountRefunded);
  switch (mode) {
    case 'due_now':
      return dec(snap.amountDueNow).toFixed(4);
    case 'balance':
      return Decimal.max(balanceDue, dec(0)).toFixed(4);
    case 'full':
      return Decimal.max(totalOwed.minus(booking.amountPaid).plus(booking.amountRefunded), dec(0)).toFixed(4);
    default:
      return dec(snap.amountDueNow).toFixed(4);
  }
}

export function computeBookingPaymentStatus(booking: BookingRow, amountPaid: string): 'unpaid' | 'partially_paid' | 'paid' {
  const owed = dec(booking.total).plus(booking.refundableDeposit);
  const paid = dec(amountPaid);
  if (paid.lessThanOrEqualTo(0)) return 'unpaid';
  if (paid.greaterThanOrEqualTo(owed)) return 'paid';
  return 'partially_paid';
}