import { cashProvider, manualProvider, paymongoProvider, stripeProvider, xenditProvider } from './providers';
import type { PaymentProvider } from './types';

export * from './types';
export { toMinor, fromMinor } from './http';
export { cashProvider, manualProvider, paymongoProvider, stripeProvider, xenditProvider };

/** Registry of payment adapters; hosts can register more providers at startup. */
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(initial: PaymentProvider[] = [manualProvider, cashProvider, paymongoProvider, xenditProvider, stripeProvider]) {
    initial.forEach((p) => this.register(p));
  }

  register(provider: PaymentProvider): void {
    this.providers.set(provider.type, provider);
  }

  get(type: string): PaymentProvider {
    const p = this.providers.get(type);
    if (!p) throw new Error(`Unknown payment provider "${type}"`);
    return p;
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
