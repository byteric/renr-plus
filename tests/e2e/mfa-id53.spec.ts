import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const origin = 'http://127.0.0.1:5173';
const auth = '/api/v1/auth';
const requireApi = createRequire(resolve('apps/api/package.json'));
const { Secret, TOTP } = requireApi('otpauth') as typeof import('otpauth');
const { mfaEnrollmentConfirmedSchema, mfaEnrollmentSchema, passwordRecoveryIssuedSchema } =
  requireApi('@renr/contracts') as typeof import('../../packages/contracts/src/index');

async function createUsers() {
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
  const password = 'Senha sintética ID53 ' + randomUUID();
  const passwordHash = (await hashPassword(password)) as string;
  const email = (role: string) => role + '-id53-' + randomUUID().slice(0, 8) + '@renr.example';
  try {
    const [holder, operator] = await db.$transaction([
      db.user.create({
        data: {
          name: 'Titular do teste',
          email: email('titular'),
          passwordHash,
          platformGrants: { create: { capability: 'READ_OVERVIEW' } },
        },
      }),
      db.user.create({
        data: {
          name: 'Responsável do teste',
          email: email('operador'),
          passwordHash,
          platformGrants: {
            create: [{ capability: 'READ_OVERVIEW' }, { capability: 'RECOVER_ACCOUNT_MFA' }],
          },
        },
      }),
    ]);
    return { holder, operator, password };
  } finally {
    await db.$disconnect();
  }
}

async function credentials(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function confirmEnrollment(page: Page, manualKey: string) {
  await expect(
    page.getByRole('img', { name: 'QR code para configurar o autenticador' }),
  ).toBeVisible();
  await expect(page.getByText('Chave manual', { exact: true })).toBeVisible();
  const code = new TOTP({ secret: Secret.fromBase32(manualKey) }).generate();
  await page.getByLabel('Código do autenticador', { exact: true }).fill(code);
  const observed = page.waitForResponse((response) =>
    response.url().endsWith(auth + '/mfa/enrollment/confirm'),
  );
  await page.getByRole('button', { name: 'Confirmar autenticador' }).click();
  const response = await observed;
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toContain('no-store');
  const { recoveryCodes } = mfaEnrollmentConfirmedSchema.parse(await response.json());
  await expect(page.getByRole('heading', { name: 'Códigos de recuperação' })).toBeVisible();
  await expect(page.getByText(recoveryCodes[0], { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Já guardei os códigos' }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await expect(page.getByText(recoveryCodes[0], { exact: true })).toHaveCount(0);
  return { code, recoveryCodes };
}

async function enableFromAccount(page: Page, password: string) {
  await page.getByRole('link', { name: 'Segurança da conta' }).click();
  await expect(page.getByRole('heading', { name: 'Segurança da conta' })).toBeVisible();
  await page.getByRole('button', { name: 'Ativar autenticador' }).click();
  await page.getByLabel('Senha atual', { exact: true }).fill(password);
  const observed = page.waitForResponse((response) =>
    response.url().endsWith(auth + '/mfa/enrollment'),
  );
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const began = await observed;
  expect(began.status()).toBe(201);
  const setup = mfaEnrollmentSchema.parse(await began.json());
  return confirmEnrollment(page, setup.manualKey);
}

test('ID 53: fator, desafio restrito, código único e recuperação assistida @personas', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const { holder, operator, password } = await createUsers();
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
  await page.goto('/');
  await credentials(page, holder.email, password);
  const first = await enableFromAccount(page, password);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await credentials(page, holder.email, password);
  await expect(page.getByRole('heading', { name: 'Verificação em duas etapas' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toHaveCount(0);
  expect((await page.request.get(auth + '/session')).status()).toBe(401);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(2);
  const code = page.getByLabel('Código do autenticador', { exact: true });
  await page.keyboard.press('Tab');
  await expect(code).toBeFocused();
  await code.fill(first.code);
  const rejected = page.waitForResponse((response) => response.url().endsWith(auth + '/mfa/login'));
  await page.getByRole('button', { name: 'Verificar código' }).click();
  expect((await rejected).status()).toBe(401);
  await page.getByRole('button', { name: 'Usar código de recuperação' }).click();
  await page.getByLabel('Código de recuperação', { exact: true }).fill(first.recoveryCodes[0]);
  await page.getByRole('button', { name: 'Verificar código' }).click();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  expect((await page.request.get(auth + '/session')).status()).toBe(200);

  const operatorBrowser = await browser.newContext({ baseURL: origin });
  try {
    const admin = await operatorBrowser.newPage();
    await admin.goto('/');
    await credentials(admin, operator.email, password);
    await enableFromAccount(admin, password);
    await admin.goto('/#/plataforma/recuperacao');
    const form = admin.getByRole('form', { name: 'Emitir recuperação do autenticador' });
    await form.getByLabel('E-mail da conta', { exact: true }).fill(holder.email);
    await form.getByLabel('Referência da conferência', { exact: true }).fill('E2E-ID53');
    await form.getByRole('checkbox', { name: /Confirmei a identidade/ }).check();
    const issued = admin.waitForResponse((response) =>
      response.url().endsWith('/platform/mfa-recoveries'),
    );
    await admin.getByRole('button', { name: 'Emitir link para o autenticador' }).click();
    const link = await issued;
    expect(link.status()).toBe(201);
    const { token } = passwordRecoveryIssuedSchema.parse(await link.json());
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await page.goto('/#/recuperar-autenticador/' + token);
    await expect(page.getByRole('heading', { name: 'Recuperar autenticador' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/recuperar-autenticador');
    expect(
      await page.evaluate(
        (secret) =>
          JSON.stringify([
            Object.assign({}, localStorage),
            Object.assign({}, sessionStorage),
          ]).includes(secret),
        token,
      ),
    ).toBe(false);
    await page.getByLabel('E-mail da conta', { exact: true }).fill(holder.email);
    await page.getByLabel('Senha atual', { exact: true }).fill(password);
    const observed = page.waitForResponse((response) =>
      response.url().endsWith(auth + '/mfa/enrollment'),
    );
    await page.getByRole('button', { name: 'Continuar recuperação' }).click();
    const began = await observed;
    expect(began.status()).toBe(201);
    await confirmEnrollment(page, mfaEnrollmentSchema.parse(await began.json()).manualKey);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await credentials(page, holder.email, password);
    const replay = await page.request.post(auth + '/mfa/login', {
      headers: { Origin: origin },
      data: { method: 'recovery', code: first.recoveryCodes[1] },
    });
    expect(replay.status()).toBe(401);
  } finally {
    await operatorBrowser.close();
  }
});
