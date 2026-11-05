import { expect, test, type Page } from '@playwright/test';
import {
  actionWorkspaceListSchema,
  managementIndicatorHistorySchema,
  managementIndicatorsSchema,
  riskWorkspaceListSchema,
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
const root = '/api/v1/organizations/' + organizationId + '/management-indicators';
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
  const loaded = page.waitForResponse((response) => response.url().includes(root + '?'));
  await navigateWorkspace(page, 'Painel');
  const response = await loaded;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('list', { name: 'Indicadores principais' })).toBeVisible();
  return managementIndicatorsSchema.parse(await response.json());
}

test('KPIs e recortes reconciliam com listas reais e a navegação volta ao mesmo painel', async ({
  page,
}) => {
  const snapshot = await openDashboard(page);
  expect(snapshot.risks.total).toBeGreaterThan(0);
  const metrics = page.getByRole('list', { name: 'Indicadores principais' });
  for (const [name, value] of [
    ['Riscos no inventário', snapshot.risks.total],
    ['Sem classificação', snapshot.risks.unclassified],
    ['Ações abertas', snapshot.actions.open],
    ['Ações atrasadas', snapshot.actions.overdue],
  ] as const)
    await expect(
      metrics.getByRole('link', { name: new RegExp(name + '.*' + value + '\\b') }),
    ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estrutura cadastrada' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Evolução no período' })).toHaveCount(0);
  const risks = page.waitForResponse((response) => response.url().includes('/risk-workspaces?'));
  await metrics.getByRole('link', { name: /Sem classificação/ }).click();
  expect(riskWorkspaceListSchema.parse(await (await risks).json()).total).toBe(
    snapshot.risks.unclassified,
  );
  await page.goBack();
  await expect(metrics).toBeVisible();
  const actions = page.waitForResponse((response) =>
    response.url().includes('/action-workspaces?'),
  );
  await metrics.getByRole('link', { name: /Ações atrasadas/ }).click();
  expect(actionWorkspaceListSchema.parse(await (await actions).json()).total).toBe(
    snapshot.actions.overdue,
  );
});

test('áreas, recorte e retorno de um detalhe persistem após recarregar', async ({
  page,
}, testInfo) => {
  const snapshot = await openDashboard(page);
  const unit = snapshot.risks.units[0]!;
  expect(unit).toBeDefined();
  await page.getByLabel('Unidade', { exact: true }).selectOption(unit.unitId);
  await expect(page).toHaveURL(new RegExp('unitId=' + unit.unitId));
  const risksArea = areas(page).getByRole('link', { name: 'Riscos' });
  await risksArea.focus();
  await page.keyboard.press('Enter');
  await expect(risksArea).toHaveAttribute('aria-current', 'page');
  const unitChart = page.getByRole('region', { name: 'Distribuição por unidade' });
  await expect(unitChart).toBeVisible();
  await page.reload();
  await expect(risksArea).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Unidade', { exact: true })).toHaveValue(unit.unitId);
  const table = unitChart.getByRole('table');
  await unitChart.getByText('Ver valores em tabela').click();
  await expect(
    table.getByRole('row', { name: unit.name + ' ' + unit.count, exact: true }),
  ).toBeVisible();
  const list = page.waitForResponse((response) => response.url().includes('/risk-workspaces?'));
  await table.getByRole('link', { name: unit.name, exact: true }).click();
  expect(riskWorkspaceListSchema.parse(await (await list).json()).total).toBe(unit.count);
  await page.goBack();
  await expect(risksArea).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Unidade', { exact: true })).toHaveValue(unit.unitId);
  const actionsArea = areas(page).getByRole('link', { name: 'Ações' });
  if (testInfo.project.name === 'mobile') await actionsArea.tap();
  else await actionsArea.click();
  const priorities = page.getByRole('table', { name: 'Ações prioritárias' });
  await expect(page.getByRole('heading', { name: 'Prioridades de acompanhamento' })).toBeVisible();
  await expect(priorities).toBeVisible();
  const returnUrl = page.url();
  await priorities.getByRole('link').first().click();
  await page.getByRole('link', { name: /Voltar ao painel/ }).click();
  await expect(page).toHaveURL(returnUrl);
});

