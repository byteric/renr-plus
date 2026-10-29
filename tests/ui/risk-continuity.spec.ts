import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  action,
  closure,
  closureContext,
  efficacy,
  evaluation,
  currentEvaluation,
  id,
  nextId,
  org,
  page as pageOf,
  publishedMethod,
  reassessment,
  reassessmentSummary,
  risk,
  stamp,
} from '../../apps/web/src/components/actions/TechnicalContinuity.fixtures';

const evidenceDirectory = resolve('tmp/id17-ui-evidence');
mkdirSync(evidenceDirectory, { recursive: true });
const summary = reassessmentSummary.evaluation;
async function mockContinuity(page: Page) {
  const state = { reassesed: false, closed: false, corrected: false, posts: 0 };
  const link = {
    id: nextId,
    organizationId: org,
    riskId: id,
    previousActionId: id,
    newActionId: nextId,
    opinionId: efficacy.latest!.id,
    reason: 'Acompanhar a medida com nova intervenção coletiva sintética.',
    author: closure.author,
    createdAt: stamp,
  };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let status = 200;
    let data: unknown = pageOf([]);
    if (route.request().method() === 'POST') {
      state.posts++;
      status = 201;
      if (path.endsWith('/reassessments')) {
        state.reassesed = true;
        data = reassessment;
      } else if (path.endsWith('/technical-closures')) {
        state.closed = true;
        data = closure;
      } else if (path.endsWith('/corrective-actions')) {
        state.corrected = true;
        const created = {
          ...action,
          id: nextId,
          status: 'PLANNED',
          implementationNote: null,
          implementedAt: null,
          version: 1,
        };
        data = {
          link,
          action: Object.fromEntries(
            Object.entries(created).filter(
              ([key]) =>
                ![
                  'risk',
                  'assignedUser',
                  'riskContext',
                  'evidenceSummary',
                  'pendingReasons',
                  'permissions',
                ].includes(key),
            ),
          ),
        };
      } else status = 503;
    } else if (path.endsWith('/health'))
      data = { status: 'ok', service: 'renr-api', timestamp: stamp };
    else if (path.endsWith('/auth/session'))
      data = {
        user: { ...closure.author, email: 'synthetic@example.test' },
        memberships: [
          {
            organizationId: org,
            organizationName: 'Empresa sintética de prevenção',
            role: 'ADMIN',
          },
        ],
        activeOrganizationId: org,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
    else if (path.endsWith('/session-capabilities'))
      data = { organizationId: org, capabilities: ['TECHNICAL_DECISIONS'], canManageAccess: true };
    else if (path.endsWith(`/risk-workspaces/${id}`))
      data = state.reassesed ? { ...risk, latestTechnicalEvaluation: summary } : risk;
    else if (path.endsWith('/risk-workspaces')) data = pageOf([risk], 50);
    else if (path.endsWith('/reassessment-context'))
      data = {
        organizationId: org,
        riskId: id,
        riskVersion: 1,
        latestEvaluation: state.reassesed ? currentEvaluation : evaluation,
        latestReassessment: state.reassesed ? reassessmentSummary : null,
        permissions: { hasTechnicalCapability: true, canReassess: true },
        blockingReasons: [],
      };
    else if (path.endsWith('/reassessments'))
      data = pageOf(state.reassesed ? [reassessmentSummary] : []);
    else if (path.includes('/reassessments/')) data = reassessment;
    else if (path.endsWith('/technical-evaluations'))
      data = pageOf(state.reassesed ? [currentEvaluation, evaluation] : [evaluation], 50);
    else if (path.includes('/technical-evaluations/'))
      data = path.endsWith(nextId) ? currentEvaluation : evaluation;
    else if (path.endsWith('/evaluation-method-versions')) data = pageOf([publishedMethod], 50);
    else if (path.endsWith('/source-options'))
      data = pageOf(
        [
          {
            kind: 'RISK_RECORD',
            id,
            label: 'Registro contextual elegível',
            reference: 'Registro coletivo sintético',
            isDemonstration: true,
            eligible: true,
            unavailableReason: null,
          },
        ],
        50,
      );
    else if (path.endsWith('/actions'))
      data = pageOf([
        {
          id,
          organizationId: org,
          riskId: id,
          title: action.title,
          risk: action.risk,
          responsibleName: action.responsibleName,
          dueDate: action.dueDate,
          status: action.status,
          version: action.version,
          isOverdue: false,
          referenceDate: action.referenceDate,
          timeZone: action.timeZone,
        },
      ]);
    else if (path.endsWith('/efficacy')) data = efficacy;
    else if (path.endsWith('/efficacy-opinions')) data = pageOf([efficacy.latest]);
    else if (path.endsWith(`/action-workspaces/${id}`)) data = action;
    else if (path.endsWith('/closure-context'))
      data = {
        ...closureContext,
        latest: state.closed ? closure : null,
        permissions: { ...closureContext.permissions, canClose: !state.closed },
        blockingReasons: state.closed ? ['ALREADY_CLOSED'] : [],
      };
    else if (path.endsWith('/technical-closures')) data = pageOf(state.closed ? [closure] : []);
    else if (path.includes('/technical-closures/')) data = closure;
    else if (path.endsWith('/corrective-actions')) data = pageOf(state.corrected ? [link] : []);
    await route.fulfill({ status, json: data });
  });
  return state;
}
async function reflow(page: Page) {
  for (const width of [320, 375, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
}

async function textContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const luminance = (value: string) => {
      const channels = (value.match(/[\d.]+/g) ?? []).map(Number);
      if (channels.length < 3 || (channels.length === 4 && channels[3] !== 1))
        throw new Error('Contrast check requires opaque RGB colors.');
      return channels.slice(0, 3).reduce((sum, channel, index) => {
        const normalized = channel / 255;
        const linear =
          normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
    };
    let background: Element | null = element;
    while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
      background = background.parentElement;
    if (!background) throw new Error('No opaque background for contrast measurement.');
    const foregroundValue = luminance(getComputedStyle(element).color);
    const backgroundValue = luminance(getComputedStyle(background).backgroundColor);
    return (
      (Math.max(foregroundValue, backgroundValue) + 0.05) /
      (Math.min(foregroundValue, backgroundValue) + 0.05)
    );
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`continuidade ${theme}: reavaliação, comparação e consulta histórica por teclado`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await mockContinuity(page);
    await page.goto(`/#/inventario/${id}`);
    const prepare = page.getByRole('button', {
      name: 'Preparar reavaliação do risco',
      exact: true,
    });
    await expect(prepare).toBeEnabled();
    await prepare.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('checkbox', { name: action.title, exact: true }).check();
    await page
      .getByLabel(`Consideração de ${action.title}`, { exact: true })
      .fill(reassessment.measures[0]!.consideration);
    await page.getByLabel('Método publicado', { exact: true }).selectOption(org);
    await page.getByLabel('Probabilidade', { exact: true }).selectOption('p1');
    await page.getByLabel('Severidade', { exact: true }).selectOption('s1');
    await page
      .getByLabel('Justificativa técnica', { exact: true })
      .fill(reassessment.evaluation.rationale);
    await page
      .getByLabel('Contexto da avaliação', { exact: true })
      .fill(reassessment.evaluation.context);
    await page
      .getByRole('checkbox', { name: 'Registro contextual elegível · Demonstrativa', exact: true })
      .check();
    expect(
      await textContrast(page.getByLabel('Justificativa técnica', { exact: true })),
    ).toBeGreaterThanOrEqual(4.5);
    await reflow(page);
    await page.getByRole('button', { name: 'Revisar avaliação e medidas', exact: true }).click();
    expect(state.posts).toBe(0);
    await expect(
      page.getByRole('heading', { name: 'Revise a reavaliação antes de confirmar', exact: true }),
    ).toBeFocused();
    expect(
      await textContrast(
        page.getByRole('heading', { name: 'Revise a reavaliação antes de confirmar', exact: true }),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await textContrast(
        page.getByRole('button', { name: 'Confirmar e registrar reavaliação', exact: true }),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    await reflow(page);
    await page.screenshot({
      path: resolve(evidenceDirectory, `reassessment-${theme}-desktop-review.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(evidenceDirectory, `reassessment-${theme}-mobile-review.png`),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Confirmar e registrar reavaliação', exact: true })
      .click();
    expect(state.posts).toBe(1);
    await page.getByRole('button', { name: 'Consultar reavaliação 2', exact: true }).click();
    const reading = page.getByRole('article', { name: 'Reavaliação consultada 2', exact: true });
    await expect(
      reading.getByRole('heading', { name: 'Anterior · avaliação 1', exact: true }),
    ).toBeVisible();
    await expect(
      reading.getByRole('heading', { name: 'Atual · avaliação 2', exact: true }),
    ).toBeVisible();
    await expect(
      reading.getByText(reassessment.measures[0]!.consideration, { exact: true }),
    ).toBeVisible();
    await reflow(page);
    await reading.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(evidenceDirectory, `reassessment-${theme}-comparison.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('heading', { name: 'Anterior · avaliação 1', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDirectory, `comparison-${theme}-previous.png`) });
    await page
      .getByRole('heading', { name: 'Atual · avaliação 2', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDirectory, `comparison-${theme}-current.png`) });
    expect(errors).toEqual([]);
  });
  test(`continuidade ${theme}: encerramento confirmado, histórico e nova corretiva`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = await mockContinuity(page);
    await page.goto(`/#/acoes/${id}`);
    const prepare = page.getByRole('button', {
      name: 'Preparar encerramento técnico',
      exact: true,
    });
    await expect(prepare).toBeEnabled();
    await prepare.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Justificativa do encerramento', { exact: true }).fill(closure.rationale);
    await page.getByRole('button', { name: 'Revisar encerramento', exact: true }).click();
    expect(state.posts).toBe(0);
    await expect(
      page.getByRole('heading', { name: 'Revise antes de confirmar', exact: true }),
    ).toBeFocused();
    expect(
      await textContrast(
        page.getByRole('heading', { name: 'Revise antes de confirmar', exact: true }),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await textContrast(
        page.getByRole('button', { name: 'Confirmar e registrar encerramento', exact: true }),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    await reflow(page);
    await page.screenshot({
      path: resolve(evidenceDirectory, `closure-${theme}-desktop-review.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(evidenceDirectory, `closure-${theme}-mobile-review.png`),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Confirmar e registrar encerramento', exact: true })
      .click();
    const context = page.getByRole('complementary', { name: 'Contexto da ação', exact: true });
    await expect(context.getByText('Encerramento vigente', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consultar encerramento 1', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Decisão de encerramento 1' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Preparar nova ação corretiva', exact: true }).click();
    await page
      .getByLabel('Motivo da ação corretiva', { exact: true })
      .fill('Acompanhar a medida com nova intervenção coletiva sintética.');
    for (const [label, value] of [
      ['Título da medida', action.title],
      ['Descrição da medida', action.description],
      ['Responsável nominal', action.responsibleName],
      ['Prazo', action.dueDate],
      ['Resultado esperado', action.expectedResult],
      ['Critério de aferição', action.verificationCriterion],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Revisar nova ação corretiva', exact: true }).click();
    expect(state.posts).toBe(1);
    await reflow(page);
    await page.screenshot({
      path: resolve(evidenceDirectory, `corrective-${theme}-desktop-review.png`),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Confirmar e criar ação corretiva', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Abrir nova ação corretiva', exact: true }),
    ).toHaveAttribute('href', `#/acoes/${nextId}`);
    expect(state.posts).toBe(2);
    expect(errors).toEqual([]);
  });
}
