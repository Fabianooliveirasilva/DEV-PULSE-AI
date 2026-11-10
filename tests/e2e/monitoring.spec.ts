import { expect, test } from '@playwright/test';
import { addMonitor, createApplication, register, setTargetMode, TARGET_URL } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await setTargetMode('up');
});

test('creates an organization from the switcher and switches to it', async ({ page }) => {
  await register(page, { org: 'First Org' });
  await page.getByTestId('org-switcher').click();
  await page.getByRole('menuitem', { name: 'New organization' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Second Org');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByTestId('org-switcher')).toContainText('Second Org');
  await page.getByTestId('org-switcher').click();
  await expect(page.getByRole('menuitem', { name: /First Org/ })).toBeVisible();
});

test('full monitoring flow: app → monitor → checks → metrics → incident → AI → resolution', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await register(page);

  // Application & monitor
  await createApplication(page, 'Payments API');
  await addMonitor(page, { name: 'Health check', url: TARGET_URL, threshold: 1 });

  // The worker performs the first check (queued on creation)
  const card = page.getByTestId('monitor-card').filter({ hasText: 'Health check' });
  await expect(card.getByText('Operational')).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/ms$/).first()).toBeVisible();

  // Metrics on the dashboard come from stored checks
  await page.goto('/dashboard');
  await expect(page.getByTestId('kpi-uptime')).toHaveText('100.00%');
  await expect(page.getByTestId('kpi-online')).toHaveText('1');

  // Outage → automatic incident
  await setTargetMode('down');
  await page.goto('/monitoring');
  await page.getByRole('button', { name: 'Run check now for Health check' }).click();
  await expect(page.getByTestId('monitor-card').getByText('Down')).toBeVisible({ timeout: 30_000 });
  await page.goto('/incidents');
  const row = page.getByRole('row').filter({ hasText: 'Payments API: Health check is down' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Critical')).toBeVisible();
  await row.getByRole('link').click();
  await expect(page.getByTestId('incident-title')).toHaveText('Payments API: Health check is down');
  await expect(page.getByTestId('timeline')).toContainText(
    'Opened automatically after 1 consecutive failed checks',
  );

  // Notification fan-out
  await expect(page.getByTestId('unread-count')).toBeVisible();

  // AI analysis without an API key: an honest "not configured" state, no fabricated result
  await page.getByTestId('request-analysis').click();
  await expect(page.getByTestId('ai-not-configured').first()).toBeVisible();
  await expect(page.getByTestId('analysis-result')).toHaveCount(0);

  // Manual workflow and resolution
  await page.getByTestId('transition-INVESTIGATING').click();
  await expect(page.getByText('Investigating').first()).toBeVisible();
  await page.getByLabel('Add a comment').fill('Restarting the payments pod');
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Restarting the payments pod');
  await page.getByLabel('Resolution note').fill('Pod restarted, root cause under review');
  await page.getByTestId('transition-RESOLVED').click();
  await expect(page.getByTestId('transition-OPEN')).toBeVisible();
  await expect(page.getByTestId('timeline')).toContainText(
    'Status changed from INVESTIGATING to RESOLVED',
  );
  await expect(page.getByText('Pod restarted, root cause under review')).toBeVisible();
});

test('rejects private and malformed monitor URLs with a clear message', async ({ page }) => {
  await register(page);
  await createApplication(page, 'Internal');
  await page.getByRole('button', { name: 'Add monitor' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Metadata');
  await dialog.getByLabel('URL').fill('ftp://example.com');
  await dialog.getByRole('button', { name: 'Create monitor' }).click();
  await expect(dialog.getByText(/http\(s\) URL/)).toBeVisible();
  await dialog.getByLabel('URL').fill('http://169.254.169.254/latest/meta-data');
  await dialog.getByRole('button', { name: 'Create monitor' }).click();
  await expect(page.getByText(/URL not allowed/)).toBeVisible();
});

test('shows a not-found state for unknown resources', async ({ page }) => {
  await register(page);
  await page.goto('/incidents/0190f6a0-0000-7000-8000-000000000001');
  await expect(page.getByRole('alert').filter({ hasText: 'Incident not found' })).toBeVisible();
});
