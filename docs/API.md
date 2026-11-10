# API

Base path: `/api/v1`. Interactive OpenAPI (Swagger UI) at `/api/docs` when `NODE_ENV` is not `production`.

## Conventions

- **Auth**: httpOnly session cookie (`dp_session`, or `__Host-dp_session` over HTTPS) set by register/login. Log ingestion uses `X-DevPulse-Key: dp_…` (or `Authorization: Bearer dp_…`).
- **CSRF**: state-changing requests carrying cookies must send an `Origin` (or `Referer`) listed in `WEB_ORIGINS`. Browsers do this automatically.
- **Tenancy**: resources live under `/orgs/:orgId`. Non-members receive `404`.
- **Validation**: zod schemas from `@devpulse/shared`. Errors: `400 { message: "Validation failed", details: [{ path, message }] }`.
- **Errors**: `{ statusCode, error, message, details?, requestId }`. No stack traces or SQL errors are returned.
- **Pagination**: cursor-based: `?limit=&cursor=` → `{ items, nextCursor }`.
- **Rate limits**: 300 req/min per IP by default; auth endpoints 5–10/min; ingestion 600/min per API key. `429` when exceeded.
- **Limits**: JSON body 100 KB (2 MB for ingestion).

## Endpoints

### Auth & profile

| Method | Path                    | Notes                                                                                                                                |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/register`        | `{ name, email, password(≥12), organizationName }` → user; creates org (OWNER) + default project; sets cookie. 409 if e-mail exists. |
| POST   | `/auth/login`           | `{ email, password }` → user; generic 401 on failure.                                                                                |
| POST   | `/auth/logout`          | Revokes the session. 204.                                                                                                            |
| GET    | `/auth/me`              | User + organisations with roles.                                                                                                     |
| PATCH  | `/auth/me`              | `{ name }`                                                                                                                           |
| POST   | `/auth/change-password` | `{ currentPassword, newPassword }`; revokes other sessions.                                                                          |
| POST   | `/auth/forgot-password` | `{ email }` → always 202 (no account enumeration).                                                                                   |
| POST   | `/auth/reset-password`  | `{ token, password }` → 204; token single-use, 30 min; revokes all sessions.                                                         |

### Organisations, members, audit

| Method               | Path                             | Permission                                                                |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| POST                 | `/orgs`                          | any user (becomes OWNER)                                                  |
| GET / PATCH / DELETE | `/orgs/:orgId`                   | `org:read` / `org:update` / `org:delete`                                  |
| GET                  | `/orgs/:orgId/members`           | `org:read`                                                                |
| POST                 | `/orgs/:orgId/members`           | `members:manage` (existing users; cannot grant a role ≥ own unless OWNER) |
| PATCH / DELETE       | `/orgs/:orgId/members/:memberId` | `members:manage` (self-leave allowed; last owner protected)               |
| GET                  | `/orgs/:orgId/audit-logs`        | `audit:read`                                                              |

### Projects & applications

| Method         | Path                                                  | Permission                                        |
| -------------- | ----------------------------------------------------- | ------------------------------------------------- |
| GET / POST     | `/orgs/:orgId/projects`                               | `org:read` / `apps:write`                         |
| PATCH / DELETE | `/orgs/:orgId/projects/:projectId`                    | `apps:write` (delete requires an empty project)   |
| GET / POST     | `/orgs/:orgId/applications`                           | `org:read` / `apps:write`                         |
| GET            | `/orgs/:orgId/applications/:appId?range=24h\|7d\|30d` | `org:read` — monitors, recent incidents, uptime   |
| PATCH / DELETE | `/orgs/:orgId/applications/:appId`                    | `apps:write`                                      |
| GET / POST     | `/orgs/:orgId/applications/:appId/api-keys`           | `org:read` / `apikeys:manage` (key returned once) |
| DELETE         | `/orgs/:orgId/applications/:appId/api-keys/:keyId`    | `apikeys:manage` (revoke)                         |

### Monitoring

| Method               | Path                                      | Permission                                                                 |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| GET / POST           | `/orgs/:orgId/monitors`                   | `org:read` / `monitors:write` — URL validated against SSRF rules incl. DNS |
| GET / PATCH / DELETE | `/orgs/:orgId/monitors/:monitorId`        | `org:read` / `monitors:write`                                              |
| POST                 | `/orgs/:orgId/monitors/:monitorId/run`    | `monitors:write` — queues a check (202), deduped per 10 s                  |
| GET                  | `/orgs/:orgId/monitors/:monitorId/checks` | `org:read` — paginated history                                             |

Monitor body: `{ applicationId, name, url, method?, expectedStatusCodes?, intervalSeconds?(30–86400), timeoutMs?(1000–30000, < interval), failureThreshold?(1–10), latencyThresholdMs?, isActive? }`.

### Incidents

| Method | Path                                                              | Permission                                                                                                            |
| ------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/incidents?status=&active=&applicationId=&severity=` | `org:read`                                                                                                            |
| POST   | `/orgs/:orgId/incidents`                                          | `incidents:write` — manual declaration                                                                                |
| GET    | `/orgs/:orgId/incidents/:id`                                      | `org:read` — events, linked checks, analyses, `allowedTransitions`                                                    |
| PATCH  | `/orgs/:orgId/incidents/:id`                                      | `incidents:write` — `{ status?, severity?, assigneeId?, probableCause?, resolutionNote? }`; invalid transitions → 400 |
| POST   | `/orgs/:orgId/incidents/:id/comments`                             | `incidents:write`                                                                                                     |
| GET    | `/orgs/:orgId/incidents/:id/report`                               | `org:read` — post-incident report from stored facts                                                                   |

