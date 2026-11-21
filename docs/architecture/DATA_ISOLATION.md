# Data isolation

Tenant data is isolated at three layers: application queries, transaction session variables, and Postgres row-level security (RLS).

## Application layer

- Route builders declare `tenant: 'required' | 'optional' | 'public' | 'none'`.
- Repositories use `app.db.tenant(tenantId, fn)` so every query runs with the correct tenant context.
- **Never** load a tenant-owned row by `id` alone; always constrain `tenant_id`.
- Platform administrators use `app.db.system()` with explicit bypass only where audited and necessary.

## Database session

Inside `tenant()` transactions the client sets:

- `app.tenant_id` — UUID of the active tenant
- `SET LOCAL ROLE booking_app` when the role exists (see migration `0001_security.sql`)

The restricted role `booking_app` has DML on tenant tables but cannot update/delete `audit_logs` or `booking_status_history`.

## Row-level security

Function `app_apply_tenant_rls()` enables **FORCE ROW LEVEL SECURITY** on every table with a `tenant_id` column:

```sql
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
)
```

`bypass_rls=on` is reserved for migrations, seeds, and audited platform operations in `system()` transactions.

## Concurrency guarantees

Migration `0001_security.sql` also adds:

- **GiST exclusion** on `booking_allocations` for overlapping `blocked_period` on the same exclusive `resource_id`.
- Check that `period` is non-empty and contained in `blocked_period`.

Application code maps exclusion violations to error code `BOOKING_UNAVAILABLE` (HTTP 409).

## Cross-tenant and customer privacy

- Missing or other-tenant IDs return **404** (not 403) on tenant routes to avoid leaking existence.
- Guest lookup requires a **lookup token** or verified contact challenge; customers cannot read arbitrary booking IDs.
- Webhook and public API payloads omit unnecessary PII.

## Testing isolation

`packages/database/test/database.test.ts` exercises RLS with the `booking_app` role. API integration tests in `apps/api/test/integration/edge-cases.test.ts` include cross-tenant scenarios when `DATABASE_URL` is set.

## Backups

Back up the Postgres database (`DATABASE_URL`) and any on-disk file storage root configured for uploads. See [DEPLOYMENT.md](DEPLOYMENT.md).
