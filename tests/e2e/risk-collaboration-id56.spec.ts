import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { demoPassword } from '../../scripts/e2e-data.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const origin = 'http://127.0.0.1:5173';
const demoOrgId = '10000000-0000-4000-8000-000000000001';
const evidenceDir = resolve(process.cwd(), 'tmp/evidencias-id56');

async function signOut(page: Page) {
  const response = await page.context().request.delete('/api/v1/auth/session', {
    headers: { Origin: origin },
  });
  expect([204, 401]).toContain(response.status());
}

async function signIn(page: Page, email: string, password: string) {
  await signOut(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Empresa ativa', exact: true })).toBeVisible();
}

async function selectOrg(page: Page, orgId: string) {
  const select = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  if ((await select.inputValue()) !== orgId) {
    await select.selectOption(orgId);
    await expect(select).toHaveValue(orgId);
  }
}

test.afterEach(async ({ page }) => {
  await signOut(page);
});

test('ID56: corrige ciclo diagnóstico e ação preventiva com Camila e valida colaboração SST x Psicologia com sigilo, compartilhamento e evidências visuais', async ({
  page,
}, testInfo) => {
  mkdirSync(evidenceDir, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const suffix = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const password = demoPassword();

  // 1. Login como Admin para preparar cenário fictício e testar RH Fix A (com e sem instrumento demonstrativo)
  await signIn(page, 'admin1@renr.example', password);
  await selectOrg(page, demoOrgId);

  // Criar empresa fictícia SEM instrumento demonstrativo (reproduzindo o erro anterior do RH)
  const noDemoOrgRes = await page.context().request.post('/api/v1/organizations', {
    headers: { Origin: origin },
    data: { name: `Empresa Sem Demo ${suffix}`, timezone: 'America/Sao_Paulo' },
  });
  expect(noDemoOrgRes.status()).toBe(201);
  const noDemoOrg = (await noDemoOrgRes.json()) as { id: string };

  await page.context().request.put('/api/v1/auth/session/organization', {
    headers: { Origin: origin },
    data: { organizationId: noDemoOrg.id },
  });
  const unitNoDemoRes = await page
    .context()
    .request.post(`/api/v1/organizations/${noDemoOrg.id}/units`, {
      headers: { Origin: origin },
      data: { name: `Unidade Aurora ${suffix}` },
    });
  expect(unitNoDemoRes.status()).toBe(201);
  const unitNoDemo = (await unitNoDemoRes.json()) as { id: string };
  const sectorNoDemoRes = await page
    .context()
    .request.post(`/api/v1/units/${unitNoDemo.id}/sectors`, {
      headers: { Origin: origin },
      data: { name: `Setor Gente ${suffix}` },
    });
  expect(sectorNoDemoRes.status()).toBe(201);

  // Recarrega a aplicação para sincronizar a lista de empresas com a recém-criada e abre Diagnóstico demonstrativo
  await page.goto('/#/diagnostico');
  await page.reload();
  await selectOrg(page, noDemoOrg.id);
  await page.getByRole('button', { name: 'Novo ciclo' }).click();
  await expect(page.getByText(/não possui instrumento demonstrativo publicado/i)).toBeVisible();
  await expect(page.getByText(/Este registro não está mais disponível/i)).toHaveCount(0);
  await page.getByLabel('Unidade', { exact: true }).selectOption(unitNoDemo.id);
  await expect(page.getByLabel('Setor', { exact: true })).toContainText(`Setor Gente ${suffix}`);
  await expect(page.getByRole('button', { name: 'Criar ciclo' })).toBeDisabled();

  // Voltar para empresa COM instrumento demonstrativo e criar um ciclo fictício selecionando unidade e setor
  await selectOrg(page, demoOrgId);
  await page.goto('/#/diagnostico');
  await page.getByRole('button', { name: 'Novo ciclo' }).click();
  const unitSelect = page.getByLabel('Unidade', { exact: true });
  await expect(unitSelect.locator('option')).not.toHaveCount(1);
  const firstUnitValue = await unitSelect.locator('option').nth(1).getAttribute('value');
  expect(firstUnitValue).toBeTruthy();
  await unitSelect.selectOption(firstUnitValue!);
  const sectorSelect = page.getByLabel('Setor', { exact: true });
  await expect(sectorSelect.locator('option')).not.toHaveCount(1);
  const firstSectorValue = await sectorSelect.locator('option').nth(1).getAttribute('value');
  expect(firstSectorValue).toBeTruthy();
  await sectorSelect.selectOption(firstSectorValue!);
  await page.getByLabel('Nome do ciclo', { exact: true }).fill(`Ciclo RH Validado ${suffix}`);
  await page.getByLabel('Início', { exact: true }).fill('2026-11-25T09:00');
  await page.getByLabel('Término', { exact: true }).fill('2027-01-25T18:00');
  await page.getByRole('button', { name: 'Criar ciclo' }).click();
  await expect(page.getByText(`Ciclo RH Validado ${suffix}`)).toBeVisible();

  // Preparar 1 risco REGISTERED e 1 risco DRAFT na empresa demoOrgId + convidar Camila (SST) e Beatriz (Psicologia)
  const registeredRiskRes = await page
    .context()
    .request.post(`/api/v1/organizations/${demoOrgId}/risks`, {
      headers: { Origin: origin },
      data: {
        sectorId: firstSectorValue,
        factor: `Sobrecarga psicossocial ID56 ${suffix}`,
        description: 'Descrição coletiva do risco para colaboração SST e Psicologia.',
        exposureDescription: 'Demanda contínua ao longo do expediente.',
        exposedGroupDescription: 'Equipe coletiva do setor.',
        possibleHarms: 'Fadiga mental e desgaste ocupacional.',
        existingControls: 'Acompanhamento de rotina.',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Registro técnico fictício ID56.',
        status: 'REGISTERED',
      },
    });
  expect(registeredRiskRes.status()).toBe(201);
  const registeredRisk = (await registeredRiskRes.json()) as { id: string };

  const draftRiskRes = await page
    .context()
    .request.post(`/api/v1/organizations/${demoOrgId}/risks`, {
      headers: { Origin: origin },
      data: {
        sectorId: firstSectorValue,
        factor: `Risco rascunho bloqueado ${suffix}`,
        status: 'DRAFT',
      },
    });
  expect(draftRiskRes.status()).toBe(201);
  const draftRisk = (await draftRiskRes.json()) as { id: string };

  const camilaEmail = `camila-id56-${suffix}@renr.example`;
  const beatrizEmail = `beatriz-id56-${suffix}@renr.example`;
  const inviteUser = async (email: string, name: string, capabilities: string[]) => {
    const inviteRes = await page
      .context()
      .request.post(`/api/v1/organizations/${demoOrgId}/access-invites`, {
        headers: { Origin: origin },
        data: {
          email,
          name,
          role: 'READER',
          capabilities,
          expiresInHours: 24,
          reason: 'Ensaio fictício local ID 56',
        },
      });
    expect(inviteRes.status()).toBe(201);
    const { token } = (await inviteRes.json()) as { token: string };
    const isolatedApi = await playwrightRequest.newContext({ baseURL: origin });
    try {
      const acceptRes = await isolatedApi.post('/api/v1/access-invites/accept', {
        headers: { Origin: origin },
        data: { token, name, password },
      });
      expect(acceptRes.status()).toBe(201);
    } finally {
      await isolatedApi.dispose();
    }
  };

  await inviteUser(camilaEmail, 'Camila SST ID56', ['TECHNICAL_DECISIONS']);
  await inviteUser(beatrizEmail, 'Beatriz Psicologia ID56', ['PSYCHOLOGY_COLLABORATION']);

  // 2. RH Fix B: Camila (READER + TECHNICAL_DECISIONS) cria ação preventiva a partir de Ações e vê bloqueio em DRAFT
  await signIn(page, camilaEmail, password);
  await page.goto('/#/acoes');
  const riskSelector = page.getByLabel('Risco registrado elegível', { exact: true });
  await expect(riskSelector).toBeVisible();
  await riskSelector.selectOption(registeredRisk.id);
  await page.getByRole('link', { name: 'Criar ação preventiva' }).click();
  await expect(page.getByRole('heading', { name: 'Nova ação' })).toBeVisible();
  await page.getByLabel('Título da medida').fill(`Pausas preventivas Camila ${suffix}`);
  await page
    .getByLabel('Descrição da medida')
    .fill('Implantar pausas coletivas planejadas no setor.');
  await page.getByLabel('Responsável nominal').fill('Coordenação de Operações');
  await page.getByLabel('Prazo').fill('2026-12-20');
  await page.getByLabel('Resultado esperado').fill('Redução do desgaste cognitivo no turno.');
  await page.getByLabel('Critério de aferição').fill('Acompanhamento mensal de escala coletiva.');
  await page.getByRole('button', { name: 'Criar ação' }).click();
  await expect(page.getByText(`Pausas preventivas Camila ${suffix}`)).toBeVisible();

  // Estado impedido (DRAFT) com explicação clara para Camila
  await page.goto(`/#/inventario/${draftRisk.id}`);
  await expect(
    page.getByText(/Risco em rascunho: registre o risco antes de criar uma ação preventiva/i),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Criar ação preventiva' })).toHaveCount(0);

  // 3. Parte 2: Beatriz (Psicologia) cria contribuição RESERVADA no mesmo risco
  await signIn(page, beatrizEmail, password);
  await page.goto(`/#/inventario/${registeredRisk.id}`);
  await expect(
    page.getByRole('heading', { name: 'Contribuições interdisciplinares' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Nova contribuição técnica' }).click();
  await page.getByLabel('Título da contribuição').fill(`Análise Psicologia ${suffix}`);
  await page
    .getByLabel('Fatores psicossociais do trabalho')
    .fill('RESERVADO-E2E-PSICO: demandas simultâneas sem intervalo coletivo previsível.');
  await page
    .getByLabel('Recomendações preventivas coletivas')
    .fill('Estruturar janelas coletivas de recuperação e revisão de metas com SST.');
  await page
    .getByLabel('Próximo passo sugerido (opcional)')
    .fill('Validar síntese antes de compartilhar.');
  await page.getByRole('button', { name: 'Salvar contribuição' }).click();
  await expect(page.getByText(`Análise Psicologia ${suffix}`)).toBeVisible();
  await expect(page.getByText('Reservado à especialidade', { exact: true })).toBeVisible();

  // 4. Camila (SST) NÃO vê a contribuição reservada de Beatriz e adiciona sua contribuição SST (SHARED)
  await signIn(page, camilaEmail, password);
  await page.goto(`/#/inventario/${registeredRisk.id}`);
  await expect(
    page.getByRole('heading', { name: 'Contribuições interdisciplinares' }),
  ).toBeVisible();
  await expect(page.getByText(`Análise Psicologia ${suffix}`)).toHaveCount(0);
  await expect(page.getByText(/RESERVADO-E2E-PSICO/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Nova contribuição técnica' }).click();
  await page.getByLabel('Visibilidade inicial').selectOption('SHARED');
  await page.getByLabel('Título da contribuição').fill(`Parecer SST Integrado ${suffix}`);
  await page
    .getByLabel('Fatores psicossociais do trabalho')
    .fill('Critério técnico SST alinhado à organização do posto de trabalho.');
  await page
    .getByLabel('Recomendações preventivas coletivas')
    .fill('Integrar medidas ergonômicas e organizacionais ao plano preventivo.');
  await page.getByRole('button', { name: 'Salvar contribuição' }).click();
  await expect(page.getByText(`Parecer SST Integrado ${suffix}`)).toBeVisible();

  // 5. Beatriz volta, vê a contribuição SHARED de Camila, edita e compartilha a sua
  await signIn(page, beatrizEmail, password);
  await page.goto(`/#/inventario/${registeredRisk.id}`);
  await expect(page.getByText(`Parecer SST Integrado ${suffix}`)).toBeVisible();
  await expect(page.getByText(`Análise Psicologia ${suffix}`)).toBeVisible();

  await page.getByRole('button', { name: 'Editar versão' }).click();
  await page
    .getByLabel('Fatores do trabalho')
    .fill('Síntese coletiva compartilhada: sobrecarga organizacional no atendimento.');
  await page
    .getByLabel('Motivo da revisão')
    .fill('Preparar síntese coletiva sem texto reservado para SST.');
  await page.getByRole('button', { name: 'Salvar revisão' }).click();
  await expect(page.getByText(/versão 2/)).toBeVisible();

  await page.getByRole('button', { name: 'Compartilhar com equipe técnica' }).click();
  await page
    .getByLabel('Justificativa do compartilhamento')
    .fill('Compartilhamento autorizado para alinhamento preventivo com SST.');
  await page.getByRole('button', { name: 'Confirmar compartilhamento' }).click();
  await expect(page.getByText(/Contribuição compartilhada com a equipe técnica/i)).toBeVisible();

  // 6. Camila confirma que agora vê ambas contribuições com autoria, especialidade, versão e zero vazamento de texto reservado
  await signIn(page, camilaEmail, password);
  await page.goto(`/#/inventario/${registeredRisk.id}`);
  await expect(page.getByText(`Análise Psicologia ${suffix}`)).toBeVisible();
  await expect(page.getByText(`Parecer SST Integrado ${suffix}`)).toBeVisible();
  await expect(page.getByText(/Autoria: Beatriz Psicologia ID56/)).toBeVisible();
  await expect(page.getByText(/RESERVADO-E2E-PSICO/)).toHaveCount(0);

  // Evidências visuais (Desktop 1440 light/dark + Mobile 320 + checagem de overflow horizontal)
  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#risk-colaboracao').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDir, 'id56-desktop-1440-light.png') });
    await page.getByRole('button', { name: 'Modo escuro' }).click();
    await page.locator('#risk-colaboracao').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDir, 'id56-desktop-1440-dark.png') });
    await page.getByRole('button', { name: 'Modo claro' }).click();
    await page.setViewportSize({ width: 320, height: 760 });
    await page.locator('#risk-colaboracao').scrollIntoViewIfNeeded();
    const overflow320 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow320).toBeLessThanOrEqual(2);
    await page.screenshot({ path: resolve(evidenceDir, 'id56-mobile-320.png') });
  }

  expect(pageErrors).toEqual([]);
});
