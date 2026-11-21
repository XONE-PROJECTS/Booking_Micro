import { and, desc, eq } from 'drizzle-orm';
import { errors } from '@universal-booking/core';
import type { ProviderContext } from '@universal-booking/payment-providers';
import { paymentProviders, type Tx } from '@universal-booking/database';
import type { AppContext } from '../../context';

export type ProviderRow = typeof paymentProviders.$inferSelect;

export function providerContext(app: AppContext, row: ProviderRow): ProviderContext {
  const credentials = row.credentialsEncrypted ? (app.secrets.decryptJson<Record<string, string>>(row.credentialsEncrypted) ?? {}) : {};
  return { credentials, settings: row.settings ?? {}, mode: row.mode };
}

export async function loadProviderRow(tx: Tx, id: string) {
  const [row] = await tx.select().from(paymentProviders).where(eq(paymentProviders.id, id));
  if (!row) throw errors.notFound('Payment provider');
  return row;
}

export async function resolveCheckoutProvider(tx: Tx, tenantId: string, providerId?: string): Promise<ProviderRow> {
  if (providerId) return loadProviderRow(tx, providerId);
  const [row] = await tx
    .select()
    .from(paymentProviders)
    .where(and(eq(paymentProviders.tenantId, tenantId), eq(paymentProviders.status, 'active'), eq(paymentProviders.isDefault, true)))
    .orderBy(desc(paymentProviders.updatedAt));
  if (!row) throw errors.configuration('No default payment provider is configured for this business.');
  return row;
}

export function scrubProvider(row: ProviderRow) {
  const { credentialsEncrypted, ...rest } = row;
  void credentialsEncrypted;
  return rest;
}

export async function ensureSingleDefault(tx: Tx, tenantId: string, providerId: string, isDefault: boolean) {
  if (!isDefault) return;
  await tx.update(paymentProviders).set({ isDefault: false }).where(and(eq(paymentProviders.tenantId, tenantId), eq(paymentProviders.isDefault, true)));
  await tx.update(paymentProviders).set({ isDefault: true }).where(eq(paymentProviders.id, providerId));
}