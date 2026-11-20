import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { companyGroupOverviewSchema, validCnpj } from '@renr/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('Company group grants and aggregate privacy on PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let origin: string;

  beforeAll(async () => {
    const environment = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(environment.DATABASE_URL);
    origin = environment.CORS_ORIGIN;
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });

  afterAll(async () => app?.close());

  async function account(name: string, organizationId?: string) {
    const user = await db.client.user.create({
      data: { name, email: `${randomUUID()}@example.test`, passwordHash: 'irrelevant' },
    });
    if (organizationId) {
      await db.client.membership.create({
        data: { userId: user.id, organizationId, role: 'ADMIN' },
      });
    }
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: organizationId ?? null,
        expiresAt: new Date(Date.now() + 300_000),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    return { ...user, cookie: `renr_session=${token}` };
  }

  async function company(name: string, people: number) {
    const seed = 'A' + randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase();
    const fiscalIdentifier = Array.from(
      { length: 100 },
      (_, i) => seed + String(i).padStart(2, '0'),
    ).find(validCnpj)!;
    const organization = await db.client.organization.create({
      data: {
        name,
        fiscalIdentifier,
        fiscalCandidate: fiscalIdentifier,
        normalizedFiscalIdentifier: fiscalIdentifier,
        fiscalState: 'VALID',
        clientClassification: 'CLIENT',
      },
    });
    const organizationId = organization.id;
    const unit = await db.client.unit.create({
      data: { name: 'Unidade exemplo', organizationId, normalizedName: 'unidade' },
    });
    const sector = await db.client.sector.create({
      data: { name: 'Setor exemplo', organizationId, unitId: unit.id, normalizedName: 'setor' },
    });
    const group = await db.client.assessmentGroup.create({
      data: { organizationId, sectorId: sector.id },
    });
    await db.client.employee.createMany({
      data: Array.from({ length: people }, (_, index) => ({
        name: `Pessoa privada fictícia ${index}`,
        organizationId,
        unitId: unit.id,
        sectorId: sector.id,
      })),
    });
    return {
      id: organizationId,
      assessmentGroupId: group.id,
      unitId: unit.id,
      sectorId: sector.id,
    };
  }

  async function assessment(organizationId: string, assessmentGroupId: string, actorId: string) {
    const instrumentVersionId = await db.client.$transaction(async (tx) => {
      // Reuse the migration's legacy demo projection, with its question and options inserted in the same transaction.
      const instrument = await tx.instrumentVersion.create({
        data: { organizationId, title: 'Questionário sintético', version: 1 },
      });
      const question = await tx.diagnosticQuestion.create({
        data: {
          instrumentVersionId: instrument.id,
          label: 'Pergunta fictícia',
          type: 'SINGLE_CHOICE',
          position: 1,
        },
      });
      await tx.questionOption.createMany({
        data: ['Sim', 'Não'].map((label, index) => ({
          instrumentVersionId: instrument.id,
          questionId: question.id,
          label,
          position: index + 1,
        })),
      });
      return instrument.id;
    });
    const policy = await db.client.consolidationPolicyVersion.create({
      data: {
        organizationId,
        usageMode: 'DEMONSTRATION',
        minimumResponses: 5,
        version: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedById: actorId,
      },
    });
    return { organizationId, assessmentGroupId, instrumentVersionId, policyVersionId: policy.id };
  }

  async function closedCycle(
    context: Awaited<ReturnType<typeof assessment>>,
    daysAgo: number,
    eligibleCount: number,
    responses: number,
  ) {
    const startsAt = new Date(Date.now() - daysAgo * 86_400_000);
    const cycle = await db.client.assessmentCycle.create({
      data: {
        ...context,
        name: 'Coleta sintética',
        startsAt,
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    await db.client.assessmentCycle.update({
      where: { id: cycle.id },
      data: { status: 'OPEN', eligibleCount },
    });
    await db.client.assessmentInvite.createMany({
      data: Array.from({ length: eligibleCount }, () => ({
        organizationId: cycle.organizationId,
        cycleId: cycle.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: cycle.endsAt,
      })),
    });
    await db.client.assessmentResponse.createMany({
      data: Array.from({ length: responses }, () => ({
        organizationId: cycle.organizationId,
        cycleId: cycle.id,
        instrumentVersionId: cycle.instrumentVersionId,
      })),
    });
    await db.client.assessmentCycle.update({
      where: { id: cycle.id },
      data: { status: 'CLOSED', closedAt: new Date(startsAt.getTime() + 3_600_000) },
    });
  }

  it('limits the group to linked companies, protects complements and revokes an open session', async () => {
    const api = request(app.getHttpServer());
    const [a, b, outsider, inactive] = await Promise.all([
      company('Cliente sintético Alfa', 6),
      company('Cliente sintético Beta', 7),
      company('Terceiro CNPJ sintético', 8),
      company('Sem detalhamento fictício', 9),
    ]);
    const [admin, reader, registry, grants, global] = await Promise.all([
      account('Administrador local', a.id),
      account('Diretoria de grupo'),
      account('Administração de clientes'),
      account('Administração de concessões'),
      account('Leitura global'),
    ]);
    await db.client.platformGrant.createMany({
      data: [
        { userId: registry.id, capability: 'MANAGE_CLIENTS' },
        { userId: grants.id, capability: 'MANAGE_GRANTS' },
        { userId: global.id, capability: 'READ_OVERVIEW' },
      ],
    });
    const [assessmentA, assessmentB] = await Promise.all([
      assessment(a.id, a.assessmentGroupId, admin.id),
      assessment(b.id, b.assessmentGroupId, admin.id),
    ]);
    await closedCycle(assessmentA, 6, 40, 12);
    await closedCycle(assessmentA, 4, 40, 24);
    await closedCycle(assessmentB, 6, 20, 8);
    await closedCycle(assessmentB, 4, 20, 14);

    const risk = await db.client.risk.create({
      data: {
        organizationId: a.id,
        assessmentGroupId: a.assessmentGroupId,
        factor: 'Fator interno privado',
        status: 'REGISTERED',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await db.client.action.create({
      data: {
        organizationId: a.id,
        riskId: risk.id,
        status: 'PLANNED',
        sourceRiskVersion: 1,
        title: 'Ação interna privada',
        description: 'Descrição fictícia',
        contextSnapshot: {},
        responsibleName: 'Pessoa privada fictícia',
        dueDate: new Date(),
        expectedResult: 'Resultado',
        verificationCriterion: 'Critério',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });

    const managerPath = '/api/v1/platform/company-groups';
    const write = (method: 'post' | 'put' | 'patch', path: string, cookie: string, body: object) =>
      api[method](path).set('Cookie', cookie).set('Origin', origin).send(body);
    const get = (path: string, cookie: string) => api.get(path).set('Cookie', cookie);
    const newGroup = {
      name: 'Grupo sintético',
      organizationIds: [a.id, b.id, inactive.id],
      reason: 'Mapeamento fictício',
    };
    await write('post', managerPath, grants.cookie, newGroup).expect(403);
    await get(`${managerPath}/eligible-clients`, registry.cookie)
      .query({ search: 'Cliente sintético Alfa' })
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: a.id })]),
        );
      });
    await write('post', managerPath, registry.cookie, {
      ...newGroup,
      organizationIds: [a.id, a.id],
    }).expect(400);
    const group = (await write('post', managerPath, registry.cookie, newGroup).expect(201)).body;
    expect(group.organizations.map(({ id }: { id: string }) => id).sort()).toEqual(
      [a.id, b.id, inactive.id].sort(),
    );
    await db.client.organization.update({ where: { id: inactive.id }, data: { isActive: false } });
    const readPath = `/api/v1/company-groups/${group.id}`;
    const grantPath = `${managerPath}/${group.id}/grants`;
    const grant = {
      email: reader.email,
      reason: 'Convidar diretoria fictícia',
      version: 0,
      active: true,
    };
    await get(readPath, global.cookie).expect(404);
    await get(readPath, admin.cookie).expect(404);
    await get(readPath, registry.cookie).expect(404);
    await write('put', grantPath, registry.cookie, grant).expect(403);
    await write('put', grantPath, grants.cookie, grant)
      .expect(200)
      .expect({ email: reader.email, active: true, version: 1 });
    await write('put', grantPath, grants.cookie, grant).expect(409);
    await get('/api/v1/company-groups', reader.cookie)
      .expect(200)
      .expect({ items: [{ id: group.id, name: group.name }] });
    await get('/api/v1/auth/session', reader.cookie)
      .expect(200)
      .expect((res) => {
        expect(res.body.hasCompanyGroups).toBe(true);
        expect(res.body.activeOrganizationId).toBeNull();
      });
    await get(`/api/v1/organizations/${a.id}/employees`, reader.cookie).expect(404);
    await write('patch', `${managerPath}/${group.id}`, reader.cookie, {
      ...newGroup,
      version: 1,
    }).expect(403);
    await get(readPath, reader.cookie)
      .expect('Cache-Control', 'private, no-store')
      .expect(200)
      .expect((res) => {
        const overview = companyGroupOverviewSchema.parse(res.body);
        expect(overview.totals).toEqual({
          employees: 13,
          openRisks: 1,
          actions: { pending: 1, inProgress: 0, done: 0, cancelled: 0 },
          participation: { status: 'AVAILABLE', eligible: 60, responses: 38, ratePercent: 63.33 },
          evolution: {
            status: 'AVAILABLE',
            referencePercent: 33.33,
            currentPercent: 63.33,
            deltaPoints: 30,
          },
        });
        expect(res.text).not.toContain('privada');
        expect(res.text).not.toContain(outsider.id);
      });
    await get(readPath, reader.cookie)
      .query({ organizationId: a.id })
      .expect(200)
      .expect((res) => {
        expect(res.body.companies).toHaveLength(1);
        expect(res.body.companies[0].id).toBe(a.id);
        expect(res.body.totals.employees).toBe(6);
      });
    await get(readPath, reader.cookie).query({ organizationId: outsider.id }).expect(404);
    await closedCycle(assessmentB, 2, 20, 2);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const dueToday = new Date(`${today}T00:00:00.000Z`);
    const dueYesterday = new Date(dueToday.getTime() - 86_400_000);
    const writeAction = (dueDate: Date, status: 'PLANNED' | 'IN_PROGRESS' | 'IMPLEMENTED') =>
      db.client.action.create({
        data: {
          organizationId: a.id,
          riskId: risk.id,
          status,
          sourceRiskVersion: 1,
          title: 'Operação privada',
          description: 'Descrição',
          contextSnapshot: {},
          responsibleName: 'Pessoa privada',
          dueDate,
          expectedResult: 'Resultado',
          verificationCriterion: 'Critério',
          createdById: admin.id,
          updatedById: admin.id,
          ...(status === 'IMPLEMENTED' && {
            implementationNote: 'Finalizada',
            implementedAt: dueYesterday,
          }),
        },
      });
    const pendingRisk = await db.client.risk.create({
      data: {
        organizationId: a.id,
        assessmentGroupId: a.assessmentGroupId,
        factor: 'Fator sem avaliação',
        status: 'REGISTERED',
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await db.client.riskEvaluation.create({
      data: {
        organizationId: a.id,
        riskId: risk.id,
        sequence: 1,
        riskVersion: 1,
        contextSnapshot: {},
        methodReference: 'Método',
        methodVersion: '1',
        observation: 'Observação privada',
        rationale: 'Justificativa',
        authorId: admin.id,
      },
    });
    await Promise.all([
      db.client.organization.update({
        where: { id: b.id },
        data: { clientClassification: 'DEMONSTRATION' },
      }),
      ...[dueYesterday, dueToday].map((dueDate) => writeAction(dueDate, 'IN_PROGRESS')),
      writeAction(dueYesterday, 'IMPLEMENTED'),
      db.client.auditEvent.createMany({
        data: [
          {
            organizationId: a.id,
            action: 'assessment.cycle.created',
            createdAt: new Date(dueYesterday.getTime() - 43_200_000),
          },
          {
            organizationId: a.id,
            action: 'EMPLOYEE_BULK_UPDATE',
            createdAt: new Date(dueYesterday.getTime() + 43_200_000),
          },
          { organizationId: a.id, action: 'LOGIN_SUCCEEDED', reason: 'Motivo privado' },
          { organizationId: outsider.id, action: 'assessment.cycle.created' },
        ],
      }),
    ]);
    const now = Date.now();
    const unclosed = await db.client.assessmentCycle.create({
      data: {
        ...assessmentA,
        name: 'Coleta vigente privada',
        startsAt: new Date(now - 3000),
        endsAt: new Date(now + 60_000),
      },
    });
    await db.client.assessmentCycle.update({
      where: { id: unclosed.id },
      data: { status: 'OPEN', eligibleCount: 6 },
    });
    await db.client.assessmentCycle.create({
      data: {
        ...assessmentB,
        name: 'Rascunho privado',
        startsAt: new Date(now + 60_000),
        endsAt: new Date(now + 120_000),
      },
    });
    const usage = (await get(readPath, reader.cookie).query({ view: 'operational' }).expect(200))
      .body;
    expect(usage).toMatchObject({
      referenceDate: today,
      timeZone: 'America/Sao_Paulo',
      portfolio: { active: 2, inactive: 1, activeDemonstrations: 1, inactiveDemonstrations: 0 },
      operational: {
        collections: { inProgress: 1, completed: 5, pending: 1 },
        evaluations: { records: 1, completed: 1, pending: 1 },
        overdueActions: 1,
        lastActivity: { status: 'AVAILABLE', date: dueYesterday.toISOString().slice(0, 10) },
      },
      totals: { employees: 13, participation: { status: 'PROTECTED' } },
    });
    expect(usage.companies).toHaveLength(2);
    const first = usage.companies.find((item: { id: string }) => item.id === a.id);
    const second = usage.companies.find((item: { id: string }) => item.id === b.id);
    expect(first).toMatchObject({
      classification: 'CLIENT',
      operational: {
        collections: { inProgress: 1, completed: 2, pending: 0 },
        evaluations: { records: 1, completed: 1, pending: 1 },
        overdueActions: 1,
      },
    });
    expect(second).toMatchObject({
      classification: 'DEMONSTRATION',
      operational: {
        collections: { inProgress: 0, completed: 3, pending: 1 },
        evaluations: { records: 0, completed: 0, pending: 0 },
        overdueActions: 0,
        lastActivity: { status: 'UNAVAILABLE' },
      },
    });
    const publicBody = JSON.stringify(usage);
    for (const fragment of [
      pendingRisk.id,
      risk.id,
      inactive.id,
      outsider.id,
      'privada',
      'privado',
    ]) {
      expect(publicBody).not.toContain(fragment);
    }
    const detail = (
      await get(readPath, reader.cookie)
        .query({ view: 'operational', organizationId: b.id })
        .expect(200)
    ).body;
    expect(detail).toMatchObject({
      portfolio: { active: 1, inactive: 0, activeDemonstrations: 1 },
      operational: second.operational,
      companies: [second],
    });
    await get(readPath, reader.cookie)
      .query({ view: 'operational', organizationId: inactive.id })
      .expect(404);
    await get(readPath, reader.cookie)
      .query({ view: 'operational', organizationId: outsider.id })
      .expect(404);
    await get(readPath, reader.cookie)
      .expect(200)
      .expect((res) => {
        const { totals, companies } = companyGroupOverviewSchema.parse(res.body);
        expect(totals.participation).toEqual({ status: 'PROTECTED' });
        expect(totals.evolution).toEqual({ status: 'PROTECTED' });
        expect(companies.find((item) => item.id === a.id)?.metrics.participation.status).toBe(
          'AVAILABLE',
        );
        expect(companies.find((item) => item.id === b.id)?.metrics.participation).toEqual({
          status: 'PROTECTED',
        });
      });

    await write('patch', `${managerPath}/${group.id}`, registry.cookie, {
      ...newGroup,
      organizationIds: [a.id],
      version: 1,
    }).expect(200);
    await get(readPath, reader.cookie).query({ organizationId: b.id }).expect(404);
    await write('put', grantPath, grants.cookie, { ...grant, active: false, version: 1 }).expect(
      200,
    );
    await get(readPath, reader.cookie).expect(404);
    await get('/api/v1/company-groups', reader.cookie).expect(200).expect({ items: [] });
    await get('/api/v1/auth/session', reader.cookie)
      .expect(200)
      .expect((res) => expect(res.body.hasCompanyGroups).toBeUndefined());
    expect(await db.client.platformAuditEvent.count({ where: { resourceId: group.id } })).toBe(4);
  });

  it('enforces the tenant and sector hierarchy for membership scopes in PostgreSQL', async () => {
    const [companyA, companyB] = await Promise.all([
      company('Cliente fictício de escopo', 0),
      company('Cliente fictício externo ao escopo', 0),
    ]);
    const user = await account('Conta fictícia de escopo', companyA.id);
    const membership = { userId: user.id, organizationId: companyA.id };
    const where = { userId_organizationId: membership };
    const stored = await db.client.membership.findUniqueOrThrow({ where });
    expect(stored.scopeRestricted).toBe(false);

    await expect(
      db.client.membershipScope.create({ data: { ...membership, unitId: companyB.unitId } }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const anotherUnit = await db.client.unit.create({
      data: { organizationId: companyA.id, name: 'Outra unidade', normalizedName: 'outra' },
    });
    await expect(
      db.client.membershipScope.create({
        data: { ...membership, unitId: anotherUnit.id, sectorId: companyA.sectorId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const unitScope = { ...membership, unitId: companyA.unitId };
    await db.client.membership.update({ where, data: { scopeRestricted: true, role: 'READER' } });
    await db.client.membershipScope.create({ data: unitScope });
    await expect(db.client.membershipScope.create({ data: unitScope })).rejects.toMatchObject({
      code: 'P2002',
    });
    await db.client.membershipScope.deleteMany({ where: membership });
    await expect(db.client.membership.findUniqueOrThrow({ where })).resolves.toMatchObject({
      scopeRestricted: true,
    });
  });
});
