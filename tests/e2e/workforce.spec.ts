import { randomUUID } from 'node:crypto';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import {
  employeeSchema,
  organizationSchema,
  unitSchema,
  sectorSchema,
  assessmentGroupSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { cleanupWorkforceFixture } from '../../scripts/workforce-e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
// Reach controls through the actual tab order; focus()/selectOption() would skip it.
async function tabTo(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  for (let index = 0; index < 80; index++) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
}
async function activate(page: Page, control: Locator) {
  await tabTo(page, control);
  await page.keyboard.press('Enter');
}
async function firstOption(page: Page, label: string, expectedId: string) {
  const control = page.getByLabel(label, { exact: true });
  await expect(control.locator(`option[value="${expectedId}"]`)).toHaveCount(1);
  await tabTo(page, control);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(control).toHaveValue(expectedId);
}
async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
const test = base.extend<{ company: { id: string; unitId: string; sectorId: string } }>({
  company: async ({ page }, use) => {
    await login(page);
    const name = `e2e-workforce-${randomUUID()}`;
    const created = await page.request.post('/api/v1/organizations', {
      headers,
      data: { name, fiscalIdentifier: null, timezone: 'America/Sao_Paulo' },
    });
    expect(created.status()).toBe(201);
    const company = organizationSchema.parse(await created.json());
    try {
      expect(
        (
          await page.request.put('/api/v1/auth/session/organization', {
            headers,
            data: { organizationId: company.id },
          })
        ).status(),
      ).toBe(200);
      const unitResponse = await page.request.post(`/api/v1/organizations/${company.id}/units`, {
        headers,
        data: { name: 'Unidade de teste', code: null },
      });
      expect(unitResponse.status()).toBe(201);
      const unit = unitSchema.parse(await unitResponse.json());
      const sectorResponse = await page.request.post(`/api/v1/units/${unit.id}/sectors`, {
        headers,
        data: { name: 'Atendimento de teste' },
      });
      expect(sectorResponse.status()).toBe(201);
      const sector = sectorSchema.parse(await sectorResponse.json());
      await page.goto('/#/colaboradores');
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(
        page.getByRole('button', { name: 'Novo colaborador', exact: true }),
      ).toBeVisible();
      await use({ id: company.id, unitId: unit.id, sectorId: sector.id });
    } finally {
      await cleanupWorkforceFixture(company.id, name);
    }
  },
});
// No passwords/session cookies in traces or videos. Screenshots only after authentication.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('cadastro nominal por teclado persiste, edita e desativa sem excluir histórico', async ({
  page,
  company,
}) => {
  const name =
    'Pessoa sintética com nome extenso para verificar leitura e quebra de linha no cadastro organizacional';
  await activate(page, page.getByRole('button', { name: 'Novo colaborador', exact: true }));
  await expect(page.getByLabel('Nome do colaborador', { exact: true })).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Tab');
  await page.keyboard.type('MAT-001');
  await firstOption(page, 'Unidade do cadastro', company.unitId);
  await firstOption(page, 'Setor do cadastro', company.sectorId);
  const savedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/employees') && response.request().method() === 'POST',
  );
  await activate(page, page.getByRole('button', { name: 'Salvar colaborador', exact: true }));
  const response = await savedResponse;
  expect(response.status()).toBe(201);
  const employee = employeeSchema.parse(await response.json());
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: `Editar colaborador ${name}`, exact: true }).click();
  await page.getByLabel('Nome do colaborador', { exact: true }).fill('Pessoa sintética revisada');
  await page.getByRole('button', { name: 'Salvar colaborador', exact: true }).click();
  await page
    .getByRole('button', { name: 'Desativar colaborador Pessoa sintética revisada', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Desativar colaborador', exact: true });
  await expect(dialog).toContainText('não revoga o acesso do usuário');
  await activate(page, dialog.getByRole('button', { name: 'Confirmar desativação', exact: true }));
  await expect(
    page.getByText('Colaborador desativado com histórico preservado.', { exact: true }),
  ).toBeVisible();
  const persisted = employeeSchema.parse(
    await (
      await page.request.get(`/api/v1/organizations/${company.id}/employees/${employee.id}`)
    ).json(),
  );
  expect(persisted.isActive).toBe(false);
  expect(persisted.name).toBe('Pessoa sintética revisada');
  expect(persisted.version).toBe(3);
});

