import { expect, test } from '@playwright/test';
import { operationalEfficacyContext } from '../../apps/web/src/components/actions/ActionEfficacy.fixtures';
import { operationalClosureContext } from '../../apps/web/src/components/actions/technical-closure.fixtures';

const org = '10000000-0000-4000-8000-000000000001';
const id = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-25T12:00:00.000Z';
const author = { id: org, name: 'Equipe sintética de acompanhamento' };
const scope = { id: org, name: 'Atendimento e organização de demandas coletivas', isActive: true };
const contextSnapshot = {
  factor: 'Organização das tarefas e distribuição das demandas',
  description: 'Contexto coletivo inteiramente sintético para validação.',
  exposureDescription: 'Exposição coletiva sintética',
  exposedGroupDescription: 'Equipe de atendimento',
  possibleHarms: 'Agravos descritos no registro',
  existingControls: 'Controles preventivos existentes',
  sourceKind: 'TECHNICAL_RECORD',
  sourceNote: 'Origem sintética para verificação de interface.',
  diagnosticCycleId: null,
  sectorId: org,
  assessmentGroupId: org,
  unit: scope,
  sector: scope,
  status: 'REGISTERED',
};
const action = {
  id,
  organizationId: org,
  riskId: id,
  title: 'Reorganizar a distribuição de demandas da equipe de atendimento',
  description:
    'Rever a distribuição das tarefas com a equipe, registrar os critérios e acompanhar as mudanças implementadas.',
  responsibleName: 'Responsável nominal externo pela coordenação das medidas',
  dueDate: '2026-10-20',
  expectedResult: 'Distribuição documentada e validada com a equipe.',
  verificationCriterion:
    'Comparar os registros de distribuição e os relatos da equipe no acompanhamento.',
  status: 'IN_PROGRESS',
  implementationNote: null,
  implementedAt: null,
  version: 2,
  sourceRiskVersion: 1,
  evaluationId: null,
  contextSnapshot,
  currentOrigin: {
    riskStatus: 'REGISTERED',
    organizationActive: true,
    unitActive: true,
    sectorActive: true,
  },
  createdBy: author,
  updatedBy: author,
  createdAt: stamp,
  updatedAt: stamp,
  isOverdue: true,
  referenceDate: '2026-10-25',
  timeZone: 'America/Sao_Paulo',
};
const permissions = {
  canManage: true,
  canExecute: true,
  canNote: true,
  canUploadEvidence: true,
  canArchiveEvidence: true,
};
const extras = {
  assignedUser: {
    userId: org,
    name: 'Membro atribuído ao acompanhamento operacional',
    currentName: 'Membro atribuído ao acompanhamento operacional',
    isActive: true,
  },
  riskContext: {
    unit: scope,
    sector: scope,
    contextMatches: true,
    technicalEvaluationState: 'CURRENT',
    priority: {
      key: 'high',
      label: 'Alta',
      rank: 3,
      methodVersionId: org,
      methodName: 'Método técnico sintético',
      methodVersion: 1,
    },
  },
  evidenceSummary: { active: 0, archived: 0 },
  pendingReasons: ['OVERDUE', 'NO_EVIDENCE'],
  permissions,
};
const listItem = {
  id,
  organizationId: org,
  riskId: id,
  title: action.title,
  risk: { id, factor: contextSnapshot.factor },
  responsibleName: action.responsibleName,
  dueDate: action.dueDate,
  status: action.status,
  version: action.version,
  isOverdue: action.isOverdue,
  referenceDate: action.referenceDate,
  timeZone: action.timeZone,
  ...extras,
};
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 50, total: items.length });

