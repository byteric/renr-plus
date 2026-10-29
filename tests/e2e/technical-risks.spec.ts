import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  accessMembershipSchema,
  evaluationMethodVersionSchema,
  organizationListSchema,
  organizationSchema,
  riskDetailSchema,
  riskMatrixSchema,
  riskSourceOptionListSchema,
  riskWorkspaceSchema,
  sectorSchema,
  sessionResponseSchema,
  technicalRiskEvaluationListSchema,
  technicalRiskEvaluationSchema,
  unitSchema,
  type EvaluationMethodVersion,
  type MethodDefinition,
  type RiskDetail,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
const api = (organizationId: string, tail: string) =>
  `/api/v1/organizations/${organizationId}/${tail}`;

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { headers, data });
  expect(response.status()).toBe(201);
  return response.json();
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}

type Fixture = { organizationId: string; sectorId: string; prefix: string; risks: RiskDetail[] };
const test = base.extend<{ technicalFixture: Fixture }>({
  technicalFixture: async ({ page }, use) => {
    await login(page);
    const prefix = `e2e-technical-${randomUUID().slice(0, 8)}`;
    const organization = organizationSchema.parse(
      await post(page.request, '/api/v1/organizations', {
        name: `${prefix} organização sintética`,
        fiscalIdentifier: null,
        timezone: 'America/Sao_Paulo',
      }),
    );
    const risks: RiskDetail[] = [];
    try {
      expect(
        (
          await page.request.put('/api/v1/auth/session/organization', {
            headers,
            data: { organizationId: organization.id },
          })
        ).status(),
      ).toBe(200);
      const session = sessionResponseSchema.parse(
        await (await page.request.get('/api/v1/auth/session')).json(),
      );
      const membershipPath = api(organization.id, `access-memberships/${session.user.id}`);
      const membership = accessMembershipSchema.parse(
        await (await page.request.get(membershipPath)).json(),
      );
      expect(
        (
          await page.request.put(`${membershipPath}/capabilities`, {
            headers,
            data: {
              expectedVersion: membership.version,
              capabilities: ['TECHNICAL_DECISIONS'],
              reason: 'Capacidade sintética restrita à organização deste E2E.',
            },
          })
        ).status(),
      ).toBe(200);
      const unit = unitSchema.parse(
        await post(page.request, api(organization.id, 'units'), {
          name: `${prefix} unidade sintética`,
          code: null,
        }),
      );
      const sector = sectorSchema.parse(
        await post(page.request, `/api/v1/units/${unit.id}/sectors`, {
          name: `${prefix} setor sintético`,
        }),
      );
      await use({ organizationId: organization.id, sectorId: sector.id, prefix, risks });
    } finally {
      // Exact owned IDs only. Published methods and evaluation history remain append-only.
      for (const owned of risks) {
        const response = await page.request.get(api(organization.id, `risks/${owned.id}`));
        expect(response.status()).toBe(200);
        const current = riskDetailSchema.parse(await response.json());
        expect(current.organizationId).toBe(organization.id);
        expect(current.factor.startsWith(prefix)).toBe(true);
        if (current.status !== 'ARCHIVED')
          expect(
            (
              await page.request.patch(api(organization.id, `risks/${current.id}`), {
                headers,
                data: { status: 'ARCHIVED', expectedVersion: current.version },
              })
            ).status(),
          ).toBe(200);
      }
      const organizationsResponse = await page.request.get(
        `/api/v1/organizations?search=${encodeURIComponent(prefix)}`,
      );
      expect(organizationsResponse.status()).toBe(200);
      const currentOrganization = organizationListSchema
        .parse(await organizationsResponse.json())
        .items.find((item) => item.id === organization.id);
      expect(currentOrganization?.name).toBe(organization.name);
      expect(
        (
          await page.request.patch(`/api/v1/organizations/${organization.id}`, {
            headers,
            data: { isActive: false },
          })
        ).status(),
      ).toBe(200);
      expect([204, 401]).toContain(
        (await page.request.delete('/api/v1/auth/session', { headers })).status(),
      );
    }
  },
});

// Credentials and session cookies must never enter browser traces, videos or screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

function definition(levelLabel: string): MethodDefinition {
  const probability = [1, 2].map((position) => ({
    key: `p${position}`,
    label: `Probabilidade sintética ${position}`,
    description: 'Critério inventado exclusivamente para este teste.',
    position,
  }));
  const severity = [1, 2, 3].map((position) => ({
    key: `s${position}`,
    label: `Severidade sintética ${position}`,
    description: 'Critério inventado exclusivamente para este teste.',
    position,
  }));
  return {
    probability,
    severity,
    levels: [
      { key: 'explicit', label: levelLabel },
      { key: 'other', label: 'Outra classe sintética' },
    ],
    priorities: [
      { key: 'first', label: 'Prioridade sintética A', rank: 1 },
      { key: 'second', label: 'Prioridade sintética B', rank: 2 },
    ],
    matrix: probability.flatMap((p) =>
      severity.map((s) => ({
        probabilityKey: p.key,
        severityKey: s.key,
        levelKey: p.key === 'p2' && s.key === 's3' ? 'explicit' : 'other',
        priorityKey: p.key === 'p2' && s.key === 's3' ? 'first' : 'second',
      })),
    ),
  };
}

