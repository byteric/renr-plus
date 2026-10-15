import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  diagnosticCycleSchema,
  diagnosticInstrumentSchema,
  diagnosticResultsSchema,
  participationInvitesSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { cleanupDiagnosticCycles } from './diagnostic-data';

const organizationId = '10000000-0000-4000-8000-000000000001';
const test = base.extend<{ cyclesToClean: { id: string; name: string }[] }>({
  // Playwright requires destructuring; this cleanup fixture has no fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  cyclesToClean: async ({}, use) => {
    const cycles: { id: string; name: string }[] = [];
    try {
      await use(cycles);
    } finally {
      await cleanupDiagnosticCycles(cycles);
    }
  },
});
// Access credentials and invitation codes must not enter traces, screenshots or video.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
async function login(page: Page, email = 'admin1@renr.example') {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}
async function navigate(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('link', { name, exact: true }).click();
}

test('ciclo real percorre criação, convite, resposta, encerramento e consolidação', async ({
  page,
  request,
  cyclesToClean,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  await login(page);
  await navigate(page, 'Diagnóstico');
  await page.getByRole('button', { name: 'Novo ciclo', exact: true }).click();
  const name = `e2e-v02-Demonstração ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Nome do ciclo', { exact: true }).fill(name);
  await page.getByLabel('Unidade', { exact: true }).selectOption({ label: 'Unidade demonstração' });
  await page.getByLabel('Setor', { exact: true }).selectOption({ label: 'Setor demonstração' });
  const localDate = (offset: number) => {
    const date = new Date(Date.now() + offset);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  await page.getByLabel('Início', { exact: true }).fill(localDate(-3600_000));
  await page.getByLabel('Término', { exact: true }).fill(localDate(86400_000));
  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith('/diagnostic-cycles') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Criar ciclo', exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const cycle = diagnosticCycleSchema.parse(await created.json());
  cyclesToClean.push({ id: cycle.id, name });
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.reload();
  // Selected detail is local state; reopening from persisted list verifies reload continuity.
  await page.getByRole('button', { name: `Ver ciclo ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Abrir ciclo', exact: true }).click();
  await page.getByLabel('Quantidade de convites', { exact: true }).fill('5');
  const emitting = page.waitForResponse(
    (response) =>
      response.url().endsWith('/participation-invites') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Emitir convites', exact: true }).click();
  const emitted = await emitting;
  const invitation = participationInvitesSchema.parse(await emitted.json());
  expect(invitation.invites).toHaveLength(5);
  expect(invitation.participationPath).toBe('/#/participar');
  await expect(page.getByLabel('Código 1', { exact: true })).toHaveValue(
    invitation.invites[0]!.code,
  );
  const instrumentResponse = await page.request.get(
    `/api/v1/organizations/${organizationId}/diagnostic-instrument`,
  );
  const instrument = diagnosticInstrumentSchema.parse(await instrumentResponse.json());
  await page.goto('/#/participar');
  await page.getByLabel('Código do convite', { exact: true }).fill(invitation.invites[0]!.code);
  await page.getByRole('button', { name: 'Acessar questionário', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // Intentional visual evidence: questions only, never invitation codes or credentials.
  await page.screenshot({
    path: testInfo.outputPath(`participation-${testInfo.project.name}-light.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Enviar respostas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('todas as questões');
  for (const [index, question] of instrument.questions.entries()) {
    const group = page.getByRole('group').nth(index);
    await group
      .getByRole(question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox')
      .first()
      .check();
  }
  await page.getByRole('button', { name: 'Enviar respostas', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Participação concluída', exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain(invitation.invites[0]!.code);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /invite|response|answer|code/i.test(key)),
    ),
  ).toEqual([]);
  for (const invite of invitation.invites.slice(1)) {
    const response = await request.post('/api/v1/participation/responses', {
      data: {
        inviteCode: invite.code,
        instrumentVersionId: instrument.id,
        answers: instrument.questions.map((question) => ({
          questionId: question.id,
          optionIds: [question.options[0]!.id],
        })),
      },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto('/#/diagnostico');
  await page.getByRole('button', { name: `Ver ciclo ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar ciclo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Emitir convites', exact: true })).toHaveCount(0);
  await expect(page.getByText('5 respostas recebidas.', { exact: false })).toBeVisible();
  const resultResponse = await page.request.get(
    `/api/v1/organizations/${organizationId}/diagnostic-cycles/${cycle.id}/results`,
  );
  const result = diagnosticResultsSchema.parse(await resultResponse.json());
  expect(result.responseCount).toBe(5);
  expect(result.availability).toBe('AVAILABLE');
  expect(result.questions).toHaveLength(5);
  for (const question of result.questions) {
    expect(question.suppressed).toBe(false);
    expect(question.options[0]?.count).toBe(5);
    expect(question.options[0]?.percentage).toBe(100);
  }
  for (const theme of ['dark', 'light']) {
    const change = page.getByRole('button', {
      name: theme === 'dark' ? 'Modo escuro' : 'Modo claro',
      exact: true,
    });
    await change.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`results-${testInfo.project.name}-${theme}.png`),
      fullPage: true,
    });
    await page
      .getByRole('heading', { name: 'Resultados agregados', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`results-detail-${testInfo.project.name}-${theme}.png`),
    });
  }
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.goto('/#/participar');
  await page.getByLabel('Código do convite', { exact: true }).fill(invitation.invites[0]!.code);
  await page.getByRole('button', { name: 'Acessar questionário', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('convite');
  expect(errors).toEqual([]);
});

test('participação pública funciona sem sessão e não aceita código inválido', async ({ page }) => {
  await page.goto('/#/participar');
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Código do convite', { exact: true })).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  await page.getByLabel('Código do convite', { exact: true }).fill('inválido');
  await page.getByRole('button', { name: 'Acessar questionário', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('código completo');
  await page.getByLabel('Código do convite', { exact: true }).fill('a'.repeat(43));
  await page.getByRole('button', { name: 'Acessar questionário', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('convite');
});

test('leitor consulta diagnóstico sem controles administrativos', async ({ page }) => {
  await login(page, 'reader@renr.example');
  await navigate(page, 'Diagnóstico');
  await expect(page.getByRole('heading', { name: 'Diagnóstico', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo ciclo', exact: true })).toHaveCount(0);
});
