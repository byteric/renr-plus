import { randomUUID } from 'node:crypto';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import {
  accessMembershipSchema,
  createdInstrumentSchema,
  instrumentListSchema,
  instrumentVersionSchema,
  organizationSchema,
  sessionResponseSchema,
  type InstrumentVersion,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { cleanupInstrumentsFixture } from '../../scripts/instruments-e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
async function activateByKeyboard(page: Page, target: Locator) {
  await expect(target).toBeEnabled();
  for (let index = 0; index < 100; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}
function draft(version: InstrumentVersion, usageMode: 'DEMONSTRATION' | 'REAL' = 'DEMONSTRATION') {
  return {
    expectedRevision: version.revision,
    title: 'Instrumento sintético de condições de trabalho',
    description: 'Conteúdo demonstrativo para validação do fluxo.',
    instructions: 'Leia as alternativas antes de escolher.',
    usageMode,
    questions: (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE'] as const).map(
      (type, index) => ({
        id: randomUUID(),
        label: `Pergunta sintética ${index + 1}`,
        type,
        required: index !== 1,
        position: index + 1,
        options: [1, 2].map((position) => ({
          id: randomUUID(),
          label: `Alternativa ${index + 1}.${position}`,
          position,
        })),
      }),
    ),
  };
}
const path = (org: string, version: InstrumentVersion) =>
  `/api/v1/organizations/${org}/instruments/${version.instrumentId}/versions/${version.id}`;
async function createVersion(
  page: Page,
  org: string,
  usageMode: 'DEMONSTRATION' | 'REAL' = 'DEMONSTRATION',
) {
  const response = await page.request.post(`/api/v1/organizations/${org}/instruments`, {
    headers,
    data: { name: 'Catálogo sintético do editor' },
  });
  expect(response.status()).toBe(201);
  const created = createdInstrumentSchema.parse(await response.json());
  const saved = await page.request.put(path(org, created.version), {
    headers,
    data: draft(created.version, usageMode),
  });
  expect(saved.status()).toBe(200);
  return instrumentVersionSchema.parse(await saved.json());
}
async function openVersion(page: Page, version: InstrumentVersion) {
  await page.goto(`/#/instrumentos?instrument=${version.instrumentId}&version=${version.id}`);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Título da versão', { exact: true })).toHaveValue(version.title);
}
const test = base.extend<{ company: { id: string } }>({
  company: async ({ page }, use) => {
    await login(page);
    const name = `e2e-instruments-${randomUUID()}`;
    const response = await page.request.post('/api/v1/organizations', {
      headers,
      data: { name, fiscalIdentifier: null, timezone: 'America/Sao_Paulo' },
    });
    expect(response.status()).toBe(201);
    const company = organizationSchema.parse(await response.json());
    try {
      expect(
        (
          await page.request.put('/api/v1/auth/session/organization', {
            headers,
            data: { organizationId: company.id },
          })
        ).status(),
      ).toBe(200);
      await use({ id: company.id });
    } finally {
      await cleanupInstrumentsFixture(company.id, name);
    }
  },
});
// Login secrets and session cookies must never be written into traces or videos.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('cria instrumento por teclado, publica demonstração e persiste conteúdo somente leitura', async ({
  page,
  company,
}) => {
  await page.goto('/#/instrumentos');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: 'Novo instrumento', exact: true }),
  );
  await expect(page.getByLabel('Nome do instrumento', { exact: true })).toBeFocused();
  await page.keyboard.type('Instrumento criado pelo editor');
  await activateByKeyboard(page, page.getByRole('button', { name: 'Criar rascunho', exact: true }));
  await expect(page.getByLabel('Título da versão', { exact: true })).toBeEnabled();
  await page.getByLabel('Título da versão', { exact: true }).fill('Condições demonstrativas');
  await page
    .getByLabel('Instruções ao participante', { exact: true })
    .fill('Selecione uma alternativa.');
  await page.getByRole('button', { name: 'Adicionar pergunta', exact: true }).click();
  await expect(page.getByLabel('Enunciado da pergunta 1', { exact: true })).toBeFocused();
  await page.keyboard.type('Os recursos estão disponíveis?');
  await page.getByLabel('Opção 1 da pergunta 1', { exact: true }).fill('Sempre');
  await page.getByLabel('Opção 2 da pergunta 1', { exact: true }).fill('Às vezes');
  const preview = page.getByRole('region', { name: 'Prévia do participante' });
  await expect(
    preview.getByRole('heading', { name: 'Condições demonstrativas', exact: true }),
  ).toBeVisible();
  await preview.getByRole('radio', { name: 'Sempre', exact: true }).check();
  const publishing = page.waitForResponse(
    (response) => response.url().endsWith('/publish') && response.request().method() === 'POST',
  );
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: 'Publicar versão', exact: true }),
  );
  const response = await publishing;
  expect(response.status()).toBe(201);
  const published = instrumentVersionSchema.parse(await response.json());
  expect(published.organizationId).toBe(company.id);
  expect(published.status).toBe('PUBLISHED');
  expect(published.revision).toBe(3);
  expect(published.questions[0]?.options.map((option) => option.label)).toEqual([
    'Sempre',
    'Às vezes',
  ]);
  await page.reload();
  await expect(page.getByLabel('Título da versão', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Criar nova versão', exact: true })).toBeVisible();
  await expect(preview.getByRole('radio', { name: 'Sempre', exact: true })).not.toBeChecked();
});

