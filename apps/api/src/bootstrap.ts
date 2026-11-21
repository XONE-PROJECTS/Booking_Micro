import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { loadEnv } from '@universal-booking/config';
import { createDatabase, runMigrations } from '@universal-booking/database';
import { TokenService, OidcVerifier } from '@universal-booking/auth';
import { SecretBox } from '@universal-booking/core/node';
import { BookingStrategyRegistry } from '@universal-booking/booking-engine';
import { PricingStrategyRegistry } from '@universal-booking/pricing-engine';
import { PaymentProviderRegistry } from '@universal-booking/payment-providers';
import { createNotificationProviders } from '@universal-booking/notification-providers';
import { OpenApiRegistry } from '@universal-booking/contracts';
import type { AppContext, RealtimePublisher } from './context';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // optional local .env
}

const noopRealtime: RealtimePublisher = { publish: () => undefined };

export async function createAppContext(): Promise<AppContext> {
  const env = loadEnv();
  const log =
    env.NODE_ENV === 'development'
      ? pino({ level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } })
      : pino({ level: env.LOG_LEVEL });

  const db = createDatabase({
    url: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
    rlsRole: env.DATABASE_RLS_ROLE || null,
    applicationName: 'universal-booking-api',
  });

  if (env.MIGRATE_ON_START) {
    const migrations = path.join(root, 'packages/database/migrations');
    await runMigrations(env.DATABASE_URL, migrations);
    log.info('Database migrations applied.');
  }

  const tokens = new TokenService(env.JWT_SECRET, env.JWT_ISSUER ?? 'universal-booking');
  const secrets = new SecretBox(env.ENCRYPTION_KEY);
  const oidc =
    env.OIDC_ISSUER && env.OIDC_JWKS_URL
      ? new OidcVerifier({
          issuer: env.OIDC_ISSUER,
          audience: env.OIDC_AUDIENCE,
          jwksUrl: env.OIDC_JWKS_URL,
          tenantClaim: env.OIDC_TENANT_CLAIM,
          rolesClaim: env.OIDC_ROLES_CLAIM,
        })
      : null;

  if (env.SENTRY_DSN) {
    try {
      // @ts-expect-error optional dependency
      const Sentry = await import('@sentry/node');
      Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
      log.info('Sentry initialized');
    } catch {
      log.warn('SENTRY_DSN set but @sentry/node is not installed');
    }
  }

  return {
    env,
    db,
    log,
    tokens,
    secrets,
    oidc,
    bookingStrategies: new BookingStrategyRegistry(),
    pricingStrategies: new PricingStrategyRegistry(),
    paymentProviders: new PaymentProviderRegistry(),
    notifier: createNotificationProviders(env, (msg, data) => log.info(data ?? {}, msg)),
    registry: new OpenApiRegistry(),
    realtime: noopRealtime,
    now: () => new Date(),
  };
}