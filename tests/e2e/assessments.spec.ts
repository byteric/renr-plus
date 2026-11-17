import { randomBytes, randomUUID } from 'node:crypto';
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  organizationSchema,
  unitSchema,
  sectorSchema,
  assessmentGroupSchema,
  createdInstrumentSchema,
  instrumentVersionSchema,
  consolidationPolicySchema,
  assessmentCycleSchema,
  assessmentComparisonSchema,
  reportSnapshotSchema,
  assessmentInviteDeliveryConfirmationSchema,
  assessmentInvitesSchema,
  assessmentResultsSchema,
  assessmentSourceSchema,
  type AssessmentCycle,
  type InstrumentVersion,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { cleanupAssessmentFixture } from '../../scripts/assessments-e2e-data.mjs';
import { navigateWorkspace } from './navigation';

const headers = { Origin: 'http://127.0.0.1:5173' };
const url = (org: string, tail: string) => `/api/v1/organizations/${org}/${tail}`;
async function post(api: APIRequestContext, path: string, data: unknown) {
  const result = await api.post(path, { headers, data });
  expect(result.status()).toBe(201);
  return result.json();
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
type Company = {
  id: string;
  groupId: string;
  unitId: string;
  sectorId: string;
  instrument: InstrumentVersion;
};
const test = base.extend<{ company: Company }>({
  company: async ({ page }, use) => {
    await login(page);
    const name = `e2e-assessments-${randomUUID()}`;
    const organization = organizationSchema.parse(
      await post(page.request, '/api/v1/organizations', {
        name,
        fiscalIdentifier: null,
        timezone: 'America/Sao_Paulo',
      }),
    );
    try {
      expect(
        (
          await page.request.put('/api/v1/auth/session/organization', {
            headers,
            data: { organizationId: organization.id },
          })
        ).status(),
      ).toBe(200);
      const unit = unitSchema.parse(
        await post(page.request, url(organization.id, 'units'), {
          name: 'Unidade sintética',
          code: null,
        }),
      );
      const sector = sectorSchema.parse(
        await post(page.request, `/api/v1/units/${unit.id}/sectors`, { name: 'Setor sintético' }),
      );
      const group = assessmentGroupSchema.parse(
        await post(page.request, url(organization.id, 'assessment-groups'), {
          name: 'Grupo da coleta sintética',
          sectorId: sector.id,
        }),
      );
      const created = createdInstrumentSchema.parse(
        await post(page.request, url(organization.id, 'instruments'), {
          name: 'Catálogo para coleta sintética',
        }),
      );
      const versionPath = url(
        organization.id,
        `instruments/${created.instrument.id}/versions/${created.version.id}`,
      );
      const saved = await page.request.put(versionPath, {
        headers,
        data: {
          expectedRevision: created.version.revision,
          title: 'Instrumento coletivo sintético',
          description: 'Condições organizacionais de demonstração.',
          instructions: 'Escolha as alternativas do cenário fictício.',
          usageMode: 'DEMONSTRATION',
          questions: (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE'] as const).map(
            (type, index) => ({
              id: randomUUID(),
              label: `Pergunta coletiva ${index + 1}`,
              type,
              required: index !== 1,
              position: index + 1,
              options: [1, 2].map((position) => ({
                id: randomUUID(),
                label: `Alternativa coletiva ${index + 1}.${position}`,
                position,
              })),
            }),
          ),
        },
      });
      expect(saved.status()).toBe(200);
      const draft = instrumentVersionSchema.parse(await saved.json());
      const instrument = instrumentVersionSchema.parse(
        await post(page.request, `${versionPath}/publish`, { expectedRevision: draft.revision }),
      );
      await page.goto('/#/coletas');
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Coletas' })).toBeVisible();
      await use({
        id: organization.id,
        groupId: group.id,
        unitId: unit.id,
        sectorId: sector.id,
        instrument,
      });
    } finally {
      await cleanupAssessmentFixture(organization.id, name);
    }
  },
});
// No participant codes, passwords, answers or cookies in Playwright artifacts.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('compara períodos, retorna ao recorte e emite o resumo executivo com PDF', async ({
  page,
  company,
}, testInfo) => {
  test.setTimeout(120_000);
  const policy = consolidationPolicySchema.parse(
    await post(page.request, url(company.id, 'consolidation-policies'), {
      usageMode: 'DEMONSTRATION',
      minimumResponses: 5,
    }),
  );
  await post(page.request, url(company.id, `consolidation-policies/${policy.id}/publish`), {
    expectedRevision: 1,
  });
  for (let person = 0; person < 20; person++) {
    await post(page.request, url(company.id, 'employees'), {
      name: `Colaborador fictício do relatório ${person}`,
      unitId: company.unitId,
      sectorId: company.sectorId,
    });
  }
  async function collect(name: string, startsAt: string, count: number) {
    const draft = assessmentCycleSchema.parse(
      await post(page.request, url(company.id, 'assessment-cycles'), {
        name,
        assessmentGroupId: company.groupId,
        instrumentVersionId: company.instrument.id,
        policyVersionId: policy.id,
        startsAt,
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    const cyclePath = url(company.id, `assessment-cycles/${draft.id}`);
    const open = assessmentCycleSchema.parse(
      await post(page.request, `${cyclePath}/open`, { expectedRevision: draft.revision }),
    );
    const batch = assessmentInvitesSchema.parse(
      await post(page.request, `${cyclePath}/invites`, { count: 15 }),
    );
    const answers = company.instrument.questions
      .filter((question) => question.required)
      .map((question) => ({
        questionId: question.id,
        optionIds: [question.options[0]!.id],
      }));
    for (const invite of batch.invites.slice(0, count)) {
      await post(page.request, '/api/v1/assessment-participation/submissions', {
        inviteCode: invite.code,
        submissionSecret: randomBytes(32).toString('base64url'),
        instrumentVersionId: company.instrument.id,
        answers,
      });
    }
    return assessmentCycleSchema.parse(
      await post(page.request, `${cyclePath}/close`, { expectedRevision: open.revision }),
    );
  }
  const reference = await collect(
    'Coleta anterior fictícia',
    new Date(Date.now() - 60_000).toISOString(),
    5,
  );
  const current = await collect('Coleta atual fictícia', new Date().toISOString(), 10);
  await page.goto(`/#/coletas?unitId=${company.unitId}&sectorId=${company.sectorId}`);
  await page.getByRole('button', { name: 'Comparativo gerencial' }).click();
  await page.getByRole('combobox', { name: 'Coleta de referência' }).selectOption(reference.id);
  await page.getByRole('combobox', { name: 'Coleta atual' }).selectOption(current.id);
  const compared = page.waitForResponse((response) =>
    response.url().includes('/assessment-comparison?'),
  );
  await page.getByRole('button', { name: 'Comparar períodos' }).click();
  const result = assessmentComparisonSchema.parse(await (await compared).json());
  expect(result.participation).toMatchObject({
    status: 'AVAILABLE',
    reference: 25,
    current: 50,
    difference: 25,
  });
  await expect(page.getByText('+25 p.p.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Abrir coleta de referência' }).click();
  await page.getByRole('button', { name: 'Voltar ao comparativo' }).click();
  await expect(page.getByRole('combobox', { name: 'Coleta atual' })).toHaveValue(current.id);
  await expect(page).toHaveURL(new RegExp(`sectorId=${company.sectorId}`));
  await page.getByRole('link', { name: 'Incluir no resumo executivo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Incluir resumo executivo' })).toBeChecked();
  const capture = page.waitForResponse(
    (response) => response.url().endsWith('/reports') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Emitir relatório' }).click();
  const snapshot = reportSnapshotSchema.parse(await (await capture).json());
  expect(snapshot.executiveVersion).toBe(1);
  const comparison = page.getByRole('table', { name: 'Evolução entre coletas' });
  await expect(comparison).toContainText('Aumento de 25 p.p.');
  await expect(comparison.getByRole('link', { name: 'Abrir coleta' }).first()).toHaveAttribute(
    'href',
    expect.stringContaining(reference.id),
  );
  const persisted = await page.request.get(url(company.id, `reports/${snapshot.id}`));
  expect(await persisted.json()).toEqual(snapshot);
  const pdf = await page.request.get(url(company.id, `reports/${snapshot.id}/pdf`));
  expect(pdf.status()).toBe(200);
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await testInfo.attach('resumo-executivo-sintetico', {
    body: bytes,
    contentType: 'application/pdf',
  });
});

test('organiza coleta, corrige antes do envio, recupera resposta perdida e encerra com fonte e supressão', async ({
  page,
  browser,
  company,
}) => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Políticas de consolidação', exact: true }).click();
  await page.getByRole('button', { name: 'Criar política', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await page.getByRole('button', { name: 'Publicar política', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Política v1 · Publicada', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Coletas da empresa', exact: true }).click();
  await page.getByRole('button', { name: 'Nova coleta', exact: true }).click();
  await page.getByLabel('Nome da coleta', { exact: true }).fill('Coleta sintética navegável');
  await page
    .getByRole('combobox', { name: 'Grupo da coleta', exact: true })
    .selectOption(company.groupId);
  await page
    .getByRole('combobox', { name: 'Instrumento da coleta', exact: true })
    .selectOption(company.instrument.instrumentId);
  await page
    .getByRole('combobox', { name: 'Versão publicada do instrumento', exact: true })
    .selectOption(company.instrument.id);
  const policySelect = page.getByRole('combobox', {
    name: 'Política de consolidação',
    exact: true,
  });
  await expect(policySelect.locator('option')).toHaveCount(2);
  await policySelect.selectOption({ index: 1 });
  const localDate = (offset: number) => {
    const date = new Date(Date.now() + offset);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  await page.getByLabel('Início da coleta', { exact: true }).fill(localDate(-60000));
  await page.getByLabel('Fim da coleta', { exact: true }).fill(localDate(3600000));
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/assessment-cycles') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  const cycle = assessmentCycleSchema.parse(await (await created).json());
  const revisedName = 'Coleta sintética revisada';
  await page.getByRole('button', { name: 'Editar rascunho', exact: true }).click();
  await page.getByLabel('Nome da coleta', { exact: true }).fill(revisedName);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByRole('heading', { name: revisedName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir coleta', exact: true }).click();
  await expect(page.getByText(/fixad|fixos|fixa|congelad/i).first()).toBeVisible();
  await page.getByLabel('Confirmação da abertura', { exact: true }).fill('ABRIR');
  await page.getByRole('button', { name: 'Confirmar abertura', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Editar rascunho', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Coleta em andamento', exact: true }),
  ).toBeVisible();
  const issued = page.waitForResponse(
    (response) =>
      response.url().includes('/invite-deliveries/') &&
      response.url().endsWith('/confirm') &&
      response.request().method() === 'POST',
  );
  await page.getByLabel('Quantidade de convites', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Preparar convites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prévia da entrega manual' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Copiar código 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Gerar convites', exact: true }).click();
  const invitations = assessmentInviteDeliveryConfirmationSchema.parse(await (await issued).json());
  const code = invitations.invites[0]!.code;
  const anonymous = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    const participant = await anonymous.newPage();
    const requests: string[] = [];
    await participant.route('**/assessment-participation/submissions', async (route) => {
      requests.push(route.request().postData()!);
      if (requests.length === 1) {
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.abort('failed');
      } else await route.continue();
    });
    await participant.goto('/#/responder');
    await participant.getByLabel('Código do convite', { exact: true }).fill(code);
    await participant.getByRole('button', { name: 'Acessar coleta', exact: true }).click();
    await expect(
      participant.getByRole('region', { name: 'Como suas respostas são protegidas' }),
    ).toContainText('mínimo de 5 respostas');
    await participant.getByRole('button', { name: 'Revisar respostas', exact: true }).click();
    await expect(
      participant.getByText('Responda as perguntas obrigatórias antes de revisar.'),
    ).toBeVisible();
    await participant.getByLabel('Alternativa coletiva 1.1', { exact: true }).check();
    await participant
      .getByRole('radio', { name: '1. Alternativa coletiva 3.1', exact: true })
      .check();
    await participant.getByRole('button', { name: 'Revisar respostas', exact: true }).click();
    await participant.getByRole('button', { name: 'Corrigir respostas', exact: true }).click();
    await participant.getByLabel('Alternativa coletiva 1.2', { exact: true }).check();
    await participant.getByRole('button', { name: 'Revisar respostas', exact: true }).click();
    await expect(participant.getByText('Não respondida (opcional)', { exact: true })).toBeVisible();
    await participant.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
    await participant
      .getByRole('button', { name: 'Reenviar a mesma resposta', exact: true })
      .click();
    await expect(
      participant.getByRole('heading', { name: 'Participação concluída', exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1] === requests[0]).toBe(true);
    expect(participant.url().includes(code)).toBe(false);
    expect(
      await participant.evaluate(() =>
        Object.keys(localStorage).filter((key) => key !== 'renr-theme'),
      ),
    ).toEqual([]);
    expect(await participant.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  } finally {
    await anonymous.close();
  }
  await page
    .getByRole('combobox', { name: 'Tipo de fonte', exact: true })
    .selectOption('OBSERVATION');
  await page
    .getByLabel('Contexto da fonte', { exact: true })
    .fill('Observação do trabalho coletivo');
  await page.getByLabel('Data da fonte', { exact: true }).fill('2026-01-01');
  await page
    .getByLabel('Síntese da fonte', { exact: true })
    .fill('Síntese de contexto coletivo, sem identificação de pessoas.');
  const sourced = page.waitForResponse(
    (response) => response.url().includes('/sources') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Registrar fonte', exact: true }).click();
  const source = assessmentSourceSchema.parse(await (await sourced).json());
  expect(source.kind).toBe('OBSERVATION');
  await expect(
    page.getByText(`Registrada por ${source.createdBy.name} em`, { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Encerrar coleta', exact: true }).click();
  await page.getByLabel('Confirmação do encerramento', { exact: true }).fill('ENCERRAR');
  await page.getByRole('button', { name: 'Confirmar encerramento', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Resultado protegido', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Envios consolidados:/)).toHaveCount(0);
  const results = assessmentResultsSchema.parse(
    await (await page.request.get(url(company.id, `assessment-cycles/${cycle.id}/results`))).json(),
  );
  expect(results.node.availability).toBe('SUPPRESSED');
  await navigateWorkspace(page, 'Painel');
  await page
    .getByRole('navigation', { name: 'Áreas do painel' })
    .getByRole('link', { name: 'Riscos', exact: true })
    .click();
  await page.getByLabel('Unidade', { exact: true }).selectOption(cycle.unitId);
  await page.getByLabel('Setor', { exact: true }).selectOption(cycle.sectorId);
  const resultsLink = page.getByRole('link', { name: 'Consultar resultados por coleta' });
  await expect(resultsLink).toHaveAttribute('href', new RegExp('sectorId=' + cycle.sectorId));
  await resultsLink.click();
  await expect(page.getByLabel('Situação da coleta')).toHaveValue('CLOSED');
  await expect(page.getByText('Coletas filtradas por setor.')).toBeVisible();
  await page.getByRole('button', { name: `Abrir coleta ${revisedName}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Resultado protegido' })).toBeVisible();
  await expect(page.getByText(/Envios consolidados:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Voltar às coletas', exact: true }).click();
  await expect(page.getByText('Coletas filtradas por setor.')).toBeVisible();
  await page.getByRole('button', { name: 'Consolidação gerencial', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Instrumento da coleta', exact: true })
    .selectOption(company.instrument.instrumentId);
  await page
    .getByRole('combobox', { name: 'Versão publicada do instrumento', exact: true })
    .selectOption(company.instrument.id);
  await page
    .getByRole('combobox', { name: 'Política de consolidação', exact: true })
    .selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Consultar consolidação', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Resultado protegido', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/zero risco/i)).toHaveCount(0);
});

test('distingue ciclo vazio de resultado coletivo disponível e protege descendente por diferença', async ({
  page,
  company,
  playwright,
}) => {
  test.setTimeout(120_000);
  const policy = consolidationPolicySchema.parse(
    await post(page.request, url(company.id, 'consolidation-policies'), {
      usageMode: 'DEMONSTRATION',
      minimumResponses: 5,
    }),
  );
  await post(page.request, url(company.id, `consolidation-policies/${policy.id}/publish`), {
    expectedRevision: 1,
  });
  async function create(name: string): Promise<AssessmentCycle> {
    const cycle = assessmentCycleSchema.parse(
      await post(page.request, url(company.id, 'assessment-cycles'), {
        name,
        assessmentGroupId: company.groupId,
        instrumentVersionId: company.instrument.id,
        policyVersionId: policy.id,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    return assessmentCycleSchema.parse(
      await post(page.request, url(company.id, `assessment-cycles/${cycle.id}/open`), {
        expectedRevision: 1,
      }),
    );
  }
  const empty = await create('Coleta sem respostas');
  await post(page.request, url(company.id, `assessment-cycles/${empty.id}/close`), {
    expectedRevision: empty.revision,
  });
  await page.goto(`/#/coletas?cycle=${empty.id}`);
  await expect(
    page.getByRole('heading', { name: 'Nenhuma resposta recebida', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/zero risco/i)).toHaveCount(0);
  for (let employee = 1; employee <= 20; employee++) {
    await post(page.request, url(company.id, 'employees'), {
      name: `Colaborador fictício ${employee}`,
      unitId: company.unitId,
      sectorId: company.sectorId,
    });
  }
  const available = await create('Coleta coletiva suficiente');
  await post(page.request, url(company.id, 'employees'), {
    name: 'Colaborador após a abertura',
    unitId: company.unitId,
    sectorId: company.sectorId,
  });
  const batch = assessmentInvitesSchema.parse(
    await post(page.request, url(company.id, `assessment-cycles/${available.id}/invites`), {
      count: 15,
    }),
  );
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    for (const invite of batch.invites.slice(0, 10))
      await post(anonymous, '/api/v1/assessment-participation/submissions', {
        inviteCode: invite.code,
        submissionSecret: randomBytes(32).toString('base64url'),
        instrumentVersionId: company.instrument.id,
        answers: company.instrument.questions
          .filter((question) => question.required)
          .map((question) => ({ questionId: question.id, optionIds: [question.options[0]!.id] })),
      });
  } finally {
    await anonymous.dispose();
  }
  await post(page.request, url(company.id, `assessment-cycles/${available.id}/close`), {
    expectedRevision: available.revision,
  });
  await page.goto(`/#/coletas?cycle=${available.id}`);
  await expect(
    page.getByRole('heading', { name: 'Resultado coletivo disponível', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Envios consolidados: 10', { exact: true })).toBeVisible();
  const participation = page.getByRole('region', { name: 'Adesão à coleta' });
  await expect(participation.getByText('50%', { exact: true })).toBeVisible();
  for (const value of ['20', '15', '10']) {
    await expect(participation.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Pergunta sem respostas.', { exact: true })).toBeVisible();
  const hidden = await create('Coleta protegida complementar');
  const code = assessmentInvitesSchema.parse(
    await post(page.request, url(company.id, `assessment-cycles/${hidden.id}/invites`), {
      count: 1,
    }),
  ).invites[0]!.code;
  await post(page.request, '/api/v1/assessment-participation/submissions', {
    inviteCode: code,
    submissionSecret: randomBytes(32).toString('base64url'),
    instrumentVersionId: company.instrument.id,
    answers: company.instrument.questions
      .filter((question) => question.required)
      .map((question) => ({ questionId: question.id, optionIds: [question.options[0]!.id] })),
  });
  await post(page.request, url(company.id, `assessment-cycles/${hidden.id}/close`), {
    expectedRevision: hidden.revision,
  });
  const family = assessmentResultsSchema.parse(
    await (
      await page.request.get(
        url(
          company.id,
          `assessment-consolidation?instrumentVersionId=${company.instrument.id}&policyVersionId=${policy.id}`,
        ),
      )
    ).json(),
  );
  expect(family.node.availability).toBe('SUPPRESSED');
  expect(family.node.responseCount).toBeNull();
});
