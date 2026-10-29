import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  evaluationMethodVersionSchema,
  riskDetailSchema,
  riskWorkspaceSchema,
  riskMatrixSchema,
  technicalRiskEvaluationSchema,
  type MethodDefinition,
  type EvaluationMethodVersion,
  type RiskDetail,
} from '@renr/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Versioned evaluation methods HTTP contract', () => {
  let env: ReturnType<typeof parseEnvironment>;
  let app: INestApplication;
  let db: PrismaService;
  let organizationId: string;
  let cookie: string;
  let adminCookie: string;
  let technicianId: string;
  let foreignOrg: string;
  let unitId: string;
  let sectorId: string;
  const path = (tail: string) => `/api/v1/organizations/${organizationId}/${tail}`;
  const post = (tail: string, body: object, session = cookie) =>
    request(app.getHttpServer())
      .post(path(tail))
      .set('Cookie', session)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const put = (tail: string, body: object) =>
    request(app.getHttpServer())
      .put(path(tail))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const get = (tail: string) => request(app.getHttpServer()).get(path(tail)).set('Cookie', cookie);
  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app, env);
    await app.init();
    db = module.get(PrismaService);
    organizationId = (
      await db.client.organization.create({ data: { name: 'Synthetic technical methods' } })
    ).id;
    const user = await db.client.user.create({
      data: {
        name: 'Synthetic technician',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused',
      },
    });
    technicianId = user.id;
    await db.client.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role: 'READER',
        capabilities: ['TECHNICAL_DECISIONS'],
      },
    });
    const token = randomBytes(32).toString('base64url');
    cookie = `renr_session=${token}`;
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: organizationId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const admin = await db.client.user.create({
      data: {
        name: 'Synthetic administrator',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused',
      },
    });
    await db.client.membership.create({
      data: { organizationId, userId: admin.id, role: 'ADMIN', capabilities: [] },
    });
    const adminToken = randomBytes(32).toString('base64url');
    adminCookie = `renr_session=${adminToken}`;
    await db.client.session.create({
      data: {
        userId: admin.id,
        activeOrganizationId: organizationId,
        tokenHash: createHash('sha256').update(adminToken).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    foreignOrg = (
      await db.client.organization.create({ data: { name: 'Synthetic isolated methods' } })
    ).id;
    unitId = (
      await db.client.unit.create({
        data: { organizationId, name: 'Synthetic unit', normalizedName: 'synthetic unit' },
      })
    ).id;
    sectorId = (
      await db.client.sector.create({
        data: {
          organizationId,
          unitId,
          name: 'Synthetic sector',
          normalizedName: 'synthetic sector',
        },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    if (db && organizationId) {
      await db.client.session.deleteMany({ where: { activeOrganizationId: organizationId } });
      await db.client.organization.update({
        where: { id: organizationId },
        data: { isActive: false },
      });
      if (foreignOrg)
        await db.client.organization.update({
          where: { id: foreignOrg },
          data: { isActive: false },
        });
    }
    if (app) await app.close();
  });
  const definition = (label = 'Explicit configured class'): MethodDefinition => ({
    probability: [1, 2].map((position) => ({
      key: `p${position}`,
      label: `P ${position}`,
      description: 'Synthetic criterion',
      position,
    })),
    severity: [1, 2, 3].map((position) => ({
      key: `s${position}`,
      label: `S ${position}`,
      description: 'Synthetic criterion',
      position,
    })),
    levels: [
      { key: 'explicit', label },
      { key: 'other', label: 'Other configured class' },
    ],
    priorities: [
      { key: 'later', label: 'Planned priority', rank: 2 },
      { key: 'first', label: 'First priority', rank: 1 },
    ],
    matrix: [1, 2].flatMap((p) =>
      [1, 2, 3].map((s) => ({
        probabilityKey: `p${p}`,
        severityKey: `s${s}`,
        levelKey: p === 2 && s === 3 ? 'explicit' : 'other',
        priorityKey: p === 2 && s === 3 ? 'first' : 'later',
      })),
    ),
  });
  async function draft() {
    return evaluationMethodVersionSchema.parse(
      (
        await post('evaluation-methods', {
          name: `Synthetic method ${randomUUID()}`,
          description: 'Local verification only; no real approval asserted.',
        }).expect(201)
      ).body,
    );
  }
  async function publish(version: EvaluationMethodVersion, content = definition()) {
    const updated = evaluationMethodVersionSchema.parse(
      (
        await put(`evaluation-method-versions/${version.id}`, {
          expectedRevision: version.revision,
          title: version.title,
          description: version.description,
          definition: content,
        }).expect(200)
      ).body,
    );
    return evaluationMethodVersionSchema.parse(
      (
        await post(`evaluation-method-versions/${version.id}/publish`, {
          expectedRevision: updated.revision,
          approvalReference: 'SYNTHETIC local test approval; not a real technical validation.',
        }).expect(201)
      ).body,
    );
  }
  async function risk(prefix = randomUUID()) {
    return riskDetailSchema.parse(
      (
        await post(
          'risks',
          {
            sectorId,
            factor: `${prefix} collective synthetic factor`,
            status: 'REGISTERED',
            description:
              'Descrição sintética com acentuação, aspas " e quebra\npara verificar o contexto.',
            exposureDescription: 'Synthetic collective exposure context',
            exposedGroupDescription: 'Synthetic collective group',
            possibleHarms: 'Hypothetical harms',
            existingControls: 'Hypothetical controls',
            sourceKind: 'TECHNICAL_RECORD',
            sourceNote: 'Synthetic contextual source; no real technical approval.',
          },
          adminCookie,
        ).expect(201)
      ).body,
    );
  }
  const evaluation = (record: RiskDetail, method: EvaluationMethodVersion) => ({
    expectedVersion: record.version,
    methodVersionId: method.id,
    probabilityKey: 'p2',
    severityKey: 's3',
    rationale: 'Synthetic technical rationale for the configured cell.',
    context: 'Synthetic organizational context recorded for local verification.',
    sources: [{ kind: 'RISK_RECORD', id: record.id }],
  });
  it('creates a version-one draft for an explicitly authorized technician', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/evaluation-methods`)
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        name: 'Synthetic configurable method',
        description: 'Local verification only; no technical approval asserted.',
      })
      .expect(201);
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.version).toBe(1);
    expect(response.body.approvalReference).toBeNull();
  });
  it('requires completeness, documented approval and current revision to publish', async () => {
    const created = await draft();
    await post(`evaluation-method-versions/${created.id}/publish`, {
      expectedRevision: 1,
      approvalReference: 'Synthetic reference',
    }).expect(400);
    const partial = definition();
    partial.matrix.pop();
    const updated = (
      await put(`evaluation-method-versions/${created.id}`, {
        expectedRevision: 1,
        title: created.title,
        description: '',
        definition: partial,
      }).expect(200)
    ).body;
    await post(`evaluation-method-versions/${created.id}/publish`, {
      expectedRevision: updated.revision,
      approvalReference: 'Synthetic reference',
    }).expect(400);
    await post(`evaluation-method-versions/${created.id}/publish`, {
      expectedRevision: updated.revision,
    }).expect(400);
    await put(`evaluation-method-versions/${created.id}`, {
      expectedRevision: 1,
      title: created.title,
      description: '',
      definition: definition(),
    }).expect(409);
    await put(`evaluation-method-versions/${created.id}`, {
      expectedRevision: updated.revision,
      title: created.title,
      description: '',
      definition: { ...definition(), formula: 'probability * severity' },
    }).expect(400);
    expect((await publish(evaluationMethodVersionSchema.parse(updated))).status).toBe('PUBLISHED');
  });
  it('denies ADMIN without capability, untrusted origin, anonymous calls and foreign resources', async () => {
    await post('evaluation-methods', { name: 'Denied administrative method' }, adminCookie).expect(
      403,
    );
    await request(app.getHttpServer())
      .post(path('evaluation-methods'))
      .set('Cookie', cookie)
      .send({ name: 'Missing origin' })
      .expect(403);
    await request(app.getHttpServer())
      .post(path('evaluation-methods'))
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example.test')
      .send({ name: 'Wrong origin' })
      .expect(403);
    await request(app.getHttpServer()).get(path('evaluation-methods')).expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignOrg}/evaluation-methods`)
      .set('Cookie', cookie)
      .expect(404);
    expect((await get('evaluation-methods?pageSize=1').expect(200)).body.items).toHaveLength(1);
    const method = await publish(await draft());
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignOrg}/evaluation-method-versions/${method.id}`)
      .set('Cookie', cookie)
      .expect(404);
  });
  it('keeps published versions immutable and forks without inheriting approval', async () => {
    const method = await publish(await draft());
    await put(`evaluation-method-versions/${method.id}`, {
      expectedRevision: method.revision,
      title: 'Changed title',
      description: '',
      definition: definition(),
    }).expect(409);
    const fork = evaluationMethodVersionSchema.parse(
      (
        await post(`evaluation-method-versions/${method.id}/fork`, {
          expectedRevision: method.revision,
        }).expect(201)
      ).body,
    );
    expect(fork).toMatchObject({
      version: 2,
      revision: 1,
      status: 'DRAFT',
      approvalReference: null,
      publishedBy: null,
    });
    await publish(fork, definition('Changed future class'));
    expect((await get(`evaluation-method-versions/${method.id}`).expect(200)).body).toEqual(method);
  });
  it('records exact results, preserves legacy DTOs and ignores administrative names and preliminary notes for validity', async () => {
    const method = await publish(await draft());
    const record = await risk();
    const stored = technicalRiskEvaluationSchema.parse(
      (
        await post(
          `risk-workspaces/${record.id}/technical-evaluations`,
          evaluation(record, method),
        ).expect(201)
      ).body,
    );
    expect(stored).toMatchObject({
      method: { versionId: method.id, version: 1 },
      level: { key: 'explicit', label: 'Explicit configured class' },
      priority: { key: 'first', rank: 1 },
      author: { id: technicianId },
    });
    const original = (await get(`risks/${record.id}`).expect(200)).body;
    expect(riskDetailSchema.safeParse(original).success).toBe(true);
    expect(original).not.toHaveProperty('latestTechnicalEvaluation');
    expect(original.latestEvaluation).toBeNull();
    await post(
      `risks/${record.id}/evaluations`,
      {
        expectedVersion: original.version,
        methodReference: 'Synthetic legacy note',
        methodVersion: 'preliminary',
        observation: 'Synthetic preliminary observation',
        rationale: 'Synthetic preliminary rationale',
      },
      adminCookie,
    ).expect(201);
    const afterNote = riskWorkspaceSchema.parse(
      (await get(`risk-workspaces/${record.id}`).expect(200)).body,
    );
    expect(afterNote.technicalEvaluationState).toBe('CURRENT');
    expect(afterNote.latestEvaluation?.label).toBe('PRELIMINARY');
    expect(afterNote.latestTechnicalEvaluation?.id).toBe(stored.id);
    await db.client.unit.update({
      where: { id: unitId },
      data: { name: 'Renamed administrative label' },
    });
    expect(
      (await get(`risk-workspaces/${record.id}`).expect(200)).body.technicalEvaluationState,
    ).toBe('CURRENT');
    await request(app.getHttpServer())
      .patch(path(`risks/${record.id}`))
      .set('Cookie', adminCookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedVersion: afterNote.version,
        description: 'Changed technical context that must invalidate the current classification.',
      })
      .expect(200);
    expect(
      (await get(`risk-workspaces/${record.id}`).expect(200)).body.technicalEvaluationState,
    ).toBe('CONTEXT_CHANGED');
    expect(
      (await get(`risk-workspaces/${record.id}/technical-evaluations`).expect(200)).body.items,
    ).toEqual([stored]);
  });
  it('aggregates all filtered pages and excludes incompatible versions without reclassification', async () => {
    const marker = randomUUID();
    const first = await publish(await draft());
    const fork = evaluationMethodVersionSchema.parse(
      (
        await post(`evaluation-method-versions/${first.id}/fork`, {
          expectedRevision: first.revision,
        }).expect(201)
      ).body,
    );
    const second = await publish(fork, definition('New method class'));
    const one = await risk(marker);
    const two = await risk(marker);
    await risk(marker);
    await post(`risk-workspaces/${one.id}/technical-evaluations`, evaluation(one, first)).expect(
      201,
    );
    await post(`risk-workspaces/${two.id}/technical-evaluations`, evaluation(two, second)).expect(
      201,
    );
    for (const selected of [first, second]) {
      const result = riskMatrixSchema.parse(
        (
          await get(
            `risk-workspaces/matrix?methodVersionId=${selected.id}&q=${marker}&page=2&pageSize=1`,
          ).expect(200)
        ).body,
      );
      expect(result).toMatchObject({
        totalMatched: 3,
        classifiedTotal: 1,
        excluded: { unclassified: 1, incompatible: 1 },
      });
      expect(result.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(1);
    }
    expect(
      (await get(`risk-workspaces/${one.id}`).expect(200)).body.latestTechnicalEvaluation.level
        .label,
    ).toBe('Explicit configured class');
  });
  it('rejects out-of-scale values, foreign sources and revoked capability without adding history', async () => {
    const method = await publish(await draft());
    const record = await risk();
    await post(`risk-workspaces/${record.id}/technical-evaluations`, {
      ...evaluation(record, method),
      probabilityKey: 'unknown',
    }).expect(400);
    await post(`risk-workspaces/${record.id}/technical-evaluations`, {
      ...evaluation(record, method),
      sources: [{ kind: 'RISK_RECORD', id: randomUUID() }],
    }).expect(404);
    await db.client.membership.update({
      where: { userId_organizationId: { userId: technicianId, organizationId } },
      data: { capabilities: [] },
    });
    try {
      await post(
        `risk-workspaces/${record.id}/technical-evaluations`,
        evaluation(record, method),
      ).expect(403);
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: technicianId, organizationId } },
        data: { capabilities: ['TECHNICAL_DECISIONS'] },
      });
    }
    expect(
      (await get(`risk-workspaces/${record.id}/technical-evaluations`).expect(200)).body.total,
    ).toBe(0);
  });
  it('serializes competing evaluations with the same expected risk version', async () => {
    const method = await publish(await draft());
    const record = await risk();
    const results = await Promise.all([
      post(`risk-workspaces/${record.id}/technical-evaluations`, evaluation(record, method)),
      post(`risk-workspaces/${record.id}/technical-evaluations`, evaluation(record, method)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      (await get(`risk-workspaces/${record.id}/technical-evaluations`).expect(200)).body.total,
    ).toBe(1);
    expect((await get(`risks/${record.id}`).expect(200)).body.version).toBe(record.version + 1);
  });
  it('serializes group deactivation and refuses an evaluation after that deactivation commits', async () => {
    const method = await publish(await draft());
    const record = await risk();
    const { Client } = createRequire(__filename)('pg') as {
      Client: new (options: { connectionString: string }) => {
        connect(): Promise<void>;
        end(): Promise<void>;
        query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      };
    };
    const blocker = new Client({ connectionString: env.DATABASE_URL });
    await blocker.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      await blocker.query('UPDATE assessment_groups SET is_active=false WHERE id=$1', [
        record.assessmentGroupId,
      ]);
      pending = post(
        `risk-workspaces/${record.id}/technical-evaluations`,
        evaluation(record, method),
      ).then((response) => response);
      let blocked = false;
      const deadline = Date.now() + 2000;
      while (!blocked && Date.now() < deadline) {
        const waiting = await blocker.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS blocked',
          [pid],
        );
        blocked = waiting.rows[0]!.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(409);
      expect(blocked).toBe(true);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (pending) await pending;
      await db.client.assessmentGroup.update({
        where: { id: record.assessmentGroupId },
        data: { isActive: true },
      });
    }
  }, 15_000);
  it('uses ID09 qualitative references without copying responses or reconstructing suppressed counts', async () => {
    const method = await publish(await draft());
    const record = await risk();
    await db.client.membership.update({
      where: { userId_organizationId: { userId: technicianId, organizationId } },
      data: { role: 'ADMIN' },
    });
    try {
      const created = (
        await post('instruments', { name: 'Synthetic REAL-mode test instrument' }).expect(201)
      ).body;
      const instrumentPath = `instruments/${created.instrument.id}/versions/${created.version.id}`;
      const updated = (
        await put(instrumentPath, {
          expectedRevision: 1,
          title: 'Synthetic instrument',
          description: 'Synthetic test only',
          instructions: 'No real responses',
          usageMode: 'REAL',
          questions: [
            {
              id: randomUUID(),
              label: 'Synthetic collective question',
              type: 'SINGLE_CHOICE',
              required: true,
              position: 1,
              options: [
                { id: randomUUID(), label: 'First synthetic option', position: 1 },
                { id: randomUUID(), label: 'Second synthetic option', position: 2 },
              ],
            },
          ],
        }).expect(200)
      ).body;
      const instrument = (
        await post(`${instrumentPath}/publish`, {
          expectedRevision: updated.revision,
          approvalReference: 'Synthetic local reference only',
        }).expect(201)
      ).body;
      const policy = (
        await post('consolidation-policies', { usageMode: 'REAL', minimumResponses: 2 }).expect(201)
      ).body;
      await post(`consolidation-policies/${policy.id}/publish`, {
        expectedRevision: policy.revision,
        approvalReference: 'Synthetic local reference only',
      }).expect(201);
      const cycle = (
        await post('assessment-cycles', {
          name: 'Synthetic qualitative source collection',
          assessmentGroupId: record.assessmentGroupId,
          instrumentVersionId: instrument.id,
          policyVersionId: policy.id,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
        }).expect(201)
      ).body;
      const source = (
        await post(`assessment-cycles/${cycle.id}/sources`, {
          kind: 'OBSERVATION',
          context: 'Synthetic collective context',
          occurredOn: '2026-01-01',
          summary: 'SYNTHETIC_PRIVATE_SUMMARY_NOT_COPIED_TO_TECHNICAL_RESULT',
        }).expect(201)
      ).body;
      const options = (
        await get(`risk-workspaces/${record.id}/source-options?pageSize=100`).expect(200)
      ).body;
      expect(options.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'ASSESSMENT_CYCLE', id: cycle.id, eligible: true }),
          expect.objectContaining({ kind: 'ASSESSMENT_SOURCE', id: source.id, eligible: true }),
        ]),
      );
      expect(JSON.stringify(options)).not.toContain('SYNTHETIC_PRIVATE_SUMMARY');
      const saved = (
        await post(`risk-workspaces/${record.id}/technical-evaluations`, {
          ...evaluation(record, method),
          sources: [
            { kind: 'ASSESSMENT_CYCLE', id: cycle.id },
            { kind: 'ASSESSMENT_SOURCE', id: source.id },
          ],
        }).expect(201)
      ).body;
      expect(saved.sources.map((item: { id: string }) => item.id)).toEqual([cycle.id, source.id]);
      expect(JSON.stringify(saved)).not.toContain('responseCount');
      expect(JSON.stringify(saved)).not.toContain('SYNTHETIC_PRIVATE_SUMMARY');
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: technicianId, organizationId } },
        data: { role: 'READER' },
      });
    }
  });
});
