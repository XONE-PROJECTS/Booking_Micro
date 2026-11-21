import type { payments } from '@universal-booking/database';

export function paymentView(row: typeof payments.$inferSelect) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    providerId: row.providerId,
    provider: row.provider,
    method: row.method,
    kind: row.kind,
    amount: row.amount,
    amountRefunded: row.amountRefunded,
    currency: row.currency,
    status: row.status,
    reference: row.reference,
    checkoutUrl: row.checkoutUrl,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}