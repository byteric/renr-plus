import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';
import { companyGroupListSchema, reportSnapshotSchema } from '../../packages/contracts/src/index';

const requireApi = createRequire(resolve('apps/api/package.json'));
const disposableDb = /^\/renr_e2e_(?:[a-f0-9]{32}|[a-f0-9-]{36})$/i;
const origin = 'http://127.0.0.1:5173';
const headers = { Origin: origin };

async function prepareScenario() {
  const connection = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  if (
    !disposableDb.test(connection.pathname) ||
    (connection.searchParams.get('schema') ?? 'public') !== 'public'
  )
    throw new Error('A jornada do ID 44 exige uma base local descartável de testes.');
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });
  const tag = randomUUID().slice(0, 8);
  const password = `Id44!${randomUUID()}`;
  const account = (name: string, email: string) => ({
    id: randomUUID(),
    name,
    email: `${email}-${tag}@example.test`,
  });
  const admin = account('Administração ID44', 'administracao');
  const director = account('Diretoria ID44', 'diretoria');
  const manager = account('Gestor ID44', 'gestor');
  const local = (await hashPassword(password)) as string;
  try {
    const structure = await db.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [admin, director, manager].map((user) => ({ ...user, passwordHash: local })),
      });
      await tx.platformGrant.createMany({
        data: [
          { userId: admin.id, capability: 'MANAGE_CLIENTS' },
          { userId: admin.id, capability: 'MANAGE_GRANTS' },
        ],
      });
      const companies = [];
      for (const label of ['Recife', 'Olinda', 'Externa']) {
        const company = await tx.organization.create({
          data: { name: `${label} ID44 ${tag}`, clientClassification: 'DEMONSTRATION' },
        });
        const unit = await tx.unit.create({
          data: {
            name: `Unidade ${label}`,
            normalizedName: `unidade ${label.toLowerCase()}`,
            organizationId: company.id,
          },
        });
        const sector = await tx.sector.create({
          data: {
            name: `Setor ${label}`,
            normalizedName: `setor ${label.toLowerCase()}`,
            unitId: unit.id,
            organizationId: company.id,
          },
        });
        await tx.employee.create({
          data: {
            name: 'Colaborador sintético',
            organizationId: company.id,
            unitId: unit.id,
            sectorId: sector.id,
          },
        });
        companies.push({ id: company.id, name: company.name, unit, sector });
      }
      const [first, second, third] = companies;
      if (!first || !second || !third) throw new Error('O cenário exige três empresas.');
      const otherUnit = await tx.unit.create({
        data: {
          name: 'Unidade fora do recorte',
          normalizedName: 'unidade fora do recorte',
          organizationId: first.id,
        },
      });
      const otherSector = await tx.sector.create({
        data: {
          name: 'Setor restrito',
          normalizedName: 'setor restrito',
          organizationId: first.id,
          unitId: otherUnit.id,
        },
      });
      async function risk(sectorId: string, factor: string) {
        const assessment = await tx.assessmentGroup.create({
          data: {
            organizationId: first.id,
            sectorId,
            name: factor,
          },
        });
        return tx.risk.create({
          data: {
            organizationId: first.id,
            assessmentGroupId: assessment.id,
            factor,
            createdById: admin.id,
            updatedById: admin.id,
          },
        });
      }
      const ownRisk = await risk(first.sector.id, 'Risco autorizado');
      const otherRisk = await risk(otherSector.id, 'Risco fora do recorte');
      await tx.membership.createMany({
        data: [
          {
            userId: admin.id,
            organizationId: first.id,
            role: 'ADMIN',
            capabilities: ['TECHNICAL_DECISIONS'],
          },
          {
            userId: manager.id,
            organizationId: first.id,
            role: 'READER',
            capabilities: ['EXECUTE_ASSIGNED_ACTIONS'],
          },
        ],
      });
      const method = await tx.evaluationMethod.create({
        data: {
          organizationId: first.id,
          name: 'Método fora do recorte',
          createdById: admin.id,
        },
      });
      const scale = (prefix: string) =>
        [1, 2].map((position) => ({
          key: `${prefix}${position}`,
          label: `${prefix} ${position}`,
          description: 'Critério fictício',
          position,
        }));
      const outsideMethod = await tx.evaluationMethodVersion.create({
        data: {
          organizationId: first.id,
          methodId: method.id,
          title: method.name,
          version: 1,
          status: 'PUBLISHED',
          approvalReference: 'Aprovação exclusivamente sintética',
          publishedAt: new Date(),
          publishedById: admin.id,
          createdById: admin.id,
          definition: {
            probability: scale('p'),
            severity: scale('s'),
            levels: [{ key: 'low', label: 'Baixo' }],
            priorities: [{ key: 'review', label: 'Revisar', rank: 1 }],
            matrix: [1, 2].flatMap((p) =>
              [1, 2].map((s) => ({
                probabilityKey: `p${p}`,
                severityKey: `s${s}`,
                levelKey: 'low',
                priorityKey: 'review',
              })),
            ),
          },
        },
      });
      const outsideInstrument = await tx.instrumentVersion.create({
        data: {
          organizationId: first.id,
          title: 'Instrumento fora do recorte',
          version: 1,
        },
      });
      const question = await tx.diagnosticQuestion.create({
        data: {
          instrumentVersionId: outsideInstrument.id,
          label: 'Pergunta de teste',
          type: 'SINGLE_CHOICE',
          position: 1,
        },
      });
      await tx.questionOption.createMany({
        data: ['Sim', 'Não'].map((label, index) => ({
          instrumentVersionId: outsideInstrument.id,
          questionId: question.id,
          label,
          position: index + 1,
        })),
      });
      const outsidePolicy = await tx.consolidationPolicyVersion.create({
        data: {
          organizationId: first.id,
          status: 'PUBLISHED',
          usageMode: 'DEMONSTRATION',
          version: 1,
          minimumResponses: 5,
          publishedById: admin.id,
          publishedAt: new Date(),
        },
      });
      return {
        first,
        second,
        third,
        otherUnit,
        ownRisk,
        otherRisk,
        outsideMethod,
        outsideInstrument,
        outsidePolicy,
      };
    });
    return { ...structure, tag, admin, director, manager, password };
  } finally {
    await db.$disconnect();
  }
}

