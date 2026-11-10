# Project status

_Last updated: 2026-11-10. Phases 0–7 completed. GitHub Actions is green on `main` (all jobs, including integration and E2E on Redis and all Docker image builds). Remaining unverified items are listed under "Pending verification"._

## Phases

| Phase                                                                                  | State                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 — Discovery & planning                                                               | ✅                                                           |
| 1 — Foundation (monorepo, TypeScript, lint/format, PostgreSQL, migrations)             | ✅                                                           |
| 2 — Frontend & design system (landing, auth, 16 product pages, dark/light themes)      | ✅                                                           |
| 3 — Backend (auth, organizations, RBAC, applications, monitors, worker, queues)        | ✅                                                           |
| 4 — Incidents, logs, notifications, dashboard on real data                             | ✅                                                           |
| 5 — AI intelligence (Anthropic provider, prompts, context builder, validator, budgets) | ✅ implemented and tested with mocks; live API not exercised |
| 6 — QA automation (unit, API, integration, E2E, negative and security tests)           | ✅                                                           |
| 7 — Hardening, Docker, CI, documentation                                               | ✅ CI green; images build; Compose stack not yet run         |

## Acceptance criteria

| Criterion                                              | State                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Frontend functional                                    | ✅ (E2E-tested)                                                                                |
| Backend functional                                     | ✅                                                                                             |
| Database configured (migrations, indexes, constraints) | ✅                                                                                             |
| Authentication functional                              | ✅                                                                                             |
| Multi-tenancy implemented and tested                   | ✅                                                                                             |
| Real HTTP monitoring                                   | ✅                                                                                             |
| Workers and queues functional                          | ✅ PostgreSQL backend (local) and Redis backend (CI) both tested                               |
| Dashboard on real data                                 | ✅                                                                                             |
| Incident management                                    | ✅                                                                                             |
| Logs                                                   | ✅                                                                                             |
| Anthropic integration when configured                  | ⚠️ implemented and tested through the real SDK with a stubbed transport; no live call (no key) |
| Error handling                                         | ✅                                                                                             |
| Security reviewed                                      | ✅ see docs/SECURITY.md (known gaps listed)                                                    |
| Unit / integration / API / E2E tests passing           | ✅ 144 / 68 / (incl.) / 14                                                                     |
| Docker functional                                      | ✅ all 4 images build in CI; ⚠️ full `docker compose up` not yet run                           |
| GitHub Actions functional                              | ✅ green on `main`                                                                             |
| Documentation & README                                 | ✅                                                                                             |
| No credentials exposed                                 | ✅ `.env` git-ignored; audit shows no secrets in tracked files                                 |
| Nothing presented as done that is not                  | ✅ statuses above and in README                                                                |

## Test results (local and CI)

| Suite                                                              | Passed |
| ------------------------------------------------------------------ | ------ |
| Unit: shared 92 · ai 19 · api 21 · worker 4 · web 8                | 144    |
| Integration: api 51 · worker 17                                    | 68     |
| Playwright E2E (desktop 13 · mobile 1)                             | 14     |
| ESLint, Prettier, TypeScript (all workspaces), `pnpm audit --prod` | clean  |

## Problems found and fixed

- **Nest 12 decorator handling**: arguments with `.transform` are treated as pipes and `{ schema }` is consumed as Standard-Schema options, so the zod decorators wrap the schema as `{ zodSchema }`.
- **Anthropic `messages.parse()` throws on refusals** before `stop_reason` can be inspected. The provider now uses `create()` and parses afterwards, so billed tokens of refusals are recorded.
- **Next.js `rewrites` are resolved at build time** (found by E2E): replaced by a runtime proxy route handler.
- **Packages excluded `dist/` from deploy bundles** (gitignore rules): added `files` fields; bundle validated by starting the API from it.
- E-mail trimming before validation; digits glued to units in log fingerprints; card-number redaction false positives (Luhn check added); `z.coerce.boolean("false") === true` in query params.
- BullMQ PostgreSQL backend needs `migrate: true`; worker `error` events must always be handled.
- React effects calling `setState` (flagged by the React hooks linter) refactored.
- UI: chart axis label wrapping, duplicate reference label, sparse-data markers, nested interactive elements in the monitoring list.

### Found by the first CI run

- **Redis rate-limit storage returned 500 right after boot**: ioredis was created with `enableOfflineQueue: false`, so requests that arrived before the connection was ready failed. The offline queue is now on (bounded by a connect timeout), and the connection is closed on shutdown.
- **Docker `pnpm install` failed**: the `node:22.12` image's bundled corepack cannot verify npm's rotated signing keys. pnpm is now installed with npm on the current Node 22 image, and a `.dockerignore` keeps host `node_modules`, build output and `.env` out of the build context.
- CI diagnostics: Playwright failures are reported as GitHub annotations, and integration suites run with `--no-bail`.

## Pending verification

1. A live Anthropic analysis: set `ANTHROPIC_API_KEY` and request an analysis from an incident.
2. `docker compose up --build` running the full stack end to end (images already build in CI).
3. Prometheus/Grafana scraping inside Compose.

## Known gaps / next tasks

See the roadmap in README and "Known gaps" in docs/SECURITY.md: e-mail verification, invitations, MFA/SSO, webhook HMAC, nonce CSP, smaller images, OpenTelemetry export, test-result ingestion.
