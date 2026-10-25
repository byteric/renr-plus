import { expect, test, type Locator, type Page } from '@playwright/test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const stamp = '2026-10-22T12:00:00.000Z';
const organization = {
  id: organizationId,
  name: 'Empresa demonstrativa de acompanhamento e prevenção de riscos ocupacionais',
  fiscalIdentifier: null,
  timezone: 'America/Sao_Paulo',
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp,
};
const risk = {
  id: '40000000-0000-4000-8000-000000000001',
  organizationId,
  assessmentGroupId: organizationId,
  sectorId: '30000000-0000-4000-8000-000000000001',
  unit: {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Unidade demonstrativa',
    isActive: true,
  },
  sector: { id: '30000000-0000-4000-8000-000000000001', name: 'Atendimento', isActive: true },
  factor: 'Organização de tarefas com acompanhamento das medidas preventivas',
  description: null,
  exposureDescription: null,
  exposedGroupDescription: null,
  possibleHarms: null,
  existingControls: null,
  sourceKind: null,
  sourceNote: null,
  diagnosticCycleId: null,
  status: 'DRAFT',
  version: 1,
  createdBy: { id: organizationId, name: 'Equipe demonstrativa' },
  updatedBy: { id: organizationId, name: 'Equipe demonstrativa' },
  createdAt: stamp,
  updatedAt: stamp,
  latestEvaluation: null,
};
const action = {
  id: '50000000-0000-4000-8000-000000000001',
  organizationId,
  riskId: risk.id,
  risk: { id: risk.id, factor: risk.factor },
  title: 'Revisar a distribuição de tarefas com acompanhamento da equipe responsável',
  responsibleName: 'Pessoa demonstrativa responsável pela execução',
  dueDate: '2026-10-20',
  status: 'IN_PROGRESS',
  version: 1,
  isOverdue: true,
  referenceDate: '2026-10-22',
  timeZone: 'America/Sao_Paulo',
};

async function openWorkspace(
  page: Page,
  theme: 'light' | 'dark',
  path = '/empresas',
  failActions = false,
) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/health') {
      await route.fulfill({ json: { status: 'ok', service: 'renr-api', timestamp: stamp } });
    } else if (path === '/api/v1/auth/session') {
      await route.fulfill({
        json: {
          user: {
            id: '30000000-0000-4000-8000-000000000001',
            name: 'Pessoa demonstrativa',
            email: 'foundation@example.test',
          },
          memberships: [{ organizationId, organizationName: organization.name, role: 'ADMIN' }],
          activeOrganizationId: organizationId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    } else if (path === '/api/v1/organizations') {
      await route.fulfill({ json: { items: [organization], total: 1, page: 1, pageSize: 50 } });
    } else if (path === `/api/v1/organizations/${organizationId}/units`) {
      await route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 50 } });
    } else if (path === `/api/v1/organizations/${organizationId}/risks`) {
      await route.fulfill({ json: { items: [risk], total: 51, page: 1, pageSize: 50 } });
    } else if (path === `/api/v1/organizations/${organizationId}/actions`) {
      if (failActions) {
        await route.fulfill({
          status: 503,
          json: { code: 'UNAVAILABLE', message: 'Serviço temporariamente indisponível.' },
        });
      } else {
        await route.fulfill({ json: { items: [action], total: 51, page: 1, pageSize: 50 } });
      }
    } else {
      throw new Error(`Unexpected fixture request: ${route.request().method()} ${path}`);
    }
  });
  await page.goto(`/#${path}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return () => {
    failActions = false;
  };
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) =>
      rgb(value)
        .map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    let background: Element | null = element;
    while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
      background = background.parentElement;
    if (!background) throw new Error('No opaque background for contrast measurement.');
    const foregroundLuminance = luminance(getComputedStyle(element).color);
    const backgroundLuminance = luminance(getComputedStyle(background).backgroundColor);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`hierarquia tipográfica e superfícies legíveis no tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkspace(page, theme);
    await expect(page.getByRole('heading', { level: 1, name: 'Empresas', exact: true })).toHaveCSS(
      'font-size',
      '30px',
    );
    await expect(page.getByText('ESTRUTURA ORGANIZACIONAL', { exact: true })).toHaveCSS(
      'font-size',
      '12px',
    );
    const record = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: organization.name }) });
    expect(await record.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
      'none',
    );
    await expect(page.getByRole('button', { name: 'Nova empresa', exact: true })).toHaveCSS(
      'font-size',
      '14px',
    );
  });

  test(`nomes extensos, foco e ações permanecem acessíveis no tema ${theme}`, async ({
    page,
  }, testInfo) => {
    await openWorkspace(page, theme);
    await expect(page.getByRole('heading', { name: organization.name, exact: true })).toBeVisible();
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const edit = page.getByRole('button', {
        name: `Editar empresa ${organization.name}`,
        exact: true,
      });
      await edit.focus();
      await expect(edit).toBeFocused();
      await expect(edit).toBeInViewport();
      const box = await edit.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await edit.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        'none',
      );
      if (width === 375 || width === 1440)
        await page.screenshot({
          path: testInfo.outputPath(`foundation-${width}-${theme}.png`),
          fullPage: true,
        });
    }
  });

  test(`erro recuperável e estado de ações mantêm contraste no tema ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 900 });
    const recover = await openWorkspace(page, theme, '/acoes', true);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    expect(await contrast(alert)).toBeGreaterThanOrEqual(4.5);
    recover();
    await alert.getByRole('button', { name: 'Atualizar ações', exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole('link', { name: action.title, exact: true })).toBeVisible();
    const badge = page.getByRole('cell').getByText('Em execução', { exact: true });
    expect(await contrast(badge)).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByText('Atrasada', { exact: true })).toBeVisible();
    const pagination = page.getByRole('navigation', { name: 'Paginação de ações', exact: true });
    await expect(
      pagination.getByRole('button', { name: 'Página anterior', exact: true }),
    ).toBeDisabled();
    await expect(
      pagination.getByRole('button', { name: 'Próxima página', exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`actions-375-${theme}.png`),
      fullPage: true,
    });
  });

  test(`inventário mantém filtros e paginação por teclado com reflow no tema ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await openWorkspace(page, theme, '/inventario');
    await expect(page.getByRole('link', { name: risk.factor, exact: true })).toBeVisible();
    expect(await contrast(page.getByText('Rascunho', { exact: true }))).toBeGreaterThanOrEqual(4.5);
    // 640 CSS pixels model the available width of a 1280px viewport at 200% zoom.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const search = page.getByRole('searchbox', { name: 'Buscar no inventário' });
    await search.focus();
    await expect(search).toBeFocused();
    const pagination = page.getByRole('navigation', {
      name: 'Paginação do inventário',
      exact: true,
    });
    const next = pagination.getByRole('button', { name: 'Próxima página', exact: true });
    await next.focus();
    await expect(next).toBeFocused();
    await expect(next).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole('link', { name: risk.factor, exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`inventory-reflow-${theme}.png`),
      fullPage: true,
    });
  });
}
