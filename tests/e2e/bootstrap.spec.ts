import { expect, test } from '@playwright/test';

test('frontend se conecta à API real sem transbordar a tela', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
  await expect(page.getByText(/API conectada/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Modo escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Modo claro', exact: true })).toBeVisible();
});
