import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import {
  accessInviteSecretSchema,
  accessMembershipListSchema,
  organizationSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { cleanupAccessFixtures } from '../../scripts/access-e2e-data.mjs';
import { navigateWorkspace } from './navigation';

const headers = { Origin: 'http://127.0.0.1:5173' };
type Fixture = { id: string; email: string; name: string; memberName: string };
const test = base.extend<{ company: Fixture }>({
  company: async ({ page }, use) => {
    const suffix = randomUUID();
    const name = `e2e-access-${suffix}`;
    const email = `e2e-access-${suffix}@example.test`;
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
    await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
    const created = await page.request.post('/api/v1/organizations', {
      headers,
      data: { name, timezone: 'America/Sao_Paulo', fiscalIdentifier: null },
    });
    expect(created.status()).toBe(201);
    const org = organizationSchema.parse(await created.json());
    try {
      expect(
        (
          await page.request.put('/api/v1/auth/session/organization', {
            headers,
            data: { organizationId: org.id },
          })
        ).status(),
      ).toBe(200);
      await page.goto('/#/acessos');
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Membros da empresa', exact: true }),
      ).toBeVisible();
      await use({ id: org.id, email, name, memberName: 'Pessoa convidada sintética' });
    } finally {
      await cleanupAccessFixtures(org.id, name, email);
    }
  },
});
// Access links, passwords and cookies must never be retained in traces/videos/artifacts.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function apiInvite(request: APIRequestContext, company: Fixture) {
  const result = await request.post(`/api/v1/organizations/${company.id}/access-invites`, {
    headers,
    data: {
      name: company.memberName,
      email: company.email,
      role: 'READER',
      capabilities: [],
      expiresInHours: 72,
      reason: 'Convite sintético de verificação',
    },
  });
  expect(result.status()).toBe(201);
  return accessInviteSecretSchema.parse(await result.json());
}
async function createMember(request: APIRequestContext, company: Fixture) {
  const { token } = await apiInvite(request, company);
  expect(
    (
      await request.post('/api/v1/access-invites/accept', {
        headers,
        data: { token, name: company.memberName, password: demoPassword() },
      })
    ).status(),
  ).toBe(201);
  const result = accessMembershipListSchema.parse(
    await (await request.get(`/api/v1/organizations/${company.id}/access-memberships`)).json(),
  );
  const member = result.items.find((item) => item.email === company.email);
  if (!member) throw new Error('Synthetic member not created.');
  return member;
}

test('gestor emite convite e nova conta ativa sem guardar o segredo no navegador', async ({
  page,
  browser,
  company,
}) => {
  await page.getByRole('button', { name: 'Convites de acesso', exact: true }).click();
  await page.getByRole('button', { name: 'Novo convite', exact: true }).click();
  await page.getByLabel('Nome da pessoa', { exact: true }).fill(company.memberName);
  await page.getByLabel('E-mail da pessoa', { exact: true }).fill(company.email);
  await page
    .getByLabel('Justificativa do convite', { exact: true })
    .fill('Entrada sintética autorizada');
  await page.getByRole('button', { name: 'Emitir convite', exact: true }).click();
  const link = await page.getByLabel('Link de ativação — exibição única').inputValue();
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(link);
    await recipient.getByRole('button', { name: 'Criar meu acesso', exact: true }).click();
    expect(new URL(recipient.url()).hash).toBe('#/ativar');
    await recipient.getByLabel('Seu nome', { exact: true }).fill(company.memberName);
    await recipient.getByLabel('Nova senha', { exact: true }).fill(demoPassword());
    await recipient.getByLabel('Confirmar nova senha', { exact: true }).fill(demoPassword());
    await recipient.getByRole('button', { name: 'Ativar acesso', exact: true }).click();
    await expect(recipient.getByRole('status').filter({ hasText: 'Acesso ativado' })).toBeVisible();
    const stored = await recipient.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(stored).toEqual({ local: ['renr-theme'], session: [] });
    await recipient
      .getByRole('link', { name: 'Ir para o espaço de trabalho', exact: true })
      .click();
    await recipient.getByLabel('E-mail', { exact: true }).fill(company.email);
    await recipient.getByLabel('Senha', { exact: true }).fill(demoPassword());
    await recipient.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(recipient.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
    await recipient.goto('/#/acessos');
    await expect(recipient.getByRole('alert')).toContainText('Somente administradores');
  } finally {
    await context.close();
  }
  await page.getByRole('button', { name: 'Fechar link secreto', exact: true }).click();
  await expect(page.getByLabel('Link de ativação — exibição única')).toHaveCount(0);
});

