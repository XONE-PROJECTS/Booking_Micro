# Acceptance checklist (blueprint mapping)

1. Multi-tenant business creation — seed + tenancy API
2. Published public services — catalog publish + portal list
3. Guest booking flow — public POST bookings
4. Staff admin login — `/auth/login` + admin UI
5. Manual payment record — payments/record
6. Webhook delivery + replay — integrations routes + worker
7. Reschedule with policy — POST `/bookings/:id/reschedule`
8. Config preview — POST `/config/preview`
9. Pricing CRUD — `/pricing/*` admin routes
10. Reports export — GET `/reports/:kind?format=csv`
11. File upload — POST `/files`
12. Payment recheck job — worker `payments.recheck`
13. Realtime channels — Socket.IO `/realtime`
14. SDK public/server clients — `packages/sdk`
15. Embed widget — `mountBookingWidget`
16. Custom domain resolve — GET `/public/resolve`
17. Docker compose — `docker-compose.yml`
18. CI pipeline — `.github/workflows/ci.yml`
19. Integration docs — `docs/integration/README.md`