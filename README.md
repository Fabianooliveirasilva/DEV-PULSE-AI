<div align="center">

# DevPulse AI

**Monitoring, incident management and AI error intelligence for web apps and APIs.**

DevPulse AI checks your endpoints, opens incidents when they fail, groups your errors, and uses Claude to explain them, keeping what the evidence shows separate from what is only a hypothesis.

![Dashboard](docs/screenshots/dashboard.png)

</div>

## The problem

When production breaks, teams jump between an uptime checker, a log tool and a chat thread, and then piece together what happened by hand. AI assistants can help, but they tend to state guesses as facts and they read untrusted log content as if it were instructions.

DevPulse AI puts checks, incidents, logs and analyses on **one data model and one timeline**. Its AI layer only sees a bounded, redacted projection of that data, has to cite evidence for every claim, and never pretends to have acted on your systems.

## Features

| Module                     | What you get                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Application monitoring** | HTTP monitors (GET/HEAD/POST) with interval, timeout, expected status codes, latency threshold and consecutive-failure threshold; background worker with retries, idempotency and per-monitor locking; check history; manual "check now"; SSRF-hardened requests.                                                                                                                                                                      |
| **Incident management**    | Automatic incidents when a monitor crosses its failure threshold and automatic resolution on recovery; manual declaration; workflow Open → Investigating → Identified → Monitoring → Resolved (validated transitions, reopen); assignee, severity, probable cause, comments, full timeline, linked checks, post-incident report.                                                                                                       |
| **Logs**                   | Ingestion API with per-application keys, secret redaction, size limits, error grouping by message fingerprint, full-text search, filters, cursor pagination, error-spike detection.                                                                                                                                                                                                                                                    |
| **AI error intelligence**  | Anthropic Claude analyses of incidents and error groups: summary, plain-language explanation, severity and category, hypotheses labelled _supported by evidence_ or _hypothesis_ with cited evidence ids, suggested fixes with risk, preventive actions, missing information. Includes versioned prompts, schema-constrained output, local validation, prompt-injection defences, per-org monthly budget, and usage and cost tracking. |
| **Reliability & QA**       | Uptime, success/failure rate, latency p50/p95/p99, flapping detection, unstable endpoints and regressions against the previous period. Clearly scoped to HTTP availability.                                                                                                                                                                                                                                                            |
| **Dashboard**              | Applications online/offline, uptime, average response, incidents, availability and latency charts, recent errors and activity. Filters by time range, application and organization.                                                                                                                                                                                                                                                    |
| **Notifications**          | In-app notifications (down, recovered, error spike, critical incident, latency) with read state; e-mail and webhook channels delivered by the worker with retries.                                                                                                                                                                                                                                                                     |
| **Accounts & teams**       | Registration, login/logout, password recovery by e-mail, profile and password change, multiple organizations, RBAC (Owner/Admin/Member/Viewer), member management, audit log.                                                                                                                                                                                                                                                          |

<table>
<tr>
<td><img src="docs/screenshots/incident.png" alt="Incident details" /></td>
<td><img src="docs/screenshots/reliability.png" alt="Reliability report" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/application.png" alt="Application details" /></td>
<td><img src="docs/screenshots/dashboard-light.png" alt="Light theme" /></td>
</tr>
</table>

<sub>Screenshots taken from a local instance with data produced by the system itself (real checks against a local service toggled between up and down).</sub>

## Tech stack

| Area           | Technologies                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Radix UI (shadcn-style components), TanStack Query, React Hook Form, zod, Recharts, Lucide |
| API            | NestJS 12, TypeScript, REST, Swagger/OpenAPI, zod validation, Argon2id, helmet, rate limiting, pino                                                       |
| Worker         | BullMQ (Redis), SSRF-guarded HTTP client, Prometheus metrics                                                                                              |
| Data           | PostgreSQL, Prisma 7 (versioned migrations, `pg_trgm` search index)                                                                                       |
| AI             | Anthropic API via the official TypeScript SDK (`claude-opus-5-5` by default)                                                                              |
| Observability  | Prometheus, Grafana (provisioned dashboard), structured logs, health/readiness probes                                                                     |
| Quality        | Vitest, Supertest, Playwright, ESLint, Prettier, GitHub Actions, CodeQL                                                                                   |
| Infrastructure | Docker (multi-stage), Docker Compose                                                                                                                      |

## Architecture

```mermaid
flowchart LR
  B[Browser] --> W[Next.js web] -->|/api proxy| A[NestJS API]
  S[Your services] -->|log ingestion| A
  A --> P[(PostgreSQL)]
  A -->|jobs| Q[(Redis / BullMQ)] --> K[Worker]
  K --> P
  K -->|checks| T[Your endpoints]
  K -->|analyses| C[Anthropic API]
```

