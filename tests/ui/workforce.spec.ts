import { expect, test, type Locator, type Page } from '@playwright/test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const unitId = '30000000-0000-4000-8000-000000000001';
const sectorId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T12:00:00.000Z';
const longName =
  'Pessoa sintética responsável pelo acompanhamento e organização das atividades de prevenção';
const inactiveName =
  'Cadastro sintético inativo com nome extenso para acompanhamento do histórico organizacional';
const unitName =
  'Unidade demonstrativa de planejamento e acompanhamento das atividades organizacionais';
const sectorName = 'Setor demonstrativo de atendimento e coordenação das medidas de prevenção';
const widths = [320, 375, 390, 768, 1280, 1440];
type Kind = 'colaboradores' | 'grupos';

function records(kind: Kind) {
  return [longName, inactiveName].map((name, index) => ({
    id: `50000000-0000-4000-8000-00000000000${index + 1}`,
    organizationId,
    name,
    unitId,
    sectorId,
    unitName,
    sectorName,
    isActive: index === 0,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...(kind === 'colaboradores'
      ? {
          internalIdentifier: 'MATRICULA-SINTETICA-DE-ACOMPANHAMENTO-ORGANIZACIONAL',
          linkedUserId: userId,
        }
      : {}),
  }));
}

async function mockWorkforce(page: Page, kind: Kind, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('renr-theme', value), theme);
  const items = records(kind);
  const resource = kind === 'colaboradores' ? 'employees' : 'assessment-groups';
  const base = `/api/v1/organizations/${organizationId}`;
  const list = (values: unknown[]) => ({
    items: values,
    total: values.length,
    page: 1,
    pageSize: 20,
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET')
      throw new Error(`Unexpected synthetic mutation: ${route.request().method()} ${path}`);
    if (path === '/api/v1/health')
      return route.fulfill({ json: { status: 'ok', service: 'renr-api', timestamp: stamp } });
    if (path === '/api/v1/auth/session')
      return route.fulfill({
        json: {
          user: { id: userId, name: longName, email: 'workforce.synthetic@example.test' },
          memberships: [{ organizationId, organizationName: unitName, role: 'ADMIN' }],
          activeOrganizationId: organizationId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    if (path === '/api/v1/auth/session-capabilities')
      return route.fulfill({ json: { organizationId, capabilities: [], canManageAccess: true } });
    if (path === `${base}/${resource}`) return route.fulfill({ json: list(items) });
    const item = items.find((value) => path === `${base}/${resource}/${value.id}`);
    if (item) return route.fulfill({ json: item });
    if (path === `${base}/units`)
      return route.fulfill({
        json: list([
          {
            id: unitId,
            organizationId,
            name: unitName,
            code: null,
            isActive: true,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ]),
      });
    if (path === `/api/v1/units/${unitId}/sectors`)
      return route.fulfill({
        json: list([
          {
            id: sectorId,
            organizationId,
            unitId,
            name: sectorName,
            isActive: true,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ]),
      });
    if (path === `${base}/access-memberships`)
      return route.fulfill({
        json: list([
          {
            organizationId,
            userId,
            name: longName,
            email: 'workforce.synthetic@example.test',
            role: 'ADMIN',
            capabilities: [],
            isActive: true,
            version: 1,
            updatedAt: stamp,
          },
        ]),
      });
    throw new Error(`Unexpected synthetic request: ${path}`);
  });
  await page.goto(`/#/${kind}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
}

async function fitsHorizontally(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1;
    }),
  ).toBe(true);
}

async function assertReflow(page: Page) {
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    zoom: document.documentElement.style.zoom,
    overflow: Array.from(document.querySelectorAll('body *'))
      .map((element) => ({
        tag: element.tagName,
        className: element.getAttribute('class'),
        right: Math.round(element.getBoundingClientRect().right),
        text: element.children.length ? '' : element.textContent?.slice(0, 70),
      }))
      .filter((element) => element.right > innerWidth + 1)
      .slice(-12),
  }));
  expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
  for (const heading of await page.getByRole('heading').all()) await fitsHorizontally(heading);
  for (const select of await page.getByRole('combobox').all()) {
    await fitsHorizontally(select);
    // Native options can be long; the closed control must keep readable text and contrast.
    expect(
      await select.evaluate((element) => {
        const style = getComputedStyle(element);
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          parseFloat(style.fontSize) >= 14 &&
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >=
            4.5
        );
      }),
    ).toBe(true);
  }
}

async function captureSizes(page: Page, label: string, actions: Locator[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await assertReflow(page);
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      await fitsHorizontally(action);
      await expect(action).toBeInViewport();
      await expect(action).toBeEnabled();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `tmp/workforce-${label}-${width}.png`, fullPage: true });
  }
  // At 200%, 640/1280px provide 320/640 CSS-pixel content widths. A 390px
  // viewport zoomed to 200% is only 195px, below the app's 320px layout minimum.
  // Native browser zoom remains a separate ID27 check.
  for (const width of [640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await assertReflow(page);
    await page.screenshot({ path: `tmp/workforce-${label}-${width}-zoom200.png`, fullPage: true });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const kind of ['colaboradores', 'grupos'] as const) {
    test(`workforce ${kind} ${theme}: listas, cadastro e edição sem overflow`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const employee = kind === 'colaboradores';
      const noun = employee ? 'colaborador' : 'grupo';
      await mockWorkforce(page, kind, theme);
      await expect(
        page.getByRole('heading', {
          name: employee ? 'Colaboradores' : 'Grupos de avaliação',
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText('Inativo', { exact: true })).toBeVisible();
      const create = page.getByRole('button', { name: `Novo ${noun}`, exact: true });
      const edit = page.getByRole('button', {
        name: `Editar ${noun} ${inactiveName}`,
        exact: true,
      });
      const deactivate = page.getByRole('button', {
        name: `Desativar ${noun} ${longName}`,
        exact: true,
      });
      const reactivate = page.getByRole('button', {
        name: `Reativar ${noun} ${inactiveName}`,
        exact: true,
      });
      await captureSizes(page, `${kind}-list-${theme}`, [create, edit, deactivate, reactivate]);
      await page.setViewportSize({ width: 320, height: 900 });
      for (const [action, title] of [
        [deactivate, 'Desativar'],
        [reactivate, 'Reativar'],
      ] as const) {
        await action.click();
        const dialog = page.getByRole('dialog');
        await expect(
          dialog.getByRole('heading', { name: `${title} ${noun}`, exact: true }),
        ).toBeVisible();
        await assertReflow(page);
        await fitsHorizontally(
          dialog.getByRole('button', {
            name: `Confirmar ${title === 'Desativar' ? 'desativação' : 'reativação'}`,
            exact: true,
          }),
        );
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(action).toBeFocused();
      }
      await create.click();
      const formName = `Cadastrar ${employee ? 'colaborador' : 'grupo de avaliação'}`;
      await expect(page.getByRole('form', { name: formName, exact: true })).toBeVisible();
      await page
        .getByLabel(employee ? 'Nome do colaborador' : 'Nome do grupo', { exact: true })
        .fill(longName);
      await page.getByLabel('Unidade do cadastro', { exact: true }).selectOption(unitId);
      await page.getByLabel('Setor do cadastro', { exact: true }).selectOption(sectorId);
      if (employee) {
        await page
          .getByLabel('Identificação interna (opcional)', { exact: true })
          .fill('MATRICULA-SINTETICA-DE-ACOMPANHAMENTO-ORGANIZACIONAL');
        await page.getByLabel('Vincular a um usuário existente', { exact: true }).check();
        await page.getByLabel('Usuário vinculado', { exact: true }).selectOption(userId);
      }
      const save = page.getByRole('button', { name: `Salvar ${noun}`, exact: true });
      const cancel = page.getByRole('button', { name: 'Cancelar edição', exact: true });
      await captureSizes(page, `${kind}-create-${theme}`, [save, cancel]);
      await cancel.click();
      await edit.click();
      await expect(
        page.getByRole('heading', {
          name: `Editar ${employee ? 'colaborador' : 'grupo de avaliação'}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel(employee ? 'Nome do colaborador' : 'Nome do grupo', { exact: true }),
      ).toHaveValue(inactiveName);
      if (employee) {
        await expect(page.getByLabel('Unidade do cadastro', { exact: true })).toHaveValue(unitId);
        await expect(page.getByLabel('Setor do cadastro', { exact: true })).toHaveValue(sectorId);
        await expect(page.getByLabel('Usuário vinculado', { exact: true })).toHaveValue(userId);
      } else
        await expect(
          page.getByText(`Vinculado a ${unitName} · ${sectorName}.`, { exact: false }),
        ).toBeVisible();
      await captureSizes(page, `${kind}-edit-${theme}`, [save, cancel]);
      expect(errors).toEqual([]);
    });
  }
}
