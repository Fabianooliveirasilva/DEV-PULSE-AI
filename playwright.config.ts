import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// End-to-end stack: real API + worker + production web build + a controllable target service.
// Ports differ from dev defaults so E2E can run next to a dev environment.
const root = import.meta.dirname;
const DB =
  process.env.E2E_DATABASE_URL ?? 'postgresql://devpulse:devpulse@localhost:54329/devpulse_test';
const MAIL = resolve(root, '.data/e2e-mail');
const QUEUE = process.env.E2E_QUEUE_BACKEND ?? 'postgres';

const shared = {
  NODE_ENV: 'test',
  DATABASE_URL: DB,
  QUEUE_BACKEND: QUEUE,
  REDIS_URL: process.env.E2E_REDIS_URL ?? '',
  MAIL_OUTBOX_DIR: MAIL,
  SSRF_ALLOWLIST: '127.0.0.1',
  LOG_LEVEL: 'warn',
};

export const E2E = { web: 'http://localhost:3100', target: 'http://127.0.0.1:4110', mailDir: MAIL };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/e2e/results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/e2e/report', open: 'never' }],
    // On GitHub Actions each failure also becomes an annotation on the job.
    ...(process.env.GITHUB_ACTIONS ? [['github'] as ['github']] : []),
  ],
  use: {
    baseURL: E2E.web,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: [
    {
      command: 'node tests/fixtures/target-server.mjs',
      url: `${E2E.target}/health`,
      env: { PORT: '4110' },
      reuseExistingServer: false,
    },
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://localhost:4100/api/v1/health/ready',
      env: {
        ...shared,
        PORT: '4100',
        WEB_ORIGINS: E2E.web,
        WEB_PUBLIC_URL: E2E.web,
        RATE_LIMIT_DISABLED: 'true',
        TRUST_PROXY: '1',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node apps/worker/dist/main.js',
      url: 'http://localhost:9465/health',
      env: {
        ...shared,
        WORKER_METRICS_PORT: '9465',
        WORKER_CONCURRENCY: '5',
        WEB_PUBLIC_URL: E2E.web,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @devpulse/web exec next start --port 3100',
      url: `${E2E.web}/login`,
      env: { API_INTERNAL_URL: 'http://localhost:4100', NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
