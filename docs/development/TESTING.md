# Testing strategy

## Layers

| Layer           | Tool               | Location                                |
| --------------- | ------------------ | --------------------------------------- |
| Unit            | Vitest             | `packages/*/test`, `apps/api/test/unit` |
| Contracts       | Vitest             | `packages/contracts/test`               |
| Database / RLS  | Vitest + Postgres  | `packages/database/test`                |
| API integration | Vitest + Supertest | `apps/api/test/integration`             |
| UI component    | Vitest + RTL       | `apps/web/src/components/**/__tests__`  |
| E2E             | Playwright         | `packages/e2e/tests`                    |
| Load            | k6                 | `scripts/k6/booking.js`                 |

## Running locally

### No database

```powershell
npm run test:unit
```

Covers engines, auth, webhooks, contracts, and API unit tests.

### With database

```powershell
npm run db:local
npm run db:migrate
$env:DATABASE_URL = "postgresql://booking:booking@127.0.0.1:54329/booking"
npm run test:integration -w @universal-booking/api
npm run test -w @universal-booking/database
```

Integration suites skip or fail fast if `DATABASE_URL` is unset (see test files).

### End-to-end

Terminal 1:

```powershell
npm run db:local
npm run db:migrate
npm run db:seed
npm run seed:demo -w @universal-booking/api
npm run dev
```

Terminal 2:

```powershell
npm run test:e2e
```

Playwright specs: `portal.spec.ts` (catalog/book flow), `admin-login.spec.ts`.

### Full verify (CI parity)

```powershell
npm run db:migrate
npm run typecheck
npm run test:unit
npm run test:integration -w @universal-booking/api
```

## Blueprint edge cases

`apps/api/test/integration/edge-cases.test.ts` targets scenarios from the blueprint when Postgres is available, including:

- Idempotent double submit
- Exclusive double-book conflict
- Cross-tenant access denied
- Webhook idempotency patterns (where implemented)

Extend this file when closing new acceptance items.

## Performance

`scripts/k6/booking.js` documents p95 targets:

- Reads 300 ms
- Availability search 500 ms
- Booking create 1 s (excluding external payment)

Run with k6 against a staging URL after seeding realistic data.

## Acceptance mapping

[../ACCEPTANCE.md](../ACCEPTANCE.md) lists 19 blueprint items. Map each to a test or manual script when marking release ready.
