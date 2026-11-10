import { expect, test } from '@playwright/test';
import { register } from './helpers';

test('navigates through the mobile menu without horizontal overflow', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = page.getByRole('dialog', { name: 'Navigation' });
  await nav.getByRole('link', { name: 'Incidents' }).click();
  await expect(page).toHaveURL(/\/incidents$/);
  await expect(nav).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible();

  for (const path of ['/', '/dashboard', '/incidents', '/settings']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