for (const theme of ['light', 'dark'] as const) {
  test(`ações ${theme}: filtros, retorno, detalhe e reflow`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = pageOf([]);
      if (path.endsWith('/health')) data = { status: 'ok', service: 'renr-api', timestamp: stamp };
      else if (path.endsWith('/auth/session'))
        data = {
          user: { ...author, email: 'sintetico@example.test' },
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
      else if (path.endsWith('/auth/session-capabilities'))
        data = { organizationId: org, capabilities: [] };
      else if (path.endsWith('/efficacy')) data = operationalEfficacyContext(action);
      else if (path.endsWith('/closure-context')) data = operationalClosureContext(action);
      else if (path.endsWith(`/action-workspaces/${id}`))
        data = { ...action, ...extras, risk: listItem.risk };
      else if (path.endsWith('/action-workspaces')) data = pageOf([listItem]);
      else if (path.endsWith('/action-assignees'))
        data = pageOf([{ userId: org, name: extras.assignedUser.name, canExecute: true }]);
      await route.fulfill({ json: data });
    });
    await page.goto('/#/acoes?assignedTo=me&overdue=true&page=1');
    const title = page.getByRole('link', { name: action.title, exact: true });
    await expect(title).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Minhas ações', exact: true })).toBeChecked();
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(title).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeFocused();
    await expect(page.getByText('Alta', { exact: true })).toBeVisible();
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const main = await page.locator('.action-main').boundingBox();
      const context = await page
        .getByRole('complementary', { name: 'Contexto da ação' })
        .boundingBox();
      expect(main).not.toBeNull();
      expect(context).not.toBeNull();
      if (width >= 1280) expect(context!.x).toBeGreaterThan(main!.x + main!.width);
      else expect(context!.y).toBeGreaterThan(main!.y);
    }
    await page.screenshot({
      path: info.outputPath(`actions-${theme}-desktop.png`),
      fullPage: true,
    });
    // CSS zoom exercises enlarged content; native browser zoom remains a separate check.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(
      page.getByRole('button', { name: 'Informar implementação', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Informar implementação', exact: true }).click();
    await page
      .getByLabel('Relato de implementação', { exact: true })
      .fill('Relato operacional sintético preservado para revisão.');
    await page.getByRole('button', { name: 'Atualizar ação', exact: true }).click();
    await expect(page.getByLabel('Relato de implementação', { exact: true })).toHaveValue(
      'Relato operacional sintético preservado para revisão.',
    );
    await page.screenshot({ path: info.outputPath(`actions-${theme}-mobile.png`), fullPage: true });
    await page.getByRole('link', { name: '← Voltar às ações', exact: true }).click();
    await expect(page).toHaveURL(/assignedTo=me&overdue=true&page=1/);
    await expect(page.getByRole('link', { name: action.title, exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`eficácia ${theme}: preparação, provas, revisão e confirmação`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const implemented = {
      ...action,
      status: 'IMPLEMENTED',
      implementedAt: stamp,
      implementationNote:
        'Distribuição revisada com a equipe e registros preservados para aferição.',
    };
    const context = {
      ...operationalEfficacyContext(implemented),
      permissions: { hasTechnicalCapability: true, canRecord: true },
      blockingReasons: [],
    };
    const proof = {
      id: org,
      organizationId: org,
      actionId: id,
      fileName: 'Relatório coletivo sintético.pdf',
      description: 'Registro documental sintético da distribuição coletiva.',
      mimeType: 'application/pdf',
      size: 128,
      sha256: 'd'.repeat(64),
      createdBy: author,
      createdAt: stamp,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      actionVersion: 2,
    };
    let posts = 0;
    let saved = false;
    const currentOpinion = {
      id: org,
      organizationId: org,
      actionId: id,
      riskId: id,
      sequence: 2,
      supersedesId: id,
      actionVersion: 2,
      actionRevisionId: id,
      actionSnapshot: context.actionSnapshot,
      riskContextSnapshot: context.riskContextSnapshot,
      actionFingerprint: context.actionFingerprint,
      riskContextFingerprint: context.riskContextFingerprint,
      contextFingerprint: context.contextFingerprint,
      criterionReference: action.verificationCriterion,
      result: 'INCONCLUSIVE',
      verifiedOn: action.referenceDate,
      observation:
        'Os registros permitem observar a distribuição, mas o período de acompanhamento ainda é curto.',
      rationale:
        'A janela de observação precisa ser ampliada para comparar a estabilidade dos resultados.',
      nextSteps: 'Repetir a aferição após novo período de acompanhamento coletivo.',
      proofPackage: {
        files: [
          {
            id: proof.id,
            fileName: proof.fileName,
            description: proof.description,
            mimeType: proof.mimeType,
            size: proof.size,
            sha256: proof.sha256,
          },
        ],
        texts: [],
      },
      author,
      createdAt: stamp,
      validity: 'CURRENT',
      reviewReasons: [],
    };
    const earlier = {
      ...currentOpinion,
      id,
      sequence: 1,
      supersedesId: null,
      result: 'EFFECTIVE',
      validity: 'SUPERSEDED',
      observation:
        'Observação sintética preservada do primeiro parecer, anterior ao acompanhamento atual.',
      rationale:
        'Justificativa sintética preservada para consultar a decisão anterior no seu contexto.',
    };
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      let data: unknown = pageOf([]);
      let status = 200;
      if (path.endsWith('/health')) data = { status: 'ok', service: 'renr-api', timestamp: stamp };
      else if (path.endsWith('/auth/session'))
        data = {
          user: { ...author, email: 'sintetico@example.test' },
          memberships: [
            {
              organizationId: org,
              organizationName: 'Empresa sintética de prevenção',
              role: 'READER',
            },
          ],
          activeOrganizationId: org,
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      else if (path.endsWith('/auth/session-capabilities'))
        data = { organizationId: org, capabilities: ['TECHNICAL_DECISIONS'] };
      else if (path.endsWith(`/action-workspaces/${id}`))
        data = { ...implemented, ...extras, risk: listItem.risk };
      else if (path.endsWith('/efficacy'))
        data = saved ? { ...context, state: 'CURRENT', latest: currentOpinion } : context;
      else if (path.endsWith('/closure-context'))
        data = {
          ...operationalClosureContext(implemented),
          efficacy: saved ? { ...context, state: 'CURRENT', latest: currentOpinion } : context,
          permissions: {
            hasTechnicalCapability: true,
            canClose: false,
            canCreateCorrective: false,
          },
          blockingReasons: ['NO_CURRENT_EFFECTIVE_OPINION', 'NO_CURRENT_REASSESSMENT'],
        };
      else if (path.endsWith('/efficacy-opinions')) {
        if (request.method() === 'POST') {
          posts += 1;
          saved = true;
          status = 201;
          data = currentOpinion;
        } else data = { ...pageOf(saved ? [currentOpinion, earlier] : []), pageSize: 20 };
      } else if (path.includes('/efficacy-opinions/'))
        data = path.endsWith(`/${earlier.id}`) ? earlier : currentOpinion;
      else if (path.endsWith('/evidence'))
        data = {
          ...pageOf(
            url.searchParams.get('page') === '2'
              ? [{ ...proof, id }]
              : [
                  proof,
                  {
                    ...proof,
                    id,
                    fileName: 'Arquivo arquivado.pdf',
                    archivedAt: stamp,
                    archivedBy: author,
                    archiveReason: 'Registro substituído',
                  },
                ],
          ),
          total: 51,
          page: Number(url.searchParams.get('page') ?? 1),
        };
      await route.fulfill({ json: data, status });
    });
    await page.goto(`/#/acoes/${id}`);
    const prepare = page.getByRole('button', { name: 'Preparar análise de eficácia', exact: true });
    await prepare.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Observação técnica', { exact: true }).fill(currentOpinion.observation);
    await page
      .getByLabel('Justificativa do parecer', { exact: true })
      .fill(currentOpinion.rationale);
    await page
      .getByLabel('Próximos passos (obrigatório)', { exact: true })
      .fill(currentOpinion.nextSteps);
    await expect(page.getByRole('checkbox', { name: /Arquivo arquivado/ })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /Relatório coletivo/ }).check();
    await page
      .getByRole('navigation', { name: 'Paginação de provas' })
      .getByRole('button', { name: 'Próxima página' })
      .click();
    await expect(
      page.getByText('Selecionados: Relatório coletivo sintético.pdf', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Adicionar prova textual', exact: true }).click();
    await page
      .getByLabel('Referência identificada 1', { exact: true })
      .fill('Ata coletiva sintética 01');
    await page
      .getByLabel('Descrição da prova 1', { exact: true })
      .fill('Registro identificado da reunião coletiva e dos critérios de distribuição.');
    await page
      .getByLabel('Justificativa da prova 1', { exact: true })
      .fill('Permite comparar o resultado observado com o critério previsto.');
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('button', { name: 'Revisar resumo do parecer', exact: true }).click();
    expect(posts).toBe(0);
    await expect(page.getByLabel('Observação técnica', { exact: true })).toBeDisabled();
    const confirm = page.getByRole('button', {
      name: 'Confirmar e registrar parecer',
      exact: true,
    });
    for (const width of [320, 375, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({
      path: info.outputPath(`efficacy-${theme}-review-desktop.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Parecer de eficácia registrado/)).toBeVisible();
    expect(posts).toBe(1);
    await expect(
      page
        .getByRole('complementary', { name: 'Contexto da ação' })
        .getByText('Inconclusivo · Vigente', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Substituído por parecer posterior', { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText(currentOpinion.observation, { exact: true })).toHaveCount(1);
    await expect(page.getByText(earlier.observation, { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`efficacy-${theme}-history-mobile.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Consultar parecer 1', exact: true }).click();
    await expect(page.getByText(earlier.observation, { exact: true })).toBeVisible();
    await expect(page.getByText(earlier.rationale, { exact: true })).toBeVisible();
    await expect(page.getByText('Substituído por parecer posterior', { exact: true })).toHaveCount(
      2,
    );
    expect(errors).toEqual([]);
  });
}
