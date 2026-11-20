import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Preventive action access (Camila SST vs READER vs ADMIN vs scopeRestricted)', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const foreignOrg = '11111111-1111-4111-8111-111111111119';
  const unitId = '22222222-2222-4222-8222-222222222221';
  const sectorId = '33333333-3333-4333-8333-333333333331';
  const groupId = '44444444-4444-4444-8444-444444444441';
  const registeredRiskId = '55555555-5555-4555-8555-555555555551';
  const draftRiskId = '55555555-5555-4555-8555-555555555552';
  const archivedRiskId = '55555555-5555-4555-8555-555555555553';
  const existingActionId = '66666666-6666-4666-8666-666666666661';

  const users = {
    camila: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      name: 'Camila SST',
      token: 'c'.repeat(43),
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'],
      scopeRestricted: false,
      organizationId: org,
    },
    pureReader: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      name: 'Leitor Puro',
      token: 'r'.repeat(43),
      role: 'READER' as const,
      capabilities: [] as string[],
      scopeRestricted: false,
      organizationId: org,
    },
    executor: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      name: 'Executor',
      token: 'e'.repeat(43),
      role: 'READER' as const,
      capabilities: ['EXECUTE_ASSIGNED_ACTIONS'],
      scopeRestricted: false,
      organizationId: org,
    },
    restrictedTechnical: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      name: 'SST Restrita',
      token: 's'.repeat(43),
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'],
      scopeRestricted: true,
      organizationId: org,
    },
    foreignCamila: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      name: 'Camila Outra Empresa',
      token: 'f'.repeat(43),
      role: 'READER' as const,
      capabilities: ['TECHNICAL_DECISIONS'],
      scopeRestricted: false,
      organizationId: foreignOrg,
    },
    admin: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
      name: 'Admin',
      token: 'a'.repeat(43),
      role: 'ADMIN' as const,
      capabilities: [] as string[],
      scopeRestricted: false,
      organizationId: org,
    },
  };

  const tokenHashes = new Map(
    Object.values(users).map((entry) => [
      createHash('sha256').update(entry.token).digest('hex'),
      entry,
    ]),
  );

  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });

  const now = new Date('2026-10-20T12:00:00.000Z');
  const orgRecord = { id: org, name: 'Empresa SST', isActive: true, timezone: 'America/Sao_Paulo' };
  const unitRecord = { id: unitId, organizationId: org, name: 'Unidade Centro', isActive: true };
  const sectorRecord = {
    id: sectorId,
    organizationId: org,
    unitId,
    name: 'Setor Operacional',
    isActive: true,
    unit: unitRecord,
    organization: orgRecord,
  };
  const makeRisk = (id: string, status: 'REGISTERED' | 'DRAFT' | 'ARCHIVED') => ({
    id,
    organizationId: org,
    assessmentGroupId: groupId,
    status,
    version: 1,
    factor: 'Sobrecarga cognitiva',
    description: 'Descrição do risco coletivo',
    exposureDescription: 'Exposição contínua',
    exposedGroupDescription: 'Equipe de atendimento',
    possibleHarms: 'Fadiga',
    existingControls: 'Pausas regulares',
    sourceKind: 'TECHNICAL_RECORD',
    sourceNote: 'Registro técnico de apoio',
    diagnosticCycleId: null,
    createdById: users.admin.id,
    updatedById: users.admin.id,
    createdBy: { id: users.admin.id, name: users.admin.name },
    updatedBy: { id: users.admin.id, name: users.admin.name },
    createdAt: now,
    updatedAt: now,
    assessmentGroup: { id: groupId, isActive: true, sector: sectorRecord },
    evaluations: [],
  });

  const risksById = new Map([
    [registeredRiskId, makeRisk(registeredRiskId, 'REGISTERED')],
    [draftRiskId, makeRisk(draftRiskId, 'DRAFT')],
    [archivedRiskId, makeRisk(archivedRiskId, 'ARCHIVED')],
  ]);

  const memberships = Object.values(users).map((u) => ({
    userId: u.id,
    organizationId: u.organizationId,
    role: u.role,
    isActive: true,
    capabilities: u.capabilities,
    hrCapabilities: [],
    scopeRestricted: u.scopeRestricted,
    scopes: u.scopeRestricted ? [{ unitId, sectorId: null }] : [],
    user: { id: u.id, name: u.name },
    organization: {
      id: u.organizationId,
      name: u.organizationId === org ? 'Empresa SST' : 'Outra Empresa',
      isActive: true,
      commercialContractAccess: null,
    },
  }));

  const findMember = (userId: string, organizationId: string) =>
    memberships.find((m) => m.userId === userId && m.organizationId === organizationId) ?? null;

  let actionSeq = 1;
  const createdActionRecord = (data: Record<string, unknown>) => {
    const risk = risksById.get(String(data.riskId))!;
    const id = `77777777-7777-4777-8777-${String(actionSeq++).padStart(12, '0')}`;
    return {
      id,
      organizationId: String(data.organizationId),
      riskId: String(data.riskId),
      title: String(data.title),
      description: String(data.description),
      responsibleName: String(data.responsibleName),
      dueDate: data.dueDate as Date,
      expectedResult: String(data.expectedResult),
      verificationCriterion: String(data.verificationCriterion),
      status: 'PLANNED' as const,
      implementationNote: null,
      implementedAt: null,
      version: 1,
      sourceRiskVersion: Number(data.sourceRiskVersion),
      evaluationId: (data.evaluationId as string | null | undefined) ?? null,
      contextSnapshot: data.contextSnapshot,
      assignedUserId: (data.assignedUserId as string | null | undefined) ?? null,
      assignedName: (data.assignedName as string | null | undefined) ?? null,
      createdById: String(data.createdById),
      updatedById: String(data.updatedById),
      createdBy: { id: String(data.createdById), name: 'Camila SST' },
      updatedBy: { id: String(data.updatedById), name: 'Camila SST' },
      createdAt: now,
      updatedAt: now,
      risk,
      organization: orgRecord,
    };
  };

  const existingAction = {
    ...createdActionRecord({
      organizationId: org,
      riskId: registeredRiskId,
      title: 'Ação existente',
      description: 'Descrição suficiente da ação existente',
      responsibleName: 'Pessoa responsável',
      dueDate: new Date('2026-10-30T00:00:00Z'),
      expectedResult: 'Resultado esperado suficiente',
      verificationCriterion: 'Critério de aferição suficiente',
      sourceRiskVersion: 1,
      contextSnapshot: {},
      createdById: users.admin.id,
      updatedById: users.admin.id,
    }),
    id: existingActionId,
  };

  const fakeClient = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const actor = tokenHashes.get(where.tokenHash);
        if (!actor) return null;
        return {
          id: `session-${actor.id}`,
          userId: actor.id,
          activeOrganizationId: actor.organizationId,
          expiresAt: new Date(Date.now() + 60000),
          user: {
            id: actor.id,
            name: actor.name,
            email: `${actor.id}@example.test`,
            companyGroupGrants: [],
            memberships: memberships.filter((m) => m.userId === actor.id),
          },
        };
      },
    },
    $transaction: async <T>(op: (tx: unknown) => Promise<T>) => op(fakeClient),
    $queryRaw: async () => [],
    commercialContractAccess: {
      findUnique: async () => null,
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === org ? orgRecord : null,
    },
    membership: {
      findUnique: async ({
        where,
      }: {
        where: { userId_organizationId: { userId: string; organizationId: string } };
      }) =>
        findMember(where.userId_organizationId.userId, where.userId_organizationId.organizationId),
      findMany: async () => memberships.filter((m) => m.organizationId === org && m.isActive),
      count: async () => memberships.filter((m) => m.organizationId === org && m.isActive).length,
    },
    risk: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        const r = risksById.get(where.id);
        return r && r.organizationId === where.organizationId ? r : null;
      },
    },
    riskEvaluation: {
      findFirst: async () => null,
    },
    action: {
      create: async ({ data }: { data: Record<string, unknown> }) => createdActionRecord(data),
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        where.id === existingActionId && where.organizationId === org ? existingAction : null,
    },
    actionRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: '88888888-8888-4888-8888-888888888881',
        organizationId: String(data.organizationId),
        actionId: String(data.actionId),
        version: Number(data.version),
        event: String(data.event),
        snapshot: data.snapshot,
        changeReason: (data.changeReason as string | null | undefined) ?? null,
        text: (data.text as string | null | undefined) ?? null,
        evidenceId: (data.evidenceId as string | null | undefined) ?? null,
        authorId: String(data.authorId),
        author: { id: String(data.authorId), name: 'Camila SST' },
        createdAt: now,
      }),
    },
    auditEvent: {
      create: async () => ({ id: '99999999-9999-4999-8999-999999999991' }),
    },
  };

  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(PrismaService)
      .useValue({ client: fakeClient })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());

  const validBody = {
    title: 'Reorganizar pausas coletivas',
    description: 'Ajustar pausas coletivas do turno com equipe.',
    responsibleName: 'Coordenação Operacional',
    dueDate: '2026-11-15',
    expectedResult: 'Redução da sobrecarga percebida',
    verificationCriterion: 'Acompanhamento mensal de escala',
    expectedRiskVersion: 1,
  };

  it('permite que Camila (READER + TECHNICAL_DECISIONS) liste responsáveis e crie ação preventiva em risco REGISTERED ativo', async () => {
    const assignees = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/action-assignees`)
      .set('Cookie', `renr_session=${users.camila.token}`)
      .expect(200);
    expect(assignees.body.items.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/risks/${registeredRiskId}/action-workspaces`)
      .set('Cookie', `renr_session=${users.camila.token}`)
      .set('Origin', env.CORS_ORIGIN)
      .send({ ...validBody, assignedUserId: users.executor.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/risks/${registeredRiskId}/actions`)
      .set('Cookie', `renr_session=${users.camila.token}`)
      .set('Origin', env.CORS_ORIGIN)
      .send(validBody)
      .expect(201);
  });

  it.each([draftRiskId, archivedRiskId])(
    'bloqueia com 409 quando Camila tenta criar ação em risco %s não elegível',
    async (riskId) => {
      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/risks/${riskId}/action-workspaces`)
        .set('Cookie', `renr_session=${users.camila.token}`)
        .set('Origin', env.CORS_ORIGIN)
        .send(validBody)
        .expect(409);

      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/risks/${riskId}/actions`)
        .set('Cookie', `renr_session=${users.camila.token}`)
        .set('Origin', env.CORS_ORIGIN)
        .send(validBody)
        .expect(409);
    },
  );

  it('continua bloqueando Camila (403) em PATCH /actions/:id e PATCH /actions/:id/assignment', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/organizations/${org}/actions/${existingActionId}`)
      .set('Cookie', `renr_session=${users.camila.token}`)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedVersion: 1,
        title: 'Alteração indevida',
        changeReason: 'Motivo de teste inválido',
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/organizations/${org}/actions/${existingActionId}/assignment`)
      .set('Cookie', `renr_session=${users.camila.token}`)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedVersion: 1,
        assignedUserId: users.executor.id,
        changeReason: 'Atribuição indevida',
      })
      .expect(403);
  });

  it.each([
    ['READER puro', users.pureReader, 403],
    ['READER + EXECUTE_ASSIGNED_ACTIONS', users.executor, 403],
    ['READER + TECHNICAL_DECISIONS com scopeRestricted', users.restrictedTechnical, 403],
    ['outra organização', users.foreignCamila, 404],
  ])(
    'nega %s em action-assignees e criação de ação preventiva (%s)',
    async (_label, actor, expectedStatus) => {
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${org}/action-assignees`)
        .set('Cookie', `renr_session=${actor.token}`)
        .expect(expectedStatus);

      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/risks/${registeredRiskId}/action-workspaces`)
        .set('Cookie', `renr_session=${actor.token}`)
        .set('Origin', env.CORS_ORIGIN)
        .send(validBody)
        .expect(expectedStatus);

      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/risks/${registeredRiskId}/actions`)
        .set('Cookie', `renr_session=${actor.token}`)
        .set('Origin', env.CORS_ORIGIN)
        .send(validBody)
        .expect(expectedStatus);
    },
  );
});
