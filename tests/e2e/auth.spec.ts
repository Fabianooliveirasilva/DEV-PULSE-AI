import { expect, test } from '@playwright/test';
import { latestMailTo, login, logout, PASSWORD, register, uniqueEmail } from './helpers';

test.describe('authentication', () => {
  test('registers a new account and lands on an empty dashboard', async ({ page }) => {
    await register(page, { name: 'Grace Hopper', org: 'Compiler Co' });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('No applications yet')).toBeVisible();
    await expect(page.getByTestId('org-switcher')).toContainText('Compiler Co');
  });

  test('logs out and logs back in, returning to the requested page', async ({ page }) => {
    const email = await register(page);
    await logout(page);
    await page.goto('/incidents');
    await expect(page).toHaveURL(/\/login\?next=%2Fincidents/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/incidents$/);
  });

  test('shows a generic error for wrong credentials', async ({ page }) => {
    const email = await register(page);
    await logout(page);
    await login(page, email, 'definitely wrong password');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid e-mail or password' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('validates the registration form client-side', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Password must be at least 12 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test('recovers a forgotten password through the e-mailed link', async ({ page }) => {
    const email = await register(page);
    await logout(page);
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('Check your inbox')).toBeVisible();

    await expect.poll(() => latestMailTo(email)?.text ?? '').toContain('/reset-password?token=');
    const link = /(http\S+reset-password\?token=\S+)/.exec(latestMailTo(email)!.text)![1]!;
    await page.goto(link);
    await page.getByLabel('New password', { exact: true }).fill('a completely new passphrase');
    await page.getByLabel('Confirm new password').fill('a completely new passphrase');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Password updated')).toBeVisible();

    await login(page, email, 'a completely new passphrase');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('redirects unauthenticated users away from every app page', async ({ page }) => {
    for (const path of ['/dashboard', '/applications', '/settings', '/ai']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    }
  });

  test('rejects an already used e-mail', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, { email });
    await logout(page);
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Dup');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Organization name').fill('Dup Org');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  });
});
