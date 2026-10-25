import { test, expect, type Page } from '@playwright/test';
import type {
  AssessmentCycle,
  AssessmentResults,
  AssessmentParticipation,
} from '../../packages/contracts/src/index';

const org = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const cycleId = '30000000-0000-4000-8000-000000000001';
const group = '40000000-0000-4000-8000-000000000001';
const version = '50000000-0000-4000-8000-000000000001';
const policy = '60000000-0000-4000-8000-000000000001';
const instrument = '70000000-0000-4000-8000-000000000001';
const question = '80000000-0000-4000-8000-000000000001';
const option = '90000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const title =
  'Coleta de condições organizacionais e acompanhamento das medidas coletivas de prevenção';
const cycle: AssessmentCycle = {
  id: cycleId,
  organizationId: org,
  name: title,
  assessmentGroupId: group,
  assessmentGroupName: 'Grupo sintético de atendimento e suporte organizacional',
  sectorId: group,
  sectorName: 'Atendimento e suporte',
  unitId: group,
  unitName: 'Unidade de acompanhamento coletivo',
  instrumentId: instrument,
  instrumentTitle: 'Instrumento de condições organizacionais',
  instrumentVersionId: version,
  instrumentVersion: 2,
  policyVersionId: policy,
  policyVersion: 1,
  usageMode: 'DEMONSTRATION',
  minimumResponses: 5,
  status: 'CLOSED',
  revision: 3,
  startsAt: stamp,
  endsAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
  closedAt: stamp,
};
function result(suppressed: boolean): AssessmentResults {
  return {
    organizationId: org,
    instrumentVersionId: version,
    policyVersionId: policy,
    minimumResponses: 5,
    node: {
      id: cycleId,
      name: title,
      nodeType: 'CYCLE',
      availability: suppressed ? 'SUPPRESSED' : 'AVAILABLE',
      responseCount: suppressed ? null : 10,
      children: [],
      questions: suppressed
        ? []
        : [
            {
              id: question,
              label:
                'Como estão organizadas as atividades e os recursos necessários ao trabalho da equipe?',
              type: 'MULTIPLE_CHOICE',
              required: true,
              availability: 'AVAILABLE',
              answerCount: 10,
              options: [
                {
                  id: option,
                  label: 'As condições coletivas estão adequadas ao planejamento das atividades',
                  count: 5,
                  percentage: 50,
                },
                {
                  id: question,
                  label: 'Existem oportunidades de melhoria a serem acompanhadas pela organização',
                  count: 5,
                  percentage: 50,
                },
              ],
            },
          ],
    },
  };
}
const publicView: AssessmentParticipation = {
  cycleName: title,
  endsAt: '2099-01-01T00:00:00.000Z',
  usageMode: 'DEMONSTRATION',
  instrument: {
    id: version,
    title: cycle.instrumentTitle,
    version: 2,
    description: 'Cenário fictício para conferir o formulário de participação.',
    instructions: 'Escolha as alternativas que descrevem o cenário coletivo.',
    questions: (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE'] as const).map(
      (type, index) => ({
        id: `80000000-0000-4000-8000-00000000000${index + 1}`,
        label: `Pergunta ${index + 1}: como estão os recursos e a organização das atividades coletivas?`,
        type,
        position: index + 1,
        required: index !== 1,
        options: [1, 2].map((position) => ({
          id: `90000000-0000-4000-8000-0000000000${index + 1}${position}`,
          position,
          label:
            position === 1
              ? 'Os recursos estão disponíveis para que a equipe realize suas atividades'
              : 'As condições de trabalho apresentam oportunidades de melhoria',
        })),
      }),
    ),
  },
};
async function mock(page: Page, theme: 'light' | 'dark', suppressed = false) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('renr-theme', value), theme);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/assessment-participation/access'))
      return route.fulfill({ json: publicView });
    if (route.request().method() !== 'GET') throw new Error('Visual inspection cannot mutate data');
    if (path.endsWith('/health'))
      return route.fulfill({ json: { status: 'ok', service: 'renr-api', timestamp: stamp } });
    if (path.endsWith('/auth/session'))
      return route.fulfill({
        json: {
          user: { id: user, name: 'Gestora sintética', email: 'synthetic@example.test' },
          memberships: [
            { organizationId: org, organizationName: 'Organização sintética', role: 'ADMIN' },
          ],
          activeOrganizationId: org,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    if (path.endsWith('/session-capabilities'))
      return route.fulfill({
        json: { organizationId: org, canManageAccess: true, capabilities: [] },
      });
    if (path.endsWith(`/${cycleId}/results`)) return route.fulfill({ json: result(suppressed) });
    if (path.endsWith(`/assessment-cycles/${cycleId}`)) return route.fulfill({ json: cycle });
    if (path.endsWith('/sources'))
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
    const instrumentRecord = {
      id: instrument,
      organizationId: org,
      name: 'Catálogo coletivo sintético',
      isLegacy: false,
      createdAt: stamp,
    };
    const versionRecord = {
      id: version,
      organizationId: org,
      instrumentId: instrument,
      title: cycle.instrumentTitle,
      version: 2,
      revision: 2,
      status: 'PUBLISHED',
      usageMode: 'DEMONSTRATION',
      questionCount: 3,
      approvalReference: null,
      publishedAt: stamp,
      publishedById: user,
      createdAt: stamp,
      updatedAt: stamp,
      cycleCount: 1,
    };
    const policyRecord = {
      id: policy,
      organizationId: org,
      version: 1,
      revision: 2,
      status: 'PUBLISHED',
      usageMode: 'DEMONSTRATION',
      minimumResponses: 5,
      algorithmVersion: 'CONSERVATIVE_V1',
      approvalReference: null,
      publishedById: user,
      publishedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (path.endsWith('/assessment-groups'))
      return route.fulfill({
        json: list([
          {
            id: group,
            organizationId: org,
            name: cycle.assessmentGroupName,
            unitId: group,
            sectorId: group,
            unitName: cycle.unitName,
            sectorName: cycle.sectorName,
            isActive: true,
            version: 1,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ]),
      });
    if (path.endsWith('/instruments')) return route.fulfill({ json: list([instrumentRecord]) });
    if (path.endsWith(`/instruments/${instrument}`))
      return route.fulfill({ json: instrumentRecord });
    if (path.endsWith('/versions')) return route.fulfill({ json: list([versionRecord]) });
    if (path.endsWith(`/versions/${version}`))
      return route.fulfill({
        json: {
          ...versionRecord,
          description: '',
          instructions: '',
          questions: publicView.instrument.questions,
        },
      });
    if (path.endsWith('/consolidation-policies'))
      return route.fulfill({ json: list([policyRecord]) });
    if (path.endsWith(`/consolidation-policies/${policy}`))
      return route.fulfill({ json: policyRecord });
    if (path.endsWith('/assessment-cycles'))
      return route.fulfill({ json: { items: [cycle], total: 1, page: 1, pageSize: 20 } });
    throw new Error(`Unexpected visual fixture path ${path}`);
  });
}
async function reflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  for (const control of await page
    .locator(
      'main input, main select, main textarea, .workspace-content button, .assessment-participation button',
    )
    .all()) {
    if (!(await control.isVisible())) continue;
    await control.scrollIntoViewIfNeeded();
    expect(
      await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1;
      }),
    ).toBe(true);
  }
}
for (const theme of ['light', 'dark'] as const) {
  test(`assessments ${theme}: cycle and policy forms follow the control tokens and reflow`, async ({
    page,
  }) => {
    await mock(page, theme);
    await page.goto('/#/coletas?create=true');
    const field = page.getByLabel('Nome da coleta', { exact: true });
    await expect(field).toBeVisible();
    expect(
      await field.evaluate((element) => parseFloat(getComputedStyle(element).borderRadius)),
    ).toBeGreaterThan(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
    }
    await page.getByRole('button', { name: 'Políticas de consolidação', exact: true }).click();
    await page.getByRole('button', { name: 'Criar política', exact: true }).click();
    await page.getByRole('combobox', { name: 'Modo de uso', exact: true }).selectOption('REAL');
    await expect(page.getByLabel('Limiar mínimo de respostas', { exact: true })).toHaveValue('');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
    }
  });
  test(`assessments ${theme}: collection list and protected results reflow`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mock(page, theme);
    await page.goto('/#/coletas');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
    }
    await page.goto(`/#/coletas?cycle=${cycleId}`);
    await expect(page.getByText('Envios consolidados: 10', { exact: true })).toBeVisible();
    const separatedLabels = await page
      .locator('.assessment-result-options > li')
      .first()
      .evaluate((element) => {
        const label = element.children[0]!.getBoundingClientRect();
        const value = element.children[1]!.getBoundingClientRect();
        return value.top >= label.bottom + 4 || value.left >= label.right + 8;
      });
    expect(separatedLabels).toBe(true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
      if (width === 390 || width === 1440) {
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({
          path: `tmp/assessments-result-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    }
    expect(errors).toEqual([]);
  });
  test(`assessments ${theme}: suppression never renders counts or percentages`, async ({
    page,
  }) => {
    await mock(page, theme, true);
    await page.goto(`/#/coletas?cycle=${cycleId}`);
    await expect(
      page.getByRole('heading', { name: 'Resultado suprimido', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Envios consolidados:/)).toHaveCount(0);
    await expect(page.getByRole('meter')).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 800 });
    await reflow(page);
  });
  test(`assessments ${theme}: participant review stays usable on touch and keyboard`, async ({
    page,
  }) => {
    await mock(page, theme);
    await page.goto('/#/responder');
    await page.getByLabel('Código do convite', { exact: true }).fill('v'.repeat(43));
    await page.getByRole('button', { name: 'Acessar coleta', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Responder à coleta' })).toBeVisible();
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await reflow(page);
      for (const choice of await page.getByRole('radio').all())
        expect(
          await choice.evaluate((element) => element.getBoundingClientRect().width),
        ).toBeLessThanOrEqual(24);
    }
    await page.getByRole('radio').nth(0).check();
    await page.getByRole('radio').nth(2).check();
    await page.getByRole('button', { name: 'Revisar respostas', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Confira antes de enviar', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Confirmar envio', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Corrigir respostas', exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 390, height: 900 });
    await reflow(page);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `tmp/assessments-participation-${theme}-390.png`,
      fullPage: true,
    });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('radio').nth(0)).toBeChecked();
    await expect(page.getByRole('radio').nth(2)).toBeChecked();
  });
}
