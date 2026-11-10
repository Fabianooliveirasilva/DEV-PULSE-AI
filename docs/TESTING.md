# Testing

| Layer              | Tool                                            | Location                                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit               | Vitest                                          | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` | Domain rules: monitor state machine, incident workflow, RBAC, uptime/percentiles/flapping, redaction, log fingerprinting, zod schemas, SSRF guard (IP ranges, DNS rebinding, redirects, timeouts against a real local HTTP server), AI context builder / validator / pricing, Anthropic provider through the **real SDK with a stubbed transport** (refusal, 400/401/429/500/529, timeout), env validation, enum parity between Prisma and the shared package, web helpers (open-redirect guard, formatters)                                                      |
| API + integration  | Vitest + Supertest + PostgreSQL (+ Redis in CI) | `apps/api/test/*.int.test.ts`                            | Full NestJS app in-process against a real database and queue: auth & sessions, password recovery via mail outbox, tenant isolation & IDOR, RBAC & privilege escalation, CSRF, SSRF, payload limits, malformed JSON, SQLi-shaped input, security headers, CORS, metrics auth, rate limiting (429), health, monitors, dashboard/reliability maths on seeded checks, incident lifecycle & invalid transitions, log ingestion/redaction/grouping (incl. concurrent batches), search escaping, pagination, AI request states (not configured, pending, dedupe, budget) |
| Worker integration | Vitest + PostgreSQL                             | `apps/worker/test/*.int.test.ts`                         | Processors against a real database with injected HTTP/AI: incident opening at threshold, linking, resolution, environment severity, idempotency of retried jobs, **concurrent checks of the same monitor** (row lock), latency alerts, SSRF-blocked destinations, channel routing, AI completion/usage/cost, retry → final failure without fabricated results, billed refusals, budget enforcement, retention (incident evidence kept), error-spike detection & dedupe, webhook delivery & retry, e-mail misconfiguration                                         |
| End-to-end         | Playwright                                      | `tests/e2e/*.spec.ts`                                    | Real browser against the real stack (production web build, API, worker, controllable target service)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## E2E scenarios

1. Registration · 2. Login · 3. Logout · 4. Password recovery (link read from the mail outbox) · 5. Organisation creation & switching · 6. Application creation · 7. Monitor configuration · 8. Check execution by the worker · 9. Metrics on the dashboard (uptime from stored checks) · 10. Incident generation after the target goes down · 11. AI analysis request → honest "not configured" state, no fabricated result · 12. Workflow, comment and resolution with timeline · 13. Permissions (viewer UI + direct API call refused; cross-tenant URL) · 14. Responsive navigation on a Pixel 7 viewport with overflow checks.

Negative cases: wrong credentials, duplicate e-mail, client-side validation, unauthenticated redirects, private/malformed monitor URLs, unknown resources.

The target service (`tests/fixtures/target-server.mjs`) switches between `up`, `down` and `slow` so outages are deterministic.

## Running

```bash
# Infrastructure (Docker): docker compose up -d postgres redis
# Without Docker: pnpm dev:infra   (embedded PostgreSQL on :54329; Redis if installed)

pnpm build:packages
pnpm test                 # unit tests in every workspace
pnpm test:integration     # API + worker (needs PostgreSQL; set TEST_DATABASE_URL)
pnpm build && pnpm test:e2e
pnpm test:e2e:report      # open the HTML report
```

Environment variables:

| Variable                                                 | Default                                                        | Purpose                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `TEST_DATABASE_URL`                                      | `postgresql://devpulse:devpulse@localhost:54329/devpulse_test` | Integration DB (migrated automatically)        |
| `TEST_QUEUE_BACKEND` / `TEST_REDIS_URL`                  | `postgres` / —                                                 | CI sets `redis` to test the production backend |
| `E2E_DATABASE_URL`, `E2E_QUEUE_BACKEND`, `E2E_REDIS_URL` | as above                                                       | E2E stack                                      |

## Reports & evidence

- Playwright: HTML report in `tests/e2e/report`; on failure a screenshot, video, trace (`pnpm exec playwright show-trace …`) and error context are kept in `tests/e2e/results`. CI uploads both as the `playwright-report` artifact.
- Vitest prints per-test results; CI logs are the execution record.

## Rules

- Tests assert behaviour and data, never only "the page opened".
- AI tests never call the paid API: the provider is exercised through the real SDK with a stubbed `fetch`, and processors use an injected provider.
- No assertion is weakened and no test is skipped to make CI pass. When a test failed during development, the cause was identified and fixed (see [PROJECT_STATUS.md](../PROJECT_STATUS.md#problems-found-and-fixed)).

## Latest results (local, 2026-11-10)

| Suite              | Result                            |
| ------------------ | --------------------------------- |
| shared unit        | 92 passed                         |
| ai unit            | 19 passed                         |
| api unit           | 21 passed                         |
| worker unit        | 4 passed                          |
| web unit           | 8 passed                          |
| api integration    | 51 passed                         |
| worker integration | 17 passed                         |
| Playwright E2E     | 14 passed (13 desktop + 1 mobile) |

Locally the queue backend was PostgreSQL (BullMQ adapter) because Redis was not available on the development machine; the Redis path is exercised in CI.
