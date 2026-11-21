# Errors

Application errors use class `AppError` in `packages/core/src/errors.ts`. The HTTP layer maps them in `apps/api/src/http/errors.ts`.

## Error codes

| Code                          | HTTP | Typical cause                                |
| ----------------------------- | ---- | -------------------------------------------- |
| `BAD_REQUEST`                 | 400  | Malformed JSON, invalid format               |
| `VALIDATION_FAILED`           | 422  | Zod validation, FK missing, check constraint |
| `UNAUTHENTICATED`             | 401  | Missing or invalid session/token             |
| `FORBIDDEN`                   | 403  | RBAC, CSRF, RLS denial                       |
| `NOT_FOUND`                   | 404  | Unknown route or tenant-scoped id            |
| `CONFLICT`                    | 409  | Unique violation                             |
| `BOOKING_UNAVAILABLE`         | 409  | Exclusive overlap / slot taken               |
| `CAPACITY_EXCEEDED`           | 409  | Insufficient pooled/capacity units           |
| `HOLD_EXPIRED`                | 409  | Hold timed out before confirm                |
| `INVALID_TRANSITION`          | 409  | Workflow action not allowed                  |
| `IDEMPOTENCY_CONFLICT`        | 409  | Same idempotency key, different body         |
| `POLICY_VIOLATION`            | 422  | Cancel/reschedule outside policy             |
| `CONFIGURATION_INVALID`       | 422  | Invalid booking definition                   |
| `PAYMENT_REQUIRED`            | 402  | Payment expected before state change         |
| `PAYMENT_FAILED`              | 402  | Provider declined                            |
| `PAYMENT_VERIFICATION_FAILED` | 400  | Webhook signature or payload invalid         |
| `RATE_LIMITED`                | 429  | Too many requests                            |
| `TENANT_SUSPENDED`            | 403  | Tenant status                                |
| `NOT_IMPLEMENTED`             | 501  | Feature flag off                             |
| `INTERNAL_ERROR`              | 500  | Unexpected failure                           |

## Database mapping

| Postgres                       | API code              |
| ------------------------------ | --------------------- |
| `23P01` exclusion violation    | `BOOKING_UNAVAILABLE` |
| `23505` unique violation       | `CONFLICT`            |
| `23503` foreign key            | `VALIDATION_FAILED`   |
| `23514` check violation        | `VALIDATION_FAILED`   |
| `22P02` invalid uuid/text      | `BAD_REQUEST`         |
| `42501` insufficient privilege | `FORBIDDEN`           |

## Validation details

Zod failures populate `error.details[]` with `path` and `message` suitable for form field display.

## Client guidance

- Use `error.code` for branching, not substring matching on `message`.
- Retry idempotent GETs on `INTERNAL_ERROR` with backoff.
- On `BOOKING_UNAVAILABLE` / `CAPACITY_EXCEEDED`, refresh availability and prompt the user to pick another slot.
