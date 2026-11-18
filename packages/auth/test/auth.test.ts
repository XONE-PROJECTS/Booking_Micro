import { describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { generateApiKey, hashPassword, OidcVerifier, parseApiKey, passwordProblems, TokenService, verifyApiKeySecret, verifyPassword } from '../src';

describe('auth', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct horse 1');
    expect(await verifyPassword(h, 'correct horse 1')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword(null, 'x')).toBe(false);
    expect(passwordProblems('short')).not.toHaveLength(0);
  });

  it('signs and verifies tokens with type checks', async () => {
    const svc = new TokenService('x'.repeat(40));
    const token = await svc.sign({ sub: 'u1', tid: 't1', typ: 'access' }, 60);
    expect((await svc.verify(token, 'access')).tid).toBe('t1');
    await expect(svc.verify(token, 'integration')).rejects.toThrow();
    await expect(new TokenService('y'.repeat(40)).verify(token)).rejects.toThrow();
    const expired = await svc.sign({ sub: 'u1', tid: 't1', typ: 'access' }, -10);
    await expect(svc.verify(expired)).rejects.toThrow(/expired/i);
  });

  it('generates parseable API keys', () => {
    const k = generateApiKey('secret');
    const parsed = parseApiKey(k.key)!;
    expect(parsed.prefix).toBe(k.prefix);
    expect(verifyApiKeySecret(parsed.secret, k.hash)).toBe(true);
    expect(verifyApiKeySecret(parsed.secret + 'x', k.hash)).toBe(false);
    expect(parseApiKey('nope')).toBeNull();
  });

  it('verifies external OIDC tokens against a JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const verifier = new OidcVerifier({ issuer: 'https://idp.example.com', audience: 'booking', jwksUrl: 'https://idp.example.com/jwks' }, createLocalJWKSet({ keys: [jwk] }));
    const token = await new SignJWT({ email: 'a@b.c', roles: ['staff'], tenant: 'acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('ext-1')
      .setIssuer('https://idp.example.com')
      .setAudience('booking')
      .setExpirationTime('5m')
      .sign(privateKey);
    const id = await verifier.verify(token);
    expect(id).toMatchObject({ subject: 'ext-1', email: 'a@b.c', roles: ['staff'], tenant: 'acme' });
    const wrongAud = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject('x').setIssuer('https://idp.example.com').setAudience('other').setExpirationTime('5m').sign(privateKey);
    await expect(verifier.verify(wrongAud)).rejects.toThrow();
  });
});
