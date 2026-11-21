# Integration guide

Integrate Universal Booking as a **hosted API consumer**, **embedded widget**, or **in-process Express app**.

## Local stack

| App | Command                                 | URL                          |
| --- | --------------------------------------- | ---------------------------- |
| Web | `npm run dev -w @universal-booking/web` | http://localhost:3000        |
| API | `npm run dev -w @universal-booking/api` | http://localhost:6767/api/v1 |

Seed demo: `npm run seed:demo -w @universal-booking/api` → slug `demo-cafe`.

## REST (public portal)

| Action                | Request                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| Catalog               | `GET /public/:businessSlug/services`                                    |
| Availability          | `POST /public/:businessSlug/availability/search`                        |
| Quote                 | `POST /public/:businessSlug/pricing/quote`                              |
| Book                  | `POST /public/:businessSlug/bookings` with header **`Idempotency-Key`** |
| Resolve custom domain | `GET /public/resolve?host=booking.example.com`                          |

Full operation list: [openapi.json](../../openapi.json).

## TypeScript SDK

### Server (secret key)

```ts
import { BookingServerClient } from '@universal-booking/sdk/server';

const client = new BookingServerClient({
  baseUrl: 'http://localhost:6767/api/v1',
  apiKey: process.env.UB_API_KEY!,
  tenantId: process.env.UB_TENANT_ID,
});

const bookings = await client.listBookings('page=1&pageSize=20');
```

Never expose API keys in browser bundles.

### Browser / portal

```ts
import { BookingPublicClient } from '@universal-booking/sdk/browser';

const client = new BookingPublicClient('http://localhost:6767/api/v1', 'demo-cafe');
const services = await client.catalog().listServices();
```

### Embed widget

```ts
import { mountBookingWidget } from '@universal-booking/sdk/browser';

mountBookingWidget({
  businessSlug: 'demo-cafe',
  apiUrl: 'http://localhost:6767/api/v1',
  container: document.getElementById('root')!,
});
```

The widget emits `postMessage` events (e.g. booking completed). Restrict parent origins in tenant embed settings.

## In-process integration

For hosts that mount the API inside their own Node server:

```ts
import { createBookingApp } from '@universal-booking/integration';

const { app, close } = await createBookingApp();
hostApp.use('/booking', app);
// on shutdown: await close();
```

`createBookingApp` boots the same Express app as `createHttpApp` with a full `AppContext` (database, env, engines). Share `DATABASE_URL` and secrets with the host process.

## Authentication for integrations

| Use case                           | Mechanism                                        |
| ---------------------------------- | ------------------------------------------------ |
| Server automation                  | Header `x-api-key`                               |
| Staff browser                      | Cookie session from `POST /auth/login`           |
| Host user without booking password | `POST /integration/tokens/exchange` with API key |

See [../api/AUTHENTICATION.md](../api/AUTHENTICATION.md).

## Webhooks

| Action     | Request                                             |
| ---------- | --------------------------------------------------- |
| Register   | `POST /integrations/webhooks`                       |
| Deliveries | `GET /integrations/webhooks/deliveries`             |
| Replay     | `POST /integrations/webhooks/deliveries/:id/replay` |

See [../api/WEBHOOKS.md](../api/WEBHOOKS.md) for signature verification.

## Payment webhooks (inbound)

`POST /integrations/payments/webhooks/paymongo` (and other providers) — configure provider dashboards to hit your public `APP_URL`. Store provider secrets via tenant payment settings (encrypted).

## Custom domains

1. Add domain in admin or API.
2. Prove ownership with DNS TXT on `_ub-verify.<domain>`.
3. Point DNS to your portal host; resolve slug with `GET /public/resolve?host=...` or Next.js host middleware when deployed.

## Errors

Clients should branch on `error.code` from the JSON envelope. Reference: [../api/ERRORS.md](../api/ERRORS.md).
