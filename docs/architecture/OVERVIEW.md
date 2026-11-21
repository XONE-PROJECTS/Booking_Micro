# System architecture

- **API** (`apps/api`): Express, tenant middleware, Drizzle/Postgres, pg-boss or BullMQ workers.
- **Web** (`apps/web`): Next.js portal (`/[businessSlug]`), admin (`/admin`), embed.
- **Engines** (`packages/*-engine`): booking, availability, pricing, workflow.
- **Workers**: hold cleanup, outbox, webhooks, notifications, reminders, payment recheck.

Data isolation: `tenantId` on every row + RLS role `booking_app`.