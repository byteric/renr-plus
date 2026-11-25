import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const origin = 'http://127.0.0.1:5173';
const platformPath = '/api/v1/platform/support-tickets';
const dashboardPath = '/api/v1/platform/commercial/dashboard';
const companyPath = (id: string) => '/api/v1/organizations/' + id + '/support-tickets';
const requireApi = createRequire(resolve('apps/api/package.json'));
const { supportTicketDetailSchema } = requireApi(
  '@renr/contracts',
) as typeof import('../../packages/contracts/src/support');

async function scenario() {
  const connection = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });
  const tag = randomUUID().slice(0, 8);
  const password = 'Id50!' + randomUUID();
  const passwordHash = (await hashPassword(password)) as string;
  const user = (kind: string) => ({
    id: randomUUID(),
    name: kind + ' ' + tag,
    email: kind.toLowerCase() + '-' + tag + '@renr.example',
    passwordHash,
  });
  const alphaAdmin = user('AdminAlpha');
  const betaAdmin = user('AdminBeta');
  const attendant = user('Atendente');
  const finance = user('Financeiro');
  try {
    const { alpha, beta } = await db.$transaction(async (tx) => {
      const alpha = await tx.organization.create({
        data: { name: 'Empresa fictícia Alfa ' + tag },
      });
      const beta = await tx.organization.create({ data: { name: 'Empresa fictícia Beta ' + tag } });
      await tx.user.createMany({ data: [alphaAdmin, betaAdmin, attendant, finance] });
      await tx.membership.createMany({
        data: [
          { userId: alphaAdmin.id, organizationId: alpha.id, role: 'ADMIN', isActive: true },
          { userId: betaAdmin.id, organizationId: beta.id, role: 'ADMIN', isActive: true },
        ],
      });
      await tx.platformGrant.createMany({
        data: [
          { userId: attendant.id, capability: 'MANAGE_SUPPORT' },
          { userId: finance.id, capability: 'READ_BILLING' },
        ],
      });
      return { alpha, beta };
    });
    return { tag, password, alpha, beta, alphaAdmin, betaAdmin, attendant, finance };
  } finally {
    await db.$disconnect();
  }
}

async function signIn(page: Page, email: string, password: string, route: string) {
  await page.context().clearCookies();
  await page.goto('/?id50=' + randomUUID() + route);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
}

