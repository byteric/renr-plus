import { expect, test, type Page } from '@playwright/test';
import type { ManagementIndicators } from '../../packages/contracts/src/index';

const id = '10000000-0000-4000-8000-000000000001';
const unitId = '10000000-0000-4000-8000-000000000002';
const sectorId = '10000000-0000-4000-8000-000000000003';
const longName =
  'Unidade de acompanhamento de projetos interdisciplinares e desenvolvimento contínuo';
const title =
  'Revisar a distribuição das jornadas de trabalho durante mudanças de prioridades no desenvolvimento';
const date = '2026-11-03';
const now = date + 'T18:00:00.000Z';
const structure = { total: 1, active: 1, inactive: 0 };
const level = {
  methodVersionId: id,
  methodName: 'Método de avaliação coletiva',
  methodVersion: 2,
  key: 'alto',
  label: 'Alto',
  count: 1,
};
const snapshot: ManagementIndicators = {
  organizationId: id,
  organization: {
    id,
    name: 'Empresa de desenvolvimento e acompanhamento de serviços digitais',
    isActive: true,
  },
  generatedAt: now,
  referenceDate: date,
  timeZone: 'America/Sao_Paulo',
  filters: { unitId, sectorId },
  structure: { units: structure, sectors: structure, employees: null },
  options: {
    units: [{ id: unitId, name: longName }],
    sectors: [{ id: sectorId, unitId, name: 'Desenvolvimento e operações de sistemas' }],
  },
  risks: {
    total: 1,
    classified: 1,
    unclassified: 0,
    levels: [level],
    units: [{ unitId, name: longName, count: 1, levels: [level], unclassified: 0 }],
  },
  actions: {
    total: 1,
    planned: 1,
    inProgress: 0,
    implemented: 0,
    cancelled: 0,
    open: 1,
    overdue: 1,
    technicalPending: 0,
    closed: 0,
    effective: 0,
  },
  priorities: {
    page: 1,
    pageSize: 5,
    total: 1,
    items: [
      { actionId: id, riskId: id, title, unitId, sectorId, dueDate: '2026-11-01', kind: 'OVERDUE' },
    ],
  },
};

async function openPanel(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('renr-theme', value), theme);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let body: unknown;
    if (path === '/health') body = { status: 'ok', service: 'renr-api', timestamp: now };
    else if (path === '/auth/session') {
      body = {
        user: { id, name: 'Leitora demonstrativa', email: 'fixture@example.test' },
        memberships: [
          { organizationId: id, organizationName: snapshot.organization.name, role: 'READER' },
        ],
        activeOrganizationId: id,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
    } else if (path.endsWith('/management-indicators')) body = snapshot;
    else if (path.endsWith('/management-indicators/history')) {
      const from = url.searchParams.get('from')!;
      const to = url.searchParams.get('to')!;
      body = {
        organizationId: id,
        generatedAt: now,
        timeZone: snapshot.timeZone,
        filters: snapshot.filters,
        from,
        to,
        points: Array.from({ length: 7 }, (_, index) => ({
          date: new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10),
          evaluations: index === 2 ? 1 : 0,
          implementations: index === 4 ? 2 : 0,
          closures: index === 5 ? 1 : 0,
        })),
      };
    }
    await route.fulfill({ status: body ? 200 : 404, json: body ?? {} });
  });
  await page.goto('/#/painel?area=acoes&dias=7&unitId=' + unitId + '&sectorId=' + sectorId);
}

for (const theme of ['light', 'dark'] as const) {
  test(
    'nomes extensos, movimento reduzido e marca no tema ' + theme,
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 840 });
      await openPanel(page, theme);
      await expect(
        page.getByRole('heading', { name: 'Ações preventivas', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: title })).toBeVisible();
      await expect(page.getByRole('img', { name: /Execuções informadas: 2/ })).toBeVisible();
      const symbol =
        theme === 'dark' ? '/brand/renr-plus-symbol-dark.svg' : '/brand/renr-plus-symbol.svg';
      await expect
        .poll(() =>
          page
            .locator('.wordmark img')
            .evaluate((element) => new URL((element as HTMLImageElement).currentSrc).pathname),
        )
        .toBe(symbol);
      expect(
        await page
          .locator('[data-chart-series]')
          .evaluateAll((series) => series.every((line) => !(line as SVGElement).style.transform)),
      ).toBe(true);
      await page.getByText('Ver eventos por dia', { exact: true }).click();
      await expect(
        page.getByRole('table', { name: 'Eventos registrados no período' }).getByRole('row'),
      ).toHaveCount(8);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('acoes-320-' + theme + '.png'),
        fullPage: true,
      });
      await page
        .getByRole('navigation', { name: 'Áreas do painel' })
        .getByRole('link', { name: 'Riscos' })
        .click();
      await expect(
        page.getByRole('link', { name: 'Alto · Método de avaliação coletiva v2 1' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: longName + ' 1' })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('riscos-320-' + theme + '.png'),
        fullPage: true,
      });
    },
  );
}
