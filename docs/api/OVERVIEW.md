# HTTP API overview

Base URL (local): `http://localhost:6767/api/v1`  
Prefix is configurable via `API_PREFIX`.

## OpenAPI

The authoritative operation list is [`openapi.json`](../../openapi.json), generated from Zod contracts:

```powershell
npm run openapi
```

Regenerate after changing route schemas in `packages/contracts` or route registrations in `apps/api`.

## Response envelope

Successful JSON responses:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

Errors:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid.",
    "details": [{ "path": "email", "message": "Invalid email" }]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

See [ERRORS.md](ERRORS.md) for codes.

## Route classes

| Class          | Auth                                 | Tenant resolution                          |
| -------------- | ------------------------------------ | ------------------------------------------ |
| Admin / staff  | User JWT or API key with permissions | Header `x-tenant-id` or membership default |
| Public catalog | None                                 | `:businessSlug` path segment               |
| Public booking | None (guest) or customer session     | Same                                       |
| Platform       | Platform admin user                  | Optional tenant                            |
| Integration    | API key                              | Required tenant                            |

## Idempotency

`POST` booking creates accept header **`Idempotency-Key`** (required on public create). Replays with the same key return the original booking response; conflicting payload → `IDEMPOTENCY_CONFLICT`.

## Pagination

List endpoints accept `page` and `pageSize` query params. Paginated responses return items in `data` with `meta.pagination` (`page`, `pageSize`, `total`, `hasMore`).

## Realtime

Socket.IO is mounted at `/realtime` on the API host. Authenticate with the same access token used for REST (see OpenAPI or `apps/api/src/realtime/socket.ts`).

## Related

- [AUTHENTICATION.md](AUTHENTICATION.md)
- [WEBHOOKS.md](WEBHOOKS.md)
- [../integration/README.md](../integration/README.md)
