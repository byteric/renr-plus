import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  accessInviteAcceptanceSchema,
  accessInviteSecretSchema,
  accessMembershipSchema,
  assessmentCycleSchema,
  assessmentInvitesSchema,
  assessmentResultsSchema,
  consolidationPolicySchema,
  createdInstrumentSchema,
  instrumentVersionSchema,
  platformGrantSchema,
  platformCapabilitiesSchema,
  sessionCapabilitiesSchema,
  type Capability,
} from '../../packages/contracts/src/index';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { test } from './personas-id37-fixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function openCollectiveSurvey(
  admin: APIRequestContext,
  tenant: string,
  groupId: string,
  origin: string,
) {
  const headers = { Origin: origin };
  async function post(path: string, data: object) {
    const response = await admin.post(tenant + path, { headers, data });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const created = createdInstrumentSchema.parse(
    await post('/instruments', { name: 'Instrumento fictício ID37' }),
  );
  const path = `${tenant}/instruments/${created.instrument.id}/versions/${created.version.id}`;
  const saved = await admin.put(path, {
    headers,
    data: {
      expectedRevision: created.version.revision,
      title: 'Instrumento fictício ID37',
      description: 'Contexto coletivo sintético.',
      instructions: 'Selecione uma alternativa fictícia.',
      usageMode: 'DEMONSTRATION',
      questions: [
        {
          id: randomUUID(),
          label: 'Questão fictícia ID37',
          type: 'SINGLE_CHOICE',
          required: true,
          position: 1,
          options: ['Alternativa fictícia A', 'Alternativa fictícia B'].map((label, index) => ({
            id: randomUUID(),
            label,
            position: index + 1,
          })),
        },
      ],
    },
  });
  expect(saved.status()).toBe(200);
  const draft = instrumentVersionSchema.parse(await saved.json());
  const published = await admin.post(path + '/publish', {
    headers,
    data: { expectedRevision: draft.revision },
  });
  expect(published.status()).toBe(201);
  const policy = consolidationPolicySchema.parse(
    await post('/consolidation-policies', { usageMode: 'DEMONSTRATION', minimumResponses: 5 }),
  );
  await post(`/consolidation-policies/${policy.id}/publish`, { expectedRevision: policy.revision });
  const cycle = assessmentCycleSchema.parse(
    await post('/assessment-cycles', {
      name: 'Coleta fictícia ID37',
      assessmentGroupId: groupId,
      instrumentVersionId: draft.id,
      policyVersionId: policy.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  );
  return assessmentCycleSchema.parse(
    await post(`/assessment-cycles/${cycle.id}/open`, {
      expectedRevision: cycle.revision,
    }),
  );
}

test('ID 37 ativa, isola e revoga cada acesso de demonstração @personas', async ({
  browser,
  page,
  scenario,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const { admin, orgId, otherOrgId, groupId, employeeId, riskId, suffix } = scenario;
  const origin = new URL(baseURL!).origin;
  const headers = { Origin: origin };
  const tenant = `/api/v1/organizations/${orgId}`;
  const otherTenant = `/api/v1/organizations/${otherOrgId}`;
  const sessionPath = '/api/v1/auth/session';
  const globalPath = '/api/v1/platform/overview';
  const grantPath = '/api/v1/platform/grants';
  const reason = 'Acesso sintético temporário ID37';
  const globalPermissionsPath = '/api/v1/platform/capabilities';
  const globalPermissions = platformCapabilitiesSchema.parse(
    await (await admin.get(globalPermissionsPath)).json(),
  );
  expect(globalPermissions.capabilities).toEqual(
    expect.arrayContaining(['READ_OVERVIEW', 'MANAGE_CLIENTS', 'MANAGE_GRANTS']),
  );
  expect((await admin.get(globalPath)).status()).toBe(200);

  await login(page, 'admin1@renr.example', demoPassword());
  await expect(
    page.getByRole('heading', { name: 'Empresas', exact: true, level: 1 }),
  ).toBeVisible();
  const originalSession = await page.request.get(sessionPath);
  expect(originalSession.status()).toBe(200);
  const original = await originalSession.json();

  async function revokeMember(userId: string) {
    const path = `${tenant}/access-memberships/${userId}`;
    const current = await admin.get(path);
    expect(current.status()).toBe(200);
    const member = accessMembershipSchema.parse(await current.json());
    const result = await admin.patch(path, {
      headers,
      data: { expectedVersion: member.version, isActive: false, reason },
    });
    expect(result.status()).toBe(200);
    expect(accessMembershipSchema.parse(await result.json()).isActive).toBe(false);
  }

  async function activate(
    target: Page,
    key: string,
    name: string,
    role: 'ADMIN' | 'READER',
    capabilities: Capability[],
  ) {
    const email = `${key}-${suffix}@example.test`;
    const password = randomBytes(24).toString('hex');
    const response = await admin.post(tenant + '/access-invites', {
      headers,
      data: { email, name, role, capabilities, expiresInHours: 2, reason },
    });
    expect(response.status()).toBe(201);
    const { invite, token } = accessInviteSecretSchema.parse(await response.json());
    expect(invite.status).toBe('PENDING');
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now() + 3_600_000);
    expect(Date.parse(invite.expiresAt)).toBeLessThanOrEqual(Date.now() + 7_200_000);
    await target.goto('/#/ativar');
    await target.getByLabel('Código do convite de acesso', { exact: true }).fill(token);
    await target.getByRole('button', { name: 'Criar meu acesso', exact: true }).click();
    await target.getByLabel('Seu nome', { exact: true }).fill(name);
    await target.getByLabel('Nova senha', { exact: true }).fill(password);
    await target.getByLabel('Confirmar nova senha', { exact: true }).fill(password);
    const accepted = target.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/access-invites/accept',
    );
    await target.getByRole('button', { name: 'Ativar acesso', exact: true }).click();
    const result = await accepted;
    expect(result.status()).toBe(201);
    const { userId, organizationId } = accessInviteAcceptanceSchema.parse(await result.json());
    expect(organizationId).toBe(orgId);
    await expect(target.getByRole('status').filter({ hasText: 'Acesso ativado' })).toBeVisible();
    expect(new URL(target.url()).hash).toBe('#/ativar');
    return { userId, email, password };
  }

  await test.step('ReTech+ consulta a plataforma sem vínculo de cliente', async () => {
    const context = await browser.newContext({ baseURL });
    try {
      const operator = await context.newPage();
      const account = await activate(operator, 'retech', 'ReTech+ consulta ID37', 'READER', []);
      const grantData = { userId: account.userId, capability: 'READ_OVERVIEW', reason };
      const created = await admin.put(grantPath, {
        headers,
        data: { ...grantData, expectedVersion: 0, isActive: true },
      });
      expect(created.status()).toBe(200);
      const grant = platformGrantSchema.parse(await created.json());
      await revokeMember(account.userId);
      await login(operator, account.email, account.password);
      await expect(operator).toHaveURL(/#\/plataforma$/);
      expect((await operator.request.get(globalPath)).status()).toBe(200);
      expect((await operator.request.get('/api/v1/platform/clients')).status()).toBe(200);
      expect((await operator.request.get('/api/v1/platform/reports')).status()).toBe(200);
      expect((await operator.request.get(grantPath)).status()).toBe(403);
      for (const scope of [tenant, otherTenant])
        expect((await operator.request.get(scope + '/management-indicators')).status()).toBe(404);
      const revoked = await admin.put(grantPath, {
        headers,
        data: { ...grantData, expectedVersion: grant.version, isActive: false },
      });
      expect(revoked.status()).toBe(200);
      expect((await operator.request.get(globalPath)).status()).toBe(403);
      expect((await operator.request.delete(sessionPath, { headers })).status()).toBe(204);
      expect((await operator.request.get(sessionPath)).status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  const tenantProfiles: {
    key: string;
    name: string;
    role: 'ADMIN' | 'READER';
    capabilities: Capability[];
    route: string;
    heading: string;
    allowed: string;
    denied: string;
  }[] = [
    {
      key: 'cliente',
      name: 'Administração cliente ID37',
      role: 'ADMIN',
      capabilities: [],
      route: 'acessos',
      heading: 'Acessos',
      allowed: '/access-memberships',
      denied: globalPath,
    },
    {
      key: 'sst',
      name: 'Camila SST ID37',
      role: 'READER',
      capabilities: ['TECHNICAL_DECISIONS'],
      route: 'coletas',
      heading: 'Coletas',
      allowed: '/assessment-cycles',
      denied: tenant + '/access-memberships',
    },
    {
      key: 'gestor',
      name: 'João gestão ID37',
      role: 'READER',
      capabilities: [],
      route: 'painel',
      heading: 'Painel',
      allowed: '/management-indicators',
      denied: tenant + '/access-memberships',
    },
    {
      key: 'rh',
      name: 'Rafael RH ID37',
      role: 'READER',
      capabilities: ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'],
      route: 'pessoas',
      heading: 'Gestão de Pessoas',
      allowed: '/people-overview',
      denied: `${tenant}/employees/${employeeId}/remunerations`,
    },
    {
      key: 'auditoria',
      name: 'Helena auditoria ID37',
      role: 'READER',
      capabilities: [],
      route: 'inventario',
      heading: 'Inventário',
      allowed: `/risks/${riskId}/history`,
      denied: tenant + '/audit-events',
    },
  ];
  for (const profile of tenantProfiles) {
    await test.step(profile.name, async () => {
      const context = await browser.newContext({ baseURL });
      try {
        const actor = await context.newPage();
        const account = await activate(
          actor,
          profile.key,
          profile.name,
          profile.role,
          profile.capabilities,
        );
        await login(actor, account.email, account.password);
        await expect(actor).toHaveURL(/#\/empresas$/);
        await actor.goto('/#/' + profile.route);
        await expect(
          actor.getByRole('heading', { name: profile.heading, level: 1, exact: true }),
        ).toBeVisible();
        const permissions = await actor.request.get('/api/v1/auth/session-capabilities');
        expect(sessionCapabilitiesSchema.parse(await permissions.json())).toEqual({
          organizationId: orgId,
          capabilities: profile.capabilities,
          canManageAccess: profile.role === 'ADMIN',
        });
        expect((await actor.request.get(tenant + profile.allowed)).status()).toBe(200);
        expect((await actor.request.get(profile.denied)).status()).toBe(403);
        expect((await actor.request.get(otherTenant + '/management-indicators')).status()).toBe(
          404,
        );
        if (profile.key === 'sst' || profile.key === 'gestor') {
          const decision = await actor.request.post(tenant + '/evaluation-methods', {
            headers,
            data: { name: 'Método fictício ID37' },
          });
          expect(decision.status()).toBe(profile.key === 'sst' ? 201 : 403);
        }
        await revokeMember(account.userId);
        expect((await actor.request.get(tenant + profile.allowed)).status()).toBe(404);
        expect((await actor.request.delete(sessionPath, { headers })).status()).toBe(204);
        expect((await actor.request.get(sessionPath)).status()).toBe(401);
      } finally {
        await context.close();
      }
    });
  }

  await test.step('Ana responde por código individual em uma sessão pública', async () => {
    const cycle = await openCollectiveSurvey(admin, tenant, groupId, origin);
    const path = tenant + '/assessment-cycles/' + cycle.id;
    const issued = await admin.post(path + '/invites', { headers, data: { count: 2 } });
    expect(issued.status()).toBe(201);
    const { invites, participationPath } = assessmentInvitesSchema.parse(await issued.json());
    const used = invites[0]!;
    const remaining = invites[1]!;
    expect(used.code === remaining.code).toBe(false);
    expect(used.expiresAt).toBe(cycle.endsAt);
    expect(remaining.expiresAt).toBe(cycle.endsAt);
    const context = await browser.newContext({ baseURL });
    try {
      const ana = await context.newPage();
      await ana.goto(participationPath);
      await ana.getByLabel('Código do convite', { exact: true }).fill(used.code);
      await ana.getByRole('button', { name: 'Acessar coleta', exact: true }).click();
      await ana.getByRole('radio', { name: 'Alternativa fictícia A', exact: true }).check();
      await ana.getByRole('button', { name: 'Revisar respostas', exact: true }).click();
      await ana.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
      await expect(
        ana.getByRole('heading', { name: 'Participação concluída', exact: true }),
      ).toBeVisible();
      expect((await ana.request.get(sessionPath)).status()).toBe(401);
      expect((await ana.request.get(path + '/results')).status()).toBe(401);
      const access = (inviteCode: string) =>
        ana.request.post('/api/v1/assessment-participation/access', {
          headers,
          data: { inviteCode },
        });
      expect((await access(used.code)).status()).toBe(409);
      const current = assessmentCycleSchema.parse(await (await admin.get(path)).json());
      expect(
        (
          await admin.post(path + '/close', {
            headers,
            data: { expectedRevision: current.revision },
          })
        ).status(),
      ).toBe(201);
      expect((await access(remaining.code)).status()).toBe(409);
      const results = assessmentResultsSchema.parse(
        await (await admin.get(path + '/results')).json(),
      );
      expect(results.node.availability).toBe('SUPPRESSED');
    } finally {
      await context.close();
    }
  });

  const preservedSession = await page.request.get(sessionPath);
  expect(preservedSession.status()).toBe(200);
  const preserved = await preservedSession.json();
  expect(preserved.user).toEqual(original.user);
  expect(preserved.memberships).toEqual(original.memberships);
  expect(preserved.activeOrganizationId).toBe(original.activeOrganizationId);
  expect(
    platformCapabilitiesSchema.parse(await (await admin.get(globalPermissionsPath)).json()),
  ).toEqual(globalPermissions);
  expect((await admin.get(globalPath)).status()).toBe(200);
  expect((await admin.get(grantPath)).status()).toBe(200);
});
