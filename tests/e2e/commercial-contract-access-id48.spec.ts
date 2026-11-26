import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

const requireApi = createRequire(resolve('apps/api/package.json'));
const origin = 'http://127.0.0.1:5173';
const evidenceDir = resolve('tmp/evidencias-id48');

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

function saoPauloReferenceDate(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
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

async function prepareContractAccessScenario() {
  const connection = localDatabaseUrl(loadDatabaseUrl());
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });

  const tag = randomUUID().slice(0, 8);
  const password = `Id48!${randomUUID()}`;
  const passwordHash = (await hashPassword(password)) as string;
  const today = saoPauloReferenceDate();

  const accessOp = {
    id: randomUUID(),
    name: `Operadora Contratos ${tag}`,
    email: `op-id48-${tag}@example.test`,
  };
  const multiAdmin = {
    id: randomUUID(),
    name: `Gestor Multi ${tag}`,
    email: `multi-id48-${tag}@example.test`,
  };
  const betaReader = {
    id: randomUUID(),
    name: `Leitor Beta ${tag}`,
    email: `reader-id48-${tag}@example.test`,
  };
  const revokedUser = {
    id: randomUUID(),
    name: `Revogado Beta ${tag}`,
    email: `revoked-id48-${tag}@example.test`,
  };

  try {
    const seeded = await db.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { ...accessOp, passwordHash },
          { ...multiAdmin, passwordHash },
          { ...betaReader, passwordHash },
          { ...revokedUser, passwordHash },
        ],
      });
      await tx.platformGrant.create({
        data: { userId: accessOp.id, capability: 'MANAGE_CONTRACT_ACCESS' },
      });

      const plan = await tx.commercialPlan.create({
        data: {
          name: `Plano Contrato ${tag}`,
          kind: 'PLAN',
          versions: {
            create: {
              ordinal: 1,
              effectiveOn: new Date(`${competenceShift(today, -3)}-01T00:00:00.000Z`),
              priceCents: 1890,
              pricingUnit: 'EMPLOYEE_MONTH',
              priceMode: 'FIXED',
              conditions: 'Condições fictícias para E2E do ID 48.',
              limits: 'Escopo demonstrativo.',
              includedFeatures: ['Gestão de riscos NR-01'],
              plannedFeatures: [],
              reason: 'Catálogo fictício ID 48.',
              createdBy: accessOp.id,
            },
          },
        },
        include: { versions: true },
      });
      const planVersion = plan.versions[0]!;

      async function createCompany(name: string) {
        const org = await tx.organization.create({
          data: { name, clientClassification: 'DEMONSTRATION', isActive: true },
        });
        await tx.commercialContract.create({
          data: {
            organizationId: org.id,
            revisions: {
              create: {
                ordinal: 1,
                kind: 'INITIAL',
                planVersionId: planVersion.id,
                startsOn: new Date(`${competenceShift(today, -1)}-01T00:00:00.000Z`),
                endsOn: new Date(`${competenceShift(today, 4)}-28T00:00:00.000Z`),
                terms: `Contrato fictício de ${name}.`,
                reason: `Contrato inicial fictício de ${name}.`,
                createdBy: accessOp.id,
              },
            },
          },
        });
        const unitName = `Unidade ${name}`;
        const sectorName = `Setor ${name}`;
        const unit = await tx.unit.create({
          data: { organizationId: org.id, name: unitName, normalizedName: unitName.toLowerCase() },
        });
        const sector = await tx.sector.create({
          data: {
            organizationId: org.id,
            unitId: unit.id,
            name: sectorName,
            normalizedName: sectorName.toLowerCase(),
          },
        });
        const group = await tx.assessmentGroup.create({
          data: { organizationId: org.id, sectorId: sector.id, name: `Grupo ${name}` },
        });
        const risk = await tx.risk.create({
          data: {
            organizationId: org.id,
            assessmentGroupId: group.id,
            factor: `Risco preservado ${name}`,
            description: 'Registro preservado durante suspensão contratual.',
            createdById: multiAdmin.id,
            updatedById: multiAdmin.id,
          },
        });
        return { org, risk };
      }

      const beta = await createCompany(`Beta Suspensa ${tag}`);
      const alpha = await createCompany(`Alpha Ativa ${tag}`);

      await tx.membership.createMany({
        data: [
          { userId: multiAdmin.id, organizationId: beta.org.id, role: 'ADMIN', isActive: true },
          { userId: multiAdmin.id, organizationId: alpha.org.id, role: 'ADMIN', isActive: true },
          { userId: betaReader.id, organizationId: beta.org.id, role: 'READER', isActive: true },
          { userId: revokedUser.id, organizationId: beta.org.id, role: 'ADMIN', isActive: false },
        ],
      });

      return { alpha, beta };
    });

    return {
      ...seeded,
      accessOp,
      multiAdmin,
      betaReader,
      revokedUser,
      password,
    };
  } finally {
    await db.$disconnect();
  }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/#/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible({ timeout: 15_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