async function publish(
  page: Page,
  fixture: Fixture,
  version: EvaluationMethodVersion,
  levelLabel: string,
) {
  const path = api(fixture.organizationId, `evaluation-method-versions/${version.id}`);
  const response = await page.request.put(path, {
    headers,
    data: {
      expectedRevision: version.revision,
      title: `${fixture.prefix} método 2×3 v${version.version}`,
      description:
        'Escalas e classificações sintéticas, sem validação normativa ou aprovação ReTech.',
      definition: definition(levelLabel),
    },
  });
  expect(response.status()).toBe(200);
  const draft = evaluationMethodVersionSchema.parse(await response.json());
  return evaluationMethodVersionSchema.parse(
    await post(page.request, `${path}/publish`, {
      expectedRevision: draft.revision,
      approvalReference: `APROVAÇÃO SINTÉTICA E2E ${fixture.prefix}: exclusiva do banco de teste, sem aprovação técnica real.`,
    }),
  );
}

async function createRisk(page: Page, fixture: Fixture, suffix: string) {
  const risk = riskDetailSchema.parse(
    await post(page.request, api(fixture.organizationId, 'risks'), {
      sectorId: fixture.sectorId,
      factor: `${fixture.prefix} ${suffix}`,
      status: 'REGISTERED',
      description: 'Descrição inteiramente sintética da organização coletiva de tarefas.',
      exposureDescription: 'Exposição coletiva fictícia criada somente para verificar o fluxo.',
      exposedGroupDescription: 'Grupo coletivo sintético do E2E.',
      possibleHarms: 'Agravos hipotéticos de teste.',
      existingControls: 'Controles hipotéticos sem alegação de eficácia.',
      sourceKind: 'TECHNICAL_RECORD',
      sourceNote: 'Registro contextual sintético, sem laudo ou aprovação técnica real.',
    }),
  );
  fixture.risks.push(risk);
  return risk;
}

async function matrix(page: Page, fixture: Fixture, versionId: string) {
  const response = await page.request.get(
    api(
      fixture.organizationId,
      `risk-workspaces/matrix?methodVersionId=${versionId}&q=${fixture.prefix}&page=2&pageSize=1`,
    ),
  );
  expect(response.status()).toBe(200);
  return riskMatrixSchema.parse(await response.json());
}

