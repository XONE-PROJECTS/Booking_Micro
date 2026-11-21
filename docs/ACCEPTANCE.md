# Acceptance checklist (blueprint mapping)

Use this list for release sign-off. Each item names the primary implementation surface; verify with the linked tests or a manual runbook.

| #   | Requirement                    | Implementation                  | Verify                                           |
| --- | ------------------------------ | ------------------------------- | ------------------------------------------------ |
| 1   | Multi-tenant business creation | DB seed + tenancy API           | `db:seed`, tenancy routes, `edge-cases.test.ts`  |
| 2   | Published public services      | Catalog publish + portal list   | Portal `/[businessSlug]`, `portal.spec.ts`       |
| 3   | Guest booking flow             | Public POST bookings            | `POST /public/:slug/bookings`, idempotency tests |
| 4   | Staff admin login              | `/auth/login` + admin UI        | `admin-login.spec.ts`, `/admin`                  |
| 5   | Manual payment record          | `payments/record`               | `record-payment.test.ts`                         |
| 6   | Webhook delivery + replay      | Integrations routes + worker    | `webhooks.test.ts`, worker `webhooks.deliver`    |
| 7   | Reschedule with policy         | `POST /bookings/:id/reschedule` | API integration / manual                         |
| 8   | Config preview                 | `POST /config/preview`          | Admin builder, config routes                     |
| 9   | Pricing CRUD                   | `/pricing/*` admin routes       | Admin pricing UI                                 |
| 10  | Reports export                 | `GET /reports/:kind?format=csv` | Admin reports                                    |
| 11  | File upload                    | `POST /files`                   | Files route + storage adapter                    |
| 12  | Payment recheck job            | Worker `payments.recheck`       | Worker logs, job registration                    |
| 13  | Realtime channels              | Socket.IO `/realtime`           | `apps/api/src/realtime/socket.ts`                |
| 14  | SDK public/server clients      | `packages/sdk`                  | Import tests, integration README                 |
| 15  | Embed widget                   | `mountBookingWidget`            | `/embed/[businessSlug]`                          |
| 16  | Custom domain resolve          | `GET /public/resolve`           | Tenancy routes, DNS verify                       |
| 17  | Docker compose                 | `docker-compose.yml`            | `docker compose up`                              |
| 18  | CI pipeline                    | `.github/workflows/ci.yml`      | GitHub Actions on PR                             |
| 19  | Integration docs               | `docs/integration/README.md`    | This repository docs index                       |

## Documentation pack (release artifact)

| Doc                  | Path                                                |
| -------------------- | --------------------------------------------------- |
| Root README          | [README.md](../README.md)                           |
| System requirements  | [SYSTEM_REQUIREMENTS.md](../SYSTEM_REQUIREMENTS.md) |
| Architecture         | [docs/architecture/](architecture/)                 |
| API                  | [docs/api/](api/)                                   |
| OpenAPI              | [openapi.json](../openapi.json)                     |
| Onboarding / testing | [docs/development/](development/)                   |

Regenerate OpenAPI after route changes: `npm run openapi`.
