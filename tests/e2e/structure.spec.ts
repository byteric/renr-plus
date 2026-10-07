import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { organizationSchema } from '../../packages/contracts/src/index';
import { demoPassword, cleanupTestOrganization } from '../../scripts/e2e-data.mjs';

const origin = 'http://127.0.0.1:5173';
const headers = { Origin: origin };
const test = base.extend<{ createdOrganizations: { id: string; name: string }[] }>({
  createdOrganizations: async ({ page }, use) => {
    const created: { id: string; name: string }[] = [];
    try {
      await use(created);
    } finally {
      const result = await page.context().request.delete('/api/v1/auth/session', { headers });
      expect([204, 401]).toContain(result.status());
      for (const item of created) await cleanupTestOrganization(item.id, item.name);
    }
  },
});
// Authentication data must not be captured in network traces or videos.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
async function selectDemo(page: Page) {
  await page
    .getByRole('button', { name: 'Selecionar empresa Empresa demonstração 1', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
}

test('estrutura completa persiste após recarga e permite editar e inativar setor', async ({
  page,
  createdOrganizations,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const name = `e2e-v01-${randomUUID().slice(0, 8)}`;
  await login(page);
  await page.getByRole('button', { name: 'Nova empresa', exact: true }).click();
  await page.getByLabel('Nome da empresa', { exact: true }).fill(name);
  await page.getByLabel('Fuso horário', { exact: true }).fill('America/Recife');
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/organizations') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar empresa', exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const organization = organizationSchema.parse(await response.json());
  createdOrganizations.push({ id: organization.id, name });
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Selecionar empresa ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nova unidade', exact: true }).click();
  await page.getByLabel('Nome da unidade', { exact: true }).fill('Matriz de demonstração');
  await page.getByLabel('Código', { exact: true }).fill('DEMO-01');
  await page.getByRole('button', { name: 'Salvar unidade', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Matriz de demonstração', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Matriz de demonstração', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Ver setores de Matriz de demonstração', exact: true })
    .click();
  await page.getByRole('button', { name: 'Novo setor', exact: true }).click();
  await page.getByLabel('Nome do setor', { exact: true }).fill('Recursos humanos');
  await page.getByRole('button', { name: 'Salvar setor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recursos humanos', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recursos humanos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar setor Recursos humanos', exact: true }).click();
  await page.getByLabel('Nome do setor', { exact: true }).fill('Gestão de pessoas');
  await page.getByLabel('Cadastro ativo', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Salvar setor', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gestão de pessoas', exact: true })).toBeVisible();
  await expect(page.getByText('Inativo', { exact: true })).toBeVisible();
  // An inactive company must remain selectable so an administrator can reactivate it.
  await page.getByRole('link', { name: 'Empresas', exact: true }).click();
  await page.getByRole('button', { name: `Editar empresa ${name}`, exact: true }).click();
  await page.getByLabel('Cadastro ativo', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Salvar empresa', exact: true }).click();
  await selectDemo(page);
  await page.getByRole('link', { name: 'Empresas', exact: true }).click();
  await page.getByRole('button', { name: `Selecionar empresa ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Empresas', exact: true }).click();
  await page.getByRole('button', { name: `Editar empresa ${name}`, exact: true }).click();
  await page.getByLabel('Cadastro ativo', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar empresa', exact: true }).click();
  await page.reload();
  const companyCard = page.getByRole('heading', { name, exact: true }).locator('..');
  await expect(companyCard.getByText('Ativo', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('campos inválidos recebem mensagem específica e o cadastro não é criado', async ({
  page,
  createdOrganizations,
}) => {
  expect(createdOrganizations).toHaveLength(0);
  await login(page);
  await page.getByRole('button', { name: 'Nova empresa', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar empresa', exact: true }).click();
  await expect(page.getByText('Use entre 2 e 120 caracteres.', { exact: true })).toBeVisible();
  await page.getByLabel('Nome da empresa', { exact: true }).fill('Empresa fictícia válida');
  await page.getByLabel('Fuso horário', { exact: true }).fill('Nao/Existe');
  await page.getByRole('button', { name: 'Salvar empresa', exact: true }).click();
  await expect(
    page.getByText('Informe um fuso horário IANA, como America/Sao_Paulo.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Nome da empresa', { exact: true })).toHaveValue(
    'Empresa fictícia válida',
  );
  const invalid = await page.context().request.post('/api/v1/organizations', {
    headers,
    data: { name: 'x', timezone: 'Nao/Existe' },
  });
  expect(invalid.status()).toBe(400);
});

test('leitor consulta mas não cria empresa ou unidade, inclusive pela API', async ({
  page,
  createdOrganizations,
}) => {
  expect(createdOrganizations).toHaveLength(0);
  await login(page, 'reader@renr.example');
  await expect(page.getByRole('button', { name: 'Nova empresa', exact: true })).toHaveCount(0);
  await selectDemo(page);
  await expect(page.getByText('Somente leitura', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova unidade', exact: true })).toHaveCount(0);
  const create = await page
    .context()
    .request.post('/api/v1/organizations/10000000-0000-4000-8000-000000000001/units', {
      headers,
      data: { name: 'Forbidden unit' },
    });
  expect(create.status()).toBe(403);
  const company = await page
    .context()
    .request.post('/api/v1/organizations', { headers, data: { name: 'Forbidden company' } });
  expect(company.status()).toBe(403);
});

test('empresa externa é recusada pela API e origem externa não altera sessão', async ({
  page,
  createdOrganizations,
}) => {
  expect(createdOrganizations).toHaveLength(0);
  await login(page);
  await expect(
    page.getByRole('heading', { name: 'Empresa demonstração 2', exact: true }),
  ).toHaveCount(0);
  const result = await page
    .context()
    .request.get('/api/v1/organizations/10000000-0000-4000-8000-000000000002/units');
  expect(result.status()).toBe(404);
  const mutation = await page
    .context()
    .request.post('/api/v1/organizations/10000000-0000-4000-8000-000000000002/units', {
      headers,
      data: { name: 'Forbidden unit' },
    });
  expect(mutation.status()).toBe(404);
  const csrf = await page.context().request.put('/api/v1/auth/session/organization', {
    headers: { Origin: 'https://foreign.example' },
    data: { organizationId: '10000000-0000-4000-8000-000000000001' },
  });
  expect(csrf.status()).toBe(403);
});

test('logout invalida a sessão no servidor e impede a reabertura do espaço privado', async ({
  page,
  createdOrganizations,
}) => {
  expect(createdOrganizations).toHaveLength(0);
  await login(page);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
  const response = await page.context().request.get('/api/v1/auth/session');
  expect(response.status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toHaveCount(0);
});

test('falha de gravação preserva o rascunho e permite correção sem perda de texto', async ({
  page,
  createdOrganizations,
}) => {
  expect(createdOrganizations).toHaveLength(0);
  await login(page);
  await selectDemo(page);
  await page.getByRole('button', { name: 'Nova unidade', exact: true }).click();
  await page.getByLabel('Nome da unidade', { exact: true }).fill('Unidade em rascunho');
  await page.route('**/api/v1/organizations/*/units', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Salvar unidade', exact: true }).click();
  await expect(
    page.getByText('Serviço temporariamente indisponível. Tente novamente em instantes.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Nome da unidade', { exact: true })).toHaveValue(
    'Unidade em rascunho',
  );
  await expect(page.getByRole('button', { name: 'Salvar unidade', exact: true })).toBeEnabled();
});

test('telas reais de demonstração são legíveis e cabem no viewport', async ({
  page,
  createdOrganizations,
}, testInfo) => {
  expect(createdOrganizations).toHaveLength(0);
  const destination = resolve('../tmp/apresentacao-v01/screenshots');
  await mkdir(destination, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+', exact: true })).toBeVisible();
  if (testInfo.project.name === 'desktop')
    await page.screenshot({ path: resolve(destination, 'login-desktop.png'), fullPage: true });
  await login(page);
  await selectDemo(page);
  await expect(
    page.getByRole('heading', { name: 'Unidade demonstração', exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === 'desktop')
    await page.screenshot({ path: resolve(destination, 'units-desktop.png'), fullPage: true });
  await page
    .getByRole('link', { name: 'Ver setores de Unidade demonstração', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Setor demonstração', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (testInfo.project.name === 'mobile')
    await page.screenshot({ path: resolve(destination, 'sectors-mobile.png'), fullPage: true });
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Modo escuro', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: resolve(destination, 'sectors-dark.png'), fullPage: true });
  }
});
