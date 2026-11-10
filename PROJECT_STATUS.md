# Project status

_Last updated: 2026-11-10. Phases 0–7 completed in the development environment. Items that could only be verified elsewhere are listed under "Pending verification"._

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
| 7 — Hardening, Docker, CI, documentation                                               | ✅ written; Docker/CI pending first execution (see below)    |

## Acceptance criteria

| Criterion                                              | State                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Frontend functional                                    | ✅ (E2E-tested)                                                                                |
| Backend functional                                     | ✅                                                                                             |
| Database configured (migrations, indexes, constraints) | ✅                                                                                             |
| Authentication functional                              | ✅                                                                                             |
| Multi-tenancy implemented and tested                   | ✅                                                                                             |
| Real HTTP monitoring                                   | ✅                                                                                             |
| Workers and queues functional                          | ✅ locally on BullMQ's PostgreSQL backend; Redis path runs in CI                               |
| Dashboard on real data                                 | ✅                                                                                             |
| Incident management                                    | ✅                                                                                             |
| Logs                                                   | ✅                                                                                             |
| Anthropic integration when configured                  | ⚠️ implemented and tested through the real SDK with a stubbed transport; no live call (no key) |
| Error handling                                         | ✅                                                                                             |
| Security reviewed                                      | ✅ see docs/SECURITY.md (known gaps listed)                                                    |
| Unit / integration / API / E2E tests passing           | ✅ 144 / 68 / (incl.) / 14                                                                     |
| Docker functional                                      | ⚠️ written, not executed locally (no Docker); deploy bundle validated                          |
| GitHub Actions functional                              | ⚠️ written, not yet run (no remote repository)                                                 |
| Documentation & README                                 | ✅                                                                                             |
| No credentials exposed                                 | ✅ `.env` git-ignored; audit shows no secrets in tracked files                                 |
| Nothing presented as done that is not                  | ✅ statuses above and in README                                                                |

## Test results (local)

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

## Pending verification (requires resources not available in the development environment)

1. `docker compose up --build` (CI `docker` job builds the images on the first push).
2. First GitHub Actions run (integration and E2E suites on Redis).
3. A live Anthropic analysis: set `ANTHROPIC_API_KEY` and request an analysis from an incident.
4. Prometheus/Grafana scraping inside Compose.

## Known gaps / next tasks

See the roadmap in README and "Known gaps" in docs/SECURITY.md: e-mail verification, invitations, MFA/SSO, webhook HMAC, nonce CSP, smaller images, OpenTelemetry export, test-result ingestion.
