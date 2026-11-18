import type { Logger } from 'pino';
import type { Env } from '@universal-booking/config';
import type { DatabaseClient } from '@universal-booking/database';
import type { OidcVerifier, TokenService } from '@universal-booking/auth';
import type { SecretBox } from '@universal-booking/core/node';
import type { BookingStrategyRegistry } from '@universal-booking/booking-engine';
import type { PricingStrategyRegistry } from '@universal-booking/pricing-engine';
import type { PaymentProviderRegistry } from '@universal-booking/payment-providers';
import type { EmailProvider, SmsProvider } from '@universal-booking/notification-providers';
import type { OpenApiRegistry } from '@universal-booking/contracts';
import type { IdentityContext } from '@universal-booking/core';

export interface RealtimePublisher {
  publish(tenantId: string, channel: 'bookings' | 'availability' | 'dashboard', event: string, data: unknown): void;
}

export interface AppContext {
  env: Env;
  db: DatabaseClient;
  log: Logger;
  tokens: TokenService;
  secrets: SecretBox;
  oidc: OidcVerifier | null;
  bookingStrategies: BookingStrategyRegistry;
  pricingStrategies: PricingStrategyRegistry;
  paymentProviders: PaymentProviderRegistry;
  notifier: { email: EmailProvider; sms: SmsProvider };
  registry: OpenApiRegistry;
  realtime: RealtimePublisher;
  /** Injectable clock for tests. */
  now(): Date;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
  timezone: string;
  currency: string;
  locale: string;
  holdMinutes: number;
  referencePrefix: string;
  guestBookingEnabled: boolean;
  defaultWorkflowId: string | null;
  defaultPolicyId: string | null;
}

export interface RequestContext {
  requestId: string;
  identity: IdentityContext;
  tenant: TenantInfo | null;
  ip: string | undefined;
  userAgent: string | undefined;
  /** Session id (refresh token family) for internal logins. */
  sessionId?: string;
  apiKeyId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
      rawBody?: Buffer;
      /** Set by pino-http */
      id?: string;
      log?: Logger;
    }
  }
}
