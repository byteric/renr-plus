import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  actionDetailSchema,
  actionRevisionSchema,
  auditEventListSchema,
  riskDetailSchema,
  sectorListSchema,
  unitListSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

const org = '10000000-0000-4000-8000-000000000001';
const api = `/api/v1/organizations/${org}`;
const headers = { Origin: 'http://127.0.0.1:5173' };
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  expect(
    (
      await page.request.put('/api/v1/auth/session/organization', {
        headers,
        data: { organizationId: org },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}

test('auditoria e histórico reais preservam revisão antiga, filtros e separação entre administrador e leitor', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await login(page, 'admin1@renr.example');
  const unit = unitListSchema
    .parse(await (await page.request.get(`${api}/units`)).json())
    .items.find((item) => item.name === 'Unidade demonstração' && item.isActive)!;
  const sector = sectorListSchema
    .parse(await (await page.request.get(`/api/v1/units/${unit.id}/sectors`)).json())
    .items.find((item) => item.name === 'Setor demonstração' && item.isActive)!;
  const label = `e2e-id2122-${randomUUID()}`;
  const riskResponse = await page.request.post(`${api}/risks`, {
    headers,
    data: {
      sectorId: sector.id,
      factor: label,
      status: 'REGISTERED',
      description: 'Contexto fictício da auditoria local',
      exposureDescription: 'Exposição fictícia de desenvolvimento',
      exposedGroupDescription: 'Equipe de teste',
      possibleHarms: 'Agravos fictícios para teste',
      existingControls: 'Controle fictício para teste',
      sourceKind: 'TECHNICAL_RECORD',
      sourceNote: 'Cenário sintético exclusivo de teste local.',
    },
  });
  expect(riskResponse.status()).toBe(201);
  const risk = riskDetailSchema.parse(await riskResponse.json());
  let actionId: string | undefined;
  const reader = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    recordVideo: undefined,
  });
  try {
    const response = await page.request.post(`${api}/risks/${risk.id}/actions`, {
      headers,
      data: {
        title: `${label} Medida`,
        description: 'Descrição original da ação que deve ser preservada.',
        responsibleName: 'Pessoa fictícia',
        dueDate: '2026-12-01',
        expectedResult: 'Resultado esperado fictício para este cenário',
        verificationCriterion: 'Critério fictício para acompanhamento local',
        expectedRiskVersion: risk.version,
      },
    });
    expect(response.status()).toBe(201);
    const action = actionDetailSchema.parse(await response.json());
    actionId = action.id;
    let currentVersion = action.version;
    const firstNote = 'Primeira anotação histórica que continua acessível após vinte revisões.';
    let firstRevision = '';
    for (let index = 0; index < 22; index++) {
      const note = await page.request.post(`${api}/actions/${action.id}/notes`, {
        headers,
        data: {
          expectedVersion: currentVersion,
          text:
            index === 0
              ? firstNote
              : `Anotação sintética ${index} para testar paginação e preservação.`,
        },
      });
      expect(note.status()).toBe(201);
      const version = actionRevisionSchema.parse(await note.json());
      currentVersion = version.version;
      if (!index) firstRevision = version.id;
    }
    await page.goto(
      `/#/auditoria?resourceType=action&resourceId=${action.id}&operation=ACTION_NOTE&page=2`,
    );
    await expect(page.getByRole('heading', { name: 'Auditoria', exact: true })).toBeVisible();
    await expect(page.getByText(firstNote, { exact: true })).toBeVisible();
    const before = page.url();
    const first = page
      .getByRole('listitem')
      .filter({ has: page.getByText(firstNote, { exact: true }) });
    await first.getByRole('button', { name: /Abrir registro/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('definition').filter({ hasText: firstNote })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`recordId=${firstRevision}`));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(before);
    await page.reload();
    await expect(page.getByLabel('Identificador do recurso')).toHaveValue(action.id);
    const readerPage = await reader.newPage();
    await login(readerPage, 'reader@renr.example');
    expect((await readerPage.request.get(`${api}/audit-events`)).status()).toBe(403);
    await readerPage.goto(`/#/acoes/${action.id}?historyPage=2`);
    await expect(
      readerPage.getByRole('heading', { name: 'Histórico unificado', exact: true }),
    ).toBeVisible();
    await expect(
      readerPage
        .getByRole('region', { name: 'Histórico unificado', exact: true })
        .getByText(firstNote, { exact: true }),
    ).toBeVisible();
    const history = auditEventListSchema.parse(
      await (await readerPage.request.get(`${api}/risks/${risk.id}/history?pageSize=100`)).json(),
    );
    expect(history.items.some((item) => item.target?.id === firstRevision)).toBe(true);
    expect(history.items.every((item) => item.resource.type !== 'access')).toBe(true);
    expect(
      (
        await readerPage.request.get(
          '/api/v1/organizations/10000000-0000-4000-8000-000000000002/audit-events',
        )
      ).status(),
    ).toBe(404);
    await readerPage.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(readerPage.getByLabel('E-mail', { exact: true })).toBeVisible();
    await expect(readerPage.getByText(firstNote, { exact: true })).toHaveCount(0);
    await reader.close();
  } finally {
    if (actionId) {
      const current = actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${actionId}`)).json(),
      );
      if (['PLANNED', 'IN_PROGRESS'].includes(current.status))
        expect(
          (
            await page.request.patch(`${api}/actions/${actionId}`, {
              headers,
              data: {
                expectedVersion: current.version,
                status: 'CANCELLED',
                changeReason: 'Finalização do cenário fictício de auditoria local.',
              },
            })
          ).status(),
        ).toBe(200);
    }
    const current = riskDetailSchema.parse(
      await (await page.request.get(`${api}/risks/${risk.id}`)).json(),
    );
    expect(
      (
        await page.request.patch(`${api}/risks/${risk.id}`, {
          headers,
          data: { expectedVersion: current.version, status: 'ARCHIVED' },
        })
      ).status(),
    ).toBe(200);
    await reader.close();
    await page.request.delete('/api/v1/auth/session', { headers });
  }
});
