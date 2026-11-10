import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { E2E } from '../../playwright.config';

/** Migrates the E2E database and empties the mail outbox before the stack starts. */
export default function globalSetup() {
  const db =
    process.env.E2E_DATABASE_URL ?? 'postgresql://devpulse:devpulse@localhost:54329/devpulse_test';
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(import.meta.dirname, '../../packages/database'),
    env: { ...process.env, DATABASE_URL: db },
    stdio: 'pipe',
  });
  rmSync(E2E.mailDir, { recursive: true, force: true });
  mkdirSync(E2E.mailDir, { recursive: true });
}
