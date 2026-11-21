# Developer onboarding

## Day one

1. Clone the repo and install **Node 24+**.
2. `copy .env.example .env` — generate long random `JWT_SECRET` and `ENCRYPTION_KEY`.
3. `npm ci`
4. `npm run db:local` && `npm run db:migrate` && `npm run db:seed`
5. `npm run dev`
6. Open http://localhost:3000/admin/login — `admin@example.com` / `ChangeMe123!` (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
7. Optional demo tenant: `npm run seed:demo -w @universal-booking/api`, then visit http://localhost:3000/demo-cafe

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before your first PR. The Cursor rule `.cursor/rules/coding-standards.mdc` enforces the same rules.

## Where to change things

| Task           | Start here                                                          |
| -------------- | ------------------------------------------------------------------- |
| New API route  | `apps/api/src/modules/*/routes.ts`, add Zod to `packages/contracts` |
| Booking rules  | `packages/booking-engine`, `packages/availability-engine`           |
| Schema change  | `packages/database/src/schema`, `npm run db:generate`               |
| Portal UI      | `apps/web/src/app/[businessSlug]`                                   |
| Admin UI       | `apps/web/src/app/admin`                                            |
| OpenAPI        | Regenerate after contract changes: `npm run openapi`                |
| Background job | `apps/api/src/jobs`, register in `queue-workers.ts`                 |

## Architecture docs

- [../architecture/OVERVIEW.md](../architecture/OVERVIEW.md)
- [../architecture/DOMAIN.md](../architecture/DOMAIN.md)
- [../architecture/DATA_ISOLATION.md](../architecture/DATA_ISOLATION.md)
- [../architecture/ENGINES.md](../architecture/ENGINES.md)

## API exploration

- Import [openapi.json](../../openapi.json) into Postman or Scalar.
- Health: `GET /health` (outside `API_PREFIX`)
- Public catalog: `GET /api/v1/public/:businessSlug/services`

## Integration modes

| Mode           | Doc                                                        |
| -------------- | ---------------------------------------------------------- |
| REST + SDK     | [../integration/README.md](../integration/README.md)       |
| Embed widget   | Same                                                       |
| In-process API | `createBookingApp()` from `@universal-booking/integration` |

## Getting help

- Acceptance checklist: [../ACCEPTANCE.md](../ACCEPTANCE.md)
- Errors: [../api/ERRORS.md](../api/ERRORS.md)
- Testing: [TESTING.md](TESTING.md)
