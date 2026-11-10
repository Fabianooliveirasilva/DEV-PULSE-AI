# Deployment

## Images

One multi-stage Dockerfile (`infrastructure/docker/Dockerfile`) builds four targets:

| Target    | Runs                                                        | Port | Health                                        |
| --------- | ----------------------------------------------------------- | ---- | --------------------------------------------- |
| `migrate` | `prisma migrate deploy` (one-shot, run before each release) | —    | exit code                                     |
| `api`     | NestJS API                                                  | 4000 | `/api/v1/health/live`, `/api/v1/health/ready` |
| `worker`  | BullMQ consumers + metrics                                  | 9464 | `/health`                                     |
| `web`     | Next.js standalone server                                   | 3000 | `/login`                                      |

Runtime images run as the non-root `node` user under `tini`, with production dependencies only (`pnpm deploy --prod`).

```bash
docker build -f infrastructure/docker/Dockerfile --target api -t devpulse-api .
```

## Local stack with Docker Compose

```bash
cp .env.example .env      # set METRICS_TOKEN (≥16 chars); ANTHROPIC_API_KEY optional
docker compose up --build
```

Services: PostgreSQL 17, Redis 7.4 (AOF, `noeviction`, as BullMQ requires), migrate, api, worker, web, Prometheus (`:9090`), Grafana (`:3001`, dashboard "DevPulse AI — Platform overview" provisioned).

## Without Docker (development)

```bash
pnpm install
pnpm dev:infra            # embedded PostgreSQL on :54329 (+ redis-server if installed)
cp .env.example .env      # DATABASE_URL=…:54329/devpulse; QUEUE_BACKEND=postgres if no Redis
pnpm build:packages && pnpm db:deploy
pnpm dev:api  &  pnpm dev:worker  &  pnpm dev:web
```

## Production checklist

| Item                                   | Setting                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTPS termination                      | In front of `web` (and of `api` if exposed). Set `COOKIE_SECURE=true` (default in production) to use the `__Host-` cookie.                                                                                                                 |
| `NODE_ENV`                             | `production` (enables guards: no SSRF allow-list, no mail outbox, rate limits mandatory; disables Swagger).                                                                                                                                |
| `WEB_ORIGINS` / `WEB_PUBLIC_URL`       | The public web origin(s).                                                                                                                                                                                                                  |
| `TRUST_PROXY`                          | Number of proxies in front of the API (the web proxy counts as 1; add your load balancer).                                                                                                                                                 |
| `QUEUE_BACKEND=redis`, `REDIS_URL`     | Managed Redis with persistence and `maxmemory-policy noeviction`.                                                                                                                                                                          |
| `DATABASE_URL`                         | Managed PostgreSQL ≥ 16 with the `pg_trgm` extension available.                                                                                                                                                                            |
| `SMTP_URL`, `MAIL_FROM`                | Required for password-reset e-mails and e-mail channels. Without it, reset e-mails are logged as not sent.                                                                                                                                 |
| `METRICS_TOKEN`                        | Long random value; configure the same token in Prometheus.                                                                                                                                                                                 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional. Set on **both** API (status/budget checks) and worker (execution). Default model `claude-opus-5-5`.                                                                                                                              |
| Secrets                                | Inject via the platform's secret store, never baked into images.                                                                                                                                                                           |
| Migrations                             | Run the `migrate` image before rolling out `api`/`worker`. Migrations are additive-first.                                                                                                                                                  |
| Scaling                                | `api` and `web` are stateless (sessions in PostgreSQL, rate limits in Redis): scale horizontally. `worker` scales horizontally too; BullMQ guarantees a job is processed by one worker, and per-monitor row locks serialise state updates. |

## Cloud targets

The images are platform-agnostic. Typical mappings: AWS ECS/Fargate + RDS + ElastiCache; Google Cloud Run (api, web) + a GCE/GKE worker + Cloud SQL + Memorystore; Fly.io or Render with managed Postgres/Redis. The worker must be a long-running process (not request-scoped serverless).

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

1. **quality**: install (pnpm cache) → build packages → Prettier check → ESLint → TypeScript → unit tests → full build.
2. **integration**: PostgreSQL 17 + Redis 7.4 service containers; API and worker integration suites on the Redis backend.
3. **e2e**: full production build, migrations, Playwright (Chromium) against the real stack; HTML report, traces, screenshots and videos uploaded as artifacts.
4. **docker**: builds all four image targets with BuildKit cache (no push).
5. **security**: `pnpm audit --prod --audit-level high` and CodeQL (security-extended).

Publishing images and deploying are environment-specific and intentionally not included; add a job that pushes to your registry on tags.

> **Verification status:** all four image targets build successfully in the CI `docker` job, and the production `pnpm deploy` bundle used by the API and worker images was validated by starting it. The complete `docker compose up` stack (including Prometheus and Grafana) has not yet been run end to end, because the original development machine has no Docker.