test('gestor concede capacidade com histórico e desativa vínculo sem remover autoria', async ({
  page,
  company,
}) => {
  const member = await createMember(page.request, company);
  await page.getByRole('button', { name: 'Atualizar acessos', exact: true }).click();
  await page.getByRole('button', { name: `Gerenciar ${company.memberName}`, exact: true }).click();
  await page.getByLabel('Decisões técnicas', { exact: true }).check();
  await page
    .getByLabel('Justificativa da alteração', { exact: true })
    .fill('Autorização técnica sintética');
  await page.getByRole('button', { name: 'Salvar capacidades', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Vínculo atualizado' })).toBeVisible();
  await page.getByRole('button', { name: 'Histórico de acessos', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Decisões técnicas concedidas', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Autorização técnica sintética', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Membros da empresa', exact: true }).click();
  await page.getByRole('button', { name: `Gerenciar ${company.memberName}`, exact: true }).click();
  await page.getByLabel('Vínculo ativo', { exact: true }).uncheck();
  await page.getByLabel('Confirmo a desativação deste vínculo', { exact: true }).check();
  await page
    .getByLabel('Justificativa da alteração', { exact: true })
    .fill('Desativação sintética');
  await page.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Vínculo atualizado' })).toBeVisible();
  const response = await page.request.get(
    `/api/v1/organizations/${company.id}/access-memberships/${member.userId}`,
  );
  expect((await response.json()).isActive).toBe(false);
});

test('reemissão invalida link anterior e revogação orienta recuperação', async ({
  page,
  browser,
  company,
}) => {
  const original = await apiInvite(page.request, company);
  await page.getByRole('button', { name: 'Convites de acesso', exact: true }).click();
  await page
    .getByRole('button', { name: `Reemitir convite de ${company.memberName}`, exact: true })
    .click();
  await page.getByLabel('Justificativa do convite', { exact: true }).fill('Reemissão sintética');
  await page.getByRole('button', { name: 'Confirmar reemissão', exact: true }).click();
  const newLink = await page.getByLabel('Link de ativação — exibição única').inputValue();
  const replay = await page.request.post('/api/v1/access-invites/accept', {
    headers,
    data: { token: original.token, name: company.memberName, password: demoPassword() },
  });
  expect(replay.status()).toBe(409);
  expect((await replay.json()).code).toBe('ACCESS_INVITE_UNAVAILABLE');
  await page.getByRole('button', { name: 'Fechar link secreto', exact: true }).click();
  await page
    .getByRole('button', { name: `Revogar convite de ${company.memberName}`, exact: true })
    .click();
  await page.getByLabel('Justificativa do convite', { exact: true }).fill('Revogação sintética');
  await page.getByRole('button', { name: 'Confirmar revogação', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Convite revogado' })).toBeVisible();
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(newLink);
    await recipient.getByRole('button', { name: 'Criar meu acesso', exact: true }).click();
    await recipient.getByLabel('Seu nome', { exact: true }).fill(company.memberName);
    await recipient.getByLabel('Nova senha', { exact: true }).fill(demoPassword());
    await recipient.getByLabel('Confirmar nova senha', { exact: true }).fill(demoPassword());
    await recipient.getByRole('button', { name: 'Ativar acesso', exact: true }).click();
    await expect(recipient.getByRole('alert')).toContainText(
      'Solicite a reemissão ao administrador',
    );
    await expect(recipient.getByRole('button', { name: 'Ativar acesso', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

test('troca de empresa remove registros anteriores e nega consulta fora do contexto', async ({
  page,
  company,
}) => {
  await createMember(page.request, company);
  await page.getByRole('button', { name: 'Atualizar acessos', exact: true }).click();
  await expect(page.getByRole('heading', { name: company.memberName, exact: true })).toBeVisible();
  await page
    .getByLabel('Empresa ativa', { exact: true })
    .selectOption('10000000-0000-4000-8000-000000000001');
  // Switching organization also changes the route and closes the mobile navigation.
  // Wait for that transition before opening the next workspace.
  await expect(page).toHaveURL(/#\/unidades$/);
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  await expect(page.getByLabel('Empresa ativa', { exact: true })).toBeEnabled();
  await navigateWorkspace(page, 'Acessos');
  await expect(page.getByRole('heading', { name: company.memberName, exact: true })).toHaveCount(0);
  expect(
    (await page.request.get(`/api/v1/organizations/${company.id}/access-memberships`)).status(),
  ).toBe(404);
});

test('pessoa com conta entra com sua própria senha para aceitar outro vínculo', async ({
  page,
  browser,
  company,
}) => {
  const response = await page.request.post(`/api/v1/organizations/${company.id}/access-invites`, {
    headers,
    data: {
      email: 'reader@renr.example',
      name: 'Leitor demonstração',
      role: 'READER',
      capabilities: [],
      expiresInHours: 72,
      reason: 'Vínculo sintético de conta existente',
    },
  });
  expect(response.status()).toBe(201);
  const { token } = accessInviteSecretSchema.parse(await response.json());
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(`/#/ativar/${token}`);
    await recipient.getByRole('button', { name: 'Já tenho conta', exact: true }).click();
    await recipient.getByLabel('E-mail', { exact: true }).fill('reader@renr.example');
    await recipient.getByLabel('Senha', { exact: true }).fill(demoPassword());
    await recipient.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(
      recipient.getByRole('button', { name: 'Aceitar vínculo', exact: true }),
    ).toBeVisible();
    await expect(recipient.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
    await recipient.getByRole('button', { name: 'Aceitar vínculo', exact: true }).click();
    await expect(
      recipient.getByRole('status').filter({ hasText: 'Vínculo ativado' }),
    ).toBeVisible();
    const session = await (await recipient.request.get('/api/v1/auth/session')).json();
    expect(
      session.memberships.some(
        (item: { organizationId: string }) => item.organizationId === company.id,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
