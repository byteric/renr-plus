import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  actionDetailSchema,
  evidenceSchema,
  evidenceUploadAttemptSchema,
  riskDetailSchema,
  sectorListSchema,
  unitListSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';

const org = '10000000-0000-4000-8000-000000000001';
const foreign = '10000000-0000-4000-8000-000000000002';
const api = `/api/v1/organizations/${org}`;
const headers = { Origin: 'http://127.0.0.1:5173' };
const prefix = () => `e2e-v0405-${randomUUID().slice(0, 8)}`;
async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  // These fixtures target a known company; login may choose another existing membership.
  const activation = await page.request.put('/api/v1/auth/session/organization', {
    headers,
    data: { organizationId: email === 'admin2@renr.example' ? foreign : org },
  });
  expect(activation.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
const test = base.extend<{ risk: { id: string; version: number; label: string } }>({
  risk: async ({ page }, use) => {
    await login(page);
    const initialCookies = await page.context().cookies();
    const units = unitListSchema.parse(await (await page.request.get(`${api}/units`)).json());
    const unit = units.items.find((item) => item.name === 'Unidade demonstração' && item.isActive);
    if (!unit) throw new Error('Seed local necessário.');
    const sectors = sectorListSchema.parse(
      await (await page.request.get(`/api/v1/units/${unit.id}/sectors`)).json(),
    );
    const sector = sectors.items.find(
      (item) => item.name === 'Setor demonstração' && item.isActive,
    );
    if (!sector) throw new Error('Setor fictício necessário.');
    const label = prefix();
    const response = await page.request.post(`${api}/risks`, {
      headers,
      data: {
        sectorId: sector.id,
        factor: `${label} Origem`,
        status: 'REGISTERED',
        description: 'Contexto coletivo inteiramente fictício',
        exposureDescription: 'Exposição coletiva inteiramente fictícia',
        exposedGroupDescription: 'Equipe fictícia',
        possibleHarms: 'Possíveis agravos fictícios',
        existingControls: 'Controles fictícios registrados',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Origem sintética de teste, sem avaliação normativa.',
      },
    });
    expect(response.status()).toBe(201);
    const risk = riskDetailSchema.parse(await response.json());
    try {
      await use({ id: risk.id, version: risk.version, label });
    } finally {
      // Only this run's exact synthetic risk/actions are logically archived; immutable history stays local.
      // Reuse this test's still-valid original admin session, rather than issuing
      // redundant password logins that consume the real per-IP security budget.
      await page.context().clearCookies();
      await page.context().addCookies(initialCookies);
      const list = await (await page.request.get(`${api}/actions?riskId=${risk.id}`)).json();
      for (const item of list.items) {
        expect(item.title.startsWith(label)).toBe(true);
        if (['PLANNED', 'IN_PROGRESS'].includes(item.status))
          expect(
            (
              await page.request.patch(`${api}/actions/${item.id}`, {
                headers,
                data: {
                  expectedVersion: item.version,
                  status: 'CANCELLED',
                  changeReason: 'Encerramento lógico do cenário de teste fictício.',
                },
              })
            ).status(),
          ).toBe(200);
      }
      const current = riskDetailSchema.parse(
        await (await page.request.get(`${api}/risks/${risk.id}`)).json(),
      );
      expect(current.factor.startsWith(label)).toBe(true);
      expect(
        (
          await page.request.patch(`${api}/risks/${risk.id}`, {
            headers,
            data: { expectedVersion: current.version, status: 'ARCHIVED' },
          })
        ).status(),
      ).toBe(200);
      await page.request.delete('/api/v1/auth/session', { headers });
    }
  },
});
// Never retain passwords, session cookies or document contents in trace/video/screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
async function createAction(page: Page, risk: { id: string; version: number; label: string }) {
  const response = await page.request.post(`${api}/risks/${risk.id}/actions`, {
    headers,
    data: {
      title: `${risk.label} Medida`,
      description: 'Descrição coletiva de uma medida fictícia',
      responsibleName: 'Pessoa fictícia',
      dueDate: '2026-11-20',
      expectedResult: 'Resultado fictício esperado para acompanhamento',
      verificationCriterion: 'Comparação fictícia entre planejamento e relato',
      expectedRiskVersion: risk.version,
    },
  });
  expect(response.status()).toBe(201);
  return actionDetailSchema.parse(await response.json());
}

test('cria pela origem, persiste, transita e mantém notas em execução informada', async ({
  page,
  risk,
}) => {
  await page.goto(`/#/inventario/${risk.id}`);
  await page.getByRole('link', { name: 'Criar ação preventiva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nova ação', exact: true })).toBeVisible();
  for (const [label, value] of [
    ['Título da medida', `${risk.label} Medida UI`],
    ['Descrição da medida', 'Descrição fictícia que será preservada após recarregar.'],
    ['Responsável nominal', 'Pessoa fictícia'],
    ['Prazo', '2026-11-20'],
    ['Resultado esperado', 'Resultado esperado fictício e documentado'],
    ['Critério de aferição', 'Critério de aferição fictício e documentado'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/action-workspaces'),
  );
  await page.getByRole('button', { name: 'Criar ação', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const action = actionDetailSchema.parse(await response.json());
  await page.reload();
  await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'Informar implementação', exact: true }).count(),
  ).toBe(0);
  await page.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
  await page
    .getByLabel('Motivo da alteração', { exact: true })
    .fill('Início registrado por meio do teste fictício.');
  await page.getByRole('button', { name: 'Registrar acompanhamento', exact: true }).click();
  await page.getByRole('button', { name: 'Informar implementação', exact: true }).click();
  await page
    .getByLabel('Motivo da alteração', { exact: true })
    .fill('Execução informada como exemplo fictício.');
  await page
    .getByLabel('Relato de implementação', { exact: true })
    .fill('A equipe fictícia informou a execução da medida, sem avaliação de eficácia.');
  await page.getByRole('button', { name: 'Registrar acompanhamento', exact: true }).click();
  await expect(page.getByText('MEDIDA PREVENTIVA · VERSÃO 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar ação', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar anotação', exact: true }).click();
  await page
    .getByLabel('Texto da anotação', { exact: true })
    .fill('Anotação fictícia posterior à execução informada.');
  await page.getByRole('button', { name: 'Registrar acompanhamento', exact: true }).click();
  await expect(page.getByText('Versão 4 · Anotação', { exact: true })).toBeVisible();
  const current = actionDetailSchema.parse(
    await (await page.request.get(`${api}/actions/${action.id}`)).json(),
  );
  expect(current.status).toBe('IMPLEMENTED');
  expect(current.sourceRiskVersion).toBe(risk.version);
});

test('envia, baixa bytes privados e arquiva sem apagar evidência ou histórico', async ({
  page,
  risk,
}) => {
  const action = await createAction(page, risk);
  await page.goto(`/#/acoes/${action.id}`);
  await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeVisible();
  const bytes = Buffer.from('%PDF-1.7\nDocumento sintético sem dados pessoais\n%%EOF');
  await page
    .getByLabel('Arquivo da evidência', { exact: true })
    .setInputFiles({ name: 'ficticio.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page
    .getByLabel('Descrição da evidência', { exact: true })
    .fill('Documento fictício para rastreabilidade.');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/evidence'),
  );
  await page.getByRole('button', { name: 'Enviar evidência', exact: true }).click();
  const upload = await saved;
  expect(upload.status()).toBe(201);
  const evidence = evidenceSchema.parse(await upload.json());
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar documento', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(evidence.fileName);
  const path = await download.path();
  if (!path) throw Error('Download local ausente');
  expect(await readFile(path)).toEqual(bytes);
  const endpoint = `${api}/actions/${action.id}/evidence/${evidence.id}/download`;
  const wire = await page.request.get(endpoint);
  expect(wire.status()).toBe(200);
  expect(wire.headers()['cache-control']).toBe('private, no-store');
  expect(wire.headers()['x-content-type-options']).toBe('nosniff');
  expect(
    createHash('sha256')
      .update(await wire.body())
      .digest('hex'),
  ).toBe(evidence.sha256);
  await page.getByRole('button', { name: 'Arquivar evidência', exact: true }).click();
  await page
    .getByLabel('Motivo do arquivamento', { exact: true })
    .fill('Documento fictício arquivado preservando a rastreabilidade.');
  await page
    .getByRole('button', { name: 'Confirmar arquivamento da evidência', exact: true })
    .click();
  await expect(page.getByText('Versão 3 · Evidência arquivada', { exact: true })).toBeVisible();
  expect((await page.request.get(endpoint)).status()).toBe(200);
  const anonymous = await page
    .context()
    .browser()!
    .newContext({ baseURL: 'http://127.0.0.1:5173' });
  try {
    expect((await anonymous.request.get(endpoint)).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

for (const committed of [true, false])
  test(
    committed
      ? 'recupera upload confirmado com resposta perdida sem novo envio'
      : 'repete tentativa ainda não registrada com a mesma chave e sem duplicação',
    async ({ page, risk }) => {
      const action = await createAction(page, risk);
      const endpoint = `${api}/actions/${action.id}/evidence`;
      const keys: string[] = [];
      await page.route(`**${endpoint}`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        keys.push(route.request().headers()['idempotency-key'] ?? '');
        if (keys.length > 1) return route.continue();
        if (committed) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          evidenceSchema.parse(await response.json());
        }
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 }),
        });
      });
      await page.goto(`/#/acoes/${action.id}`);
      await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeVisible();
      const bytes = Buffer.from('%PDF-1.7\nSynthetic recoverable evidence fixture\n%%EOF');
      const description = 'Documento fictício preservado durante recuperação explícita.';
      const input = page.getByLabel('Arquivo da evidência', { exact: true });
      await input.setInputFiles({
        name: 'recoverable.pdf',
        mimeType: 'application/pdf',
        buffer: bytes,
      });
      await page.getByLabel('Descrição da evidência', { exact: true }).fill(description);
      await page.getByRole('button', { name: 'Enviar evidência', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Resultado incerto' })).toBeVisible();
      await expect(page.getByLabel('Descrição da evidência', { exact: true })).toHaveValue(
        description,
      );
      expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(1);
      await expect(
        page.getByRole('button', { name: 'Enviar evidência', exact: true }),
      ).toBeDisabled();
      await page.getByRole('button', { name: 'Consultar tentativa de envio', exact: true }).click();
      if (!committed)
        await page.getByRole('button', { name: 'Repetir tentativa original', exact: true }).click();
      await expect(
        page.getByText(
          committed
            ? 'Evidência recuperada; envio confirmado no histórico.'
            : 'Evidência adicionada ao histórico.',
          { exact: true },
        ),
      ).toBeVisible();
      expect(keys.length).toBe(committed ? 1 : 2);
      expect(new Set(keys).size).toBe(1);
      const attempt = evidenceUploadAttemptSchema.parse(
        await (await page.request.get(`${endpoint}/upload-attempts/${keys[0]}`)).json(),
      );
      expect(attempt.state).toBe('COMPLETED');
      const list = await (await page.request.get(endpoint)).json();
      expect(list.total).toBe(1);
      const evidence = evidenceSchema.parse(list.items[0]);
      expect(evidence.id).toBe(attempt.evidence?.id);
      expect(await (await page.request.get(`${endpoint}/${evidence.id}/download`)).body()).toEqual(
        bytes,
      );
      const current = actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${action.id}`)).json(),
      );
      expect(current.version).toBe(action.version + 1);
    },
  );

test('leitor consulta sem escrita e outra empresa não acessa ação/anexo', async ({
  page,
  risk,
}) => {
  const action = await createAction(page, risk);
  await page.context().clearCookies();
  await login(page, 'reader@renr.example');
  await page.goto(`/#/acoes/${action.id}`);
  await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar ação', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar evidência', exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post(`${api}/actions/${action.id}/notes`, {
        headers,
        data: { expectedVersion: 1, text: 'Tentativa fictícia não autorizada' },
      })
    ).status(),
  ).toBe(403);
  await page.request.delete('/api/v1/auth/session', { headers });
  await login(page, 'admin2@renr.example');
  expect((await page.request.get(`${api}/actions/${action.id}`)).status()).toBe(404);
  expect(
    (
      await page.request.get(`/api/v1/organizations/${foreign}/actions/${action.id}/evidence`)
    ).status(),
  ).toBe(404);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/actions/${action.id}`)).status()).toBe(401);
});

test('filtros voltam pela URL e lista/detalhe refluem nos dois temas', async ({ page, risk }) => {
  const action = await createAction(page, risk);
  await navigateWorkspace(page, 'Ações');
  await page.getByLabel('Buscar título ou responsável', { exact: true }).fill(risk.label);
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  const filtered = page.url();
  await page.getByRole('link', { name: action.title, exact: true }).click();
  await page.getByRole('link', { name: '← Voltar às ações', exact: true }).click();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByLabel('Buscar título ou responsável', { exact: true })).toHaveValue(
    risk.label,
  );
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole('table', { name: 'Ações preventivas', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('link', { name: action.title, exact: true }).click();
    await expect(page.getByRole('heading', { name: action.title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const theme = page.getByRole('button', { name: /Modo (claro|escuro)/ });
    await theme.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('link', { name: '← Voltar às ações', exact: true }).click();
  }
});
