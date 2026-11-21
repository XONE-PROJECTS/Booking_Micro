import { z } from 'zod';

const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : ['true', '1', 'yes'].includes(v)));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const deploymentModes = ['multi-tenant', 'single-tenant', 'embedded'] as const;
export type DeploymentMode = (typeof deploymentModes)[number];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_DEPLOYMENT_MODE: z.enum(deploymentModes).default('multi-tenant'),
    APP_NAME: z.string().default('Universal Booking'),
    APP_URL: z.url().default('http://localhost:6767'),
    PORT: z.coerce.number().int().positive().default(6767),
    API_PREFIX: z
      .string()
      .regex(/^\/[a-z0-9/_-]*$/i, 'API_PREFIX must start with "/"')
      .default('/api/v1'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    /** Role used for tenant transactions so row-level security applies; empty disables SET ROLE. */
    DATABASE_RLS_ROLE: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$|^$/)
      .default('booking_app'),
    MIGRATE_ON_START: bool(false),
    TRUST_PROXY: z.string().default('loopback'),
    HOLD_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    OIDC_ISSUER: z.string().optional(),
    OIDC_AUDIENCE: z.string().optional(),
    OIDC_JWKS_URL: z.string().optional(),
    OIDC_TENANT_CLAIM: z.string().default('tenant'),
    OIDC_ROLES_CLAIM: z.string().default('roles'),

    AUTH_MODE: z.enum(['internal', 'external', 'hybrid']).default('hybrid'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    INTEGRATION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

    ENABLE_ADMIN_APP: bool(true),
    ENABLE_BOOKING_PORTAL: bool(true),
    ENABLE_EMBED_WIDGET: bool(true),
    ADMIN_APP_URL: z.url().default('http://localhost:3000'),
    PORTAL_APP_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: csv,

    REDIS_ENABLED: bool(false),
    REDIS_URL: z.string().optional(),
    JOBS_ENABLED: bool(true),
    REALTIME_ENABLED: bool(false),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

    EMAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().default('Universal Booking <no-reply@example.com>'),
    SMTP_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    SMS_DRIVER: z.enum(['console', 'semaphore', 'twilio']).default('console'),
    SEMAPHORE_API_KEY: z.string().optional(),
    SEMAPHORE_SENDER: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),

    DEFAULT_TENANT_SLUG: z.string().default('default'),
    DEFAULT_TIMEZONE: z.string().default('Asia/Manila'),
    DEFAULT_CURRENCY: z.string().length(3).default('PHP'),
    DEFAULT_LOCALE: z.string().default('en-PH'),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    REQUEST_BODY_LIMIT: z.string().default('1mb'),
    WEBHOOK_ALLOW_PRIVATE_URLS: bool(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.REDIS_ENABLED && !env.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL is required when REDIS_ENABLED=true' });
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
    }
    if (env.EMAIL_DRIVER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when EMAIL_DRIVER=smtp' });
    }
    if (env.EMAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when EMAIL_DRIVER=resend' });
    }
    if (env.NODE_ENV === 'production' && /change-me/i.test(env.JWT_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must be changed in production' });
    }
    if (env.NODE_ENV === 'production' && /change-me/i.test(env.ENCRYPTION_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'ENCRYPTION_KEY must be changed in production' });
    }
    if (env.AUTH_MODE !== 'internal' && env.OIDC_ISSUER && !env.OIDC_JWKS_URL) {
      ctx.addIssue({ code: 'custom', path: ['OIDC_JWKS_URL'], message: 'OIDC_JWKS_URL is required when OIDC_ISSUER is set' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return parsed.data;
}
