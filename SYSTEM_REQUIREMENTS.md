# System requirements

Universal Booking is configurable reservation infrastructure that host applications consume via REST, the TypeScript SDK, webhooks, or full source integration.

## Confirmed architecture (v1)

| Area           | Decision                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Tenancy        | Multi-tenant and single-tenant from one codebase (`APP_DEPLOYMENT_MODE`)                           |
| Integration    | REST + SDK + embed widget; optional in-process `createBookingApp()`                                |
| Booking engine | Fully configurable strategies (appointment, accommodation, rental, capacity, event, table, custom) |
| Authentication | Hybrid: internal accounts, customer portal login, API keys, host token exchange                    |
| Payments       | Pluggable provider adapters (manual/cash built in)                                                 |
| Scope          | Full platform: catalog, availability, pricing, bookings, admin, portal, workers, integrations      |

## Functional requirements

### Tenancy and businesses

- Create and manage tenants (businesses) with slug, timezone, currency, locale, branding.
- Role-based access: platform admin, tenant owner/admin, staff, customer.
- Custom domains with DNS verification; public slug resolution.

### Catalog and configuration

- Versioned services with publish/archive; each version snapshots booking definition, forms, workflow, and pricing at booking time.
- Resources (exclusive, pooled, capacity), staff, operating hours, blackouts, maintenance.
- Policy sets, preview endpoint for invalid configuration before publish.

### Availability and inventory

- Strategy-driven date/time selection (slots, ranges, recurring where enabled).
- Server-side availability search; exclusive overlap blocked at the database (GiST exclusion).
- Holds with expiry; idempotent booking creation via `Idempotency-Key`.

### Pricing and reservations

- Server-authoritative pricing (strategies, taxes, fees, discounts, deposits).
- Workflow state machine with approve/reject/cancel/reschedule under policy rules.
- Guest and registered customers; manual payment recording before live provider checkout.

### Customer channels

- Hosted portal and iframe embed with postMessage events.
- Guest lookup and self-service within policy.

### Administrator

- Bookings desk, calendar, catalog, pricing, availability, reports (CSV), integrations, builder surfaces.

### Integrations

- REST API with OpenAPI 3.1 generated from Zod contracts.
- Outbound webhooks with signed deliveries, delivery log, and replay.
- Inbound payment provider webhooks with signature verification.
- Socket.IO realtime channel for in-app updates.
- Optional Redis-backed BullMQ; default job runner uses pg-boss on Postgres.

## Non-functional requirements

| Topic                      | Target                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Data isolation             | `tenant_id` on tenant rows + Postgres RLS; restricted `booking_app` role in requests                 |
| Concurrency                | No double booking of exclusive resources; capacity races handled in transactions                     |
| API shape                  | `{ success, data \| error, meta }` envelope; stable error codes                                      |
| Observability              | Structured logging (pino); optional Sentry when `SENTRY_DSN` is set                                  |
| Performance (p95 guidance) | Reads &lt; 300 ms, availability search &lt; 500 ms, booking create &lt; 1 s (excl. payment provider) |
| i18n                       | `en-PH` first in web app                                                                             |

## Explicitly out of scope (v1)

OTA/channel managers, iCal sync, waitlists, AI pricing, licensing/subscription billing inside the engine.

## Acceptance

Release readiness is tracked in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): 19 blueprint items mapped to code paths and automated tests where present.