test('ID 50: cliente abre e acompanha chamado, suporte atende pela fila e painel, outras permissões são isoladas', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const fixture = await scenario();
  const title = 'Dúvida de navegação ' + fixture.tag;
  const note = 'Agendamos a orientação para o administrador.';
  const resolved = 'A orientação foi concluída.';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 760 });

  await signIn(page, fixture.alphaAdmin.email, fixture.password, '#/chamados');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await page.getByRole('textbox', { name: 'Assunto', exact: true }).fill(title);
  await page.getByRole('combobox', { name: 'Categoria', exact: true }).selectOption('TECHNICAL');
  await page.getByLabel('Descrição').fill('Preciso encontrar as opções de cadastro da empresa.');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(companyPath(fixture.alpha.id)) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Enviar chamado' }).click();
  const posted = await created;
  expect(posted.status()).toBe(201);
  const { ticket } = supportTicketDetailSchema.parse(await posted.json());
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Aguardando a triagem da equipe de suporte.')).toBeVisible();

  await signIn(page, fixture.betaAdmin.email, fixture.password, '#/chamados/' + ticket.id);
  await expect(page.getByRole('alert')).toContainText('Este registro não está mais disponível');
  expect((await page.request.get(companyPath(fixture.alpha.id) + '/' + ticket.id)).status()).toBe(
    404,
  );
  const beta = await page.request.post(companyPath(fixture.beta.id), {
    headers: { Origin: origin },
    data: {
      subject: 'Chamado da Beta ' + fixture.tag,
      category: 'ACCESS',
      description: 'Dúvida da outra empresa.',
    },
  });
  expect(beta.status()).toBe(201);
  const { ticket: betaTicket } = supportTicketDetailSchema.parse(await beta.json());

  await signIn(page, fixture.attendant.email, fixture.password, '#/plataforma/chamados');
  const upcomingDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  );
  const betaScheduled = await page.request.patch(platformPath + '/' + betaTicket.id, {
    headers: { Origin: origin },
    data: {
      expectedVersion: betaTicket.version,
      status: 'IN_PROGRESS',
      assigneeId: fixture.attendant.id,
      dueOn: upcomingDate,
      note: 'Atendimento da Beta agendado.',
    },
  });
  expect(betaScheduled.status()).toBe(200);
  const betaPanel = await (
    await page.request.get(dashboardPath + '?organizationId=' + fixture.beta.id)
  ).json();
  expect(betaPanel.supportTickets).toEqual({ pending: 1, dueSoon: 1, overdue: 0 });
  expect(betaPanel.alerts).toMatchObject([{ sourceId: betaTicket.id, kind: 'SUPPORT_DUE_SOON' }]);
  await page.getByRole('link', { name: title }).click();
  const form = page.getByRole('form', { name: 'Atualizar atendimento' });
  const responsible = form.getByRole('combobox', { name: 'Responsável', exact: true });
  await expect(responsible).toBeEnabled();
  await responsible.selectOption(fixture.attendant.id);
  await form.getByLabel('Situação').selectOption('IN_PROGRESS');
  await form.getByLabel('Prazo de atendimento').fill('2020-01-01');
  await form.getByLabel('Atualização para o cliente').fill(note);
  await form.getByRole('button', { name: 'Salvar atualização' }).click();
  await expect(page.getByText(note)).toBeVisible();
  const stale = await page.request.patch(platformPath + '/' + ticket.id, {
    headers: { Origin: origin },
    data: {
      expectedVersion: ticket.version,
      status: 'RESOLVED',
      assigneeId: fixture.attendant.id,
      dueOn: '2020-01-01',
      note: 'Tentativa de sobrescrever versão anterior.',
    },
  });
  expect(stale.status()).toBe(409);

  const panel = await page.request.get(dashboardPath + '?organizationId=' + fixture.alpha.id);
  expect(panel.status()).toBe(200);
  const panelData = await panel.json();
  expect(panelData.supportTickets).toEqual({ pending: 1, dueSoon: 0, overdue: 1 });
  expect(panelData.billing).toBeNull();
  expect(
    panelData.alerts.filter((alert: { domain: string }) => alert.domain === 'support'),
  ).toMatchObject([
    { sourceId: ticket.id, organizationId: fixture.alpha.id, kind: 'SUPPORT_OVERDUE' },
  ]);
  await page.goto('/#/plataforma/comercial?secao=painel');
  const alertLink = page.getByRole('link', { name: 'Abrir chamado de ' + fixture.alpha.name });
  await expect(alertLink).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(2);
  const evidence = resolve('tmp/evidencias-id50');
  mkdirSync(evidence, { recursive: true });
  await alertLink.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(evidence, 'painel-' + info.project.name + '.png') });
  await alertLink.click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Responsável', exact: true })).toHaveValue(
    fixture.attendant.id,
  );
  await form.getByLabel('Situação').selectOption('RESOLVED');
  await form.getByLabel('Atualização para o cliente').fill(resolved);
  await form.getByRole('button', { name: 'Salvar atualização' }).click();
  await expect(page.getByText(resolved)).toBeVisible();
  const closed = await (
    await page.request.get(dashboardPath + '?organizationId=' + fixture.alpha.id)
  ).json();
  expect(closed.supportTickets).toEqual({ pending: 0, dueSoon: 0, overdue: 0 });
  expect(closed.alerts).toHaveLength(0);

  await signIn(page, fixture.alphaAdmin.email, fixture.password, '#/chamados/' + ticket.id);
  await expect(page.getByText(note)).toBeVisible();
  await expect(page.getByText(resolved)).toBeVisible();
  await expect(page.getByText('Consulte a resolução no histórico.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Detalhes do chamado' })).toContainText(
    fixture.attendant.name,
  );
  await page.getByRole('heading', { name: title }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: resolve(evidence, 'chamado-' + info.project.name + '.png') });

  await signIn(
    page,
    fixture.finance.email,
    fixture.password,
    '#/plataforma/comercial?secao=painel',
  );
  await expect(page.getByRole('heading', { name: 'Painel comercial', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir fila de chamados' })).toHaveCount(0);
  expect((await page.request.get(platformPath + '/' + ticket.id)).status()).toBe(403);
  const finance = await (await page.request.get(dashboardPath)).json();
  expect(finance.supportTickets).toBeNull();
  expect(pageErrors).toEqual([]);
});
