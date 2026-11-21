# Coding standards

These rules apply to every change. They mirror blueprint section 19 and are referenced by `.cursor/rules/coding-standards.mdc`.

## Tenancy and data access

- Resolve **trusted tenant context** on every mutation and tenant-scoped read.
- Never load tenant-owned rows by primary key without also filtering `tenant_id`.
- Use `app.db.tenant(tenantId, …)` for tenant work and `app.db.system(…)` only for platform or cross-tenant operations with audit.
- Prefer **404** over **403** when a resource is missing or belongs to another tenant (unless revealing existence is intentional).

## Pricing and payments

- **Server decides** totals, tax, deposits, and payment status. Ignore client-supplied amounts on create.
- Run quotes through `packages/pricing-engine` at booking time and persist `pricing_snapshot` on the booking.

## Contracts and validation

- HTTP request and response shapes live in **`packages/contracts`** as Zod schemas.
- Register schemas on routes so OpenAPI stays accurate (`npm run openapi` in CI or before release).

## Bookings and concurrency

- Require **`Idempotency-Key`** on public booking creates; store and replay deterministic responses.
- Allocate inventory inside transactions; rely on DB exclusion constraints for exclusive resources.
- Emit domain events through the **transactional outbox**, not direct webhook HTTP from request handlers.

## Engine boundaries

- Keep `packages/*-engine` free of Express, React, Drizzle, and payment SDK imports.
- Industry-specific logic belongs in strategies or host apps, not core tables.

## Configuration versioning

- Published services use immutable **service versions**; bookings reference the version they were created against.
- Validate booking definitions with strategy `validateConfiguration` before publish.

## Security

- Hash API keys and passwords; encrypt provider secrets with `ENCRYPTION_KEY`.
- Validate webhook URLs (SSRF) before saving endpoints.
- Scrub unnecessary PII from logs and webhook payloads.

## Tests

- Add or extend Vitest coverage when fixing bugs or adding non-trivial behavior.
- Integration tests for booking conflicts and tenant isolation should run against real Postgres in CI.

See [TESTING.md](TESTING.md) and [../api/ERRORS.md](../api/ERRORS.md).
