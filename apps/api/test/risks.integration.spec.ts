import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import { riskDetailSchema, preliminaryEvaluationSchema, riskOverviewSchema } from '@renr/contracts';
import { RiskOverviewRepository } from '../src/modules/risks/risk-overview.repository';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('v0.3 inventory against PostgreSQL', () => {
  const environment = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(environment.DATABASE_URL);
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const token = randomUUID().replaceAll('-', '') + '12345678901';
  const cookie = `renr_session=${token}`;
  const base = `/api/v1/organizations/${orgId}`;
  let app: INestApplication;
  let database: PrismaService;
  let sectorId: string;
  let unitId: string;
  const full = {
    factor: 'Sobrecarga fictícia',
    status: 'REGISTERED',
    description: 'Descrição fictícia do contexto',
    exposureDescription: 'Exposição fictícia persistente',
    exposedGroupDescription: 'Equipe sintética',
    possibleHarms: 'Fadiga fictícia',
    existingControls: 'Pausas e rodízio',
    sourceKind: 'TECHNICAL_RECORD',
    sourceNote: 'Registro técnico inteiramente fictício',
    diagnosticCycleId: null,
  };
  const evaluation = {
    methodReference: 'Observação demonstrativa',
    methodVersion: '1',
    observation: 'Observação fictícia preliminar',
    rationale: 'Justificativa de demonstração',
  };
  const api = () => request(app.getHttpServer());
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    database = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
    await database.client.user.create({
      data: {
        id: userId,
        name: 'Autor sintético',
        email: `${userId}@renr.example`,
        passwordHash: 'unused',
      },
    });
    await database.client.organization.create({
      data: {
        id: orgId,
        name: 'Inventário sintético',
        memberships: { create: { userId, role: 'ADMIN' } },
      },
    });
    await database.client.organization.create({
      data: { id: otherOrgId, name: 'Empresa externa' },
    });
    const unit = await database.client.unit.create({
      data: { organizationId: orgId, name: 'Unidade', normalizedName: 'unidade' },
    });
    unitId = unit.id;
    const sector = await database.client.sector.create({
      data: { organizationId: orgId, unitId, name: 'Setor', normalizedName: 'setor' },
    });
    sectorId = sector.id;
    await database.client.assessmentGroup.create({ data: { organizationId: orgId, sectorId } });
    await database.client.session.create({
      data: {
        userId,
        activeOrganizationId: orgId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
  });
  afterAll(async () => {
    // History is immutable; keep the synthetic rows in this disposable local test database.
    await database.client.session.deleteMany({ where: { userId } });
    await app.close();
  });
  it('creates pending drafts and complete registrations, then retrieves their scope and authors', async () => {
    const draft = await api()
      .post(`${base}/risks`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ sectorId, factor: 'Rascunho sintético', description: ' ' })
      .expect(201);
    expect(draft.body).toMatchObject({
      status: 'DRAFT',
      description: null,
      version: 1,
      createdBy: { id: userId },
      unit: { id: unitId },
    });
    const registered = await api()
      .post(`${base}/risks`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ ...full, sectorId })
      .expect(201);
    const registeredId = riskDetailSchema.parse(registered.body).id;
    expect(registered.body.latestEvaluation).toBeNull();
    await api().get(`${base}/risks/${registeredId}`).set('Cookie', cookie).expect(200);
    // Continue this single persisted journey; each independent case below creates its own records.
    const first = await api()
      .post(`${base}/risks/${registeredId}/evaluations`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ ...evaluation, expectedVersion: 1 })
      .expect(201);
    expect(preliminaryEvaluationSchema.parse(first.body)).toMatchObject({
      sequence: 1,
      riskVersion: 1,
      label: 'PRELIMINARY',
      contextSnapshot: { factor: full.factor },
    });
    const updates = await Promise.all(
      ['Alteração A', 'Alteração B'].map((factor) =>
        api()
          .patch(`${base}/risks/${registeredId}`)
          .set('Cookie', cookie)
          .set('Origin', environment.CORS_ORIGIN)
          .send({ factor, expectedVersion: 2 }),
      ),
    );
    expect(updates.map((item) => item.status).sort()).toEqual([200, 409]);
    const second = await api()
      .post(`${base}/risks/${registeredId}/evaluations`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ ...evaluation, expectedVersion: 3 })
      .expect(201);
    expect(second.body).toMatchObject({ sequence: 2, riskVersion: 3 });
    const history = await api()
      .get(`${base}/risks/${registeredId}/evaluations`)
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body.total).toBe(2);
    expect(history.body.items[1].contextSnapshot.factor).toBe(full.factor);
    await expect(
      database.client.riskEvaluation.update({
        where: { id: first.body.id },
        data: { observation: 'Tentativa de sobrescrever' },
      }),
    ).rejects.toThrow();
    await expect(
      database.client.riskEvaluation.delete({ where: { id: first.body.id } }),
    ).rejects.toThrow();
    const duplicate = {
      ...evaluation,
      organizationId: orgId,
      riskId: registeredId,
      authorId: userId,
      sequence: 1,
      riskVersion: 1,
      contextSnapshot: first.body.contextSnapshot,
    };
    await expect(database.client.riskEvaluation.create({ data: duplicate })).rejects.toThrow();
    await expect(
      database.client.riskEvaluation.create({
        data: { ...duplicate, sequence: 10, organizationId: otherOrgId },
      }),
    ).rejects.toThrow();
    const overview = await api().get(`${base}/risk-overview`).set('Cookie', cookie).expect(200);
    expect(riskOverviewSchema.parse(overview.body).totals).toEqual({
      total: 2,
      draft: 1,
      registered: 1,
      withEvaluation: 1,
      withoutEvaluation: 1,
    });
    const without = await api()
      .get(`${base}/risks?evaluationPresence=WITHOUT`)
      .set('Cookie', cookie)
      .expect(200);
    expect(without.body.total).toBe(1);
    expect(without.body.items[0].status).toBe('DRAFT');
    await api()
      .patch(`${base}/risks/${registeredId}`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ expectedVersion: 4, status: 'ARCHIVED' })
      .expect(200);
    const list = await api().get(`${base}/risks`).set('Cookie', cookie).expect(200);
    expect(list.body.total).toBe(1);
    const archived = await api()
      .get(`${base}/risks?status=ARCHIVED&evaluationPresence=WITH`)
      .set('Cookie', cookie)
      .expect(200);
    expect(archived.body.total).toBe(1);
    await api()
      .post(`${base}/risks/${registeredId}/evaluations`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ ...evaluation, expectedVersion: 5 })
      .expect(409);
    await api().get(`${base}/risks/${randomUUID()}`).set('Cookie', cookie).expect(404);
    const old = await api().get(`${base}/overview`).set('Cookie', cookie).expect(200);
    expect(old.body).not.toHaveProperty('totals');
    expect(overview.headers['cache-control']).toBe('private, no-store');
    expect(
      await database.client.auditEvent.count({
        where: { organizationId: orgId, action: 'RISK_UPDATE' },
      }),
    ).toBe(1);
  });
  it('validates origin availability and exact AssessmentGroup, rejects inactive and incoherent scope', async () => {
    const instrument = await database.client.instrumentVersion.create({
      data: {
        organizationId: orgId,
        title: 'Instrumento sintético',
        version: 1,
        questions: {
          create: [
            {
              label: 'Synthetic question',
              type: 'SINGLE_CHOICE',
              position: 1,
              options: {
                create: [
                  { label: 'First', position: 1 },
                  { label: 'Second', position: 2 },
                ],
              },
            },
          ],
        },
      },
    });
    const group = await database.client.assessmentGroup.findUniqueOrThrow({
      where: { organizationId_sectorId: { organizationId: orgId, sectorId } },
    });
    const cycle = await database.client.diagnosticCycle.create({
      data: {
        organizationId: orgId,
        instrumentVersionId: instrument.id,
        name: 'Ciclo sintético',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60000),
        status: 'CLOSED',
        groups: { create: { assessmentGroupId: group.id } },
      },
    });
    const postCycleRisk = (scopeSectorId = sectorId) =>
      api()
        .post(`${base}/risks`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({
          ...full,
          sectorId: scopeSectorId,
          sourceKind: 'DIAGNOSTIC_CYCLE',
          diagnosticCycleId: cycle.id,
        });
    await postCycleRisk().expect(403);
    await database.client.diagnosticResponse.createMany({
      data: Array.from({ length: 5 }, () => ({
        organizationId: orgId,
        cycleId: cycle.id,
        instrumentVersionId: instrument.id,
        submittedPeriod: new Date('2026-10-17'),
      })),
    });
    const valid = await postCycleRisk().expect(201);
    expect(valid.body.diagnosticCycleId).toBe(cycle.id);
    const second = await database.client.sector.create({
      data: { organizationId: orgId, unitId, name: 'Outro setor', normalizedName: 'outro setor' },
    });
    await postCycleRisk(second.id).expect(403);
    await database.client.diagnosticCycle.update({
      where: { id: cycle.id },
      data: { status: 'OPEN' },
    });
    await postCycleRisk().expect(403);
    await api()
      .patch(`${base}/risks/${valid.body.id}`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ expectedVersion: 1, sourceKind: 'TECHNICAL_RECORD', diagnosticCycleId: null })
      .expect(400);
    const anotherUnit = await database.client.unit.create({
      data: { organizationId: orgId, name: 'Outra unidade', normalizedName: 'outra unidade' },
    });
    await api()
      .get(`${base}/risks?unitId=${anotherUnit.id}&sectorId=${sectorId}`)
      .set('Cookie', cookie)
      .expect(400);
    await database.client.sector.update({ where: { id: second.id }, data: { isActive: false } });
    await api()
      .post(`${base}/risks`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ sectorId: second.id, factor: 'Fator fictício' })
      .expect(409);
  });
  it('allows only one preliminary evaluation for two submissions with the same version', async () => {
    const created = await api()
      .post(`${base}/risks`)
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ ...full, sectorId })
      .expect(201);
    const results = await Promise.all(
      [1, 2].map(() =>
        api()
          .post(`${base}/risks/${created.body.id}/evaluations`)
          .set('Cookie', cookie)
          .set('Origin', environment.CORS_ORIGIN)
          .send({ ...evaluation, expectedVersion: 1 }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await database.client.riskEvaluation.count({ where: { riskId: created.body.id } })).toBe(
      1,
    );
    const current = await database.client.risk.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(current.version).toBe(2);
  });
  it('uses top eight units plus OTHERS, includes inactive units and returns a zero snapshot', async () => {
    const chartOrgId = randomUUID();
    await database.client.organization.create({
      data: {
        id: chartOrgId,
        name: 'Gráficos fictícios',
        memberships: { create: { userId, role: 'ADMIN' } },
      },
    });
    await database.client.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: chartOrgId },
    });
    const base = `/api/v1/organizations/${chartOrgId}`;
    const before = await api().get(`${base}/risk-overview`).set('Cookie', cookie).expect(200);
    for (let index = 0; index < 10; index += 1) {
      const unit = await database.client.unit.create({
        data: {
          organizationId: chartOrgId,
          name: `Unidade ${index}`,
          normalizedName: `unidade ${index}`,
        },
      });
      const sector = await database.client.sector.create({
        data: {
          organizationId: chartOrgId,
          unitId: unit.id,
          name: 'Setor',
          normalizedName: 'setor',
        },
      });
      await api()
        .post(`${base}/risks`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ sectorId: sector.id, factor: 'Fator fictício' })
        .expect(201);
      if (index === 0)
        await database.client.unit.update({ where: { id: unit.id }, data: { isActive: false } });
    }
    const response = await api().get(`${base}/risk-overview`).set('Cookie', cookie).expect(200);
    const overview = riskOverviewSchema.parse(response.body);
    expect(overview.totals.total).toBe(before.body.totals.total + 10);
    expect(overview.units).toHaveLength(9);
    expect(overview.units.filter((unit) => unit.kind === 'UNIT')).toHaveLength(8);
    expect(overview.units.at(-1)).toMatchObject({ kind: 'OTHERS', total: 2 });
    expect(overview.units.some((unit) => unit.kind === 'UNIT' && unit.isActive === false)).toBe(
      true,
    );
    await database.client.membership.create({
      data: { userId, organizationId: otherOrgId, role: 'ADMIN' },
    });
    await database.client.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: otherOrgId },
    });
    const empty = await api()
      .get(`/api/v1/organizations/${otherOrgId}/risk-overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(empty.body.totals).toEqual({
      total: 0,
      draft: 0,
      registered: 0,
      withEvaluation: 0,
      withoutEvaluation: 0,
    });
    expect(empty.body.units).toEqual([]);
  });
  it('aggregates a synthetic volume in PostgreSQL and records an actual EXPLAIN', async () => {
    const volumeOrg = randomUUID();
    await database.client.organization.create({
      data: { id: volumeOrg, name: 'Volume sintético descartável' },
    });
    const unit = await database.client.unit.create({
      data: {
        organizationId: volumeOrg,
        name: 'Volume',
        normalizedName: 'volume',
        isActive: false,
      },
    });
    const sector = await database.client.sector.create({
      data: {
        organizationId: volumeOrg,
        unitId: unit.id,
        name: 'Volume',
        normalizedName: 'volume',
      },
    });
    const group = await database.client.assessmentGroup.create({
      data: { organizationId: volumeOrg, sectorId: sector.id },
    });
    try {
      await database.client.risk.createMany({
        data: Array.from({ length: 2000 }, () => ({
          organizationId: volumeOrg,
          assessmentGroupId: group.id,
          factor: 'Fator sintético',
          createdById: userId,
          updatedById: userId,
        })),
      });
      const snapshot = await app.get(RiskOverviewRepository).snapshot(volumeOrg);
      expect(snapshot?.totals).toEqual({
        total: 2000,
        draft: 2000,
        registered: 0,
        withEvaluation: 0,
        withoutEvaluation: 2000,
      });
      const plan = await database.client.$queryRaw<
        Array<{ 'QUERY PLAN': Array<{ 'Execution Time': number; Plan: { 'Node Type': string } }> }>
      >`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT u.id::text AS "unitId", u.name, u.is_active AS "isActive", count(*) AS total,
          count(*) FILTER (WHERE r.status = 'DRAFT') AS draft,
          count(*) FILTER (WHERE r.status = 'REGISTERED') AS registered,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM risk_evaluations e WHERE e.organization_id = r.organization_id AND e.risk_id = r.id)) AS "withEvaluation"
        FROM risks r JOIN assessment_groups g ON g.organization_id = r.organization_id AND g.id = r.assessment_group_id
        JOIN sectors s ON s.organization_id = g.organization_id AND s.id = g.sector_id
        JOIN units u ON u.organization_id = s.organization_id AND u.id = s.unit_id
        WHERE r.organization_id = ${volumeOrg}::uuid AND r.status IN ('DRAFT', 'REGISTERED')
        GROUP BY u.id, u.name, u.is_active ORDER BY total DESC, u.name ASC, u.id ASC`;
      const result = plan[0]?.['QUERY PLAN'][0];
      if (!result) throw new Error('Expected PostgreSQL execution plan');
      expect(result['Execution Time']).toBeGreaterThanOrEqual(0);
      console.info(
        'Synthetic risk overview EXPLAIN:',
        JSON.stringify({
          rows: 2000,
          executionMs: result['Execution Time'],
          node: result.Plan['Node Type'],
        }),
      );
    } finally {
      await database.client.risk.deleteMany({ where: { organizationId: volumeOrg } });
      await database.client.assessmentGroup.delete({ where: { id: group.id } });
      await database.client.sector.delete({ where: { id: sector.id } });
      await database.client.unit.delete({ where: { id: unit.id } });
      await database.client.organization.delete({ where: { id: volumeOrg } });
    }
  });
});
