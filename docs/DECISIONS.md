# Decisions

Short architecture decision records. Each states context, decision and consequences.

### ADR-001 — Monorepo with pnpm workspaces, no Turborepo

**Context:** three apps share types, schemas and domain logic. **Decision:** pnpm workspaces with internal packages compiled by `tsc`. **Consequences:** simple tooling; no remote build cache (acceptable at this size).

### ADR-002 — TypeScript 6.0, not 7.x

**Context:** `typescript@latest` is 7.x (native port); the Nest CLI ships with ~6.0 and Nest relies on `emitDecoratorMetadata`. **Decision:** pin 6.0.3 everywhere. **Consequences:** proven decorator support; revisit when Nest supports 7.

### ADR-003 — ESM everywhere

NestJS 12 is ESM-only. All packages are `"type": "module"` with `NodeNext` resolution (explicit `.js` import suffixes).

### ADR-004 — Opaque server-side sessions instead of JWT

**Decision:** random 256-bit token in an httpOnly cookie; only its SHA-256 is stored. **Why:** immediate revocation (logout, password reset), no token-in-JS exposure. **Cost:** one indexed lookup per request.

### ADR-005 — Same-origin proxy for the web app

**Decision:** the browser calls `/api/*` on the web origin; a Next.js route handler forwards to the API at request time. **Why:** first-party cookies, no public CORS, one image for every environment. Next.js `rewrites` were tried first and rejected: their destination is fixed at build time (found by the E2E suite).

### ADR-006 — CSRF via Origin allow-list + SameSite=Lax

No synchronizer tokens: every unsafe request with cookies must carry an allowed `Origin`/`Referer`, bodies are JSON only. Covered by integration tests.

### ADR-007 — zod at the boundaries instead of class-validator

Schemas live in `@devpulse/shared` and are reused by forms (React Hook Form) and the API. A tiny `@ZodBody/@ZodQuery` decorator validates in controllers. Note: Nest treats decorator arguments with `.transform` as pipes and consumes `{ schema }` as Standard-Schema options, hence the `{ zodSchema }` wrapper.

### ADR-008 — Queue backend selectable: Redis (production) or BullMQ's PostgreSQL adapter

**Context:** the development machine had no Docker, no root and no Redis; compiling Redis from source was blocked by the sandbox policy. BullMQ 6 ships an official PostgreSQL backend. **Decision:** `QUEUE_BACKEND=redis|postgres`, isolated in `@devpulse/queue`; production, Docker Compose and CI use Redis. **Consequences:** identical application code; CI runs integration and E2E suites on Redis so the production path is tested.

### ADR-009 — Embedded PostgreSQL for local development without Docker

`embedded-postgres` (official binaries via npm) through `pnpm dev:infra`. Docker Compose remains the primary path.

### ADR-010 — One NestJS module

Feature folders give separation; controllers are thin and Prisma is the data layer. Splitting into Nest sub-modules would add wiring without isolation benefits at this size.

### ADR-011 — Domain logic as pure functions in `@devpulse/shared`

The monitor state machine, incident workflow, RBAC and reliability maths have no I/O, are unit-tested exhaustively and are reused by API, worker and UI.

### ADR-012 — Concurrency and idempotency in the database

`MonitorCheck.idempotencyKey` unique (job id) makes retries safe; `SELECT … FOR UPDATE` on the monitor serialises concurrent checks; `Incident.activeMonitorId` unique guarantees one open automatic incident per monitor. All three are covered by worker integration tests.

### ADR-013 — AI layer: provider abstraction, structured output, local validation

Anthropic is the first provider (`claude-opus-5-5` by default, configurable). Requests use schema-constrained JSON output and server-side refusal fallbacks; the response is parsed only after checking `stop_reason`, so refusals and truncations are recorded with their billed usage. A validator removes evidence ids that were not in the context and downgrades unsupported "confirmed" causes. The model receives a bounded, redacted projection — never tools or database access.

### ADR-014 — AI runs in the worker, asynchronously

Analyses take seconds to minutes; running them in API requests would tie up connections. The API records intent (`PENDING`) and the UI polls. Budget is pre-checked in the API and enforced in the worker.

### ADR-015 — No simulated AI output

Without `ANTHROPIC_API_KEY`, requests are stored as `NOT_CONFIGURED` and the UI says so. Tests use mocks; production never does.

### ADR-016 — Error grouping by normalised message fingerprint

First line only, ids/numbers/URLs/quoted strings replaced, SHA-256 per application. Atomic `INSERT … ON CONFLICT` keeps counts correct under concurrency.

### ADR-017 — Severity of automatic incidents follows the environment

Production outage = CRITICAL, staging = MEDIUM, development = LOW. Simple, predictable, editable by humans afterwards.

### ADR-018 — UI components written in-repo (shadcn approach) on Radix primitives

The shadcn CLI downloads component source at install time; components were written directly following the same pattern (Radix + cva + tailwind-merge) to keep full control and avoid an install-time code download.

### ADR-019 — Chart and colour rules

Series colours were validated for colour-vision deficiency and contrast against both themes' surfaces; status colours are a reserved scale and always paired with an icon and a label; one y-axis per chart; tooltips on hover.

### ADR-020 — Third-party Claude Code skills not installed

Skill directories were reviewed; official skills install through `/plugin` (user action) and several community sources were unvetted (one was flagged for malware). Work relied on built-in skills (`claude-api`, `dataviz`) and official documentation instead.

### ADR-021 — Deferred items

E-mail verification, invitations for new users, MFA/SSO, webhook HMAC signatures, nonce-based CSP for the web app, smaller backend images, OpenTelemetry tracing export, Playwright results ingestion into the reliability module. Tracked in [PROJECT_STATUS.md](../PROJECT_STATUS.md).
