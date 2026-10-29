import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  organizationSchema,
  organizationListSchema,
  unitSchema,
  sectorSchema,
  riskDetailSchema,
  actionDetailSchema,
  accessInviteSecretSchema,
  accessMembershipListSchema,
  accessMembershipSchema,
  actionWorkspaceSchema,
  actionWorkspaceHistoryListSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
// Credentials, cookies and activation secrets must never enter retained artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}

test('atribuição nominal independente permite execução restrita e preserva histórico', async ({
  page,
  browser,
}) => {
  const label = `e2e-action-assignment-${randomUUID()}`;
  const email = `${label}@example.test`;
  await login(page, 'admin1@renr.example');
  const createdOrg = await page.request.post('/api/v1/organizations', {
    headers,
    data: { name: label, timezone: 'America/Sao_Paulo' },
  });
  expect(createdOrg.status()).toBe(201);
  const org = organizationSchema.parse(await createdOrg.json());
  const api = `/api/v1/organizations/${org.id}`;
  let riskId: string | undefined;
  let actionId: string | undefined;
  let userId: string | undefined;
  const executorContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    recordVideo: undefined,
  });
  try {
    expect(
      (
        await page.request.put('/api/v1/auth/session/organization', {
          headers,
          data: { organizationId: org.id },
        })
      ).status(),
    ).toBe(200);
    const createdUnit = await page.request.post(`${api}/units`, {
      headers,
      data: { name: `${label} Unidade` },
    });
    expect(createdUnit.status()).toBe(201);
    const unit = unitSchema.parse(await createdUnit.json());
    const createdSector = await page.request.post(`/api/v1/units/${unit.id}/sectors`, {
      headers,
      data: { name: `${label} Setor` },
    });
    expect(createdSector.status()).toBe(201);
    const sector = sectorSchema.parse(await createdSector.json());
    const invited = await page.request.post(`${api}/access-invites`, {
      headers,
      data: {
        name: 'Executor sintético ID14',
        email,
        role: 'READER',
        capabilities: ['EXECUTE_ASSIGNED_ACTIONS'],
        expiresInHours: 24,
        reason: 'Fixture sintética isolada ID14',
      },
    });
    expect(invited.status()).toBe(201);
    const secret = accessInviteSecretSchema.parse(await invited.json());
    const accepted = await executorContext.request.post('/api/v1/access-invites/accept', {
      headers,
      data: { token: secret.token, name: 'Executor sintético ID14', password: demoPassword() },
    });
    expect(accepted.status()).toBe(201);
    const members = accessMembershipListSchema.parse(
      await (await page.request.get(`${api}/access-memberships`)).json(),
    );
    const executor = members.items.find((member) => member.email === email);
    if (!executor) throw new Error('Exact synthetic executor not found.');
    userId = executor.userId;
    const createdRisk = await page.request.post(`${api}/risks`, {
      headers,
      data: {
        sectorId: sector.id,
        factor: `${label} Origem`,
        status: 'REGISTERED',
        description: 'Contexto coletivo sintético de teste',
        exposureDescription: 'Exposição coletiva sintética',
        exposedGroupDescription: 'Equipe sintética',
        possibleHarms: 'Agravos sintéticos descritos',
        existingControls: 'Controles sintéticos existentes',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Registro fictício para validação operacional.',
      },
    });
    expect(createdRisk.status()).toBe(201);
    const risk = riskDetailSchema.parse(await createdRisk.json());
    riskId = risk.id;
    await page.request.put('/api/v1/auth/session/organization', {
      headers,
      data: { organizationId: org.id },
    });
    await page.goto(`/#/acoes/nova?riskId=${risk.id}`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nova ação', exact: true })).toBeVisible();
    for (const [field, value] of [
      ['Título da medida', `${label} Medida`],
      ['Descrição da medida', 'Reorganizar demandas coletivas da equipe sintética'],
      ['Responsável nominal', 'Responsável externo sintético'],
      ['Prazo', '2026-12-20'],
      ['Resultado esperado', 'Distribuição coletiva documentada'],
      ['Critério de aferição', 'Comparar registros de acompanhamento sintéticos'],
    ])
      await page.getByLabel(field!, { exact: true }).fill(value!);
    await page
      .getByLabel('Membro atribuído (opcional)', { exact: true })
      .selectOption(executor.userId);
    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/risks/${risk.id}/action-workspaces`),
    );
    await page.getByRole('button', { name: 'Criar ação', exact: true }).click();
    const response = await creation;
    expect(response.status()).toBe(201);
    const action = actionDetailSchema.parse(await response.json());
    actionId = action.id;
    const detail = actionWorkspaceSchema.parse(
      await (await page.request.get(`${api}/action-workspaces/${action.id}`)).json(),
    );
    expect(detail.assignedUser?.userId).toBe(executor.userId);
    expect(detail.responsibleName).toBe('Responsável externo sintético');
    const executorPage = await executorContext.newPage();
    await login(executorPage, email);
    await executorPage.request.put('/api/v1/auth/session/organization', {
      headers,
      data: { organizationId: org.id },
    });
    await executorPage.goto('/#/acoes?assignedTo=me&page=1');
    await executorPage.reload();
    await executorPage.getByRole('link', { name: action.title, exact: true }).click();
    await expect(
      executorPage.getByRole('button', { name: 'Editar ação', exact: true }),
    ).toHaveCount(0);
    await expect(
      executorPage.getByRole('button', { name: 'Atribuir membro', exact: true }),
    ).toHaveCount(0);
    await expect(
      executorPage.getByRole('button', { name: 'Cancelar ação', exact: true }),
    ).toHaveCount(0);
    await executorPage.getByRole('button', { name: 'Iniciar execução', exact: true }).click();
    await executorPage
      .getByLabel('Motivo da alteração', { exact: true })
      .fill('Execução sintética iniciada pelo membro atribuído');
    await executorPage
      .getByRole('button', { name: 'Registrar acompanhamento', exact: true })
      .click();
    await executorPage.getByRole('button', { name: 'Informar implementação', exact: true }).click();
    await executorPage
      .getByLabel('Motivo da alteração', { exact: true })
      .fill('Comunicação sintética da execução da medida');
    await executorPage
      .getByLabel('Relato de implementação', { exact: true })
      .fill('A equipe sintética informou a execução da medida planejada.');
    await executorPage
      .getByRole('button', { name: 'Registrar acompanhamento', exact: true })
      .click();
    await expect(executorPage.getByText('Informada pela equipe', { exact: true })).toBeVisible();
    const efficacy = executorPage.getByRole('region', { name: 'Análise de eficácia', exact: true });
    await expect(
      efficacy.getByText(
        'Consulta disponível. A preparação exige capacidade de decisões técnicas.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(
      efficacy.getByRole('button', { name: 'Preparar análise de eficácia', exact: true }),
    ).toHaveCount(0);
    await expect(
      executorPage
        .getByRole('complementary', { name: 'Contexto da ação' })
        .getByText('Sem parecer técnico', { exact: true }),
    ).toBeVisible();
    const closure = executorPage.getByRole('region', {
      name: 'Encerramento técnico e continuidade',
      exact: true,
    });
    await expect(
      closure.getByText('Sem encerramento técnico registrado.', { exact: true }),
    ).toBeVisible();
    for (const name of ['Preparar encerramento técnico', 'Preparar nova ação corretiva'])
      await expect(closure.getByRole('button', { name, exact: true })).toHaveCount(0);
    const closureContext = await executorPage.request.get(
      `${api}/actions/${action.id}/closure-context`,
    );
    expect(closureContext.status()).toBe(200);
    expect((await closureContext.json()).permissions).toEqual({
      hasTechnicalCapability: false,
      canClose: false,
      canCreateCorrective: false,
    });
    for (const endpoint of ['technical-closures', 'corrective-actions'])
      expect(
        (
          await executorPage.request.post(`${api}/actions/${action.id}/${endpoint}`, {
            headers,
            data: {},
          })
        ).status(),
      ).toBe(403);
    await expect(
      executorPage.getByRole('button', { name: 'Adicionar anotação', exact: true }),
    ).toBeEnabled();
    await executorPage.getByRole('button', { name: 'Adicionar anotação', exact: true }).click();
    await executorPage
      .getByLabel('Texto da anotação', { exact: true })
      .fill('Acompanhamento sintético registrado pelo executor atribuído.');
    await executorPage
      .getByRole('button', { name: 'Registrar acompanhamento', exact: true })
      .click();
    await expect(
      executorPage.getByText('Acompanhamento sintético registrado pelo executor atribuído.', {
        exact: true,
      }),
    ).toBeVisible();
    await executorPage.getByLabel('Arquivo da evidência', { exact: true }).setInputFiles({
      name: 'evidencia-id14.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nEvidencia sintetica ID14\n%%EOF'),
    });
    await executorPage
      .getByLabel('Descrição da evidência', { exact: true })
      .fill('Documento sintético do acompanhamento ID14');
    await executorPage.getByRole('button', { name: 'Enviar evidência', exact: true }).click();
    await expect(
      executorPage.getByText('Evidência adicionada ao histórico.', { exact: true }),
    ).toBeVisible();
    await expect(
      executorPage.getByRole('button', { name: 'Arquivar evidência', exact: true }),
    ).toHaveCount(0);
    const history = actionWorkspaceHistoryListSchema.parse(
      await (
        await executorPage.request.get(`${api}/action-workspaces/${action.id}/history`)
      ).json(),
    );
    expect(
      history.items.some((entry) => entry.assignmentChange?.next?.userId === executor.userId),
    ).toBe(true);
    expect(history.items.some((entry) => entry.event === 'IMPLEMENTED')).toBe(true);
    const implemented = actionWorkspaceSchema.parse(
      await (await executorPage.request.get(`${api}/action-workspaces/${action.id}`)).json(),
    );
    expect(implemented.status).toBe('IMPLEMENTED');
    expect(
      (
        await executorPage.request.patch(`${api}/actions/${action.id}/assignment`, {
          headers,
          data: {
            expectedVersion: implemented.version,
            assignedUserId: null,
            changeReason: 'Tentativa negada de reatribuição por executor',
          },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await executorContext.close();
    // Archive only this run's exact synthetic records; immutable action history remains local.
    if (actionId) {
      const current = actionDetailSchema.parse(
        await (await page.request.get(`${api}/actions/${actionId}`)).json(),
      );
      expect(current.title.startsWith(label)).toBe(true);
      if (['PLANNED', 'IN_PROGRESS'].includes(current.status))
        expect(
          (
            await page.request.patch(`${api}/actions/${actionId}`, {
              headers,
              data: {
                expectedVersion: current.version,
                status: 'CANCELLED',
                changeReason: 'Limpeza lógica do cenário sintético ID14',
              },
            })
          ).status(),
        ).toBe(200);
    }
    if (riskId) {
      const current = riskDetailSchema.parse(
        await (await page.request.get(`${api}/risks/${riskId}`)).json(),
      );
      expect(current.factor).toBe(`${label} Origem`);
      expect(
        (
          await page.request.patch(`${api}/risks/${riskId}`, {
            headers,
            data: { expectedVersion: current.version, status: 'ARCHIVED' },
          })
        ).status(),
      ).toBe(200);
    }
    if (userId) {
      const member = accessMembershipSchema.parse(
        await (await page.request.get(`${api}/access-memberships/${userId}`)).json(),
      );
      expect(member.email).toBe(email);
      expect(
        (
          await page.request.patch(`${api}/access-memberships/${userId}`, {
            headers,
            data: {
              expectedVersion: member.version,
              isActive: false,
              reason: 'Desativação exata da fixture sintética ID14',
            },
          })
        ).status(),
      ).toBe(200);
    }
    const organizationResponse = await page.request.get(
      `/api/v1/organizations?search=${encodeURIComponent(label)}`,
    );
    expect(organizationResponse.status()).toBe(200);
    const currentOrg = organizationListSchema
      .parse(await organizationResponse.json())
      .items.find((item) => item.id === org.id);
    expect(currentOrg?.name).toBe(label);
    expect(
      (
        await page.request.patch(`/api/v1/organizations/${org.id}`, {
          headers,
          data: { isActive: false },
        })
      ).status(),
    ).toBe(200);
    await page.request.delete('/api/v1/auth/session', { headers });
  }
});
