import { expect, test } from '@playwright/test';

test('login page renders the auth shell', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Riviamigo' })).toBeVisible();
  await expect(page.getByText('Your Rivian\'s data companion.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});