import { test, expect } from '@playwright/test';

test('portal home loads', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Portal' })).toBeVisible();
});

test('portal service detail link', async ({ page }) => {
  await page.goto('/demo');
  const bookLink = page.getByRole('link').filter({ hasText: /book|service/i }).first();
  if (await bookLink.count()) await bookLink.click();
});