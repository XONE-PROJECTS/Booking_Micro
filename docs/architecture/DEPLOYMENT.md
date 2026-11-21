# Deployment and operations

## Local development

| Step        | Command                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| Env         | `copy .env.example .env` — set `JWT_SECRET` and `ENCRYPTION_KEY` (≥ 32 chars each) |
| Postgres    | `npm run db:local` (host port **54329**) or `docker compose up postgres`           |
| Schema      | `npm run db:migrate`                                                               |
| Seed        | `npm run db:seed` — platform admin + default tenant                                |
| Demo data   | `npm run seed:demo -w @universal-booking/api`                                      |
| Dev servers | `npm run dev` — API **6767**, web **3000**                                         |

`MIGRATE_ON_START=true` runs migrations when the API boots (default in `.env.example`).

## Docker Compose

[`docker-compose.yml`](../../docker-compose.yml) services:

| Service    | Image / build                | Port         |
| ---------- | ---------------------------- | ------------ |
| `postgres` | postgres:17-alpine           | 54329 → 5432 |
| `api`      | Dockerfile                   | 6767         |
| `worker`   | Same image, `npm run worker` | —            |

Compose wires internal `DATABASE_URL` to the `postgres` service. For production, inject secrets via your orchestrator; do not commit `.env`.

## Environment variables (core)

See [`.env.example`](../../.env.example). Important groups:

- **Database** — `DATABASE_URL`
- **Crypto** — `JWT_SECRET`, `ENCRYPTION_KEY` (API keys and provider secrets encrypted at rest)
- **URLs** — `APP_URL`, `ADMIN_APP_URL`, `PORTAL_APP_URL`, `API_PREFIX`
- **Jobs** — `JOBS_ENABLED`, optional `REDIS_URL` for BullMQ
- **Notifications** — `EMAIL_DRIVER`, `SMS_DRIVER` (`console` for dev)
- **Observability** — optional `SENTRY_DSN`

## Processes

| Process  | When                                                             |
| -------- | ---------------------------------------------------------------- |
| API HTTP | Always for REST and Socket.IO                                    |
| Worker   | Required for holds, outbox, webhooks, reminders, payment recheck |
| Next.js  | Portal/admin static and SSR                                      |

Scale API and workers horizontally; keep **one logical Postgres** with connection pooling sized to workload.

## CI

GitHub Actions workflow [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): `npm ci` → migrate → typecheck → unit tests → API integration tests against service Postgres.

## Load testing

- `npm run load-test` — lightweight script
- `scripts/k6/booking.js` — k6 scenarios with blueprint p95 notes

## Backups and recovery

1. **Database:** `pg_dump "$DATABASE_URL" > backup.sql` on a schedule; test restore on a staging instance.
2. **Files:** copy the configured local or object storage directory used by `POST /files` if you store uploads on disk.
3. **Secrets:** restore `JWT_SECRET` and `ENCRYPTION_KEY` from a secrets manager; rotating them invalidates existing sessions and encrypted fields.

## Custom domains

Tenants register domains via admin/API. Verification uses DNS TXT on `_ub-verify.<domain>`. Public resolution: `GET /api/v1/public/resolve?host=...` returns the business slug for portal routing.
