# Coding standards

- Tenant context on every mutation; never load tenant-owned rows by id without `tenantId`.
- Server decides pricing and payment status; ignore client-supplied totals.
- Use Zod contracts in `packages/contracts` for HTTP bodies.
- Idempotency-Key on booking creates.
- Emit domain events through the transactional outbox.