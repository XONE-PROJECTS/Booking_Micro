# Universal Booking

Industry-independent, API-first booking infrastructure. Multi-tenant SaaS or single-tenant self-host from one codebase.

## Prerequisites

- Node.js **24+**
- Docker (local Postgres)
- `npm ci` at the repo root

## Quick start

```powershell
copy .env.example .env
npm ci
npm run db:local
npm run db:migrate
npm run db:seed
npm run dev
```

| Service                    | URL                                                              |
| -------------------------- | ---------------------------------------------------------------- |
| Portal and admin (Next.js) | http://localhost:3000                                            |
| API                        | http://localhost:6767/api/v1                                     |
| OpenAPI                    | [openapi.json](openapi.json) (regenerate with `npm run openapi`) |

Default seed: platform admin `admin@example.com` / `ChangeMe123!`, tenant slug `default`. Demo business: `npm run seed:demo -w @universal-booking/api` (e.g. `demo-cafe`).

## Repository layout

| Path                   | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `apps/api`             | Express HTTP API, workers, OpenAPI generator                               |
| `apps/web`             | Next.js portal (`/[businessSlug]`), admin (`/admin`), embed (`/embed/...`) |
| `packages/*-engine`    | Pure booking, availability, pricing, resource, workflow logic              |
| `packages/database`    | Drizzle schema, migrations, RLS, seeds                                     |
| `packages/contracts`   | Zod request/response contracts (OpenAPI source)                            |
| `packages/sdk`         | TypeScript clients and embed widget                                        |
| `packages/integration` | `createBookingApp()` for in-process API embedding                          |
| `docs/`                | Architecture, API, integration, testing, onboarding                        |

## Common commands

```powershell
npm run typecheck          # All workspaces
npm run test:unit          # Engine and package unit tests
npm run test -w @universal-booking/api   # API unit + integration (needs DATABASE_URL)
npm run test:e2e           # Playwright (API and web must be running)
npm run build              # Turbo build
docker compose up          # Postgres + API + worker
```

## Documentation

- [System requirements](SYSTEM_REQUIREMENTS.md)
- [Docs index](docs/README.md)
- [Integration guide](docs/integration/README.md)
- [Acceptance checklist](docs/ACCEPTANCE.md)

## License

Private — see repository owner.
