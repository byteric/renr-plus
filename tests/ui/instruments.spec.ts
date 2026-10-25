import { expect, test, type Locator, type Page } from '@playwright/test';
import { instrumentSchema, instrumentVersionSchema } from '../../packages/contracts/src/index';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const instrumentId = '30000000-0000-4000-8000-000000000001';
const versionId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const longTitle =
  'Instrumento de acompanhamento das condições organizacionais e das medidas de prevenção';
const catalog = instrumentSchema.parse({
  id: instrumentId,
  organizationId,
  name: longTitle,
  isLegacy: false,
  createdAt: stamp,
});

function version(published: boolean) {
  return instrumentVersionSchema.parse({
    id: versionId,
    organizationId,
    instrumentId,
    title: longTitle,
    version: 1,
    revision: 2,
    status: published ? 'PUBLISHED' : 'DRAFT',
    usageMode: 'REAL',
    questionCount: 3,
    approvalReference: published
      ? 'Registro sintético de aprovação técnica para inspeção da interface'
      : null,
    publishedAt: published ? stamp : null,
    publishedById: published ? userId : null,
    createdAt: stamp,
    updatedAt: stamp,
    cycleCount: published ? 2 : 0,
    description:
      'Conteúdo sintético para conferir leitura, navegação e prévia sem registrar respostas.',
    instructions:
      'Leia cada pergunta e selecione a alternativa que melhor descreve o cenário apresentado.',
    questions: (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE'] as const).map(
      (type, index) => ({
        id: `50000000-0000-4000-8000-00000000000${index + 1}`,
        label: `Cenário ${index + 1}: como estão organizadas as atividades e os recursos necessários para realizar o trabalho com segurança?`,
        type,
        required: index !== 1,
        position: index + 1,
        options: [1, 2].map((position) => ({
          id: `60000000-0000-4000-8000-0000000000${index + 1}${position}`,
          label:
            position === 1
              ? 'As condições são adequadas e os recursos necessários estão disponíveis para a equipe'
              : 'Há oportunidades de melhoria que precisam ser acompanhadas pela organização',
          position,
        })),
      }),
    ),
  });
}

async function mockInstruments(page: Page, theme: 'light' | 'dark', published: boolean) {
  const detail = version(published);
  const summary = Object.fromEntries(
    Object.entries(detail).filter(
      ([key]) => !['description', 'instructions', 'questions'].includes(key),
    ),
  );
  const base = `/api/v1/organizations/${organizationId}/instruments`;
  const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('renr-theme', value), theme);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET')
      throw new Error('Visual fixtures must never mutate data');
    if (path === '/api/v1/health')
      return route.fulfill({ json: { status: 'ok', service: 'renr-api', timestamp: stamp } });
    if (path === '/api/v1/auth/session')
      return route.fulfill({
        json: {
          user: {
            id: userId,
            name: 'Pessoa sintética',
            email: 'instruments.synthetic@example.test',
          },
          memberships: [
            { organizationId, organizationName: 'Organização sintética', role: 'ADMIN' },
          ],
          activeOrganizationId: organizationId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    if (path === '/api/v1/auth/session-capabilities')
      return route.fulfill({
        json: { organizationId, canManageAccess: true, capabilities: ['TECHNICAL_DECISIONS'] },
      });
    if (path === base) return route.fulfill({ json: list([catalog]) });
    if (path === `${base}/${instrumentId}`) return route.fulfill({ json: catalog });
    if (path === `${base}/${instrumentId}/versions`)
      return route.fulfill({ json: list([summary]) });
    if (path === `${base}/${instrumentId}/versions/${versionId}`)
      return route.fulfill({ json: detail });
    throw new Error(`Unexpected instrument fixture request: ${path}`);
  });
  await page.goto(`/#/instrumentos?instrument=${instrumentId}&version=${versionId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Título da versão', { exact: true })).toHaveValue(longTitle);
  await expect(page.getByRole('region', { name: 'Prévia do participante' })).toBeVisible();
  return detail;
}

async function withinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  expect(
    await locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1;
    }),
  ).toBe(true);
}
async function reflow(page: Page, contentOnly = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const scope = contentOnly ? page.getByRole('form', { name: 'Editar instrumento' }) : page;
  for (const control of await scope.getByRole('combobox').all()) await withinViewport(control);
}

for (const theme of ['light', 'dark'] as const) {
  test(`instruments ${theme}: editor, preview and publication reflow`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockInstruments(page, theme, false);
    const preview = page.getByRole('region', { name: 'Prévia do participante' });
    await expect(preview.getByRole('checkbox')).toHaveCount(2);
    await expect(preview.getByRole('radio')).toHaveCount(4);
    for (const control of await preview.getByRole('radio').all()) {
      expect(
        await control.evaluate((element) => element.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(24);
    }
    expect(
      await preview
        .getByText(
          'As condições são adequadas e os recursos necessários estão disponíveis para a equipe',
          { exact: true },
        )
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(100);
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
      for (const name of ['Adicionar pergunta', 'Salvar rascunho', 'Publicar versão']) {
        const action = page.getByRole('button', { name, exact: true });
        await withinViewport(action);
        await expect(action).toBeEnabled();
      }
      if (width === 390 || width === 1440) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `tmp/instruments-editor-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    }
    for (const width of [640, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      // CSS zoom does not recalculate viewport media queries. Check the instrument
      // content and global horizontal overflow, without treating the sticky shell
      // as a native browser-zoom simulation (covered separately by ID27).
      await reflow(page, true);
      await withinViewport(page.getByRole('button', { name: 'Salvar rascunho', exact: true }));
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button', { name: 'Mover pergunta 1 para baixo', exact: true }).click();
    await expect(page.getByLabel('Enunciado da pergunta 2', { exact: true })).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'Pergunta movida para a posição 2.' }),
    ).toHaveCount(1);
    await page.getByLabel('Título da versão', { exact: true }).fill('Prévia local ainda não salva');
    await expect(
      preview.getByRole('heading', { name: 'Prévia local ainda não salva', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`instruments ${theme}: published content stays readable and immutable`, async ({ page }) => {
    await mockInstruments(page, theme, true);
    await expect(page.getByLabel('Título da versão', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Salvar rascunho', exact: true })).toHaveCount(0);
    await expect(
      page.getByText('2 ciclos associados a esta versão.', { exact: false }),
    ).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
      await withinViewport(page.getByRole('button', { name: 'Criar nova versão', exact: true }));
      await expect(page.getByText(/Referência de aprovação: Registro sintético/)).toBeVisible();
    }
  });
}
