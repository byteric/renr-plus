import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  organizationSchema,
  unitSchema,
  sectorSchema,
  riskDetailSchema,
  actionDetailSchema,
  accessMembershipSchema,
  sessionResponseSchema,
  evaluationMethodVersionSchema,
  technicalRiskEvaluationSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  evidenceSchema,
  riskSourceOptionListSchema,
  riskReassessmentSchema,
  riskReassessmentListSchema,
  technicalClosureSchema,
  technicalClosureContextSchema,
  technicalClosureListSchema,
  correctiveActionCreatedSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
// Synthetic accounts only; no credentials, cookies or private data in retained artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}

test('reavaliação e encerramento explícitos preservam origem, provas e continuidade', async ({
  page,
}) => {
  test.setTimeout(120000);
  const label = `e2e-continuity-${randomUUID().slice(0, 8)}`;
  await login(page);
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers, data });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const org = organizationSchema.parse(
    await post('/api/v1/organizations', {
      name: label,
      timezone: 'America/Sao_Paulo',
    }),
  );
  const api = `/api/v1/organizations/${org.id}`;
  let riskId: string | undefined;
  let correctiveId: string | undefined;

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    expect(
      (
        await page.request.put('/api/v1/auth/session/organization', {
          headers,
          data: { organizationId: org.id },
        })
      ).status(),
    ).toBe(200);
    const session = sessionResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/session')).json(),
    );
    const memberPath = `${api}/access-memberships/${session.user.id}`;
    const membership = accessMembershipSchema.parse(
      await (await page.request.get(memberPath)).json(),
    );
    expect(
      (
        await page.request.put(`${memberPath}/capabilities`, {
          headers,
          data: {
            expectedVersion: membership.version,
            capabilities: ['TECHNICAL_DECISIONS'],
            reason: 'Capacidade sintética exclusiva da organização isolada IDs17 e18.',
          },
        })
      ).status(),
    ).toBe(200);
    const unit = unitSchema.parse(await post(`${api}/units`, { name: `${label} Unidade` }));
    const sector = sectorSchema.parse(
      await post(`/api/v1/units/${unit.id}/sectors`, { name: `${label} Setor` }),
    );
    const risk = riskDetailSchema.parse(
      await post(`${api}/risks`, {
        sectorId: sector.id,
        factor: `${label} Origem`,
        status: 'REGISTERED',
        description: 'Organização coletiva de tarefas inteiramente sintética.',
        exposureDescription: 'Exposição coletiva sintética',
        exposedGroupDescription: 'Equipe sintética',
        possibleHarms: 'Agravos hipotéticos de teste',
        existingControls: 'Controles preventivos sintéticos',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Registro sintético sem certificação normativa.',
      }),
    );
    riskId = risk.id;
    const draft = evaluationMethodVersionSchema.parse(
      await post(`${api}/evaluation-methods`, {
        name: `${label} Método`,
        description: 'Método exclusivamente sintético para validação E2E.',
      }),
    );
    const editedResponse = await page.request.put(`${api}/evaluation-method-versions/${draft.id}`, {
      headers,
      data: {
        expectedRevision: draft.revision,
        title: `${label} Método v1`,
        description: 'Escalas sintéticas sem alegação de aprovação normativa.',
        definition: {
          probability: [
            {
              key: 'p',
              label: 'Probabilidade sintética',
              description: 'Critério sintético de teste',
              position: 1,
            },
          ],
          severity: [
            {
              key: 's',
              label: 'Severidade sintética',
              description: 'Critério sintético de teste',
              position: 1,
            },
          ],
          levels: [{ key: 'level', label: 'Classe sintética' }],
          priorities: [{ key: 'priority', label: 'Prioridade sintética', rank: 1 }],
          matrix: [
            { probabilityKey: 'p', severityKey: 's', levelKey: 'level', priorityKey: 'priority' },
          ],
        },
      },
    });
    expect(editedResponse.status()).toBe(200);
    const edited = evaluationMethodVersionSchema.parse(await editedResponse.json());
    const method = evaluationMethodVersionSchema.parse(
      await post(`${api}/evaluation-method-versions/${draft.id}/publish`, {
        expectedRevision: edited.revision,
        approvalReference: `APROVAÇÃO SINTÉTICA ${label}: somente E2E local, sem aprovação real.`,
      }),
    );
    const baseline = technicalRiskEvaluationSchema.parse(
      await post(`${api}/risk-workspaces/${risk.id}/technical-evaluations`, {
        expectedVersion: risk.version,
        methodVersionId: method.id,
        probabilityKey: 'p',
        severityKey: 's',
        rationale: 'Justificativa coletiva sintética da avaliação inicial.',
        context: 'Contexto inicial sintético preservado para comparação posterior.',
        sources: [{ kind: 'RISK_RECORD', id: risk.id }],
      }),
    );
    const content = {
      title: `${label} Medida`,
      description: 'Reorganizar a distribuição coletiva de tarefas sintéticas',
      responsibleName: 'Responsável externo sintético',
      dueDate: '2026-12-20',
      expectedResult: 'Distribuição coletiva documentada',
      verificationCriterion: 'Comparar registros coletivos antes e depois da medida',
    };
    const evaluatedRisk = riskDetailSchema.parse(
      await (await page.request.get(`${api}/risks/${risk.id}`)).json(),
    );
    let action = actionDetailSchema.parse(
      await post(`${api}/risks/${risk.id}/actions`, {
        ...content,
        expectedRiskVersion: evaluatedRisk.version,
      }),
    );
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED'] as const) {
      const response = await page.request.patch(`${api}/actions/${action.id}`, {
        headers,
        data: {
          expectedVersion: action.version,
          status,
          changeReason: 'Acompanhamento coletivo inteiramente sintético.',
          ...(status === 'IMPLEMENTED'
            ? { implementationNote: 'Equipe sintética informou execução da medida preventiva.' }
            : {}),
        },
      });
      expect(response.status()).toBe(200);
      action = actionDetailSchema.parse(await response.json());
    }
    const upload = await page.request.post(`${api}/actions/${action.id}/evidence`, {
      headers,
      multipart: {
        expectedVersion: String(action.version),
        description: 'Registro coletivo sintético para continuidade',
        file: {
          name: 'continuity-proof.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\nSynthetic continuity proof\n%%EOF'),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const evidence = evidenceSchema.parse(await upload.json());
    action = actionDetailSchema.parse(
      await (await page.request.get(`${api}/actions/${action.id}`)).json(),
    );
    const operationalVersion = action.version;
    async function recordOpinion(proofArchived = false) {
      const current = efficacyContextSchema.parse(
        await (await page.request.get(`${api}/actions/${action.id}/efficacy`)).json(),
      );
      return efficacyOpinionSchema.parse(
        await post(`${api}/actions/${action.id}/efficacy-opinions`, {
          expectedVersion: current.actionVersion,
          expectedLatestOpinionId: current.latest?.id ?? null,
          expectedContextFingerprint: current.contextFingerprint,
          result: 'EFFECTIVE',
          verifiedOn: current.referenceDate,
          observation: 'Observação sintética coletiva baseada nos registros de acompanhamento.',
          rationale: 'Justificativa sintética fundamentada na prova coletiva selecionada.',
          evidenceIds: proofArchived ? [] : [evidence.id],
          textualEvidence: proofArchived
            ? [
                {
                  reference: `${label} registro posterior`,
                  description:
                    'Registro coletivo sintético posterior ao arquivamento da prova anterior.',
                  rationale: 'Fonte textual identificada fundamenta o novo parecer sintético.',
                },
              ]
            : [],
        }),
      );
    }
    const opinion = await recordOpinion();
    await page.goto(`/#/inventario/${risk.id}`);
    await page.reload();
    const panel = page.getByRole('region', { name: 'Reavaliação do risco', exact: true });
    await panel.getByRole('button', { name: 'Preparar reavaliação do risco', exact: true }).click();
    await panel.getByRole('checkbox', { name: action.title, exact: true }).check();
    await panel.getByText(`Consultar parecer de ${action.title}`, { exact: true }).click();
    await expect(panel.getByText(opinion.observation, { exact: true })).toBeVisible();
    await expect(
      panel.getByText(`Prova: ${evidence.fileName} · ${evidence.description}`, { exact: true }),
    ).toBeVisible();
    const consideration =
      'Consideração sintética da medida implementada e do parecer eficaz vigente.';
    await panel.getByLabel(`Consideração de ${action.title}`, { exact: true }).fill(consideration);
    await panel.getByLabel('Método publicado', { exact: true }).selectOption(method.id);
    await panel.getByLabel('Probabilidade', { exact: true }).selectOption('p');
    await panel.getByLabel('Severidade', { exact: true }).selectOption('s');
    await panel
      .getByLabel('Justificativa técnica', { exact: true })
      .fill('Justificativa sintética explícita da reavaliação coletiva.');
    await panel
      .getByLabel('Contexto da avaliação', { exact: true })
      .fill('Contexto sintético posterior à medida sem redução numérica inventada.');
    const sources = riskSourceOptionListSchema.parse(
      await (await page.request.get(`${api}/risk-workspaces/${risk.id}/source-options`)).json(),
    );
    const source = sources.items.find(
      (item) => item.kind === 'RISK_RECORD' && item.id === risk.id && item.eligible,
    );
    expect(source).toBeDefined();
    await panel.getByRole('checkbox', { name: source!.label, exact: true }).check();
    await panel.getByRole('button', { name: 'Revisar avaliação e medidas', exact: true }).click();
    const review = panel.getByRole('region', { name: 'Revisão da reavaliação', exact: true });
    await expect(
      review.getByRole('heading', { name: 'Revise a reavaliação antes de confirmar', exact: true }),
    ).toBeFocused();
    await expect(review.getByText(/Predecessor: avaliação 1/)).toBeVisible();
    await expect(review.getByText(consideration, { exact: true })).toBeVisible();
    expect(
      riskReassessmentListSchema.parse(
        await (await page.request.get(`${api}/risk-workspaces/${risk.id}/reassessments`)).json(),
      ).total,
    ).toBe(0);
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/risk-workspaces/${risk.id}/reassessments`),
    );
    await review
      .getByRole('button', { name: 'Confirmar e registrar reavaliação', exact: true })
      .click();
    const saved = await saving;
    expect(saved.status()).toBe(201);
    expect(saved.headers()['cache-control']).toBe('private, no-store');
    const reassessment = riskReassessmentSchema.parse(await saved.json());
    expect(reassessment.previousEvaluation.id).toBe(baseline.id);
    expect(reassessment.comparison).toBe('COMPARABLE');
    expect(reassessment.measures[0]?.opinion.id).toBe(opinion.id);
    await expect(
      panel.getByText('Reavaliação registrada e confirmada pelo serviço.', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Consultar reavaliação 2', exact: true }).click();
    const reading = panel.getByRole('article', { name: 'Reavaliação consultada 2', exact: true });
    await expect(
      reading.getByRole('heading', { name: 'Anterior · avaliação 1', exact: true }),
    ).toBeVisible();
    await expect(
      reading.getByRole('heading', { name: 'Atual · avaliação 2', exact: true }),
    ).toBeVisible();
    await expect(
      reading.getByText('Comparável: mesma versão de método', { exact: true }),
    ).toBeVisible();
    await page.getByText('Histórico de avaliações técnicas', { exact: true }).click();
    const individual = page.waitForResponse((response) =>
      response.url().endsWith(`/technical-evaluations/${baseline.id}`),
    );
    await page.getByRole('button', { name: 'Consultar avaliação 1', exact: true }).click();
    expect((await individual).status()).toBe(200);
    await expect(
      page
        .getByRole('region', { name: 'Avaliação técnica consultada 1', exact: true })
        .getByText(baseline.rationale, { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );

    await page.goto(`/#/acoes/${action.id}`);
    const closurePanel = page.getByRole('region', {
      name: 'Encerramento técnico e continuidade',
      exact: true,
    });
    await closurePanel
      .getByRole('button', { name: 'Preparar encerramento técnico', exact: true })
      .click();
    const rationale =
      'Encerramento sintético fundamentado no parecer, reavaliação e provas vigentes.';
    await closurePanel.getByLabel('Justificativa do encerramento', { exact: true }).fill(rationale);
    await closurePanel.getByRole('button', { name: 'Revisar encerramento', exact: true }).click();
    const closureReview = closurePanel.getByRole('region', {
      name: 'Revisão da decisão técnica',
      exact: true,
    });
    await expect(
      closureReview.getByRole('heading', { name: 'Revise antes de confirmar', exact: true }),
    ).toBeFocused();
    expect(
      technicalClosureListSchema.parse(
        await (await page.request.get(`${api}/actions/${action.id}/technical-closures`)).json(),
      ).total,
    ).toBe(0);
    const closing = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/actions/${action.id}/technical-closures`),
    );
    await closureReview
      .getByRole('button', { name: 'Confirmar e registrar encerramento', exact: true })
      .click();
    const closed = await closing;
    expect(closed.status()).toBe(201);
    expect(closed.headers()['cache-control']).toBe('private, no-store');
    const closure = technicalClosureSchema.parse(await closed.json());
    expect(closure.validity).toBe('CURRENT');
    expect(closure.reassessmentId).toBe(reassessment.id);
    expect(closure.proofPackage).toEqual(opinion.proofPackage);
    await expect(
      closurePanel.getByText('Encerramento técnico registrado e confirmado pelo serviço.', {
        exact: true,
      }),
    ).toBeVisible();
    await closurePanel
      .getByRole('button', { name: 'Consultar encerramento 1', exact: true })
      .click();
    await expect(
      closurePanel
        .getByRole('article', { name: 'Decisão de encerramento 1', exact: true })
        .last()
        .getByText(rationale, { exact: true }),
    ).toBeVisible();
    expect(
      actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${action.id}`)).json(),
      ),
    ).toMatchObject({ status: 'IMPLEMENTED', version: operationalVersion, title: action.title });

    await closurePanel
      .getByRole('button', { name: 'Preparar nova ação corretiva', exact: true })
      .click();
    await closurePanel
      .getByLabel('Motivo da ação corretiva', { exact: true })
      .fill('Nova medida sintética de continuidade sem sobrescrever a ação original.');
    for (const [field, value] of [
      ['Título da medida', `${label} Corretiva`],
      ['Descrição da medida', content.description],
      ['Responsável nominal', content.responsibleName],
      ['Prazo', content.dueDate],
      ['Resultado esperado', content.expectedResult],
      ['Critério de aferição', content.verificationCriterion],
    ])
      await closurePanel.getByLabel(field!, { exact: true }).fill(value!);
    await closurePanel
      .getByRole('button', { name: 'Revisar nova ação corretiva', exact: true })
      .click();
    expect(
      (
        await page.request
          .get(`${api}/actions/${action.id}/corrective-actions`)
          .then((response) => response.json())
      ).total,
    ).toBe(0);
    const creating = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/actions/${action.id}/corrective-actions`),
    );
    await closurePanel
      .getByRole('button', { name: 'Confirmar e criar ação corretiva', exact: true })
      .click();
    const created = await creating;
    expect(created.status()).toBe(201);
    const corrective = correctiveActionCreatedSchema.parse(await created.json());
    correctiveId = corrective.action.id;
    expect(corrective.link.previousActionId).toBe(action.id);
    expect(corrective.action).toMatchObject({
      riskId: risk.id,
      status: 'PLANNED',
      title: `${label} Corretiva`,
    });
    expect(corrective.action.id).not.toBe(action.id);
    await expect(
      closurePanel.getByRole('link', { name: 'Abrir nova ação corretiva', exact: true }),
    ).toHaveAttribute('href', `#/acoes/${corrective.action.id}`);
    expect(
      actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${action.id}`)).json(),
      ),
    ).toMatchObject({ status: 'IMPLEMENTED', version: operationalVersion, title: action.title });

    const archival = await page.request.patch(
      `${api}/actions/${action.id}/evidence/${evidence.id}`,
      {
        headers,
        data: {
          expectedVersion: operationalVersion,
          changeReason: 'Arquivamento exato da prova sintética selecionada exige revisão.',
        },
      },
    );
    expect(archival.status()).toBe(200);
    await page.getByRole('button', { name: 'Atualizar ação', exact: true }).click();
    await expect(
      closurePanel.getByText('Prova selecionada arquivada', { exact: true }).first(),
    ).toBeVisible();
    const reviewAfterProof = technicalClosureContextSchema.parse(
      await (await page.request.get(`${api}/actions/${action.id}/closure-context`)).json(),
    );
    expect(reviewAfterProof.latest?.reviewReasons).toContain('SELECTED_EVIDENCE_ARCHIVED');
    expect(reviewAfterProof.latest?.proofPackage).toEqual(closure.proofPackage);
    const secondOpinion = await recordOpinion(true);
    expect(secondOpinion.supersedesId).toBe(opinion.id);
    await page.getByRole('button', { name: 'Atualizar ação', exact: true }).click();
    await expect(
      closurePanel.getByText('Parecer substituído', { exact: true }).first(),
    ).toBeVisible();
    const reviewAfterOpinion = technicalClosureContextSchema.parse(
      await (await page.request.get(`${api}/actions/${action.id}/closure-context`)).json(),
    );
    expect(reviewAfterOpinion.latest?.validity).toBe('REVIEW_REQUIRED');
    expect(reviewAfterOpinion.latest?.reviewReasons).toContain('OPINION_SUPERSEDED');

    await expect(
      closurePanel.getByRole('button', { name: 'Preparar encerramento técnico', exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    // Only exact owned records are archived. Append-only decisions and proofs stay local.
    if (correctiveId) {
      const current = actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${correctiveId}`)).json(),
      );
      expect(current.title).toBe(`${label} Corretiva`);
      expect(
        (
          await page.request.patch(`${api}/actions/${correctiveId}`, {
            headers,
            data: {
              expectedVersion: current.version,
              status: 'CANCELLED',
              changeReason: 'Limpeza lógica exata da corretiva sintética IDs17 e18.',
            },
          })
        ).status(),
      ).toBe(200);
    }
    if (riskId) {
      const current = riskDetailSchema.parse(
        await (await page.request.get(`${api}/risks/${riskId}`)).json(),
      );
      expect(current.factor).toBe(`${label} Origem`);
      expect(
        (
          await page.request.patch(`${api}/risks/${riskId}`, {
            headers,
            data: {
              expectedVersion: current.version,
              status: 'ARCHIVED',
            },
          })
        ).status(),
      ).toBe(200);
    }
    expect(
      (await page.request.patch(`${api}`, { headers, data: { isActive: false } })).status(),
    ).toBe(200);
  }
  {
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
    await expect(page.getByText(label, { exact: false })).toHaveCount(0);
    expect(
      (await page.request.get(`${api}/risk-workspaces/${riskId}/reassessments`)).status(),
    ).toBe(401);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Encerramento técnico e continuidade', exact: true }),
    ).toHaveCount(0);
  }
});
