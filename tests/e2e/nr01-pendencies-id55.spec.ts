import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  managementIndicatorsSchema,
  nr01PendenciesSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.afterEach(async ({ page }) => {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  expect([204, 401]).toContain(response.status());
});

const organizationId = '10000000-0000-4000-8000-000000000001';
const indicatorsRoot = '/api/v1/organizations/' + organizationId + '/management-indicators';
const areas = (page: Page) => page.getByRole('navigation', { name: 'Áreas do painel' });

async function openDashboard(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const organization = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  if ((await organization.inputValue()) !== organizationId) {
    await organization.selectOption(organizationId);
    await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  }
  const loaded = page.waitForResponse((response) => response.url().includes(indicatorsRoot + '?'));
  await navigateWorkspace(page, 'Painel');
  const response = await loaded;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('list', { name: 'Indicadores principais' })).toBeVisible();
  return managementIndicatorsSchema.parse(await response.json());
}

test('ID55: painel de pendências NR-01 reconcilia com indicadores, filtra por estado/regra e preserva retorno da origem', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const snapshot = await openDashboard(page);
  const pendenciesPromise = page.waitForResponse((response) =>
    response.url().includes(indicatorsRoot + '/nr01-pendencies?'),
  );
  const tab = areas(page).getByRole('link', { name: 'Pendências NR-01', exact: true });
  await tab.focus();
  await page.keyboard.press('Enter');
  const pendenciesRes = await pendenciesPromise;
  expect(pendenciesRes.status()).toBe(200);
  const pendencies = nr01PendenciesSchema.parse(await pendenciesRes.json());

  // Reconciliação com /management-indicators no mesmo recorte e exigência de risco + ação na massa fictícia
  expect(pendencies.summary.signals.overdueActions).toBe(snapshot.actions.overdue);
  expect(pendencies.summary.total).toBeGreaterThan(0);
  expect(pendencies.summary.byOrigin.RISK).toBeGreaterThan(0);
  expect(pendencies.summary.byOrigin.ACTION).toBeGreaterThan(0);

  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { name: 'Pendências da NR-01', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Regras normativas, prazos legais e classificação de conformidade NR-01/i),
  ).toBeVisible();

  const statusBar = page.getByRole('group', { name: 'Filtrar por situação NR-01' });
  for (const label of [
    'Pendente',
    'Em andamento',
    'Aguardando validação',
    'Necessita revisão',
    'Concluído',
  ]) {
    await expect(statusBar.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }

  // Filtrar por origem "Riscos do inventário", exigir ao menos um risco, abrir e conferir retorno com filtro preservado
  const risksOnly = page.waitForResponse(
    (response) =>
      response.url().includes(indicatorsRoot + '/nr01-pendencies?') &&
      response.url().includes('origin=RISK'),
  );
  await page.getByLabel('Origem', { exact: true }).selectOption('RISK');
  const filteredRisks = nr01PendenciesSchema.parse(await (await risksOnly).json());
  expect(filteredRisks.total).toBeGreaterThan(0);
  expect(filteredRisks.items.length).toBeGreaterThan(0);
  expect(filteredRisks.items.every((item) => item.origin === 'RISK')).toBe(true);
  await expect(page).toHaveURL(/nrOrigin=RISK/);

  const riskReturnUrl = page.url();
  const riskTable = page.getByRole('table', { name: /Pendências da NR-01/i });
  await riskTable.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`#/inventario/${filteredRisks.items[0]!.riskId}\\?`));
  await expect(page.getByRole('link', { name: /Voltar ao painel/ })).toBeVisible();
  const risksAfterReturn = page.waitForResponse(
    (response) =>
      response.url().includes(indicatorsRoot + '/nr01-pendencies?') &&
      response.url().includes('origin=RISK'),
  );
  await page.getByRole('link', { name: /Voltar ao painel/ }).click();
  const returnedRisks = nr01PendenciesSchema.parse(await (await risksAfterReturn).json());
  expect(returnedRisks.items.every((item) => item.origin === 'RISK')).toBe(true);
  await expect(page).toHaveURL(riskReturnUrl);
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Origem', { exact: true })).toHaveValue('RISK');
  await expect(page.getByRole('table', { name: /Pendências da NR-01/i })).toBeVisible();

  // Limpar filtros da fila, exigir ao menos uma ação, abrir e conferir retorno com filtro preservado
  const resetBtn = page.getByRole('button', { name: 'Limpar filtros da fila', exact: true });
  await resetBtn.click();
  await expect(page).not.toHaveURL(/nrOrigin=RISK/);

  const actionsOnly = page.waitForResponse(
    (response) =>
      response.url().includes(indicatorsRoot + '/nr01-pendencies?') &&
      response.url().includes('origin=ACTION'),
  );
  await page.getByLabel('Origem', { exact: true }).selectOption('ACTION');
  const filteredActions = nr01PendenciesSchema.parse(await (await actionsOnly).json());
  expect(filteredActions.total).toBeGreaterThan(0);
  expect(filteredActions.items.length).toBeGreaterThan(0);
  expect(filteredActions.items.every((item) => item.origin === 'ACTION')).toBe(true);
  await expect(page).toHaveURL(/nrOrigin=ACTION/);

  const actionReturnUrl = page.url();
  const actionTable = page.getByRole('table', { name: /Pendências da NR-01/i });
  await actionTable.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`#/acoes/${filteredActions.items[0]!.actionId}\\?`));
  await expect(page.getByRole('link', { name: /Voltar ao painel/ })).toBeVisible();
  const actionsAfterReturn = page.waitForResponse(
    (response) =>
      response.url().includes(indicatorsRoot + '/nr01-pendencies?') &&
      response.url().includes('origin=ACTION'),
  );
  await page.getByRole('link', { name: /Voltar ao painel/ }).click();
  const returnedActions = nr01PendenciesSchema.parse(await (await actionsAfterReturn).json());
  expect(returnedActions.items.every((item) => item.origin === 'ACTION')).toBe(true);
  await expect(page).toHaveURL(actionReturnUrl);
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Origem', { exact: true })).toHaveValue('ACTION');
  await expect(page.getByRole('table', { name: /Pendências da NR-01/i })).toBeVisible();

  // Capturar evidências visuais em desktop e mobile + validar ausência de overflow horizontal e zoom 200%
  const restored = page.waitForResponse(
    (response) =>
      response.url().includes(indicatorsRoot + '/nr01-pendencies?') &&
      !response.url().includes('origin='),
  );
  await page.getByRole('button', { name: 'Limpar filtros da fila', exact: true }).click();
  await restored;
  await expect(page.getByRole('table', { name: /Pendências da NR-01/i })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const evidenceDir = resolve('tmp/evidencias-id55');
  mkdirSync(evidenceDir, { recursive: true });

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      const toggle = page.getByRole('button', {
        name: theme === 'light' ? 'Modo claro' : 'Modo escuro',
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByRole('heading', { name: 'Pendências da NR-01' })).toBeVisible();
      await expect(page.getByRole('table', { name: /Pendências da NR-01/i })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      if (testInfo.project.name === 'desktop' && (width === 320 || width === 1440)) {
        await page.screenshot({
          path: resolve(evidenceDir, `nr01-pendencias-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  }

  // Verificar zoom 200% sem overflow
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );

  expect(errors).toEqual([]);
});
