import { expect, test } from '@playwright/test';
import { createApplication, login, logout, register } from './helpers';

test('a VIEWER can read but sees no write controls, and the API refuses writes', async ({
  page,
}) => {
  // Viewer account
  const viewerEmail = await register(page, { name: 'Vera Viewer', org: 'Viewer Personal' });
  await logout(page);

  // Owner creates data and adds the viewer
  await register(page, { name: 'Olga Owner', org: 'Shared Org' });
  await createApplication(page, 'Shared App');
  await page.goto('/settings?tab=members');
  await page.getByLabel('Member e-mail').fill(viewerEmail);
  await page.getByLabel('Role', { exact: true }).selectOption('VIEWER');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('cell', { name: /Vera Viewer/ })).toBeVisible();
  await logout(page);

  // Viewer switches to the shared organization
  await login(page, viewerEmail);
  await page.getByTestId('org-switcher').click();
  await page.getByRole('menuitem', { name: /Shared Org/ }).click();
  await page.goto('/applications');
  await expect(page.getByRole('link', { name: 'Shared App' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New application' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Shared App' }).click();
  await expect(page.getByRole('button', { name: 'Add monitor' })).toHaveCount(0);

  // Direct API call from the viewer's session is refused
  const status = await page.evaluate(async () => {
    const me = await (await fetch('/api/v1/auth/me')).json();
    const shared = me.organizations.find((o: { name: string }) => o.name === 'Shared Org');
    const projects = await (await fetch(`/api/v1/orgs/${shared.id}/projects`)).json();
    const res = await fetch(`/api/v1/orgs/${shared.id}/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: projects[0].id, name: 'Sneaky' }),
    });
    return res.status;
  });
  expect(status).toBe(403);
});

test("a user cannot open another organization's data by URL", async ({ page, browser }) => {
  await register(page, { org: 'Tenant A' });
  await createApplication(page, 'Secret App');
  const appUrl = page.url();

  const other = await browser.newPage();
  await register(other, { org: 'Tenant B' });
  await other.goto(appUrl.replace(/^https?:\/\/[^/]+/, ''));
  await expect(other.getByRole('alert').filter({ hasText: 'Application not found' })).toBeVisible();
  await other.close();
});
