import { expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E } from '../../playwright.config';

export const PASSWORD = 'correct horse battery staple';

export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.devpulse.test`;
}

export async function register(
  page: Page,
  opts: { name?: string; email?: string; org?: string } = {},
) {
  const email = opts.email ?? uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Full name').fill(opts.name ?? 'E2E User');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Organization name').fill(opts.org ?? 'E2E Org');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

export async function logout(page: Page) {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
}

export async function createApplication(page: Page, name: string) {
  await page.goto('/applications');
  await page.getByRole('button', { name: 'New application' }).first().click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create application' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

export async function addMonitor(
  page: Page,
  opts: { name: string; url: string; threshold?: number },
) {
  await page.getByRole('button', { name: 'Add monitor' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(opts.name);
  await dialog.getByLabel('URL').fill(opts.url);
  await dialog.getByLabel('Failures to alert').fill(String(opts.threshold ?? 1));
  await dialog.getByRole('button', { name: 'Create monitor' }).click();
  await expect(dialog).toBeHidden();
}

export async function setTargetMode(mode: 'up' | 'down' | 'slow') {
  const res = await fetch(`${E2E.target}/mode/${mode}`, { method: 'POST' });
  expect(res.ok).toBe(true);
}

export function latestMailTo(to: string): { subject: string; text: string } | undefined {
  const mails = readdirSync(E2E.mailDir)
    .sort()
    .map(
      (f) =>
        JSON.parse(readFileSync(join(E2E.mailDir, f), 'utf8')) as {
          to: string;
          subject: string;
          text: string;
        },
    );
  return mails.filter((m) => m.to === to).at(-1);
}

export const TARGET_URL = `${E2E.target}/health`;