### Logs

| Method | Path                                                                                 | Auth                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| POST   | `/ingest/logs`                                                                       | API key. `{ logs: [{ timestamp?, severity, environment?, message, metadata? }] }` (≤ 100) → `202 { accepted, grouped }` |
| GET    | `/orgs/:orgId/logs?q=&severity=&applicationId=&environment=&from=&to=&errorGroupId=` | `logs:read`                                                                                                             |
| GET    | `/orgs/:orgId/error-groups?range=&applicationId=`                                    | `logs:read`                                                                                                             |
| GET    | `/orgs/:orgId/error-groups/:groupId`                                                 | `logs:read` — samples, hourly counts, analyses                                                                          |

```bash
curl -X POST https://devpulse.example.com/api/v1/ingest/logs \
  -H "X-DevPulse-Key: $DEVPULSE_KEY" -H "content-type: application/json" \
  -d '{"logs":[{"severity":"ERROR","message":"Payment provider timeout after 3000ms","environment":"production","metadata":{"orderId":"A-17"}}]}'
```

### AI

| Method | Path                                 | Permission                                                                                                                   |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orgs/:orgId/ai/status`             | `org:read` — configured?, budget, month spend                                                                                |
| POST   | `/orgs/:orgId/ai/analyses`           | `ai:analyze` — `{ targetType: INCIDENT\|ERROR_GROUP, targetId }` → 202 with `PENDING`, `NOT_CONFIGURED` or `BUDGET_EXCEEDED` |
| GET    | `/orgs/:orgId/ai/analyses` / `…/:id` | `org:read`                                                                                                                   |
| GET    | `/orgs/:orgId/ai/usage`              | `org:read` — month usage by day/model                                                                                        |

### Dashboard, reliability, notifications

| Method         | Path                                                | Notes                                                                                            |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET            | `/orgs/:orgId/dashboard?range=&applicationId=`      | KPIs, availability/latency series, recent errors, activity                                       |
| GET            | `/orgs/:orgId/reliability?range=&applicationId=`    | Per-monitor uptime, success/failure rate, p50/p95/p99, flap rate, regressions vs previous period |
| GET            | `/orgs/:orgId/notifications?unread=`                | Caller's notifications + unread count                                                            |
| POST           | `/orgs/:orgId/notifications/:id/read` · `/read-all` |                                                                                                  |
| GET / POST     | `/orgs/:orgId/notification-channels`                | `channels:manage` to create (webhook URLs SSRF-validated)                                        |
| PATCH / DELETE | `/orgs/:orgId/notification-channels/:id`            | `channels:manage`                                                                                |

### Operations

| Method | Path            | Notes                                                                          |
| ------ | --------------- | ------------------------------------------------------------------------------ |
| GET    | `/health/live`  | Process up                                                                     |
| GET    | `/health/ready` | Database + queue reachable (503 otherwise)                                     |
| GET    | `/metrics`      | Prometheus; requires `Authorization: Bearer $METRICS_TOKEN`; disabled if unset |

## Role matrix

| Permission                                           | VIEWER | MEMBER | ADMIN | OWNER |
| ---------------------------------------------------- | :----: | :----: | :---: | :---: |
| read org data, logs                                  |   ✓    |   ✓    |   ✓   |   ✓   |
| apps / monitors / incidents write, AI analyze        |        |   ✓    |   ✓   |   ✓   |
| members, API keys, channels, org settings, audit log |        |        |   ✓   |   ✓   |
| delete organisation, manage owners                   |        |        |       |   ✓   |
