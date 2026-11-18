import { hash, verify } from '@node-rs/argon2';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { errors } from '@universal-booking/core';
import { randomToken, safeEqual, sha256 } from '@universal-booking/core/node';

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export const passwordPolicy = { minLength: 10, maxLength: 200 };

export function passwordProblems(password: string): string[] {
  const p: string[] = [];
  if (password.length < passwordPolicy.minLength) p.push(`Use at least ${passwordPolicy.minLength} characters.`);
  if (password.length > passwordPolicy.maxLength) p.push(`Use at most ${passwordPolicy.maxLength} characters.`);
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) p.push('Use letters and numbers.');
  return p;
}

export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  if (!passwordHash) {
    // Spend comparable time so missing accounts are not distinguishable by timing.
    await hash(password);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT access and integration tokens
// ---------------------------------------------------------------------------

export type TokenType = 'access' | 'integration';

export interface AccessClaims {
  sub: string;
  /** Active tenant for the session; null for platform-only sessions. */
  tid: string | null;
  typ: TokenType;
  /** Session id (refresh token family) for access tokens. */
  sid?: string;
  /** Integration tokens: linked customer and scopes granted by the host system. */
  cid?: string | null;
  scp?: string[];
  email?: string;
  name?: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly issuer = 'universal-booking',
    private readonly audience = 'universal-booking-api',
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims, ttlSeconds: number): Promise<string> {
    const { sub, ...rest } = claims;
    return new SignJWT(rest as JWTPayload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setJti(randomToken(12))
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string, expected?: TokenType): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer, audience: this.audience, algorithms: ['HS256'] });
      const claims = payload as unknown as AccessClaims;
      if (!payload.sub || !claims.typ) throw errors.unauthenticated('Invalid token.');
      if (expected && claims.typ !== expected) throw errors.unauthenticated('Wrong token type.');
      return { ...claims, sub: payload.sub };
    } catch (e) {
      if (e instanceof joseErrors.JWTExpired) throw errors.unauthenticated('Token expired.');
      if (e instanceof joseErrors.JOSEError) throw errors.unauthenticated('Invalid token.');
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Opaque tokens: refresh tokens, guest booking tokens, magic links
// ---------------------------------------------------------------------------

export interface OpaqueToken {
  token: string;
  hash: string;
}

export function createOpaqueToken(bytes = 32): OpaqueToken {
  const token = randomToken(bytes);
  return { token, hash: sha256(token) };
}

export const hashOpaqueToken = (token: string): string => sha256(token);

// ---------------------------------------------------------------------------
// API keys: "ubk_<kind>_<prefix>_<secret>", stored as prefix + sha256(secret)
// ---------------------------------------------------------------------------

export type ApiKeyKind = 'secret' | 'publishable';

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

const kindCode: Record<ApiKeyKind, string> = { secret: 'sk', publishable: 'pk' };

export function generateApiKey(kind: ApiKeyKind = 'secret'): GeneratedApiKey {
  const prefix = `ubk_${kindCode[kind]}_${randomToken(6).replace(/[-_]/g, 'x').slice(0, 8).toLowerCase()}`;
  const secret = randomToken(32);
  return { key: `${prefix}_${secret}`, prefix, hash: sha256(secret) };
}

export function parseApiKey(key: string): { prefix: string; secret: string; kind: ApiKeyKind } | null {
  const m = /^(ubk_(sk|pk)_[a-z0-9x]{8})_([A-Za-z0-9_-]{20,})$/.exec(key.trim());
  if (!m) return null;
  return { prefix: m[1]!, kind: m[2] === 'sk' ? 'secret' : 'publishable', secret: m[3]! };
}

export const verifyApiKeySecret = (secret: string, storedHash: string): boolean => safeEqual(sha256(secret), storedHash);

// ---------------------------------------------------------------------------
// CSRF: double-submit token bound to the refresh cookie
// ---------------------------------------------------------------------------

export const createCsrfToken = (): string => randomToken(24);
export const csrfMatches = (header: string | undefined, cookie: string | undefined): boolean => !!header && !!cookie && safeEqual(header, cookie);

// ---------------------------------------------------------------------------
// External identity providers (OIDC / JWKS)
// ---------------------------------------------------------------------------

export interface OidcConfig {
  issuer: string;
  audience?: string;
  jwksUrl: string;
  tenantClaim?: string;
  rolesClaim?: string;
}

export interface ExternalIdentity {
  provider: string;
  subject: string;
  email?: string;
  name?: string;
  tenant?: string;
  roles: string[];
  claims: Record<string, unknown>;
}

export class OidcVerifier {
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    private readonly config: OidcConfig,
    jwks?: JWTVerifyGetKey,
  ) {
    this.jwks = jwks ?? createRemoteJWKSet(new URL(config.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  }

  async verify(token: string): Promise<ExternalIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.config.issuer, audience: this.config.audience });
      if (!payload.sub) throw errors.unauthenticated('External token has no subject.');
      const rolesRaw = payload[this.config.rolesClaim ?? 'roles'];
      const tenantRaw = payload[this.config.tenantClaim ?? 'tenant'];
      return {
        provider: this.config.issuer,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        tenant: typeof tenantRaw === 'string' ? tenantRaw : undefined,
        roles: Array.isArray(rolesRaw) ? rolesRaw.filter((r): r is string => typeof r === 'string') : [],
        claims: payload as Record<string, unknown>,
      };
    } catch (e) {
      if (e instanceof joseErrors.JOSEError) throw errors.unauthenticated('External token could not be verified.');
      throw e;
    }
  }
}
