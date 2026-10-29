import { expect, test, type Locator } from '@playwright/test';
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

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgba = (value: string) => {
      if (!/^rgba?\(/.test(value)) throw new Error('Unsupported rendered color');
      const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    const over = (color: number[], background: number[]) =>
      color
        .slice(0, 3)
        .map((channel, index) => channel * color[3]! + background[index]! * (1 - color[3]!));
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    let background = [255, 255, 255];
    for (const node of chain)
      background = over(rgba(getComputedStyle(node).backgroundColor), background);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) =>
      color
        .map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const fg = luminance(foreground),
      bg = luminance(background);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`evidências ${theme}: recupera envio incerto, conserva arquivo e consulta usos em mobile`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    let key = '';
    let posts = 0;
    let complete = false;
    const proof = {
      id: org,
      organizationId: org,
      actionId: id,
      description: 'Registro documental coletivo sintético para acompanhamento.',
      fileName: 'Registro-coletivo-sintético.pdf',
      mimeType: 'application/pdf',
      size: 8,
      sha256: 'a'.repeat(64),
      createdBy: author,
      createdAt: stamp,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      actionVersion: 3,
    };
    const pageOf = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.endsWith('/evidence')) {
        posts += 1;
        key = request.headers()['idempotency-key'] ?? '';
        return route.fulfill({ status: 503, json: {} });
      }
      let data: unknown = pageOf([]);
      if (path.includes('/upload-attempts/')) {
        complete = true;
        data = {
          key,
          organizationId: org,
          actionId: id,
          state: 'COMPLETED',
          attemptVersion: 2,
          description: proof.description,
          fileName: proof.fileName,
          mimeType: proof.mimeType,
          size: proof.size,
          sha256: proof.sha256,
          createdAt: stamp,
          updatedAt: stamp,
          leaseExpiresAt: null,
          currentActionVersion: 3,
          retryAllowed: false,
          objectState: 'PRESENT',
          evidence: proof,
        };
      } else if (path.endsWith('/health'))
        data = { status: 'ok', service: 'renr-api', timestamp: stamp };
      else if (path.endsWith('/auth/session'))
        data = {
          user: { ...author, email: 'sintetico@example.test' },
          memberships: [
            { organizationId: org, organizationName: 'Empresa sintética', role: 'ADMIN' },
          ],
          activeOrganizationId: org,
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      else if (path.endsWith('/auth/session-capabilities'))
        data = { organizationId: org, capabilities: [] };
      else if (path.endsWith('/efficacy')) data = operationalEfficacyContext(action);
      else if (path.endsWith('/closure-context')) data = operationalClosureContext(action);
      else if (path.endsWith(`/action-workspaces/${id}`) || path.endsWith(`/actions/${id}`))
        data = {
          ...action,
          version: complete ? 3 : 2,
          ...extras,
          risk: { id, factor: contextSnapshot.factor },
        };
      else if (path.endsWith('/evidence')) data = pageOf(complete ? [proof] : []);
      else if (path.endsWith('/usage'))
        data = {
          evidenceId: org,
          opinionTotal: 1,
          closureTotal: 0,
          items: [{ kind: 'OPINION', id, sequence: 1, createdAt: stamp }],
          total: 1,
          page: 1,
          pageSize: 20,
        };
      await route.fulfill({ json: data });
    });
    await page.goto(`/#/acoes/${id}`);
    await page.getByLabel('Descrição da evidência', { exact: true }).fill(proof.description);
    await page.getByLabel('Arquivo da evidência', { exact: true }).setInputFiles({
      name: proof.fileName,
      mimeType: proof.mimeType,
      buffer: Buffer.from('%PDF-1.7'),
    });
    await page.getByRole('button', { name: 'Enviar evidência', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Resultado incerto');
    const errorContrast = await contrast(page.getByRole('alert'));
    expect(errorContrast).toBeGreaterThanOrEqual(4.5);
    await expect(
      page.getByRole('button', { name: 'Enviar evidência', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Atualizar evidências e versão', exact: true }).click();
    await expect(page.getByLabel('Descrição da evidência', { exact: true })).toHaveValue(
      proof.description,
    );
    expect(
      await page
        .getByLabel('Arquivo da evidência', { exact: true })
        .evaluate((element) => (element as HTMLInputElement).files?.[0]?.name),
    ).toBe(proof.fileName);
    const consult = page.getByRole('button', { name: 'Consultar tentativa de envio', exact: true });
    await consult.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Evidência recuperada; envio confirmado no histórico.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(proof.fileName, { exact: true })).toBeVisible();
    const successContrast = await contrast(
      page.getByText('Evidência recuperada; envio confirmado no histórico.', { exact: true }),
    );
    const labelContrast = await contrast(page.getByText('Descrição da evidência', { exact: true }));
    const controlContrast = await contrast(
      page.getByRole('button', { name: 'Enviar evidência', exact: true }),
    );
    for (const ratio of [successContrast, labelContrast, controlContrast])
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    await info.attach(`contrastes-evidencias-${theme}`, {
      body: Buffer.from(
        JSON.stringify({ errorContrast, successContrast, labelContrast, controlContrast }),
      ),
      contentType: 'application/json',
    });
    expect(posts).toBe(1);
    await page.getByRole('button', { name: 'Arquivar evidência', exact: true }).click();
    await expect(page.getByText(/1 parecer.*0 encerramento/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirmar arquivamento da evidência', exact: true }),
    ).toBeEnabled();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('form', { name: 'Arquivar evidência', exact: true })
      .scrollIntoViewIfNeeded();
    const target = await page
      .getByRole('button', { name: 'Confirmar arquivamento da evidência', exact: true })
      .boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`evidence-${theme}.png`), fullPage: true });
    await page.screenshot({ path: info.outputPath(`evidence-${theme}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('form', { name: 'Arquivar evidência', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`evidence-${theme}-desktop.png`) });
  });
}
