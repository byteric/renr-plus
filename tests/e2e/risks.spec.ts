import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  diagnosticCycleSchema,
  diagnosticInstrumentSchema,
  participationInvitesSchema,
  preliminaryEvaluationListSchema,
  preliminaryEvaluationSchema,
  riskDetailSchema,
  riskListSchema,
  sectorListSchema,
  unitListSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';

const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const headers = { Origin: 'http://127.0.0.1:5173' };
const api = `/api/v1/organizations/${org}`;
type OwnedRisk = { id: string; prefix: string; archived: boolean };
const test = base.extend<{ ownedRisks: OwnedRisk[] }>({
  ownedRisks: async ({ page }, use) => {
    const owned: OwnedRisk[] = [];
    try {
      await use(owned);
    } finally {
      // Append-only evaluation history is preserved; cleanup is logical and restricted to exact IDs.
      for (const item of owned.filter((value) => !value.archived)) {
        const response = await page.request.get(`${api}/risks/${item.id}`);
        expect(response.status()).toBe(200);
        const risk = riskDetailSchema.parse(await response.json());
        expect(risk.factor.startsWith(item.prefix)).toBe(true);
        if (risk.status !== 'ARCHIVED') {
          const archived = await page.request.patch(`${api}/risks/${item.id}`, {
            headers,
            data: { status: 'ARCHIVED', expectedVersion: risk.version },
          });
          expect(archived.status()).toBe(200);
        }
      }
      const logout = await page.request.delete('/api/v1/auth/session', { headers });
      expect([204, 401]).toContain(logout.status());
    }
  },
});
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const select = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  if ((await select.inputValue()) !== org) {
    const [activation] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith('/api/v1/auth/session/organization'),
      ),
      select.selectOption(org),
    ]);
    expect(activation.status()).toBe(200);
    await expect(select).toHaveValue(org);
    await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  }
}
async function scope(page: Page) {
  const units = unitListSchema.parse(await (await page.request.get(`${api}/units`)).json());
  const unit = units.items.find((value) => value.name === 'Unidade demonstração' && value.isActive);
  if (!unit) throw new Error('Execute db:seed no banco local antes dos E2E.');
  const sectors = sectorListSchema.parse(
    await (await page.request.get(`/api/v1/units/${unit.id}/sectors`)).json(),
  );
  const sector = sectors.items.find(
    (value) => value.name === 'Setor demonstração' && value.isActive,
  );
  if (!sector) throw new Error('Setor fictício local ausente.');
  return { unit, sector };
}
async function fillContext(page: Page) {
  for (const label of [
    'Descrição do fator',
    'Contexto de exposição',
    'Grupo exposto',
    'Possíveis agravos',
    'Controles existentes',
  ]) {
    await page
      .getByLabel(label, { exact: true })
      .fill(`${label}: exemplo coletivo inteiramente fictício para teste.`);
  }
  await page
    .getByLabel('Nota de origem', { exact: true })
    .fill('Origem sintética para verificar rastreabilidade; sem avaliação normativa.');
}
async function addEvaluation(page: Page, reference: string) {
  await page.getByRole('button', { name: 'Adicionar ficha preliminar', exact: true }).click();
  await page.getByLabel('Referência do método', { exact: true }).fill(reference);
  await page.getByLabel('Versão do método', { exact: true }).fill('1.0-demo');
  await page
    .getByLabel('Observação preliminar', { exact: true })
    .fill('Observação coletiva fictícia, sem classificação normativa de risco.');
  await page
    .getByLabel('Justificativa', { exact: true })
    .fill('Verificação de persistência e do contexto preservado por versão.');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/evaluations') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar ficha preliminar', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  return preliminaryEvaluationSchema.parse(await response.json());
}