test('grupo por setor é editável, tem composição preservada e pode ser desativado', async ({
  page,
  company,
}) => {
  await page.goto('/#/grupos');
  await page.waitForLoadState('networkidle');
  await activate(page, page.getByRole('button', { name: 'Novo grupo', exact: true }));
  await expect(page.getByLabel('Nome do grupo', { exact: true })).toBeFocused();
  await page.keyboard.type('Grupo coletivo de teste');
  await firstOption(page, 'Unidade do cadastro', company.unitId);
  await firstOption(page, 'Setor do cadastro', company.sectorId);
  await activate(page, page.getByRole('button', { name: 'Salvar grupo', exact: true }));
  await page
    .getByRole('button', { name: 'Editar grupo Grupo coletivo de teste', exact: true })
    .click();
  await expect(page.getByLabel('Setor do cadastro', { exact: true })).toHaveCount(0);
  await page.getByLabel('Nome do grupo', { exact: true }).fill('Grupo revisado de teste');
  await page.getByRole('button', { name: 'Salvar grupo', exact: true }).click();
  await page
    .getByRole('button', { name: 'Desativar grupo Grupo revisado de teste', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirmar desativação', exact: true }).click();
  await expect(
    page.getByText('Grupo desativado com histórico preservado.', { exact: true }),
  ).toBeVisible();
  const listing = await page.request.get(
    `/api/v1/organizations/${company.id}/assessment-groups?isActive=false`,
  );
  const body = await listing.json();
  const group = assessmentGroupSchema.parse(body.items[0]);
  expect(group.sectorId).toBe(company.sectorId);
  expect(group.name).toBe('Grupo revisado de teste');
  await page.getByRole('link', { name: 'Ver colaboradores do setor', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`sectorId=${company.sectorId}`));
});

test('empresa, unidade e setor são cadastrados percorrendo os formulários por teclado', async ({
  page,
}) => {
  await login(page);
  const name = `e2e-workforce-${randomUUID()}`;
  await activate(page, page.getByRole('button', { name: 'Nova empresa', exact: true }));
  await expect(page.getByLabel('Nome da empresa', { exact: true })).toBeFocused();
  await page.keyboard.type(name);
  await tabTo(page, page.getByLabel('Identificador fiscal', { exact: true }));
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Fuso horário', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('America/Recife');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/organizations') && response.request().method() === 'POST',
  );
  await activate(page, page.getByRole('button', { name: 'Salvar empresa', exact: true }));
  const response = await created;
  expect(response.status()).toBe(201);
  const company = organizationSchema.parse(await response.json());
  try {
    await activate(
      page,
      page.getByRole('button', { name: `Selecionar empresa ${name}`, exact: true }),
    );
    await activate(page, page.getByRole('button', { name: 'Nova unidade', exact: true }));
    await expect(page.getByLabel('Nome da unidade', { exact: true })).toBeFocused();
    await page.keyboard.type('Unidade por teclado');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Código', { exact: true })).toBeFocused();
    await page.keyboard.type('KEY-01');
    await activate(page, page.getByRole('button', { name: 'Salvar unidade', exact: true }));
    await activate(
      page,
      page.getByRole('link', { name: 'Ver setores de Unidade por teclado', exact: true }),
    );
    await activate(page, page.getByRole('button', { name: 'Novo setor', exact: true }));
    await expect(page.getByLabel('Nome do setor', { exact: true })).toBeFocused();
    await page.keyboard.type('Setor por teclado');
    await activate(page, page.getByRole('button', { name: 'Salvar setor', exact: true }));
    await expect(
      page.getByRole('heading', { name: 'Setor por teclado', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await cleanupWorkforceFixture(company.id, name);
  }
});

test('paginação e filtros permanecem ao editar, cancelar, voltar e recarregar', async ({
  page,
  company,
}) => {
  test.setTimeout(60000);
  for (let index = 0; index < 21; index++) {
    const result = await page.request.post(`/api/v1/organizations/${company.id}/employees`, {
      headers,
      data: {
        name: `Colaborador ${String(index).padStart(2, '0')}`,
        unitId: company.unitId,
        sectorId: company.sectorId,
      },
    });
    expect(result.status()).toBe(201);
  }
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Paginação de colaboradores', exact: true })
    .getByRole('button', { name: 'Próxima página', exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole('button', { name: 'Editar colaborador Colaborador 20', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByLabel('Buscar colaboradores', { exact: true }).fill('Colaborador 00');
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole('heading', { name: 'Colaborador 00', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Buscar colaboradores', { exact: true })).toHaveValue(
    'Colaborador 00',
  );
  await page.goBack();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole('heading', { name: 'Colaborador 20', exact: true })).toBeVisible();
});

test('leitor não recebe acesso ao cadastro nominal nem pela URL direta', async ({ page }) => {
  await login(page, 'reader@renr.example');
  await page.goto('/#/colaboradores');
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByText('Somente administradores podem gerenciar colaboradores e grupos de avaliação.', {
      exact: true,
    }),
  ).toBeVisible();
  const result = await page.request.get(
    '/api/v1/organizations/10000000-0000-4000-8000-000000000001/employees',
  );
  expect(result.status()).toBe(403);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
