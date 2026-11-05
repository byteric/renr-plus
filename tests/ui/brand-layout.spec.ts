import { expect, test } from '@playwright/test';

test('a marca reserva espaço durante o carregamento e preserva o acesso ao login', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/api/v1/**', (route) =>
    route.request().url().endsWith('/health')
      ? route.fulfill({
          status: 200,
          json: { status: 'ok', service: 'renr-api', timestamp: '2026-11-04T12:00:00.000Z' },
        })
      : route.fulfill({ status: 401, json: {} }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/renr-plus-logo.svg', async (route) => {
    observed();
    await gate;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await requested;
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+' })).toBeVisible();
  const header = page.getByRole('banner');
  const before = (await header.boundingBox())!.height;
  release();
  await page
    .locator('.wordmark img')
    .first()
    .evaluate((element) => (element as HTMLImageElement).decode());
  const after = (await header.boundingBox())!.height;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click({ trial: true });
});