test('método sintético 2×3 sustenta avaliação real, versões imutáveis e matriz sem misturas', async ({
  page,
  technicalFixture: fixture,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (testInfo.project.name === 'desktop')
    await page.setViewportSize({ width: 1440, height: 1000 });
  const created = evaluationMethodVersionSchema.parse(
    await post(page.request, api(fixture.organizationId, 'evaluation-methods'), {
      name: `${fixture.prefix} catálogo sintético`,
      description: 'Catálogo criado pelo E2E; não pertence ao seed normal.',
    }),
  );
  const firstVersion = await publish(page, fixture, created, 'Classe sintética original');
  expect(firstVersion.definition.matrix).toHaveLength(6);
  const evaluated = await createRisk(page, fixture, 'risco avaliado');
  await createRisk(page, fixture, 'risco sem avaliação');
  const listUrl = `/#/inventario?q=${fixture.prefix}`;
  await page.goto(listUrl);
  await page.reload();
  const origin = page.getByRole('link', { name: evaluated.factor, exact: true });
  await origin.click();
  const panel = page.getByRole('complementary', { name: 'Contexto do risco selecionado' });
  await expect(panel.getByRole('heading', { name: evaluated.factor, exact: true })).toBeVisible();
  if (testInfo.project.name === 'desktop') await expect(origin).toBeVisible();
  else await expect(origin).not.toBeVisible();
  await panel.getByRole('button', { name: 'Registrar avaliação técnica', exact: true }).click();
  await panel.getByLabel('Método publicado', { exact: true }).selectOption(firstVersion.id);
  await panel.getByLabel('Probabilidade', { exact: true }).selectOption({
    label: 'Probabilidade sintética 2 — Critério inventado exclusivamente para este teste.',
  });
  await panel.getByLabel('Severidade', { exact: true }).selectOption({
    label: 'Severidade sintética 3 — Critério inventado exclusivamente para este teste.',
  });
  await panel
    .getByLabel('Justificativa técnica', { exact: true })
    .fill('Justificativa sintética observada no contexto coletivo deste teste E2E.');
  await panel
    .getByLabel('Contexto da avaliação', { exact: true })
    .fill('Contexto inteiramente sintético preservado para a avaliação da versão original.');
  const sourcesResponse = await page.request.get(
    api(fixture.organizationId, `risk-workspaces/${evaluated.id}/source-options`),
  );
  expect(sourcesResponse.status()).toBe(200);
  const source = riskSourceOptionListSchema
    .parse(await sourcesResponse.json())
    .items.find(
      (entry) => entry.kind === 'RISK_RECORD' && entry.id === evaluated.id && entry.eligible,
    );
  expect(source).toBeDefined();
  await panel.getByRole('checkbox', { name: source!.label, exact: true }).check();
  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/risk-workspaces/${evaluated.id}/technical-evaluations`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Confirmar avaliação técnica', exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const evaluation = technicalRiskEvaluationSchema.parse(await saved.json());
  expect(evaluation).toMatchObject({
    method: { versionId: firstVersion.id, version: 1 },
    probability: { key: 'p2', label: 'Probabilidade sintética 2' },
    severity: { key: 's3', label: 'Severidade sintética 3' },
    level: { key: 'explicit', label: 'Classe sintética original' },
    priority: { key: 'first', label: 'Prioridade sintética A' },
  });
  await expect(
    panel.getByText('Avaliação técnica registrada e confirmada pelo serviço.', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(/Avaliação mais recente: Classe sintética original/)).toBeVisible();
  await panel.getByRole('link', { name: /Voltar ao inventário/ }).click();
  await expect(page).toHaveURL((url) => url.hash === `#/inventario?q=${fixture.prefix}`);
  await expect(origin).toBeFocused();
  const current = riskWorkspaceSchema.parse(
    await (
      await page.request.get(api(fixture.organizationId, `risk-workspaces/${evaluated.id}`))
    ).json(),
  );
  expect(current.technicalEvaluationState).toBe('CURRENT');
  expect(current.latestTechnicalEvaluation?.id).toBe(evaluation.id);
  const initial = await matrix(page, fixture, firstVersion.id);
  expect(initial).toMatchObject({
    totalMatched: 2,
    classifiedTotal: 1,
    excluded: { unclassified: 1, incompatible: 0 },
  });
  expect(
    initial.cells.find((cell) => cell.probabilityKey === 'p2' && cell.severityKey === 's3')?.count,
  ).toBe(1);

  const fork = evaluationMethodVersionSchema.parse(
    await post(
      page.request,
      api(fixture.organizationId, `evaluation-method-versions/${firstVersion.id}/fork`),
      { expectedRevision: firstVersion.revision },
    ),
  );
  const secondVersion = await publish(page, fixture, fork, 'Classe sintética revisada');
  const secondRisk = await createRisk(page, fixture, 'risco avaliado na nova versão');
  await post(
    page.request,
    api(fixture.organizationId, `risk-workspaces/${secondRisk.id}/technical-evaluations`),
    {
      expectedVersion: secondRisk.version,
      methodVersionId: secondVersion.id,
      probabilityKey: 'p2',
      severityKey: 's3',
      rationale: 'Justificativa sintética exclusiva da nova versão publicada.',
      context: 'Contexto sintético da nova versão, sem alteração retroativa.',
      sources: [{ kind: 'RISK_RECORD', id: secondRisk.id }],
    },
  );
  const history = technicalRiskEvaluationListSchema.parse(
    await (
      await page.request.get(
        api(fixture.organizationId, `risk-workspaces/${evaluated.id}/technical-evaluations`),
      )
    ).json(),
  );
  expect(history.items).toHaveLength(1);
  expect(history.items[0]).toEqual(evaluation);
  const originalAfterPublication = evaluationMethodVersionSchema.parse(
    await (
      await page.request.get(
        api(fixture.organizationId, `evaluation-method-versions/${firstVersion.id}`),
      )
    ).json(),
  );
  expect(originalAfterPublication).toEqual(firstVersion);
  for (const version of [firstVersion, secondVersion]) {
    const result = await matrix(page, fixture, version.id);
    expect(result).toMatchObject({
      methodVersion: { id: version.id },
      totalMatched: 3,
      classifiedTotal: 1,
      excluded: {
        unclassified: 1,
        incompatible: 1,
        contextChanged: 0,
        inactiveScope: 0,
        notRegistered: 0,
      },
    });
    expect(result.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(1);
  }
  await page.getByRole('link', { name: 'Matriz', exact: true }).click();
  await page
    .getByLabel('Método publicado e versão da matriz', { exact: true })
    .selectOption(firstVersion.id);
  await expect(
    page.getByText('1 classificados de 3 registros no recorte.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('rowheader', { name: 'Probabilidade sintética 2', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Severidade sintética 3', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', {
      name: '1 Classe sintética original · Prioridade sintética A',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Método ou versão incompatível', { exact: true })).toBeVisible();
  await page
    .getByLabel('Método publicado e versão da matriz', { exact: true })
    .selectOption(secondVersion.id);
  await expect(
    page.getByRole('cell', {
      name: '1 Classe sintética revisada · Prioridade sintética A',
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
