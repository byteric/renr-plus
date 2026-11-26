import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const origin = 'http://127.0.0.1:5173';
const auth = '/api/v1/auth';
const globalRecovery = '/api/v1/platform/password-recoveries';
const companyRecovery = (id: string) => '/api/v1/organizations/' + id + '/password-recoveries';
const requireApi = createRequire(resolve('apps/api/package.json'));
const { passwordRecoveryIssuedSchema } = requireApi(
  '@renr/contracts',
) as typeof import('../../packages/contracts/src/password-recovery');

async function scenario() {
  if (!process.env.DATABASE_URL) {
    const dotenv = requireApi('dotenv') as { config: (opts: { path: string }) => void };
    dotenv.config({ path: resolve('apps/api/.env') });
  }
  const connection = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient: Client } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const db: PrismaClient = new Client({
    adapter: new PrismaPg({ connectionString: connection.href, max: 1 }),
  });
  const tag = randomUUID().slice(0, 8);
  const password = 'Senha inicial ID52 ' + randomUUID();
  const passwordHash = (await hashPassword(password)) as string;
  const user = (kind: string) => ({
    id: randomUUID(),
    name: kind + ' ' + tag,
    email: kind.toLowerCase() + '-id52-' + tag + '@renr.example',
    passwordHash,
  });
  const localIssuer = user('Responsavel');
  const globalIssuer = user('Operador');
  const holder = user('Titular');
  const otherCompany = user('OutraEmpresa');
  const sharedHolder = user('VinculosMultiplos');
  try {
    const { alpha, beta } = await db.$transaction(async (tx) => {
      const alpha = await tx.organization.create({ data: { name: 'Recuperação Alfa ' + tag } });
      const beta = await tx.organization.create({ data: { name: 'Recuperação Beta ' + tag } });
      await tx.user.createMany({
        data: [localIssuer, globalIssuer, holder, otherCompany, sharedHolder],
      });
      await tx.membership.createMany({
        data: [
          { userId: localIssuer.id, organizationId: alpha.id, role: 'ADMIN' },
          { userId: holder.id, organizationId: alpha.id, role: 'READER' },
          { userId: otherCompany.id, organizationId: beta.id, role: 'ADMIN' },
          { userId: sharedHolder.id, organizationId: alpha.id, role: 'READER' },
          { userId: sharedHolder.id, organizationId: beta.id, role: 'READER' },
        ],
      });
      await tx.platformGrant.createMany({
        data: [
          { userId: localIssuer.id, capability: 'ASSIST_COMPANY_PASSWORD_RECOVERY' },
          { userId: globalIssuer.id, capability: 'MANAGE_PASSWORD_RECOVERY' },
        ],
      });
      return { alpha, beta };
    });
    return { alpha, beta, localIssuer, globalIssuer, holder, otherCompany, sharedHolder, password };
  } finally {
    await db.$disconnect();
  }
}

async function signIn(page: Page, email: string, password: string, route: string) {
  await page.context().clearCookies();
  await page.goto('/?id52=' + randomUUID() + route);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
}

function verification(email: string) {
  return { email, verificationConfirmed: true, verificationReference: 'REC-' + randomUUID() };
}

