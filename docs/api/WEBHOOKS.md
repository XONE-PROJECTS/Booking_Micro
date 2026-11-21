# Webhooks

## Outbound (your app receives events)

### Register

`POST /api/v1/integrations/webhooks` (authenticated, tenant-scoped)

Body includes HTTPS `url`, `secret`, and subscribed `eventTypes` (e.g. `booking.created`, `booking.cancelled` — see OpenAPI enum).

URLs pass SSRF checks (`packages/webhooks`): no localhost, link-local, or private IPs unless `allowPrivate` in tests.

### Delivery

Workers enqueue deliveries from the transactional **outbox**. Each POST includes headers:

| Header                | Value               |
| --------------------- | ------------------- |
| `x-booking-event`     | Event type          |
| `x-booking-delivery`  | Delivery UUID       |
| `x-booking-signature` | HMAC signed payload |

Verify with `packages/webhooks` `verifySignature(secret, rawBody, header)`. Timestamps outside the skew window are rejected (replay protection).

### Operations

| Endpoint                                            | Purpose                  |
| --------------------------------------------------- | ------------------------ |
| `GET /integrations/webhooks`                        | List endpoints           |
| `POST /integrations/webhooks/:id/test`              | Send test payload        |
| `DELETE /integrations/webhooks/:id`                 | Remove endpoint          |
| `GET /integrations/webhooks/deliveries`             | Delivery log             |
| `POST /integrations/webhooks/deliveries/:id/replay` | Re-queue failed delivery |

Retries use exponential backoff; permanent failure statuses appear on the delivery row.

## Inbound payment provider webhooks

Provider-specific routes under `/api/v1/integrations/payments/webhooks/*`:

| Provider | Path                |
| -------- | ------------------- |
| PayMongo | `POST .../paymongo` |

Verify signatures using secrets stored encrypted with `ENCRYPTION_KEY`. Handlers update payment and booking payment status idempotently (duplicate provider events should not double-apply).

Configure provider dashboards to point at `{APP_URL}{API_PREFIX}/integrations/payments/webhooks/...`.

## Testing locally

Use `EMAIL_DRIVER=console` and webhook test endpoint, or point a tunnel URL at your machine and register it. Unit tests in `packages/webhooks/test/webhooks.test.ts` cover signing and SSRF rules.
