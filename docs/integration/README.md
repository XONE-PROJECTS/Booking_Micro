# Integration guide

## Public portal

- Web app: `npm run dev -w @universal-booking/web` (port 3000)
- API: `npm run dev -w @universal-booking/api` (port 6767)
- Catalog: `GET /api/v1/public/:businessSlug/services`
- Book: `POST /api/v1/public/:businessSlug/bookings` with `Idempotency-Key`

## SDK

```ts
import { BookingClient } from '@universal-booking/sdk';

const client = new BookingClient({ baseUrl: 'http://localhost:6767/api/v1' });
await client.publicCatalog('demo-cafe').listServices();
```

## Embed

```ts
import { mountBookingWidget } from '@universal-booking/sdk/browser';

mountBookingWidget({ businessSlug: 'demo-cafe', apiUrl: 'http://localhost:6767/api/v1', container: document.getElementById('root')! });
```

## Webhooks

Register: `POST /api/v1/integrations/webhooks`  
Deliveries: `GET /api/v1/integrations/webhooks/deliveries`  
Replay: `POST /api/v1/integrations/webhooks/deliveries/:id/replay`

## Payment webhooks

`POST /api/v1/integrations/payments/webhooks/paymongo` (provider-specific signatures)