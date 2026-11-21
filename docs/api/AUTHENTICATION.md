# Authentication

## Staff and admin (internal)

### Email and password

`POST /api/v1/auth/login`

Body: `email`, `password`, optional `tenantSlug`, `tokenTransport` (`cookie` | `body`).

- **Cookie mode (default):** sets httpOnly refresh cookie and exposes `csrfToken` for mutating requests with header `x-csrf-token`.
- **Body mode:** returns `refreshToken` in JSON for mobile or non-browser clients.

Follow with:

- `POST /auth/refresh` — rotate access token
- `POST /auth/logout` — revoke session family
- `GET /auth/me` — current principal and tenant

Failed login lockout: 10 attempts → 15 minute lock (`MAX_FAILED_LOGINS` in identity routes).

### Access token

Send `Authorization: Bearer <accessToken>` on API calls. Access tokens are short-lived JWTs signed with `JWT_SECRET`.

### Tenant context

After login, staff routes need a tenant:

- `x-tenant-id` header, or
- `POST /auth/switch` with `tenantId` / slug (see OpenAPI)

Platform administrators can access cross-tenant routes where `permission` allows.

## API keys

Create keys via admin integration routes (`POST /integrations/api-keys`). Use header:

```
x-api-key: <full secret shown once at creation>
```

Optional `x-tenant-id` when the key is not bound to a single tenant. Keys are stored hashed. Scopes map to RBAC permissions on the route (`permission: 'bookings.read'`, etc.).

## Customer portal

Per-business login: `POST /api/v1/public/:businessSlug/auth/login`  
Same cookie session model scoped to that tenant.

Customer registration: `POST /public/:businessSlug/auth/register` (see OpenAPI).

## Host-system hybrid login (token exchange)

Trusted backends with an integration API key call:

`POST /api/v1/integration/tokens/exchange`

Body includes `provider`, `subject` (stable host user id), optional profile fields, and `scopes`. Response: short-lived **Bearer** token (`typ: integration`) the browser or SDK uses instead of booking-system passwords.

This satisfies the blueprint hybrid auth model: the host keeps its own login; booking mints scoped tokens.

## Public and guest booking

No auth required for catalog, availability, quote, and guest booking create. Guest lookup uses booking reference + verification (email/phone/token) per route contract.

## CSRF

When using cookie refresh tokens, mutating routes that accept cookies require matching `x-csrf-token` and CSRF cookie on refresh/logout.

## Security headers

Helmet and CORS apply from API bootstrap; allowed origins come from environment (`CORS_ORIGINS` / app URLs).
