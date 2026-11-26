import { mkdirSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import {
  clientRegistrationSchema,
  platformClientListSchema,
} from '../../packages/contracts/src/index';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const requireApi = createRequire(resolve('apps/api/package.json'));
const origin = 'http://127.0.0.1:5173';
const evidenceDir = resolve(process.cwd(), 'tmp/evidencias-id51');

function saoPauloReferenceDate(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function shiftDays(isoDate: string, deltaDays: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function competenceShift(isoDate: string, deltaMonths: number): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, month + deltaMonths, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function randomCnpj() {
  const base = `${randomInt(10_000_000, 100_000_000)}0001`;
  const checkDigit = (digits: string) => {
    const sum = [...digits]
      .reverse()
      .reduce((total, digit, index) => total + Number(digit) * (2 + (index % 8)), 0);
    const remainder = sum % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  };
  const first = checkDigit(base);
  return `${base}${first}${checkDigit(base + first)}`;
}

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const dotenv = requireApi('dotenv') as { config: (opts: { path: string }) => void };
  dotenv.config({ path: resolve('apps/api/.env') });
  return process.env.DATABASE_URL ?? '';
}

async function prepareId51Scenario(isDesktop: boolean) {
  const connection = localDatabaseUrl(loadDatabaseUrl());
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });

  const tag = `${isDesktop ? 'desk' : 'mob'}-${randomUUID().slice(0, 6)}`;
  const password = `Id51!${randomUUID()}`;
  const passwordHash = (await hashPassword(password)) as string;
  const today = saoPauloReferenceDate();
  const civilDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const devStudioCnpj = randomCnpj();
  const catalogCnpjDigits = randomCnpj();
  const catalogCnpj = catalogCnpjDigits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );

  const fullOp = {
    id: randomUUID(),
    name: `Operador Completo ${tag}`,
    email: `full-id51-${tag}@example.test`,
  };
  const globalRead = {
    id: randomUUID(),
    name: `Leitor Global ${tag}`,
    email: `read-id51-${tag}@example.test`,
  };
  const supportOnly = {
    id: randomUUID(),
    name: `Suporte Comercial ${tag}`,
    email: `sup-id51-${tag}@example.test`,
  };
  const devStudioAdmin = {
    id: randomUUID(),
    name: `Admin Dev Studio ${tag}`,
    email: `admin-ds-${tag}@example.test`,
  };
  const rafaelRh = {
    id: randomUUID(),
    name: `Rafael RH ${tag}`,
    email: `rafael-ds-${tag}@example.test`,
  };

  try {
    const data = await db.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { ...fullOp, passwordHash },
          { ...globalRead, passwordHash },
          { ...supportOnly, passwordHash },
          { ...devStudioAdmin, passwordHash },
          { ...rafaelRh, passwordHash },
        ],
      });

      await tx.platformGrant.createMany({
        data: [
          { userId: fullOp.id, capability: 'READ_OVERVIEW' },
          { userId: fullOp.id, capability: 'MANAGE_CLIENTS' },
          { userId: fullOp.id, capability: 'READ_COMMERCIAL' },
          { userId: fullOp.id, capability: 'MANAGE_COMMERCIAL' },
          { userId: fullOp.id, capability: 'READ_BILLING' },
          { userId: fullOp.id, capability: 'MANAGE_BILLING' },
          { userId: fullOp.id, capability: 'READ_CONTRACT_ACCESS' },
          { userId: fullOp.id, capability: 'MANAGE_CONTRACT_ACCESS' },
          { userId: fullOp.id, capability: 'READ_SUPPORT' },
          { userId: globalRead.id, capability: 'READ_OVERVIEW' },
          { userId: supportOnly.id, capability: 'READ_COMMERCIAL' },
        ],
      });

      const devStudio = await tx.organization.create({
        data: {
          name: `ReNR Dev Studio ${tag}`,
          fiscalIdentifier: devStudioCnpj,
          fiscalCandidate: devStudioCnpj,
          normalizedFiscalIdentifier: devStudioCnpj,
          fiscalState: 'VALID',
          clientClassification: 'DEMONSTRATION',
        },
      });

      await tx.membership.createMany({
        data: [
          {
            userId: devStudioAdmin.id,
            organizationId: devStudio.id,
            role: 'ADMIN',
            hrCapabilities: [],
          },
          {
            userId: rafaelRh.id,
            organizationId: devStudio.id,
            role: 'READER',
            hrCapabilities: ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'],
          },
        ],
      });

      const unitRecife = await tx.unit.create({
        data: {
          organizationId: devStudio.id,
          name: 'Unidade Matriz Recife',
          normalizedName: 'unidade matriz recife',
        },
      });
      const unitEmpty = await tx.unit.create({
        data: {
          organizationId: devStudio.id,
          name: 'Unidade Sem Setores',
          normalizedName: 'unidade sem setores',
        },
      });
      const secEng = await tx.sector.create({
        data: {
          organizationId: devStudio.id,
          unitId: unitRecife.id,
          name: 'Engenharia de Produto',
          normalizedName: 'engenharia de produto',
        },
      });
      const secOps = await tx.sector.create({
        data: {
          organizationId: devStudio.id,
          unitId: unitRecife.id,
          name: 'Operações e Suporte',
          normalizedName: 'operacoes e suporte',
        },
      });

      const cohorts: {
        sectorId: string;
        kind: 'OVERDUE' | 'DUE_SOON' | 'REGULAR' | 'UNKNOWN';
        count: number;
        prefix: string;
      }[] = [
        { sectorId: secEng.id, kind: 'OVERDUE', count: 5, prefix: 'VENC' },
        { sectorId: secEng.id, kind: 'DUE_SOON', count: 5, prefix: 'PROX' },
        { sectorId: secEng.id, kind: 'REGULAR', count: 5, prefix: 'REG' },
        { sectorId: secOps.id, kind: 'UNKNOWN', count: 5, prefix: 'DESC' },
      ];
      let seq = 1;
      for (const cohort of cohorts) {
        for (let i = 0; i < cohort.count; i += 1) {
          const code = `${cohort.prefix}-${tag}-${String(i + 1).padStart(2, '0')}`;
          const emp = await tx.employee.create({
            data: {
              organizationId: devStudio.id,
              unitId: unitRecife.id,
              sectorId: cohort.sectorId,
              name: `Pessoa Fictícia DevStudio ${String(seq).padStart(2, '0')}`,
              internalIdentifier: code,
              normalizedIdentifier: code.toLowerCase(),
              isActive: true,
            },
          });
          seq += 1;
          const base = {
            organizationId: devStudio.id,
            employeeId: emp.id,
            updatedById: rafaelRh.id,
            source: 'Massa fictícia ReNR Dev Studio ID51',
          };
          if (cohort.kind === 'UNKNOWN') {
            await tx.employeeHrProfile.create({
              data: { ...base, vacationHistoryKnown: false, followUp: true },
            });
            continue;
          }
          await tx.employeeHrProfile.create({
            data: {
              ...base,
              birthDate: civilDate('1991-06-15'),
              gender: 'FEMALE',
              vacationHistoryKnown: true,
              complexLeaveHistoryKnown: true,
            },
          });
          await tx.employmentPeriod.create({
            data: { ...base, startsOn: civilDate('2023-02-01') },
          });
          const offset = cohort.kind === 'OVERDUE' ? -45 : cohort.kind === 'DUE_SOON' ? 20 : 180;
          await tx.employeeVacationPeriod.create({
            data: {
              ...base,
              acquisitionStart: civilDate('2024-02-01'),
              acquisitionEnd: civilDate('2025-01-31'),
              concessionDeadline: civilDate(shiftDays(today, offset)),
              entitlementDays: 30,
              balanceDays: 30,
              historyKnown: true,
            },
          });
        }
      }

      return { devStudio, unitRecife, unitEmpty, secEng };
    });

    return {
      ...data,
      tag,
      today,
      password,
      catalogCnpj,
      catalogCnpjDigits,
      fullOp,
      globalRead,
      supportOnly,
      devStudioAdmin,
      rafaelRh,
    };
  } finally {
    await db.$disconnect();
  }
}

