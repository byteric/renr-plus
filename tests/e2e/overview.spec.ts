import { test, expect, type Page } from '@playwright/test';
import { navigateWorkspace } from './navigation';
import {
  organizationListSchema,
  organizationOverviewSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

// Keep authentication out of traces/videos; capture only the loaded panel.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.afterEach(async ({ page }) => {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  expect([204, 401]).toContain(response.status());
});

async function login(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const orgId = '10000000-0000-4000-8000-000000000001';
  const select = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  if ((await select.inputValue()) !== orgId) await select.selectOption(orgId);
  else await navigateWorkspace(page, 'Unidades');
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  const organizations = organizationListSchema.parse(
    await (await page.request.get('/api/v1/organizations')).json(),
  );
  const current = organizations.items.find((entry) => entry.id === orgId);
  if (!current) throw new Error('Organização fictícia local ausente.');
  return current.name;
}

test('painel lê indicadores reais, mantém contexto e funciona em claro e escuro', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/overview') && response.request().method() === 'GET',
  );
  await navigateWorkspace(page, 'Painel');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const overview = organizationOverviewSchema.parse(await response.json());
  await expect(page).toHaveURL(/#\/painel$/);
  await expect(
    page.getByRole('heading', { name: overview.organization.name, exact: true }),
  ).toBeVisible();
  for (const [label, value] of [
    ['Unidades cadastradas', overview.units.total],
    ['Setores cadastrados', overview.sectors.total],
    ['Unidades sem setores', overview.unitsWithoutSectors],
  ] as const) {
    const metric = page.getByText(label, { exact: true }).locator('..');
    await expect(metric.getByRole('definition')).toHaveText(String(value));
  }
  await expect(
    page.getByText(/não representam avaliação de riscos nem conformidade com a NR-01/),
  ).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Modo escuro', exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`overview-${testInfo.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Painel', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: overview.organization.name, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Consultar unidades e setores →' }).click();
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('painel recupera após falha temporária usando nova resposta real', async ({ page }) => {
  const name = await login(page);
  let fail = true;
  await page.route('**/api/v1/organizations/*/overview', async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  await navigateWorkspace(page, 'Painel');
  await expect(page.getByRole('alert')).toContainText('Serviço temporariamente indisponível');
  await expect(page.getByText('Unidades cadastradas', { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('resposta inválida não exibe indicadores e sessão expirada retorna ao login', async ({
  page,
}) => {
  await login(page);
  let status = 200;
  await page.route('**/api/v1/organizations/*/overview', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: '{}' }),
  );
  await navigateWorkspace(page, 'Painel');
  await expect(page.getByRole('alert')).toContainText('Não foi possível concluir a operação');
  await expect(page.getByText('Unidades cadastradas', { exact: true })).toHaveCount(0);
  status = 401;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Painel', exact: true })).toHaveCount(0);
});