test('inventário persiste, protege conflito, preserva duas fichas e arquiva sem apagar história', async ({
  page,
  ownedRisks,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const { unit, sector } = await scope(page);
  await navigateWorkspace(page, 'Inventário');
  await page.getByRole('link', { name: 'Novo risco', exact: false }).click();
  const prefix = `e2e-v03-${randomUUID().slice(0, 8)}`;
  const factor = `${prefix} Organização coletiva`;
  await page.getByLabel('Fator de risco', { exact: true }).fill(factor);
  await page.getByLabel('Unidade', { exact: true }).selectOption(unit.id);
  await page.getByLabel('Setor', { exact: true }).selectOption(sector.id);
  await fillContext(page);
  await page.getByLabel('Tipo de origem', { exact: true }).selectOption('TECHNICAL_RECORD');
  const creating = page.waitForResponse(
    (r) => r.url().endsWith('/risks') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Registrar risco', exact: true }).click();
  const createdResponse = await creating;
  expect(createdResponse.status()).toBe(201);
  const created = riskDetailSchema.parse(await createdResponse.json());
  const owned = { id: created.id, prefix, archived: false };
  ownedRisks.push(owned);
  await expect(page).toHaveURL(new RegExp(created.id));
  await page.reload();
  await expect(page.getByRole('heading', { name: factor, exact: true })).toBeVisible();
  const first = await addEvaluation(page, `${prefix} ficha original`);
  expect(first.riskVersion).toBe(1);
  expect(first.contextSnapshot.factor).toBe(factor);
  await page.getByRole('button', { name: 'Editar registro', exact: true }).click();
  await page.getByLabel('Fator de risco', { exact: true }).fill(`${prefix} edição local`);
  const remoteName = `${prefix} edição remota`;
  const remote = await page.request.patch(`${api}/risks/${created.id}`, {
    headers,
    data: { factor: remoteName, expectedVersion: 2 },
  });
  expect(remote.status()).toBe(200);
  const conflicting = page.waitForResponse(
    (r) => r.url().endsWith(`/risks/${created.id}`) && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  expect((await conflicting).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText('texto foi preservado');
  await expect(page.getByLabel('Fator de risco', { exact: true })).toHaveValue(
    `${prefix} edição local`,
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: remoteName, exact: true })).toBeVisible();
  const second = await addEvaluation(page, `${prefix} ficha atual`);
  expect(second.sequence).toBe(2);
  expect(second.riskVersion).toBe(3);
  expect(second.contextSnapshot.factor).toBe(remoteName);
  const history = preliminaryEvaluationListSchema.parse(
    await (await page.request.get(`${api}/risks/${created.id}/evaluations`)).json(),
  );
  expect(history.items.map((value) => value.id)).toEqual([second.id, first.id]);
  expect(history.items[1]!.contextSnapshot.factor).toBe(factor);
  await page.getByRole('link', { name: 'Origem', exact: true }).click();
  await expect(page).toHaveURL(/section=origem/);
  await page.reload();
  await expect(page.locator('#risk-origem')).toBeFocused();
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  // Safe visual evidence: fictitious risk data only, never login credentials or invitation codes.
  await page.screenshot({
    path: testInfo.outputPath(`risk-detail-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Arquivar risco', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar arquivamento', exact: true }).click();
  await expect(page.getByText(/Registro arquivado · somente leitura/)).toBeVisible();
  owned.archived = true;
  await page.goto(`/#/inventario?q=${prefix}`);
  await expect(
    page.getByRole('heading', { name: 'Nenhum registro neste recorte', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Estado do registro', { exact: true }).selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await expect(page.getByRole('link', { name: remoteName, exact: true })).toBeVisible();
  const filteredUrl = page.url();
  await page.reload();
  await expect(page.getByLabel('Estado do registro', { exact: true })).toHaveValue('ARCHIVED');
  await page.getByRole('link', { name: remoteName, exact: true }).click();
  await page.getByRole('link', { name: 'Voltar ao inventário', exact: false }).click();
  await expect(page).toHaveURL(filteredUrl);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/risks`)).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('leitor tem somente leitura e organização externa não recebe registro alheio', async ({
  page,
  playwright,
  ownedRisks,
}) => {
  expect(ownedRisks).toHaveLength(0);
  await login(page, 'reader@renr.example');
  await navigateWorkspace(page, 'Inventário');
  const fixtureFactor = 'Sobrecarga de tarefas — fictício';
  await page.getByLabel('Buscar no inventário', { exact: true }).fill(fixtureFactor);
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  const risks = riskListSchema.parse(
    await (await page.request.get(`${api}/risks?q=${encodeURIComponent(fixtureFactor)}`)).json(),
  );
  const risk = risks.items.find((item) => item.factor === fixtureFactor);
  if (!risk) throw new Error('Inventário fictício ausente. Execute db:seed.');
  await expect(page.getByRole('link', { name: risk.factor, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Novo risco', exact: false })).toHaveCount(0);
  await page.goto(`/#/inventario/${risk.id}`);
  await expect(page.getByRole('heading', { name: risk.factor, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar registro' })).toHaveCount(0);
  expect(
    (
      await page.request.patch(`${api}/risks/${risk.id}`, {
        headers,
        data: { factor: 'Sem permissão', expectedVersion: risk.version },
      })
    ).status(),
  ).toBe(403);
  await page.goto('/#/inventario/novo');
  await expect(page.getByRole('alert')).toContainText('somente leitura');
  const other = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    const authenticated = await other.post('/api/v1/auth/sessions', {
      headers,
      data: { email: 'admin2@renr.example', password: demoPassword() },
    });
    expect(authenticated.status()).toBe(201);
    expect((await other.get(`/api/v1/organizations/${otherOrg}/risks/${risk.id}`)).status()).toBe(
      404,
    );
    expect(
      (await other.get(`/api/v1/organizations/${otherOrg}/risks/${risk.id}/evaluations`)).status(),
    ).toBe(404);
  } finally {
    await other.delete('/api/v1/auth/session', { headers });
    await other.dispose();
  }
});

test('diagnóstico coletivo dá origem ao registro e mantém o vínculo após recarga', async ({
  page,
  request,
  ownedRisks,
}) => {
  await login(page);
  const { sector } = await scope(page);
  const instrument = diagnosticInstrumentSchema.parse(
    await (await page.request.get(`${api}/diagnostic-instrument`)).json(),
  );
  const prefix = `e2e-v03-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${api}/diagnostic-cycles`, {
    headers,
    data: {
      name: `${prefix} ciclo coletivo`,
      sectorId: sector.id,
      instrumentVersionId: instrument.id,
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);
  const cycle = diagnosticCycleSchema.parse(await created.json());
  expect(
    (await page.request.post(`${api}/diagnostic-cycles/${cycle.id}/open`, { headers })).status(),
  ).toBe(201);
  const invites = participationInvitesSchema.parse(
    await (
      await page.request.post(`${api}/diagnostic-cycles/${cycle.id}/participation-invites`, {
        headers,
        data: { count: 5 },
      })
    ).json(),
  );
  for (const invite of invites.invites) {
    const response = await request.post('/api/v1/participation/responses', {
      data: {
        inviteCode: invite.code,
        instrumentVersionId: instrument.id,
        answers: instrument.questions.map((question) => ({
          questionId: question.id,
          optionIds: [question.options[0]!.id],
        })),
      },
    });
    expect(response.status()).toBe(201);
  }
  expect(
    (await page.request.post(`${api}/diagnostic-cycles/${cycle.id}/close`, { headers })).status(),
  ).toBe(201);
  await page.goto(`/#/diagnostico?cycleId=${cycle.id}`);
  await page
    .getByRole('link', { name: 'Criar registro de risco a partir deste ciclo', exact: true })
    .click();
  await expect(page.getByLabel('Setor', { exact: true })).toHaveValue(sector.id);
  await expect(page.getByLabel('Ciclo de origem', { exact: true })).toHaveValue(cycle.id);
  await page.getByLabel('Fator de risco', { exact: true }).fill(`${prefix} fator contextual`);
  await fillContext(page);
  const saving = page.waitForResponse(
    (r) => r.url().endsWith('/risks') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Registrar risco', exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const risk = riskDetailSchema.parse(await saved.json());
  ownedRisks.push({ id: risk.id, prefix, archived: false });
  expect(risk.diagnosticCycleId).toBe(cycle.id);
  await page.reload();
  await page.getByRole('link', { name: 'Consultar diagnóstico de origem', exact: false }).click();
  await expect(page.getByRole('heading', { name: cycle.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar aos ciclos', exact: true })).toBeVisible();
});