async function login(page: Page, email: string, password: string, route = '') {
  await page.goto(`/#/${route}`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acesse o ReNR+' })).toBeVisible();
}

test('ID 44 separa consolidado, operações da empresa e recortes revogados em sessão aberta', async ({
  page,
  request,
}, info) => {
  const {
    first,
    second,
    third,
    otherUnit,
    ownRisk,
    otherRisk,
    outsideMethod,
    outsideInstrument,
    outsidePolicy,
    tag,
    admin,
    director,
    manager,
    password,
  } = await prepareScenario();
  const name = `Grupo Horizonte ${tag}`;
  await login(page, admin.email, password, 'plataforma/grupos');
  await page.getByRole('button', { name: 'Novo grupo de empresas' }).click();
  await page.getByLabel('Nome ou CNPJ').fill(tag);
  await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click();
  await page.getByRole('button', { name: `Incluir ${first.name}`, exact: true }).click();
  await page.getByRole('button', { name: `Incluir ${second.name}`, exact: true }).click();
  await page.getByLabel('Nome do grupo').fill(name);
  await page
    .getByLabel('Justificativa', { exact: true })
    .fill('Vínculo de empresas fictícias para verificação.');
  await page.getByRole('button', { name: 'Salvar composição', exact: true }).click();
  await expect(page.getByText('Composição do grupo salva.')).toBeVisible();
  await page.getByRole('button', { name: `Gerenciar consultas de ${name}` }).click();
  await page.getByLabel('E-mail da conta').fill(director.email);
  await page
    .getByLabel('Justificativa', { exact: true })
    .fill('Consulta executiva de grupo fictício.');
  await page.getByRole('button', { name: 'Conceder consulta', exact: true }).click();
  await expect(page.getByText('Consulta ao grupo concedida.')).toBeVisible();

  await page.goto('/#/acessos');
  await page
    .getByRole('listitem')
    .filter({ hasText: manager.email })
    .getByRole('button', { name: 'Gerenciar' })
    .click();
  await page.getByRole('button', { name: 'Gerenciar recortes do vínculo' }).click();
  await page.getByLabel('Unidade autorizada').selectOption(first.unit.id);
  await page.getByRole('button', { name: 'Adicionar recorte' }).click();
  await page
    .getByLabel('Justificativa dos recortes')
    .fill('Limitar o gestor a sua própria unidade.');
  await page.getByRole('button', { name: 'Salvar recortes' }).click();
  await expect(page.getByText('Recortes do vínculo atualizados.')).toBeVisible();

  expect(
    (
      await request.post('/api/v1/auth/sessions', {
        headers,
        data: { email: admin.email, password },
      })
    ).status(),
  ).toBe(201);
  const reportPath = `/api/v1/organizations/${first.id}/reports`;
  const orgPath = `/api/v1/organizations/${first.id}`;
  const assignees = await request.get(`${orgPath}/action-assignees`);
  expect(assignees.status()).toBe(200);
  expect.soft(await assignees.json()).toMatchObject({
    items: expect.arrayContaining([{ userId: manager.id, name: manager.name, canExecute: false }]),
  });
  const emitted = await request.post(reportPath, {
    headers,
    data: { kind: 'SST', unitId: first.unit.id },
  });
  expect(emitted.status()).toBe(201);
  const report = reportSnapshotSchema.parse(await emitted.json());
  const scopePath = `/api/v1/organizations/${first.id}/access-memberships/${manager.id}/scopes`;

  await logout(page);
  await login(page, director.email, password);
  await expect(page.getByRole('heading', { name: 'Consolidado de empresas' })).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const summary = page.getByRole('region', { name, exact: true });
  await expect(summary.getByText('2 empresas no recorte autorizado')).toBeVisible();
  await expect(summary.locator('dd').first()).toHaveText('2');
  await expect(page.getByRole('heading', { name: first.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: second.name })).toBeVisible();
  await expect(page.getByText(third.name, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Empresa ativa')).toHaveCount(0);
  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: 'Modo escuro' }).click();
    await expect(page.getByRole('button', { name: 'Modo claro' })).toBeVisible();
  }
  await page.screenshot({
    path: info.outputPath('consolidado.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: `Ver indicadores de ${second.name}` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Empresa no consolidado')).toBeFocused();
  await expect(page.getByLabel('Empresa no consolidado')).toHaveValue(second.id);
  await expect(page.getByRole('heading', { name: first.name })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: second.name })).toBeVisible();
  const groups = companyGroupListSchema.parse(
    await (await page.request.get('/api/v1/company-groups')).json(),
  );
  const groupId = groups.items.find((group) => group.name === name)?.id;
  expect(groupId).toBeDefined();
  expect(
    (
      await page.request.get(`/api/v1/company-groups/${groupId}?organizationId=${third.id}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.put(`/api/v1/platform/company-groups/${groupId}/grants`, {
        headers,
        data: {
          email: director.email,
          active: false,
          reason: 'Encerramento da verificação.',
          version: 1,
        },
      })
    ).status(),
  ).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Você está sem acesso a grupos de empresas.')).toBeVisible();
  await expect(page.getByText(second.name, { exact: true })).toHaveCount(0);

  await logout(page);
  await login(page, manager.email, password, 'unidades');
  await expect(page.getByText('Acesso por unidade ou setor')).toBeVisible();
  await expect(page.getByText(first.unit.name, { exact: true })).toBeVisible();
  await expect(page.getByText(otherUnit.name, { exact: true })).toHaveCount(0);
  expect([403, 404]).toContain(
    (await page.request.get(`/api/v1/units/${otherUnit.id}/sectors`)).status(),
  );
  expect((await page.request.get(`${orgPath}/risks/${ownRisk.id}`)).status()).toBe(200);
  expect((await page.request.get(`${orgPath}/risks/${ownRisk.id}/history`)).status()).toBe(200);
  expect((await page.request.get(`${orgPath}/risks/${otherRisk.id}`)).status()).toBe(404);
  expect((await page.request.get(`${orgPath}/risks/${otherRisk.id}/history`)).status()).toBe(404);
  expect(
    (
      await page.request.patch(`${orgPath}/risks/${otherRisk.id}`, {
        headers,
        data: { expectedVersion: 1, factor: 'Alteração proibida' },
      })
    ).status(),
  ).toBe(403);
  const pdfPath = `${reportPath}/${report.id}/pdf`;
  const methods = await page.request.get(`${orgPath}/evaluation-method-versions?status=PUBLISHED`);
  expect.soft(methods.status()).toBe(200);
  expect.soft(await methods.json()).toMatchObject({ items: [] });
  expect
    .soft(
      (
        await page.request.get(
          `${orgPath}/risk-workspaces/matrix?methodVersionId=${outsideMethod.id}`,
        )
      ).status(),
    )
    .toBe(404);
  expect
    .soft(
      (
        await page.request.get(
          `${orgPath}/assessment-consolidation?instrumentVersionId=${outsideInstrument.id}&policyVersionId=${outsidePolicy.id}`,
        )
      ).status(),
    )
    .toBe(404);
  await page.goto('/#/coletas?view=consolidation');
  await expect(page.getByText('Nenhuma coleta no seu recorte.')).toBeVisible();
  await page.goto('/#/unidades');
  expect((await page.request.get(pdfPath)).status()).toBe(200);
  const { version } = (await (await request.get(scopePath)).json()) as { version: number };
  expect(
    (
      await request.put(scopePath, {
        headers,
        data: { scopes: [], expectedVersion: version, reason: 'Revogação durante o teste.' },
      })
    ).status(),
  ).toBe(200);
  expect([403, 404]).toContain((await page.request.get(pdfPath)).status());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText('Seu vínculo está sem unidades ou setores autorizados.'),
  ).toBeVisible();
  await expect(page.getByText(first.unit.name, { exact: true })).toHaveCount(0);
});
