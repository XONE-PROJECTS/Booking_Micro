export type ProviderPaymentStatus = 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export interface ProviderContext {
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
  mode: 'test' | 'live';
  fetch?: typeof fetch;
}

export interface CreatePaymentInput {
  paymentId: string;
  bookingReference: string;
  /** Decimal amount as a string, for example "1500.00". */
  amount: string;
  currency: string;
  description: string;
  customer: { name: string; email?: string | null; phone?: string | null };
  successUrl: string;
  cancelUrl: string;
  methods?: string[];
  expiresAt?: Date;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  checkoutUrl?: string;
  expiresAt?: Date;
  raw?: Record<string, unknown>;
}

export interface VerifyResult {
  status: ProviderPaymentStatus;
  amount?: string;
  currency?: string;
  paidAt?: Date;
  /** Provider id needed for refunds (payment intent, payment id). */
  providerReference?: string;
  raw?: Record<string, unknown>;
}

export interface RefundInput {
  providerPaymentId: string;
  providerReference?: string | null;
  amount: string;
  currency: string;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  raw?: Record<string, unknown>;
}

export interface WebhookInput {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  amount?: string;
  currency?: string;
  providerReference?: string;
  raw?: Record<string, unknown>;
}

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface PaymentProvider {
  type: string;
  label: string;
  /** Online providers redirect to a hosted checkout and confirm by webhook. */
  online: boolean;
  credentialFields: CredentialField[];
  createPayment(input: CreatePaymentInput, ctx: ProviderContext): Promise<CreatePaymentResult>;
  verifyPayment(providerPaymentId: string, ctx: ProviderContext): Promise<VerifyResult>;
  refund(input: RefundInput, ctx: ProviderContext): Promise<RefundResult>;
  /** Throws PaymentWebhookError when the signature is invalid; returns null for events that need no action. */
  verifyWebhook(input: WebhookInput, ctx: ProviderContext): Promise<WebhookEvent | null>;
}

export class PaymentWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentWebhookError';
  }
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
