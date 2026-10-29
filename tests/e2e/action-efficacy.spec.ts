import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  accessInviteSecretSchema,
  accessMembershipListSchema,
  accessMembershipSchema,
  actionDetailSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  efficacyOpinionListSchema,
  evidenceSchema,
  organizationSchema,
  riskDetailSchema,
  sectorSchema,
  unitSchema,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';

const headers = { Origin: 'http://127.0.0.1:5173' };
// Session, activation secrets and file contents stay out of retained artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10000 });
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
}

test('parecer técnico exige revisão e confirmação, preserva provas e não encerra a ação', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const label = `e2e-efficacy-${randomUUID()}`;
  const email = `${label}@example.test`;
  await login(page, 'admin1@renr.example');
  const orgResponse = await page.request.post('/api/v1/organizations', {
    headers,
    data: { name: label, timezone: 'America/Sao_Paulo' },
  });
  expect(orgResponse.status()).toBe(201);
  const org = organizationSchema.parse(await orgResponse.json());
  const api = `/api/v1/organizations/${org.id}`;
  const technicalContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5173',
    recordVideo: undefined,
  });
  let riskId: string | undefined;
  let technicianId: string | undefined;
  try {
    expect(
      (
        await page.request.put('/api/v1/auth/session/organization', {
          headers,
          data: { organizationId: org.id },
        })
      ).status(),
    ).toBe(200);
    const unitResponse = await page.request.post(`${api}/units`, {
      headers,
      data: { name: `${label} Unidade` },
    });
    expect(unitResponse.status()).toBe(201);
    const unit = unitSchema.parse(await unitResponse.json());
    const sectorResponse = await page.request.post(`/api/v1/units/${unit.id}/sectors`, {
      headers,
      data: { name: `${label} Setor` },
    });
    expect(sectorResponse.status()).toBe(201);
    const sector = sectorSchema.parse(await sectorResponse.json());
    const invitation = await page.request.post(`${api}/access-invites`, {
      headers,
      data: {
        name: 'Técnico sintético ID16',
        email,
        role: 'READER',
        capabilities: ['TECHNICAL_DECISIONS'],
        expiresInHours: 24,
        reason: 'Fixture técnica sintética exclusiva do ID16',
      },
    });
    expect(invitation.status()).toBe(201);
    const secret = accessInviteSecretSchema.parse(await invitation.json());
    expect(
      (
        await technicalContext.request.post('/api/v1/access-invites/accept', {
          headers,
          data: {
            token: secret.token,
            name: 'Técnico sintético ID16',
            password: demoPassword(),
          },
        })
      ).status(),
    ).toBe(201);
    const members = accessMembershipListSchema.parse(
      await (await page.request.get(`${api}/access-memberships`)).json(),
    );
    const technician = members.items.find((member) => member.email === email);
    if (!technician) throw new Error('Exact synthetic technical membership not found.');
    technicianId = technician.userId;
    const riskResponse = await page.request.post(`${api}/risks`, {
      headers,
      data: {
        sectorId: sector.id,
        factor: `${label} Origem`,
        status: 'REGISTERED',
        description: 'Descrição coletiva sintética da organização das tarefas',
        exposureDescription: 'Exposição coletiva sintética',
        exposedGroupDescription: 'Equipe sintética',
        possibleHarms: 'Agravos sintéticos descritos',
        existingControls: 'Controles preventivos sintéticos',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Registro fictício, sem certificação normativa.',
      },
    });
    expect(riskResponse.status()).toBe(201);
    const risk = riskDetailSchema.parse(await riskResponse.json());
    riskId = risk.id;
    const creation = await page.request.post(`${api}/risks/${risk.id}/actions`, {
      headers,
      data: {
        title: `${label} Medida`,
        description: 'Reorganizar a distribuição coletiva de tarefas sintéticas',
        responsibleName: 'Responsável externo sintético',
        dueDate: '2026-12-20',
        expectedResult: 'Distribuição coletiva documentada e acompanhada',
        verificationCriterion: 'Comparar registros coletivos antes e depois da medida',
        expectedRiskVersion: risk.version,
      },
    });
    expect(creation.status()).toBe(201);
    let action = actionDetailSchema.parse(await creation.json());
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED'] as const) {
      const response = await page.request.patch(`${api}/actions/${action.id}`, {
        headers,
        data: {
          expectedVersion: action.version,
          status,
          changeReason: 'Acompanhamento operacional sintético da medida',
          ...(status === 'IMPLEMENTED'
            ? { implementationNote: 'A equipe sintética informou a execução da medida preventiva.' }
            : {}),
        },
      });
      expect(response.status()).toBe(200);
      action = actionDetailSchema.parse(await response.json());
    }
    const upload = await page.request.post(`${api}/actions/${action.id}/evidence`, {
      headers,
      multipart: {
        expectedVersion: String(action.version),
        description: 'Registro coletivo sintético para análise de eficácia',
        file: {
          name: 'efficacy-proof.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\nSynthetic efficacy proof\n%%EOF'),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const evidence = evidenceSchema.parse(await upload.json());
    action = actionDetailSchema.parse(
      await (await page.request.get(`${api}/actions/${action.id}`)).json(),
    );
    const operationalVersion = action.version;
    await page.goto(`/#/acoes/${action.id}`);
    await page.reload();
    const adminPanel = page.getByRole('region', { name: 'Análise de eficácia', exact: true });
    await expect(
      adminPanel.getByText(
        'Consulta disponível. A preparação exige capacidade de decisões técnicas.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      adminPanel.getByRole('button', { name: 'Preparar análise de eficácia', exact: true }),
    ).toHaveCount(0);

    const technicalPage = await technicalContext.newPage();
    await test.step('Autenticar o técnico sintético', () => login(technicalPage, email));
    expect(
      (
        await technicalPage.request.put('/api/v1/auth/session/organization', {
          headers,
          data: { organizationId: org.id },
        })
      ).status(),
    ).toBe(200);
    await technicalPage.goto(`/#/acoes/${action.id}`);
    await technicalPage.reload();
    const panel = technicalPage.getByRole('region', { name: 'Análise de eficácia', exact: true });
    await expect(
      panel.getByText('Nenhum parecer técnico registrado.', { exact: true }),
    ).toBeVisible();
    let writes = 0;
    technicalPage.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith(`/actions/${action.id}/efficacy-opinions`)
      )
        writes += 1;
    });

    async function record(result: 'EFFECTIVE' | 'INCONCLUSIVE', number: number) {
      const current = efficacyContextSchema.parse(
        await (await technicalPage.request.get(`${api}/actions/${action.id}/efficacy`)).json(),
      );
      await panel
        .getByRole('button', { name: 'Preparar análise de eficácia', exact: true })
        .click();
      await panel.getByLabel('Conclusão', { exact: true }).selectOption(result);
      await panel.getByLabel('Data da verificação', { exact: true }).fill(current.referenceDate);
      await panel
        .getByLabel('Observação técnica', { exact: true })
        .fill(
          `Observação coletiva sintética do parecer ${number}, baseada nos registros da equipe.`,
        );
      await panel
        .getByLabel('Justificativa do parecer', { exact: true })
        .fill(
          `Justificativa técnica sintética do parecer ${number}, relacionada ao critério preservado.`,
        );
      if (result === 'INCONCLUSIVE')
        await panel
          .getByLabel('Próximos passos (obrigatório)', { exact: true })
          .fill('Reunir novos registros coletivos e realizar outra verificação técnica.');
      await panel
        .getByRole('checkbox', {
          name: `${evidence.fileName} · ${evidence.description}`,
          exact: true,
        })
        .check();
      await panel.getByRole('button', { name: 'Adicionar prova textual', exact: true }).click();
      await panel
        .getByLabel('Referência identificada 1', { exact: true })
        .fill(`${label} registro ${number}`);
      await panel
        .getByLabel('Descrição da prova 1', { exact: true })
        .fill('Descrição sintética dos registros coletivos de acompanhamento.');
      await panel
        .getByLabel('Justificativa da prova 1', { exact: true })
        .fill('A fonte identificada fundamenta a conclusão técnica sintética.');
      await panel.getByRole('button', { name: 'Revisar resumo do parecer', exact: true }).click();
      const review = panel.getByRole('region', { name: 'Revisão do parecer', exact: true });
      await expect(
        review.getByRole('heading', { name: 'Revise antes de confirmar', exact: true }),
      ).toBeVisible();
      expect(writes).toBe(number - 1);
      const before = efficacyOpinionListSchema.parse(
        await (
          await technicalPage.request.get(`${api}/actions/${action.id}/efficacy-opinions`)
        ).json(),
      );
      expect(before.total).toBe(number - 1);
      const confirmation = technicalPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/actions/${action.id}/efficacy-opinions`),
      );
      await review
        .getByRole('button', { name: 'Confirmar e registrar parecer', exact: true })
        .click();
      const response = await confirmation;
      expect(response.status()).toBe(201);
      const opinion = efficacyOpinionSchema.parse(await response.json());
      await expect(
        panel.getByText(
          'Parecer de eficácia registrado. O acompanhamento continua; este registro não encerra a ação.',
          { exact: true },
        ),
      ).toBeVisible();
      expect(opinion.result).toBe(result);
      expect(opinion.author.id).toBe(technician.userId);
      expect(opinion.actionVersion).toBe(operationalVersion);
      expect(opinion.proofPackage.files[0]?.sha256).toBe(evidence.sha256);
      expect(opinion.proofPackage.texts).toHaveLength(1);
      expect(writes).toBe(number);
      return opinion;
    }
    const first = await test.step('Preparar, revisar e confirmar o primeiro parecer', () =>
      record('EFFECTIVE', 1));
    await panel.getByRole('button', { name: 'Consultar parecer 1', exact: true }).click();
    const second = await test.step('Substituir o parecer com conclusão inconclusiva', () =>
      record('INCONCLUSIVE', 2));
    expect(second.supersedesId).toBe(first.id);
    await expect(
      panel.getByRole('heading', { name: 'Parecer 2 · Inconclusivo', exact: true }).first(),
    ).toBeVisible();
    const oldEntries = panel.getByRole('listitem').filter({
      has: technicalPage.getByRole('heading', { name: 'Parecer 1 · Eficaz', exact: true }),
    });
    await expect(
      oldEntries.first().getByText('Substituído por parecer posterior', { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: 'Parecer 1 · Eficaz', exact: true }),
    ).toHaveCount(1);
    for (const old of await oldEntries.all())
      await expect(old.getByText('Vigente', { exact: true })).toHaveCount(0);
    expect(
      actionDetailSchema.parse(
        await (await technicalPage.request.get(`${api}/actions/${action.id}`)).json(),
      ).version,
    ).toBe(operationalVersion);
    await expect(
      technicalPage.getByRole('button', { name: /Encerrar ação|Fechar tecnicamente/ }),
    ).toHaveCount(0);
    const archival = await page.request.patch(
      `${api}/actions/${action.id}/evidence/${evidence.id}`,
      {
        headers,
        data: {
          expectedVersion: operationalVersion,
          changeReason: 'Arquivamento sintético da prova selecionada exige revisão',
        },
      },
    );
    expect(archival.status()).toBe(200);
    await technicalPage.getByRole('button', { name: 'Atualizar ação', exact: true }).click();
    await expect(
      panel.getByText('Prova selecionada arquivada', { exact: true }).first(),
    ).toBeVisible();
    const reviewRequired = efficacyContextSchema.parse(
      await (await technicalPage.request.get(`${api}/actions/${action.id}/efficacy`)).json(),
    );
    expect(reviewRequired.state).toBe('REVIEW_REQUIRED');
    expect(reviewRequired.latest?.id).toBe(second.id);
    expect(reviewRequired.latest?.proofPackage).toEqual(second.proofPackage);
    const legacy = actionDetailSchema.parse(
      await (await technicalPage.request.get(`${api}/actions/${action.id}`)).json(),
    );
    expect(legacy.status).toBe('IMPLEMENTED');
    await technicalPage.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(
      technicalPage.getByRole('heading', { name: 'Acesse o ReNR+', exact: true }),
    ).toBeVisible();
    expect((await technicalPage.request.get(`${api}/actions/${action.id}/efficacy`)).status()).toBe(
      401,
    );
  } finally {
    await technicalContext.close();
    if (riskId) {
      const risk = riskDetailSchema.parse(
        await (await page.request.get(`${api}/risks/${riskId}`)).json(),
      );
      expect(risk.factor).toBe(`${label} Origem`);
      expect(
        (
          await page.request.patch(`${api}/risks/${riskId}`, {
            headers,
            data: { expectedVersion: risk.version, status: 'ARCHIVED' },
          })
        ).status(),
      ).toBe(200);
    }
    if (technicianId) {
      const membership = accessMembershipSchema.parse(
        await (await page.request.get(`${api}/access-memberships/${technicianId}`)).json(),
      );
      expect(membership.email).toBe(email);
      expect(
        (
          await page.request.patch(`${api}/access-memberships/${technicianId}`, {
            headers,
            data: {
              expectedVersion: membership.version,
              isActive: false,
              reason: 'Desativação exata da fixture sintética ID16',
            },
          })
        ).status(),
      ).toBe(200);
    }
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
