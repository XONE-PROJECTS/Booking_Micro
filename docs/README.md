# Documentation index

| Document                                                           | Description                                         |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md)               | System components and request flow                  |
| [architecture/DOMAIN.md](architecture/DOMAIN.md)                   | Bounded contexts and main entities                  |
| [architecture/DATA_ISOLATION.md](architecture/DATA_ISOLATION.md)   | Tenant isolation, RLS, and DB constraints           |
| [architecture/ENGINES.md](architecture/ENGINES.md)                 | Booking strategies, availability, pricing, workflow |
| [architecture/DEPLOYMENT.md](architecture/DEPLOYMENT.md)           | Docker, env, workers, backups                       |
| [api/OVERVIEW.md](api/OVERVIEW.md)                                 | REST conventions, OpenAPI, public vs admin routes   |
| [api/AUTHENTICATION.md](api/AUTHENTICATION.md)                     | Sessions, API keys, token exchange                  |
| [api/WEBHOOKS.md](api/WEBHOOKS.md)                                 | Outbound events and inbound payment hooks           |
| [api/ERRORS.md](api/ERRORS.md)                                     | Error codes and envelope                            |
| [development/CODING_STANDARDS.md](development/CODING_STANDARDS.md) | Rules for contributors                              |
| [development/TESTING.md](development/TESTING.md)                   | Test layers and CI                                  |
| [development/ONBOARDING.md](development/ONBOARDING.md)             | Day-one setup for developers                        |
| [integration/README.md](integration/README.md)                     | SDK, embed, and host integration                    |
| [ACCEPTANCE.md](ACCEPTANCE.md)                                     | Blueprint acceptance mapping                        |

Machine-readable API contract: [../openapi.json](../openapi.json) (run `npm run openapi` to refresh).