test('ID 48: suspensão em sessão aberta e novo login, preservação de dados/downloads e reativação sem restaurar vínculos revogados', async ({
  browser,
}) => {
  mkdirSync(evidenceDir, { recursive: true });
  const scenario = await prepareContractAccessScenario();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const attachErrorWatchers = (page: Page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  };

  // Contexto A: sessão já aberta do usuário multi-empresa operando em Beta.
  const tenantCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tenantPage = await tenantCtx.newPage();

  // Contexto B: operador autorizado de acesso contratual.
  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const opPage = await opCtx.newPage();

  try {
    await signIn(tenantPage, scenario.multiAdmin.email, scenario.password);
    attachErrorWatchers(tenantPage);
    // Garante que Beta está ativa na sessão aberta e o risco + download funcionam antes da suspensão.
    await tenantPage.context().request.put('/api/v1/auth/session/organization', {
      headers: { Origin: origin },
      data: { organizationId: scenario.beta.org.id },
    });
    const createdReport = await tenantPage
      .context()
      .request.post(`/api/v1/organizations/${scenario.beta.org.id}/reports`, {
        headers: { Origin: origin },
        data: { kind: 'SST' },
      });
    expect(createdReport.status()).toBe(201);
    const betaReportId = ((await createdReport.json()) as { id: string }).id;
    await tenantPage.goto('/#/inventario');
    await expect(tenantPage.getByText(scenario.beta.risk.factor)).toBeVisible({ timeout: 15_000 });
    const prePdf = await tenantPage
      .context()
      .request.get(`/api/v1/organizations/${scenario.beta.org.id}/reports/${betaReportId}/pdf`);
    expect(prePdf.status()).toBe(200);

    // Operador entra na área Comercial -> Acesso contratual, ativa Alpha e suspende Beta.
    await signIn(opPage, scenario.accessOp.email, scenario.password);
    attachErrorWatchers(opPage);
    await opPage.goto('/#/plataforma/comercial');
    await expect(opPage.getByRole('heading', { name: 'Acesso contratual' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(opPage.getByText(scenario.beta.org.name)).toBeVisible();
    await assertNoHorizontalOverflow(opPage);
    await opPage.screenshot({
      path: resolve(evidenceDir, 'desktop-access-list-light.png'),
      fullPage: true,
    });

    await opPage
      .getByRole('button', { name: `Gerenciar acesso de ${scenario.beta.org.name}` })
      .click();
    await expect(opPage.getByRole('heading', { name: scenario.beta.org.name })).toBeVisible();

    const suspensionReason = 'Suspensão manual E2E para validar bloqueio imediato no servidor.';
    const suspensionNextStep = 'Regularize o contrato junto à operação comercial ReTech+.';

    await opPage.getByLabel('Transição contratual').selectOption('SUSPENSION');
    await opPage.getByLabel('Motivo da decisão').fill(suspensionReason);
    await opPage.getByLabel(/Próximo passo orientado/i).fill(suspensionNextStep);
    await opPage.getByLabel(/Confirmo esta decisão manual/i).check();
    await opPage.getByRole('button', { name: 'Confirmar transição' }).click();

    await expect(opPage.getByText(/Transição registrada com histórico/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(opPage.getByText(suspensionReason).first()).toBeVisible();
    await opPage.evaluate(() => window.scrollTo(0, 0));
    await opPage.screenshot({
      path: resolve(evidenceDir, 'desktop-access-detail-suspended-light.png'),
      fullPage: true,
    });

    // Captura também modo escuro no desktop.
    await opPage.getByRole('button', { name: /Modo escuro/i }).click();
    await opPage.evaluate(() => window.scrollTo(0, 0));
    await opPage.screenshot({
      path: resolve(evidenceDir, 'desktop-access-detail-suspended-dark.png'),
      fullPage: true,
    });

    // Sessão já aberta de Beta é imediatamente bloqueada no servidor (inclusive download protegido).
    const blockedRisks = await tenantPage
      .context()
      .request.get(`/api/v1/organizations/${scenario.beta.org.id}/risks`);
    expect(blockedRisks.status()).toBe(403);
    expect((await blockedRisks.json()).code).toBe('CONTRACT_ACCESS_SUSPENDED');

    const blockedPdf = await tenantPage
      .context()
      .request.get(`/api/v1/organizations/${scenario.beta.org.id}/reports/${betaReportId}/pdf`);
    expect(blockedPdf.status()).toBe(403);
    expect((await blockedPdf.json()).code).toBe('CONTRACT_ACCESS_SUSPENDED');

    // Recarrega a sessão do multi-empresa em #/empresas: vê aviso de suspensão autorizado para Beta e Alpha operacional.
    await tenantPage.goto('/#/empresas');
    await tenantPage.reload();
    await expect(
      tenantPage.getByRole('heading', { name: 'Empresas com acesso contratual suspenso' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(tenantPage.getByText(suspensionReason)).toBeVisible();
    await expect(tenantPage.getByText(suspensionNextStep)).toBeVisible();
    await tenantPage.screenshot({
      path: resolve(evidenceDir, 'desktop-admin-suspended-notice.png'),
      fullPage: true,
    });

    // Alpha permanece acessível na mesma sessão aberta!
    await tenantPage
      .getByRole('button', { name: `Selecionar empresa ${scenario.alpha.org.name}` })
      .click();
    await expect(tenantPage).toHaveURL(/#\/unidades/, { timeout: 15_000 });
    await tenantPage.goto('/#/inventario');
    await expect(tenantPage.getByText(scenario.alpha.risk.factor)).toBeVisible({ timeout: 15_000 });

    // Novo login do READER de Beta NÃO expõe motivo nem próximo passo.
    const readerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const readerPage = await readerCtx.newPage();
    try {
      await signIn(readerPage, scenario.betaReader.email, scenario.password);
      attachErrorWatchers(readerPage);
      await readerPage.goto('/#/empresas');
      await expect(
        readerPage.getByRole('heading', { name: 'Empresas com acesso contratual suspenso' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(readerPage.getByText(/Procure a administração da empresa/i)).toBeVisible();
      await expect(readerPage.getByText(suspensionReason)).toHaveCount(0);
      await expect(readerPage.getByText(suspensionNextStep)).toHaveCount(0);
    } finally {
      await readerCtx.close();
    }

    // Operador reativa Beta manualmente.
    await opPage.getByLabel('Motivo da decisão').fill('Reativação manual após regularização E2E.');
    await opPage
      .getByLabel(/Próximo passo orientado/i)
      .fill('Acesso operacional restabelecido para vínculos ativos.');
    await opPage.getByLabel(/Confirmo esta decisão manual/i).check();
    await opPage.getByRole('button', { name: 'Confirmar transição' }).click();
    await expect(opPage.getByText(/versão 2/i).first()).toBeVisible({ timeout: 15_000 });

    // Multi-empresa retorna a Beta e confirma preservação do histórico e download protegido.
    await tenantPage.goto('/#/empresas');
    await tenantPage.reload();
    await tenantPage
      .getByRole('button', { name: `Selecionar empresa ${scenario.beta.org.name}` })
      .click();
    await expect(tenantPage).toHaveURL(/#\/unidades/, { timeout: 15_000 });
    await tenantPage.goto('/#/inventario');
    await expect(tenantPage.getByText(scenario.beta.risk.factor)).toBeVisible({ timeout: 15_000 });
    const restoredPdf = await tenantPage
      .context()
      .request.get(`/api/v1/organizations/${scenario.beta.org.id}/reports/${betaReportId}/pdf`);
    expect(restoredPdf.status()).toBe(200);
    expect((await restoredPdf.body()).subarray(0, 5).toString('utf8')).toBe('%PDF-');

    // Usuário com vínculo revogado continua sem acesso após reativação.
    const revokedCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const revokedPage = await revokedCtx.newPage();
    try {
      await signIn(revokedPage, scenario.revokedUser.email, scenario.password);
      attachErrorWatchers(revokedPage);
      const deniedOverview = await revokedPage
        .context()
        .request.get(`/api/v1/organizations/${scenario.beta.org.id}/overview`);
      expect(deniedOverview.status()).toBe(404);
    } finally {
      await revokedCtx.close();
    }

    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter(
        (entry) => !entry.includes('status of 403') && !entry.includes('status of 404'),
      ),
    ).toEqual([]);
  } finally {
    await tenantCtx.close();
    await opCtx.close();
  }
});

test('ID 48 (mobile 320px): tabela responsiva e detalhe sem overflow horizontal', async ({
  browser,
}) => {
  mkdirSync(evidenceDir, { recursive: true });
  const scenario = await prepareContractAccessScenario();
  const pageErrors: string[] = [];

  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await signIn(page, scenario.accessOp.email, scenario.password);
    await page.goto('/#/plataforma/comercial');
    await expect(page.getByRole('heading', { name: 'Acesso contratual' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(scenario.beta.org.name)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(evidenceDir, 'mobile-320-access-list.png'),
      fullPage: true,
    });

    await page
      .getByRole('button', { name: `Gerenciar acesso de ${scenario.beta.org.name}` })
      .click();
    await expect(page.getByRole('heading', { name: scenario.beta.org.name })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(evidenceDir, 'mobile-320-access-detail.png'),
      fullPage: true,
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
