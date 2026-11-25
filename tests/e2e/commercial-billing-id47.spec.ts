import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { commercialBillingChargeListSchema } from '../../packages/contracts/src/index';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

const requireApi = createRequire(resolve('apps/api/package.json'));
const origin = 'http://127.0.0.1:5173';
const billingBase = '/api/v1/platform/commercial/billing';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.afterEach(async ({ page }) => {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: origin },
  });
  expect([204, 401]).toContain(response.status());
});

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

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const dotenv = requireApi('dotenv') as { config: (opts: { path: string }) => void };
  dotenv.config({ path: resolve('apps/api/.env') });
  return process.env.DATABASE_URL ?? '';
}

async function prepareBillingScenario() {
  const connection = localDatabaseUrl(loadDatabaseUrl());
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });

  const tag = randomUUID().slice(0, 8);
  const password = `Id47!${randomUUID()}`;
  const passwordHash = (await hashPassword(password)) as string;
  const today = saoPauloReferenceDate();
  const compOverdue = competenceShift(today, -1);
  const compOpen = competenceShift(today, 0);
  const compNew = competenceShift(today, 1);

  const financeUser = {
    id: randomUUID(),
    name: `Operadora Financeira ${tag}`,
    email: `fin-id47-${tag}@example.test`,
  };
  const commercialOnlyUser = {
    id: randomUUID(),
    name: `Leitor Comercial ${tag}`,
    email: `com-id47-${tag}@example.test`,
  };

  try {
    const data = await db.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { ...financeUser, passwordHash },
          { ...commercialOnlyUser, passwordHash },
        ],
      });
      await tx.platformGrant.createMany({
        data: [
          { userId: financeUser.id, capability: 'MANAGE_BILLING' },
          { userId: commercialOnlyUser.id, capability: 'READ_COMMERCIAL' },
        ],
      });

      const plan = await tx.commercialPlan.create({
        data: {
          name: `Ouro Demo ${tag}`,
          kind: 'PLAN',
          versions: {
            create: {
              ordinal: 1,
              effectiveOn: new Date(`${competenceShift(today, -3)}-01T00:00:00.000Z`),
              priceCents: 2890,
              pricingUnit: 'EMPLOYEE_MONTH',
              priceMode: 'FIXED',
              conditions: 'Condições fictícias ID 47.',
              limits: 'Escopo de demonstração.',
              includedFeatures: ['Governança ampliada'],
              plannedFeatures: [],
              reason: 'Catálogo fictício para E2E do ID 47.',
              createdBy: financeUser.id,
            },
          },
        },
        include: { versions: true },
      });
      const planVersion = plan.versions[0]!;

      const orgAlpha = await tx.organization.create({
        data: { name: `Alpha Fin ${tag}`, clientClassification: 'DEMONSTRATION' },
      });
      const orgBeta = await tx.organization.create({
        data: { name: `Beta Fin ${tag}`, clientClassification: 'DEMONSTRATION' },
      });

      const contractAlpha = await tx.commercialContract.create({
        data: {
          organizationId: orgAlpha.id,
          revisions: {
            create: {
              ordinal: 1,
              kind: 'INITIAL',
              planVersionId: planVersion.id,
              startsOn: new Date(`${competenceShift(today, -2)}-01T00:00:00.000Z`),
              endsOn: new Date(`${competenceShift(today, 3)}-28T00:00:00.000Z`),
              terms: 'Termo contratual fictício Alpha.',
              reason: 'Contrato fictício para teste E2E ID 47.',
              createdBy: financeUser.id,
            },
          },
        },
        include: { revisions: true },
      });

      const contractBeta = await tx.commercialContract.create({
        data: {
          organizationId: orgBeta.id,
          revisions: {
            create: {
              ordinal: 1,
              kind: 'INITIAL',
              planVersionId: planVersion.id,
              startsOn: new Date(`${competenceShift(today, -2)}-01T00:00:00.000Z`),
              endsOn: new Date(`${competenceShift(today, 3)}-28T00:00:00.000Z`),
              terms: 'Termo contratual fictício Beta.',
              reason: 'Contrato fictício Beta para isolamento.',
              createdBy: financeUser.id,
            },
          },
        },
        include: { revisions: true },
      });

      const revAlpha = contractAlpha.revisions[0]!;
      const revBeta = contractBeta.revisions[0]!;

      const dueOverdue = new Date(`${shiftDays(today, -6)}T00:00:00.000Z`);
      const dueOpen = new Date(`${today}T00:00:00.000Z`);

      await tx.commercialBillingCharge.create({
        data: {
          organizationId: orgAlpha.id,
          contractId: contractAlpha.id,
          contractRevisionId: revAlpha.id,
          planVersionId: planVersion.id,
          competence: compOverdue,
          amountCents: 145000,
          dueOn: dueOverdue,
          paidOn: null,
          receiptReference: null,
          createdBy: financeUser.id,
          updatedBy: financeUser.id,
          revisions: {
            create: {
              contractId: contractAlpha.id,
              contractRevisionId: revAlpha.id,
              planVersionId: planVersion.id,
              ordinal: 1,
              kind: 'CREATED',
              competence: compOverdue,
              amountCents: 145000,
              dueOn: dueOverdue,
              paidOn: null,
              receiptReference: null,
              reason: 'Lançamento inicial vencido E2E.',
              createdBy: financeUser.id,
            },
          },
        },
      });

      await tx.commercialBillingCharge.create({
        data: {
          organizationId: orgAlpha.id,
          contractId: contractAlpha.id,
          contractRevisionId: revAlpha.id,
          planVersionId: planVersion.id,
          competence: compOpen,
          amountCents: 159000,
          dueOn: dueOpen,
          paidOn: null,
          receiptReference: null,
          createdBy: financeUser.id,
          updatedBy: financeUser.id,
          revisions: {
            create: {
              contractId: contractAlpha.id,
              contractRevisionId: revAlpha.id,
              planVersionId: planVersion.id,
              ordinal: 1,
              kind: 'CREATED',
              competence: compOpen,
              amountCents: 159000,
              dueOn: dueOpen,
              paidOn: null,
              receiptReference: null,
              reason: 'Lançamento em aberto no dia de referência.',
              createdBy: financeUser.id,
            },
          },
        },
      });

      await tx.commercialBillingCharge.create({
        data: {
          organizationId: orgBeta.id,
          contractId: contractBeta.id,
          contractRevisionId: revBeta.id,
          planVersionId: planVersion.id,
          competence: compOpen,
          amountCents: 99000,
          dueOn: dueOpen,
          paidOn: dueOpen,
          receiptReference: `PIX-BETA-${tag}`,
          createdBy: financeUser.id,
          updatedBy: financeUser.id,
          revisions: {
            create: {
              contractId: contractBeta.id,
              contractRevisionId: revBeta.id,
              planVersionId: planVersion.id,
              ordinal: 1,
              kind: 'CREATED',
              competence: compOpen,
              amountCents: 99000,
              dueOn: dueOpen,
              paidOn: dueOpen,
              receiptReference: `PIX-BETA-${tag}`,
              reason: 'Cobrança paga da empresa Beta.',
              createdBy: financeUser.id,
            },
          },
        },
      });

      return {
        orgAlpha,
        orgBeta,
        compOverdue,
        compOpen,
        compNew,
        today,
        dueNew: shiftDays(today, 25),
      };
    });

    return { ...data, password, financeUser, commercialOnlyUser, tag };
  } finally {
    await db.$disconnect();
  }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('ID47: fluxo manual de cobranças, vencimentos, recebimentos, correção com histórico e isolamento de escopo', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const scenario = await prepareBillingScenario();

  // 1) Leitor comercial sem concessão financeira não vê aba financeira e API recusa /billing com 403
  await signIn(page, scenario.commercialOnlyUser.email, scenario.password);
  await expect(page.getByRole('heading', { name: 'Planos e serviços', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cobranças e pagamentos' })).toHaveCount(0);
  const forbiddenRes = await page.context().request.get(`${billingBase}/charges`);
  expect(forbiddenRes.status()).toBe(403);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();

  // 2) Operadora financeira entra direto em Cobranças e pagamentos e confere reconciliação
  const chargesLoaded = page.waitForResponse(
    (res) => res.url().includes(`${billingBase}/charges?`) && res.status() === 200,
  );
  await signIn(page, scenario.financeUser.email, scenario.password);
  await expect(
    page.getByRole('heading', { name: 'Cobranças e pagamentos', exact: true }),
  ).toBeVisible();
  // Descarta os 401 esperados de /auth/session antes da autenticação; qualquer erro a partir daqui falha o teste.
  consoleErrors.length = 0;
  const initialPayload = commercialBillingChargeListSchema.parse(
    await (await chargesLoaded).json(),
  );
  expect(initialPayload.summary.billedCents).toBe(
    initialPayload.summary.openCents +
      initialPayload.summary.overdueCents +
      initialPayload.summary.receivedCents,
  );

  // Filtrar pela empresa Alpha para isolar o recorte do cenário e conferir totais exatos
  const alphaFiltered = page.waitForResponse(
    (res) =>
      res.url().includes(`${billingBase}/charges?`) &&
      res.url().includes(`organizationId=${scenario.orgAlpha.id}`),
  );
  await page.getByLabel('Empresa', { exact: true }).selectOption(scenario.orgAlpha.id);
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  const alphaPayload = commercialBillingChargeListSchema.parse(await (await alphaFiltered).json());
  expect(alphaPayload.summary).toMatchObject({
    billedCents: 304000,
    openCents: 159000,
    overdueCents: 145000,
    receivedCents: 0,
    counts: { total: 2, open: 1, overdue: 1, paid: 0 },
  });
  expect(alphaPayload.items.every((item) => item.organizationId === scenario.orgAlpha.id)).toBe(
    true,
  );

  // Capturar evidências visuais (light + dark) sem overflow horizontal
  const evidenceDir = resolve('tmp/evidencias-id47');
  mkdirSync(evidenceDir, { recursive: true });
  const isMobile = testInfo.project.name === 'mobile';
  const widthTag = isMobile ? '320' : '1440';
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 740 });
  } else {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(evidenceDir, `cobrancas-${widthTag}-light.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Modo escuro', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Modo claro', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(evidenceDir, `cobrancas-${widthTag}-dark.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Modo claro', exact: true }).click();

  // 3) Registrar nova cobrança manual na competência seguinte
  await page.getByRole('button', { name: 'Registrar cobrança', exact: true }).click();
  const compInput = page.getByLabel('Competência (AAAA-MM)', { exact: true });
  await compInput.fill(scenario.compNew);
  await page.getByLabel('Valor em reais', { exact: true }).fill('1.890,00');
  await page.getByLabel('Vencimento', { exact: true }).fill(scenario.dueNew);
  await page
    .getByLabel('Motivo do registro', { exact: true })
    .fill('Lançamento manual E2E da próxima competência.');
  const createRes = page.waitForResponse(
    (res) =>
      res.url().includes(`/clients/${scenario.orgAlpha.id}/contracts/`) &&
      res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar cobrança', exact: true }).click();
  expect((await createRes).status()).toBe(201);
  await expect(page.getByText(new RegExp(`Cobrança ${scenario.compNew} registrada`))).toBeVisible();

  // 4) Abrir a cobrança vencida, confirmar recebimento e registrar correção preservando histórico
  await page
    .getByRole('button', {
      name: new RegExp(`Detalhes da cobrança ${scenario.compOverdue} de ${scenario.orgAlpha.name}`),
    })
    .click();
  await expect(page.getByText(/Lançamento inicial vencido E2E\./)).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click();
  await page.getByLabel('Data de recebimento', { exact: true }).fill(scenario.today);
  await page
    .getByLabel('Referência do comprovante (opcional)', { exact: true })
    .fill(`PIX-E2E-${scenario.tag}`);
  await page
    .getByLabel('Motivo da confirmação', { exact: true })
    .fill('Baixa manual conferida no E2E.');
  const payRes = page.waitForResponse(
    (res) => res.url().endsWith('/payment') && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar recebimento', exact: true }).click();
  expect((await payRes).status()).toBe(201);
  await expect(page.getByText(`PIX-E2E-${scenario.tag}`).first()).toBeVisible();

  await page.getByRole('button', { name: 'Registrar correção', exact: true }).click();
  await page.getByLabel('Valor em reais', { exact: true }).fill('1.520,00');
  await page
    .getByLabel('Motivo da correção', { exact: true })
    .fill('Ajuste manual E2E preservando histórico.');
  const corrRes = page.waitForResponse(
    (res) => res.url().endsWith('/corrections') && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Salvar correção', exact: true }).click();
  expect((await corrRes).status()).toBe(201);

  const historyList = page.getByRole('list', { name: 'Histórico da cobrança' });
  await expect(historyList.getByText(/Lançamento inicial vencido E2E\./)).toBeVisible();
  await expect(historyList.getByText(/Baixa manual conferida no E2E\./)).toBeVisible();
  await expect(historyList.getByText(/Ajuste manual E2E preservando histórico\./)).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