test('ID 52: orientação uniforme, emissão assistida, troca pelo titular, sessão antiga revogada e novo login @personas', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const data = await scenario();
  const replacement = 'Nova senha ID52 ' + randomUUID();
  const old = await browser.newContext({ baseURL: origin });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
  try {
    const oldLogin = await old.request.post(auth + '/sessions', {
      headers: { Origin: origin },
      data: { email: data.holder.email, password: data.password },
    });
    expect(oldLogin.ok()).toBe(true);
    expect((await old.request.get(auth + '/session')).status()).toBe(200);

    await page.goto('/');
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
    await expect(page.getByRole('heading', { name: 'Recuperar acesso' })).toBeVisible();
    await page.getByLabel('E-mail da conta', { exact: true }).fill(data.holder.email);
    const requestObserved = page.waitForResponse((response) =>
      response.url().endsWith(auth + '/recovery/requests'),
    );
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const existing = await requestObserved;
    const unknown = await page.request.post(auth + '/recovery/requests', {
      headers: { Origin: origin },
      data: { email: 'ausente-' + randomUUID() + '@renr.example' },
    });
    expect(existing.status()).toBe(202);
    expect(unknown.status()).toBe(existing.status());
    expect(await unknown.json()).toEqual(await existing.json());
    expect((await old.request.get(auth + '/session')).status()).toBe(200);

    await signIn(page, data.localIssuer.email, data.password, '#/acessos');
    for (const email of [data.otherCompany.email, data.sharedHolder.email]) {
      const outside = await page.request.post(companyRecovery(data.alpha.id), {
        headers: { Origin: origin },
        data: verification(email),
      });
      expect([403, 404]).toContain(outside.status());
      expect(Object.hasOwn(await outside.json(), 'token')).toBe(false);
    }
    await page.getByRole('button', { name: 'Recuperar senha', exact: true }).click();
    await page.getByLabel('E-mail da conta', { exact: true }).fill(data.holder.email);
    await page.getByLabel('Referência da conferência', { exact: true }).fill('TESTE-ID52');
    await page.getByRole('checkbox', { name: /Confirmei a identidade/ }).check();
    const issuanceObserved = page.waitForResponse((response) =>
      response.url().endsWith(companyRecovery(data.alpha.id)),
    );
    await page.getByRole('button', { name: 'Emitir link de recuperação' }).click();
    const issuance = await issuanceObserved;
    expect(issuance.status()).toBe(201);
    expect(issuance.headers()['cache-control']).toContain('no-store');
    const first = passwordRecoveryIssuedSchema.parse(await issuance.json());
    await expect(page.getByRole('button', { name: 'Copiar link' })).toBeVisible();
    const firstUrl = await page.getByLabel('Link de recuperação', { exact: true }).inputValue();
    expect(new URL(firstUrl).hash.startsWith('#/redefinir-senha/')).toBe(true);

    const newer = await page.request.post(companyRecovery(data.alpha.id), {
      headers: { Origin: origin },
      data: verification(data.holder.email),
    });
    expect(newer.status()).toBe(201);
    const second = passwordRecoveryIssuedSchema.parse(await newer.json());
    const status = (token: string) =>
      page.request.post(auth + '/recovery/status', {
        headers: { Origin: origin },
        data: { token },
      });
    expect(await (await status(first.token)).json()).toEqual({ available: false });
    expect(await (await status(second.token)).json()).toEqual({ available: true });

    await page.context().clearCookies();
    await page.goto('/?id52=' + randomUUID() + '#/redefinir-senha/' + second.token);
    await expect(page.getByRole('heading', { name: 'Definir nova senha' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/redefinir-senha');
    const persisted = await page.evaluate(() =>
      JSON.stringify({
        local: Object.assign({}, localStorage),
        session: Object.assign({}, sessionStorage),
      }),
    );
    expect(persisted.includes(second.token)).toBe(false);
    const newPasswordField = page.getByLabel('Nova senha', { exact: true });
    const confirmPasswordField = page.getByLabel('Confirmar nova senha', { exact: true });
    await expect(newPasswordField).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(2);
    const evidence = resolve('tmp/evidencias-id52');
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, 'nova-senha-' + info.project.name + '.png') });
    await newPasswordField.fill(replacement);
    await page.keyboard.press('Tab');
    await expect(confirmPasswordField).toBeFocused();
    await confirmPasswordField.fill(replacement);
    await page.getByRole('button', { name: 'Redefinir senha', exact: true }).click();
    await expect(
      page.getByText('Senha redefinida. Entre com a nova senha.', { exact: true }),
    ).toBeVisible();
    expect((await old.request.get(auth + '/session')).status()).toBe(401);
    expect((await page.request.get(auth + '/session')).status()).toBe(401);
    expect(await (await status(second.token)).json()).toEqual({ available: false });
    const replay = await page.request.post(auth + '/recovery/confirm', {
      headers: { Origin: origin },
      data: { token: second.token, password: replacement },
    });
    expect(replay.status()).toBe(404);

    await page.getByLabel('E-mail', { exact: true }).fill(data.holder.email);
    await page.getByLabel('Senha', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(2);

    await signIn(page, data.globalIssuer.email, data.password, '#/plataforma/recuperacao');
    await expect(page.getByRole('button', { name: 'Emitir link de recuperação' })).toBeVisible();
    const globalGrant = await page.request.post(globalRecovery, {
      headers: { Origin: origin },
      data: verification(data.sharedHolder.email),
    });
    expect(globalGrant.status()).toBe(201);
    await page.screenshot({ path: resolve(evidence, 'operacao-' + info.project.name + '.png') });
  } finally {
    await old.close();
  }
});
