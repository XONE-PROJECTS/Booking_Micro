import { test, expect } from '@playwright/test';

test('admin login shows reservation desk', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();

  const slug = process.env.E2E_TENANT_SLUG ?? 'demo';
  const email = process.env.E2E_STAFF_EMAIL ?? 'owner@demo.test';
  const password = process.env.E2E_STAFF_PASSWORD ?? 'ChangeMe123!';

  await page.getByLabel('Business slug').fill(slug);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.goto('/admin/bookings');
  await expect(page.getByRole('heading', { name: 'Reservation desk' })).toBeVisible();
  await expect(page.locator('.admin-table')).toBeVisible();
});