test('painel sem cortes em seis larguras, dois temas e zoom de 200%', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  for (const width of [320, 375, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      const toggle = page.getByRole('button', {
        name: theme === 'light' ? 'Modo claro' : 'Modo escuro',
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      for (const label of ['Visão geral', 'Riscos', 'Ações', 'Estrutura']) {
        const link = areas(page).getByRole('link', { name: label, exact: true });
        await link.click();
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect(page.getByLabel('Unidade', { exact: true })).toBeVisible();
        expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        if (label === 'Ações') {
          await expect(page.getByRole('heading', { name: 'Ações preventivas' })).toBeVisible();
          const overlaps = await page
            .locator('.dashboard-action-summary .dashboard-reflow-heading')
            .evaluate((node) => {
              const boxes = [...node.children].map((child) => child.getBoundingClientRect());
              return boxes.some((a, index) =>
                boxes
                  .slice(index + 1)
                  .some(
                    (b) =>
                      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
                  ),
              );
            });
          expect(overlaps).toBe(false);
        }
        if (width === 320 || width === 1440)
          await page.screenshot({
            path: testInfo.outputPath(`painel-${width}-${theme}-${label}.png`),
            fullPage: true,
          });
      }
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  for (const label of ['Visão geral', 'Riscos', 'Ações', 'Estrutura']) {
    await areas(page).getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByLabel('Unidade', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});

test('período da série permanece independente do retrato e permite falha parcial', async ({
  page,
}) => {
  const snapshot = await openDashboard(page);
  await areas(page).getByRole('link', { name: 'Riscos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evolução no período' })).toBeVisible();
  const expectedFrom = new Date(Date.parse(snapshot.referenceDate) - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const loaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === root + '/history' &&
      url.searchParams.get('from') === expectedFrom &&
      url.searchParams.get('to') === snapshot.referenceDate
    );
  });
  await page.getByLabel('Período da série').selectOption('7');
  const response = await loaded;
  expect(response.status()).toBe(200);
  const history = managementIndicatorHistorySchema.parse(await response.json());
  expect(history.to).toBe(snapshot.referenceDate);
  expect(Date.parse(history.to) - Date.parse(history.from)).toBe(6 * 86_400_000);
  if (history.points.some((point) => point.evaluations > 0)) {
    await page.getByText('Ver eventos por dia', { exact: true }).click();
    await expect(
      page.getByRole('table', { name: 'Eventos registrados no período' }).getByRole('row'),
    ).toHaveCount(8);
  } else await expect(page.getByText(/Nenhum evento registrado/)).toBeVisible();
  await page.route('**/management-indicators/history?**', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.getByLabel('Período da série').selectOption('90');
  await expect(page.getByRole('alert')).toContainText('Histórico indisponível');
  await expect(page.getByRole('region', { name: 'Distribuição por unidade' })).toBeVisible();
});

test('filtros inválidos ou duplicados não se transformam em totais gerais', async ({ page }) => {
  const snapshot = await openDashboard(page);
  const unitId = snapshot.options.units[0]!.id;
  for (const query of ['unitId=invalida', 'unitId=' + unitId + '&unitId=' + unitId]) {
    const response = page.waitForResponse(
      (entry) => entry.url().includes(root + '?') && entry.status() === 400,
    );
    await page.goto('/#/painel?' + query);
    await response;
    await expect(page.getByRole('alert')).toContainText('Confira os campos informados');
    await expect(page.getByRole('list', { name: 'Indicadores principais' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Limpar filtros', exact: true }).click();
    await expect(page).toHaveURL(/#\/painel$/);
    await expect(page.getByRole('list', { name: 'Indicadores principais' })).toBeVisible();
  }
});
