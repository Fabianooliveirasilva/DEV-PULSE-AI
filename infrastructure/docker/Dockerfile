# syntax=docker/dockerfile:1.7
# Multi-stage build for the whole monorepo. Targets: migrate, api, worker, web.
#   docker build -f infrastructure/docker/Dockerfile --target api -t devpulse-api .

ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=10.20.0

# ───────── base: pnpm installed from npm ─────────
# Not corepack: older bundled corepack versions fail signature checks after npm's key
# rotation, and corepack is no longer shipped with newer Node releases.
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_STRICT=0
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm --version
WORKDIR /repo

# ───────── deps: install with a cached store (manifests only, for layer caching) ─────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/database/package.json packages/database/
COPY packages/queue/package.json packages/queue/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ───────── build: compile everything ─────────
FROM deps AS build
COPY . .
RUN pnpm --filter "./packages/**" run build \
 && pnpm --filter @devpulse/api run build \
 && pnpm --filter @devpulse/worker run build \
 && pnpm --filter @devpulse/web run build
# Self-contained production bundles (only runtime dependencies).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @devpulse/api deploy --legacy --prod /out/api \
 && pnpm --filter @devpulse/worker deploy --legacy --prod /out/worker

# ───────── migrate: one-shot job applying Prisma migrations ─────────
FROM build AS migrate
WORKDIR /repo/packages/database
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ───────── runtime base ─────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

# ───────── api ─────────
FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ───────── worker ─────────
FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
EXPOSE 9464
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:9464/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ───────── web (Next.js standalone output) ─────────
FROM runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public /app/apps/web/public
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
