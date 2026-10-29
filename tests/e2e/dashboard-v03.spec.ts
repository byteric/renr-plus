import { expect, test, type Page } from '@playwright/test';
import {
  riskWorkspaceListSchema,
  riskOverviewSchema,
  riskRegistrationsSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';

// Authentication is never captured in screenshots, videos or traces.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.afterEach(async ({ page }) => {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  expect([204, 401]).toContain(response.status());
});

async function openDashboard(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const organization = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  const organizationId = '10000000-0000-4000-8000-000000000001';
  if ((await organization.inputValue()) !== organizationId) {
    await organization.selectOption(organizationId);
    await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  }
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/risk-overview') && response.request().method() === 'GET',
  );
  await navigateWorkspace(page, 'Painel');
  const response = await loaded;
  expect(response.status()).toBe(200);
  const snapshot = riskOverviewSchema.parse(await response.json());
  await expect(page.getByRole('list', { name: 'Indicadores do inventário' })).toBeVisible();
  return snapshot;
}

test('KPIs e anel conferem com snapshot real; sem ficha exclui arquivados', async ({ page }) => {
  const snapshot = await openDashboard(page);
  expect(snapshot.totals.total).toBeGreaterThan(0);
  const metrics = page.getByRole('list', { name: 'Indicadores do inventário' });
  for (const [name, value] of [
    ['Registros ativos', snapshot.totals.total],
    ['Rascunhos', snapshot.totals.draft],
    ['Registrados', snapshot.totals.registered],
    ['Sem ficha', snapshot.totals.withoutEvaluation],
  ] as const) {
    await expect(
      metrics.getByRole('link', { name: new RegExp(`${name}.*${value}`) }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole('img', {
      name: `${snapshot.totals.withEvaluation} de ${snapshot.totals.total} registros com ficha preliminar`,
    }),
  ).toBeVisible();
  const loaded = page.waitForResponse(
    (response) =>
      /\/risk-workspaces\?/.test(response.url()) && response.request().method() === 'GET',
  );
  await metrics.getByRole('link', { name: /Sem ficha/ }).click();
  await expect(page).toHaveURL(/#\/inventario\?page=1&evaluationPresence=WITHOUT$/);
  const result = riskWorkspaceListSchema.parse(await (await loaded).json());
  expect(result.total).toBe(snapshot.totals.withoutEvaluation);
  expect(
    result.items.every((risk) => risk.status !== 'ARCHIVED' && risk.latestEvaluation === null),
  ).toBe(true);
  expect(result.items.some((risk) => risk.status === 'REGISTERED')).toBe(true);
  const archivedResponse = page.waitForResponse(
    (response) =>
      /\/risk-workspaces\?/.test(response.url()) && response.request().method() === 'GET',
  );
  await page.goto('/#/inventario?page=1&status=ARCHIVED&evaluationPresence=WITHOUT');
  const archived = riskWorkspaceListSchema.parse(await (await archivedResponse).json());
  expect(archived.items.length).toBeGreaterThan(0);
  expect(
    archived.items.every((risk) => risk.status === 'ARCHIVED' && risk.latestEvaluation === null),
  ).toBe(true);
});

test('valores por unidade oferecem drill-down real com filtro explícito', async ({ page }) => {
  const snapshot = await openDashboard(page);
  const unit = snapshot.units.find((value) => value.kind === 'UNIT');
  expect(unit?.kind).toBe('UNIT');
  if (!unit || unit.kind !== 'UNIT')
    throw new Error('A fixture local deve possuir uma unidade com riscos.');
  await page.getByText('Ver valores e filtrar por unidade', { exact: true }).click();
  const table = page.getByRole('table', { name: 'Valores e acesso ao inventário por unidade' });
  await expect(table).toBeVisible();
  const loaded = page.waitForResponse(
    (response) =>
      /\/risk-workspaces\?/.test(response.url()) && response.request().method() === 'GET',
  );
  await table
    .getByRole('link', { name: unit.name + (unit.isActive ? '' : ' · inativa'), exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`unitId=${unit.unitId}`));
  const list = riskWorkspaceListSchema.parse(await (await loaded).json());
  expect(list.total).toBe(unit.total);
  expect(
    list.items.every((risk) => risk.unit.id === unit.unitId && risk.status !== 'ARCHIVED'),
  ).toBe(true);
});

test('painel mantém leitura, ações e reflow em quatro larguras e ambos temas', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDashboard(page);
  await page.waitForLoadState('networkidle');
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      const toggle = page.getByRole('button', {
        name: theme === 'light' ? 'Modo claro' : 'Modo escuro',
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByRole('list', { name: 'Indicadores do inventário' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const region = page.getByRole('list', { name: 'Indicadores do inventário' });
      for (const link of await region.getByRole('link').all()) {
        const box = await link.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: testInfo.outputPath(`dashboard-v03-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});

test('série de cadastros confere com a API por período e mostra os dias sem registro', async ({
  page,
}) => {
  await openDashboard(page);
  const url = '/api/v1/organizations/10000000-0000-4000-8000-000000000001/risk-registrations';
  const response = await page.request.get(`${url}?days=30`);
  expect(response.status()).toBe(200);
  const thirty = riskRegistrationsSchema.parse(await response.json());
  await expect(
    page.getByRole('img', {
      name: new RegExp(`${thirty.total} cadastros entre.*${thirty.timeZone}`),
    }),
  ).toBeVisible();
  await page.getByText('Ver cadastros por dia', { exact: true }).click();
  const table = page.getByRole('table', { name: 'Cadastros diários de riscos' });
  await expect(table.getByRole('row')).toHaveCount(31);
  for (const [index, point] of thirty.points.entries()) {
    await expect(
      table
        .getByRole('row')
        .nth(index + 1)
        .getByRole('cell')
        .last(),
    ).toHaveText(String(point.count));
  }
  const loading = page.waitForResponse((r) => r.url().includes('/risk-registrations?days=7'));
  await page.getByLabel('Período de cadastros', { exact: true }).selectOption('7');
  const seven = riskRegistrationsSchema.parse(await (await loading).json());
  expect(seven.days).toBe(7);
  await expect(
    page.getByRole('img', {
      name: new RegExp(`${seven.total} cadastros entre.*${seven.timeZone}`),
    }),
  ).toBeVisible();
  await page.getByText('Ver cadastros por dia', { exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Cadastros diários de riscos' }).getByRole('row'),
  ).toHaveCount(8);
});
