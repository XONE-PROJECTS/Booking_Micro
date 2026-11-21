import { and, eq, inArray, lt } from 'drizzle-orm';
import { payments } from '@universal-booking/database';
import type { AppContext } from '../context';
import { applyPaymentOutcome } from '../modules/payments/apply';
import { loadProviderRow, providerContext } from '../modules/payments/providers';

const BATCH = 30;

export async function recheckPendingPayments(ctx: AppContext): Promise<number> {
  const staleBefore = new Date(ctx.now().getTime() - 5 * 60_000);
  return ctx.db.system(async (sysTx) => {
    const due = await sysTx
      .select()
      .from(payments)
      .where(and(inArray(payments.status, ['pending', 'processing']), lt(payments.updatedAt, staleBefore)))
      .limit(BATCH);
    let checked = 0;
    for (const p of due) {
      const providerPaymentId = p.providerPaymentId;
      if (!providerPaymentId || p.provider === 'manual' || p.provider === 'cash') continue;
      await ctx.db.tenant(p.tenantId, async (tx) => {
        try {
          const adapter = ctx.paymentProviders.get(p.provider);
          const providerRow = p.providerId ? await loadProviderRow(tx, p.providerId) : null;
          if (!providerRow) return;
          const pctx = providerContext(ctx, providerRow);
          const verified = await adapter.verifyPayment(providerPaymentId, pctx);
          if (verified.status === 'succeeded' || verified.status === 'failed' || verified.status === 'expired') {
            await applyPaymentOutcome(ctx, tx, {
              tenantId: p.tenantId,
              paymentId: p.id,
              status: verified.status,
              amount: verified.amount ?? p.amount,
              currency: verified.currency ?? p.currency,
              paidAt: verified.paidAt,
              provider: p.provider,
              providerPaymentId,
              providerEventId: `recheck:${p.id}:${ctx.now().toISOString()}`,
              txType: 'verify',
              raw: verified.raw,
            });
            checked++;
          }
        } catch (e) {
          ctx.log.warn({ paymentId: p.id, err: e }, 'payment recheck failed');
        }
      });
    }
    return checked;
  });
}