Monorepo: `apps/web`, `apps/api`, `apps/worker`; `packages/shared` (domain logic + schemas), `packages/database`, `packages/ai`, `packages/queue`. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

**Requirements:** Node.js ≥ 22.12, pnpm 10, plus Docker, _or_ the no-Docker path below.

### With Docker

```bash
cp .env.example .env            # set METRICS_TOKEN; ANTHROPIC_API_KEY is optional
docker compose up --build
```

- Web: http://localhost:3000
- API docs: http://localhost:4000/api/docs
- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090

### Without Docker (local development)

```bash
pnpm install
pnpm dev:infra                  # embedded PostgreSQL on :54329 (+ redis-server if installed)
cp .env.example .env            # DATABASE_URL=postgresql://devpulse:devpulse@localhost:54329/devpulse
                                # QUEUE_BACKEND=postgres  (when Redis is not installed)
pnpm build:packages
pnpm db:deploy
pnpm dev:api    # :4000
pnpm dev:worker
pnpm dev:web    # :3000
```

Send a first log once you have created an application and an ingestion key:

```bash
curl -X POST http://localhost:3000/api/v1/ingest/logs \
  -H "X-DevPulse-Key: dp_xxxxxxxx_…" -H "content-type: application/json" \
  -d '{"logs":[{"severity":"ERROR","message":"Payment provider timeout after 3000ms"}]}'
```

### Configuration

All variables are documented in [`.env.example`](.env.example) and validated at start-up (the process refuses to boot with an invalid or unsafe production configuration). The most important ones:

| Variable                               | Purpose                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | PostgreSQL connection                                                                    |
| `QUEUE_BACKEND`, `REDIS_URL`           | `redis` in production; `postgres` (BullMQ adapter) for machines without Redis            |
| `WEB_ORIGINS`, `WEB_PUBLIC_URL`        | Allowed browser origins (CORS/CSRF) and public URL used in e-mails                       |
| `SMTP_URL`                             | E-mail delivery (password reset, e-mail channels)                                        |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Enables AI analyses (API and worker). Without a key the UI shows "configuration pending" |
| `METRICS_TOKEN`                        | Bearer token for Prometheus scraping                                                     |

## Tests

```bash
pnpm test                 # unit tests (all workspaces)
pnpm test:integration     # API + worker against PostgreSQL
pnpm build && pnpm test:e2e && pnpm test:e2e:report
```

Latest local run: **144 unit**, **68 integration** (51 API + 17 worker) and **14 Playwright E2E** tests passing. See [docs/TESTING.md](docs/TESTING.md) for what each suite covers.

## Feature status

| Area                                                         | Status                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, sessions, password recovery, profile                   | ✅ Implemented and tested (unit, API, E2E)                                                                                                           |
| Organizations, RBAC, multi-tenant isolation, audit log       | ✅ Implemented and tested                                                                                                                            |
| HTTP monitoring, worker, queues, SSRF protection             | ✅ Implemented and tested                                                                                                                            |
| Incidents (automatic + manual), workflow, timeline, report   | ✅ Implemented and tested                                                                                                                            |
| Logs ingestion, redaction, grouping, search, spike detection | ✅ Implemented and tested                                                                                                                            |
| Dashboard & reliability reports                              | ✅ Implemented and tested                                                                                                                            |
| In-app notifications; webhook & e-mail delivery              | ✅ Implemented and tested (webhooks are not HMAC-signed yet)                                                                                         |
| AI analysis with Anthropic                                   | ✅ Implemented, tested with a mocked transport and provider. ⚠️ **Not yet exercised against the live API** (no key was available during development) |
| Prometheus metrics, Grafana dashboard                        | ✅ Implemented. Endpoints tested; Grafana provisioning not run locally                                                                               |
| Dockerfiles & Compose                                        | ⚠️ Written; built in CI. Not executed on the development machine (no Docker). The production bundle used by the images was validated                 |
| GitHub Actions                                               | ⚠️ Written; first run happens on the first push                                                                                                      |

## Roadmap

- E-mail verification and invitations for people without an account
- MFA and SSO (OIDC)
- HMAC-signed webhooks; Slack integration
- Ingest Playwright/CI test results into the Reliability module
- OpenTelemetry trace export; status pages
- Smaller backend images; nonce-based CSP for the web app

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) · [Decisions](docs/DECISIONS.md) · [Project status](PROJECT_STATUS.md)
