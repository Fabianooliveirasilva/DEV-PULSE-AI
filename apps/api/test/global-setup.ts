import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies migrations to the dedicated test database once per run. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://devpulse:devpulse@localhost:54329/devpulse_test';
  process.env.TEST_DATABASE_URL = url;
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(import.meta.dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