async function signOut(page: Page) {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: origin },
  });
  expect([204, 401]).toContain(response.status());
}

async function signIn(page: Page, email: string, password: string, expectOrgSelect: boolean) {
  await signOut(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  if (expectOrgSelect) {
    await expect(page.getByRole('combobox', { name: 'Empresa ativa', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  }
}

async function submitCatalogCompany(form: Locator) {
  const [response] = await Promise.all([
    form
      .page()
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/platform/clients',
      ),
    form.getByRole('button', { name: 'Salvar empresa no catálogo' }).click(),
  ]);
  return response;
}

test.afterEach(async ({ page }) => {
  await signOut(page);
});

test('ID51: valida cadastro CNPJ + grupos, setores/férias RH na ReNR Dev Studio e painel comercial com alertas e atalhos', async ({
  page,
}, testInfo) => {
  mkdirSync(evidenceDir, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const isDesktop = testInfo.project.name === 'desktop';
  const scenario = await prepareId51Scenario(isDesktop);
  const companyName = `Empresa Catálogo ID51 ${scenario.tag}`;

  // === 1. Conferir férias fictícias na ReNR Dev Studio com Rafael (perfil RH) ===
  await signIn(page, scenario.rafaelRh.email, scenario.password, true);
  await page.goto('/#/pessoas');
  await expect(page.getByRole('heading', { name: 'Visão de pessoas' })).toBeVisible();
  await page.locator('summary', { hasText: 'Férias' }).click();
  await expect(page.locator('.people-metric', { hasText: 'Férias vencidas' })).toContainText('5');
  await expect(
    page.locator('.people-metric', { hasText: 'Férias próximas do vencimento' }),
  ).toContainText('5');
  await expect(
    page.locator('.people-metric', { hasText: 'Histórico de férias desconhecido' }),
  ).toContainText('5');

  // === 2. Conferir setores ativos em Colaboradores com Admin da ReNR Dev Studio ===
  await signIn(page, scenario.devStudioAdmin.email, scenario.password, true);
  await page.goto('/#/colaboradores');
  await page.getByRole('button', { name: 'Novo colaborador', exact: true }).click();
  await page.getByLabel('Nome do colaborador').fill(`Colaborador Setor ${scenario.tag}`);
  await page.getByLabel('Unidade do cadastro').selectOption(scenario.unitRecife.id);
  await expect(page.getByLabel('Setor do cadastro')).toContainText('Engenharia de Produto');
  await page.getByLabel('Setor do cadastro').selectOption(scenario.secEng.id);

  // Trocar para unidade sem setores ativos -> limpa setor e informa lista vazia
  await page.getByLabel('Unidade do cadastro').selectOption(scenario.unitEmpty.id);
  await expect(page.getByLabel('Setor do cadastro')).toHaveValue('');
  await expect(page.getByText(/Nenhum setor ativo cadastrado nesta unidade/i)).toBeVisible();

  // Voltar para Unidade Matriz Recife, selecionar setor ativo e salvar
  await page.getByLabel('Unidade do cadastro').selectOption(scenario.unitRecife.id);
  await expect(page.getByLabel('Setor do cadastro')).toContainText('Engenharia de Produto');
  await page.getByLabel('Setor do cadastro').selectOption(scenario.secEng.id);
  await page.getByRole('button', { name: 'Salvar colaborador', exact: true }).click();
  await expect(page.getByText('Colaborador salvo com sucesso.')).toBeVisible();

  // === 3. CNPJ no catálogo + duplicidade + orientação e inclusão em grupos ===
  await signIn(page, scenario.fullOp.email, scenario.password, false);
  await page.goto('/#/plataforma/grupos');
  await expect(
    page.getByText(/Grupos reúnem apenas empresas já cadastradas no catálogo/i),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Cadastrar empresa no catálogo (CNPJ)' }).click();

  const createForm = page.getByRole('form', { name: 'Cadastrar empresa no catálogo' });
  await expect(createForm).toBeVisible();
  await createForm.getByLabel('Nome da empresa').fill(companyName);
  await createForm.getByLabel('CNPJ').fill(scenario.catalogCnpj);
  await createForm.getByLabel('Motivo do cadastro').fill('Cadastro fictício de validação ID 51.');
  const createdResponse = await submitCatalogCompany(createForm);
  expect(createdResponse.status(), 'POST do novo cadastro no catálogo').toBe(201);
  const created = clientRegistrationSchema.parse(await createdResponse.json());
  expect(created).toMatchObject({
    name: companyName,
    normalizedFiscalIdentifier: scenario.catalogCnpjDigits,
    clientClassification: 'CLIENT',
    fiscalState: 'VALID',
  });
  await expect(
    page.getByText(`Empresa ${companyName} cadastrada no catálogo (${scenario.catalogCnpj}).`, {
      exact: true,
    }),
  ).toBeVisible();

  // Rejeitar CNPJ duplicado preservando rascunho
  await page.getByRole('button', { name: 'Cadastrar empresa' }).click();
  const dupForm = page.getByRole('form', { name: 'Cadastrar empresa no catálogo' });
  await dupForm.getByLabel('Nome da empresa').fill(`Duplicada ${scenario.tag}`);
  await dupForm.getByLabel('CNPJ').fill(scenario.catalogCnpjDigits);
  await dupForm.getByLabel('Motivo do cadastro').fill('Teste de bloqueio de CNPJ duplicado.');
  const duplicateResponse = await submitCatalogCompany(dupForm);
  expect(duplicateResponse.status(), 'POST com CNPJ já cadastrado').toBe(409);
  await expect(dupForm.getByRole('alert')).toContainText(/CNPJ já cadastrado/i);
  await expect(dupForm.getByLabel('Nome da empresa')).toHaveValue(`Duplicada ${scenario.tag}`);
  await page.getByRole('button', { name: 'Fechar cadastro de empresa' }).click();

  // Incluir a empresa recém-cadastrada em um grupo
  await page.goto('/#/plataforma/grupos');
  await page.getByRole('button', { name: 'Novo grupo de empresas' }).click();
  const searchGroupForm = page.getByRole('form', { name: 'Buscar empresas elegíveis' });
  await searchGroupForm.getByLabel('Nome ou CNPJ').fill(scenario.catalogCnpjDigits);
  await searchGroupForm.getByRole('button', { name: 'Buscar empresas' }).click();
  await page.getByRole('button', { name: `Incluir ${companyName}` }).click();
  const saveGroupForm = page.getByRole('form', { name: 'Salvar composição' });
  await saveGroupForm.getByLabel('Nome do grupo').fill(`Grupo ID51 ${scenario.tag}`);
  await saveGroupForm.getByLabel('Justificativa').fill('Composição validada no E2E ID 51.');
  await saveGroupForm.getByRole('button', { name: 'Salvar composição' }).click();
  await expect(page.getByText('Composição do grupo salva.')).toBeVisible();

  // === 4. Cenário comercial (plano, contrato expirando, 2 cobranças vencidas, acesso suspenso) ===
  const clientsRes = await page
    .context()
    .request.get(
      `/api/v1/platform/clients?search=${scenario.catalogCnpjDigits}&classification=CLIENT&fiscalState=VALID`,
    );
  expect(clientsRes.status()).toBe(200);
  const clientsData = platformClientListSchema.parse(await clientsRes.json());
  const targetOrgId = created.organizationId;
  expect(clientsData.items.map((client) => client.organizationId)).toEqual([targetOrgId]);

  const planRes = await page.context().request.post('/api/v1/platform/commercial/plans', {
    headers: { Origin: origin },
    data: {
      name: `Plano E2E ID51 ${scenario.tag}`,
      kind: 'PLAN',
      reason: 'Plano fictício ID 51.',
      version: {
        effectiveOn: shiftDays(scenario.today, -120),
        priceCents: 100000,
        pricingUnit: 'EMPLOYEE_MONTH',
        priceMode: 'FIXED',
        conditions: 'Condições fictícias E2E ID51.',
        limits: 'Sem custo externo.',
        includedFeatures: ['Painel consolidado'],
        plannedFeatures: [],
      },
    },
  });
  expect(planRes.status()).toBe(201);
  const planVersionId = ((await planRes.json()) as { versions: { id: string }[] }).versions[0]!.id;

  const contractRes = await page
    .context()
    .request.post(`/api/v1/platform/commercial/clients/${targetOrgId}/contract`, {
      headers: { Origin: origin },
      data: {
        planVersionId,
        startsOn: shiftDays(scenario.today, -60),
        endsOn: shiftDays(scenario.today, 15),
        terms: 'Vigência prestes a renovar.',
        reason: 'Contrato fictício ID51.',
      },
    });
  expect(contractRes.status()).toBe(201);
  const contractBody = (await contractRes.json()) as { id: string; revisions: { id: string }[] };
  const revId = contractBody.revisions[0]!.id;

  for (const [comp, dueOffset, cents] of [
    [competenceShift(scenario.today, -2), -25, 100000],
    [competenceShift(scenario.today, -1), -5, 50000],
  ] as const) {
    const chRes = await page
      .context()
      .request.post(
        `/api/v1/platform/commercial/billing/clients/${targetOrgId}/contracts/${contractBody.id}/charges`,
        {
          headers: { Origin: origin },
          data: {
            contractRevisionId: revId,
            competence: comp,
            amountCents: cents,
            dueOn: shiftDays(scenario.today, dueOffset),
            paidOn: null,
            receiptReference: null,
            reason: 'Cobrança vencida fictícia ID51.',
            idempotencyKey: randomUUID(),
          },
        },
      );
    expect(chRes.status()).toBe(201);
  }

  const suspRes = await page
    .context()
    .request.post(`/api/v1/platform/commercial/access/clients/${targetOrgId}/transitions`, {
      headers: { Origin: origin },
      data: {
        expectedVersion: 0,
        kind: 'SUSPENSION',
        effectiveOn: scenario.today,
        reason: 'Suspensão fictícia para alerta no painel ID51.',
        nextStep: 'Contatar equipe comercial.',
        confirmed: true,
      },
    });
  expect(suspRes.status()).toBe(201);

  // Conferir painel comercial completo + atalhos + evidências visuais (light, dark, 320px)
  await page.goto('/#/plataforma/comercial?secao=painel');
  await expect(page.getByRole('heading', { name: 'Painel comercial' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cadastrar empresa (CNPJ)' })).toBeVisible();
  await expect(
    page.locator('li.commercial-alert-item', { hasText: companyName }).filter({
      hasText: '2 cobranças vencidas em aberto',
    }),
  ).toHaveCount(1);
  await expect(
    page.locator('li.commercial-alert-item', { hasText: companyName }).filter({
      hasText: 'Acesso contratual suspenso',
    }),
  ).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Abrir fila de chamados' })).toHaveAttribute(
    'href',
    '#/plataforma/chamados',
  );

  if (isDesktop) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(evidenceDir, 'id51-desktop-1440-light.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Modo escuro', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Modo claro', exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(evidenceDir, 'id51-desktop-1440-dark.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Modo claro', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 760 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(evidenceDir, 'id51-mobile-320.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Testar atalho do alerta de cobranças vencidas -> abre Cobranças e pagamentos
  await page.getByRole('button', { name: `Abrir cobranças de ${companyName}` }).click();
  await expect(page.getByRole('heading', { name: 'Cobranças e pagamentos' })).toBeVisible();

  // === 5. Conferir restrição financeira com Suporte (READ_COMMERCIAL apenas) ===
  await signIn(page, scenario.supportOnly.email, scenario.password, false);
  await page.goto('/#/plataforma/comercial?secao=painel');
  await expect(page.getByRole('heading', { name: 'Painel comercial' })).toBeVisible();
  await expect(page.getByText(/Restrito aos perfis financeiros concedidos/i)).toBeVisible();
  await expect(page.getByText(/cobranças vencidas em aberto/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir fila de chamados' })).toHaveCount(0);

  // === 6. Conferir consulta global somente leitura com READ_OVERVIEW ===
  await signIn(page, scenario.globalRead.email, scenario.password, false);
  await page.goto(
    `/#/plataforma?search=${scenario.catalogCnpjDigits}&classification=CLIENT&fiscalState=VALID`,
  );
  await expect(page.getByText(companyName, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar empresa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Corrigir cadastro/i })).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