test('apresenta três tipos, reordena com foco e cria versão sem modificar a publicação anterior', async ({
  page,
  company,
}) => {
  const original = await createVersion(page, company.id);
  await openVersion(page, original);
  const preview = page.getByRole('region', { name: 'Prévia do participante' });
  await expect(preview.getByRole('radio')).toHaveCount(4);
  await expect(preview.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('button', { name: 'Mover pergunta 1 para baixo', exact: true }).click();
  await expect(page.getByLabel('Enunciado da pergunta 2', { exact: true })).toBeFocused();
  const publication = page.waitForResponse(
    (response) => response.url().endsWith('/publish') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
  expect((await publication).status()).toBe(201);
  await expect(page.getByLabel('Título da versão', { exact: true })).toBeDisabled();
  const published = instrumentVersionSchema.parse(
    await (await page.request.get(path(company.id, original))).json(),
  );
  expect(published.status).toBe('PUBLISHED');
  expect(published.questions[0]?.type).toBe('MULTIPLE_CHOICE');
  await page.getByRole('button', { name: 'Criar nova versão', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versão 2', exact: true })).toBeVisible();
  const currentId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('version');
  const current = instrumentVersionSchema.parse(
    await (await page.request.get(path(company.id, { ...original, id: currentId! }))).json(),
  );
  expect(current.approvalReference).toBeNull();
  const oldIds = new Set(
    published.questions.flatMap((question) => [
      question.id,
      ...question.options.map((option) => option.id),
    ]),
  );
  expect(
    current.questions
      .flatMap((question) => [question.id, ...question.options.map((option) => option.id)])
      .some((id) => oldIds.has(id)),
  ).toBe(false);
  await page.getByLabel('Título da versão', { exact: true }).fill('Versão revisada');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(
    page.getByText('Rascunho salvo. A versão ainda não foi publicada.', { exact: true }),
  ).toBeVisible();
  expect(
    instrumentVersionSchema.parse(
      await (await page.request.get(path(company.id, original))).json(),
    ),
  ).toEqual(published);
});

test('uso real exige capacidade explícita e referência com foco no campo inválido', async ({
  page,
  company,
}) => {
  const version = await createVersion(page, company.id, 'REAL');
  await openVersion(page, version);
  await expect(page.getByRole('button', { name: 'Publicar versão', exact: true })).toBeDisabled();
  expect(
    (
      await page.request.post(`${path(company.id, version)}/publish`, {
        headers,
        data: {
          expectedRevision: version.revision,
          approvalReference: 'Referência não autorizada',
        },
      })
    ).status(),
  ).toBe(403);
  const session = sessionResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/session')).json(),
  );
  const membershipPath = `/api/v1/organizations/${company.id}/access-memberships/${session.user.id}`;
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
          reason: 'Autorização sintética somente neste cenário de teste',
        },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Publicar versão', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
  await expect(page.getByLabel('Referência de aprovação', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Referência de aprovação', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.keyboard.type('Ata sintética de aprovação técnica');
  await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
  await expect(
    page.getByText('Referência de aprovação: Ata sintética de aprovação técnica', { exact: true }),
  ).toBeVisible();
  const saved = instrumentVersionSchema.parse(
    await (await page.request.get(path(company.id, version))).json(),
  );
  expect(saved.publishedById).toBe(session.user.id);
  expect(saved.status).toBe('PUBLISHED');
});

test('falha temporária e revisão concorrente conservam a edição local sem sobrescrever o servidor', async ({
  page,
  company,
}) => {
  const version = await createVersion(page, company.id);
  await openVersion(page, version);
  const url = `**${path(company.id, version)}`;
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT')
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'UNAVAILABLE',
            message: 'Falha sintética temporária',
            requestId: 'synthetic',
          },
        },
      });
    return route.continue();
  });
  const title = page.getByLabel('Título da versão', { exact: true });
  await title.fill('Edição local preservada');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(title).toHaveValue('Edição local preservada');
  await page.unroute(url);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(
    page.getByText('Rascunho salvo. A versão ainda não foi publicada.', { exact: true }),
  ).toBeVisible();
  const remote = instrumentVersionSchema.parse(
    await (await page.request.get(path(company.id, version))).json(),
  );
  const updated = await page.request.put(path(company.id, version), {
    headers,
    data: { ...draft(remote), title: 'Edição concorrente confirmada', questions: remote.questions },
  });
  expect(updated.status()).toBe(200);
  await title.fill('Outra edição ainda não confirmada');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText(/Revisão desatualizada ou versão publicada/)).toBeVisible();
  await expect(title).toHaveValue('Outra edição ainda não confirmada');
  const persisted = instrumentVersionSchema.parse(
    await (await page.request.get(path(company.id, version))).json(),
  );
  expect(persisted.title).toBe('Edição concorrente confirmada');
});

test('leitor consulta catálogo publicado sem controles de criação ou edição', async ({ page }) => {
  await login(page, 'reader@renr.example');
  const session = sessionResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/session')).json(),
  );
  const org = session.activeOrganizationId!;
  const catalogs = instrumentListSchema.parse(
    await (await page.request.get(`/api/v1/organizations/${org}/instruments`)).json(),
  );
  expect(catalogs.items.length).toBeGreaterThan(0);
  await page.goto('/#/instrumentos');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Novo instrumento', exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: `Ver versões de ${catalogs.items[0]!.name}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Abrir versão 1', exact: true }).click();
  await expect(page.getByLabel('Título da versão', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Criar nova versão', exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/v1/organizations/${org}/instruments`, {
        headers,
        data: { name: 'Criação proibida' },
      })
    ).status(),
  ).toBe(403);
});
