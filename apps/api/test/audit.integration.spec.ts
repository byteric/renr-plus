import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { auditEventListSchema, auditRecordSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditRepository } from '../src/modules/audit/audit.repository';
import { ActionsService } from '../src/modules/actions/actions.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
jest.setTimeout(60_000);
describeDatabase('ID21 audit and operational history in PostgreSQL', () => {
  const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
  localDatabaseUrl(env.DATABASE_URL);
  const org = randomUUID(),
    otherOrg = randomUUID(),
    admin = randomUUID(),
    reader = randomUUID();
  let db: PrismaService,
    app: INestApplication,
    audit: AuditService,
    repository: AuditRepository,
    actions: ActionsService;
  let risk: { id: string; version: number }, action: { id: string; version: number };
  const cookies = new Map<string, string>();
  const base = `/api/v1/organizations/${org}`;
  const get = (path: string, actor = admin) =>
    request(app.getHttpServer())
      .get(base + path)
      .set('Cookie', cookies.get(actor)!);
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(base + path)
      .set('Cookie', cookies.get(admin)!)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    audit = module.get(AuditService);
    repository = module.get(AuditRepository);
    actions = module.get(ActionsService);
    app = module.createNestApplication({ logger: false });
    configureApplication(app, env);
    await app.init();
    await db.client.organization.createMany({
      data: [
        { id: org, name: 'Synthetic ID21', timezone: 'America/New_York' },
        { id: otherOrg, name: 'Foreign synthetic ID21' },
      ],
    });
    for (const [id, role] of [
      [admin, 'ADMIN'],
      [reader, 'READER'],
    ] as const) {
      await db.client.user.create({
        data: {
          id,
          name: `Synthetic ${role}`,
          email: `${id}@example.test`,
          passwordHash: 'NEVER-EXPOSE-PASSWORD-HASH',
        },
      });
      await db.client.membership.create({ data: { userId: id, organizationId: org, role } });
      const token = randomBytes(32).toString('base64url');
      cookies.set(id, `renr_session=${token}`);
      await db.client.session.create({
        data: {
          userId: id,
          activeOrganizationId: org,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    }
    const unit = await db.client.unit.create({
      data: { organizationId: org, name: 'Synthetic unit', normalizedName: 'synthetic' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic',
      },
    });
    await db.client.assessmentGroup.create({ data: { organizationId: org, sectorId: sector.id } });
    risk = (
      await post('/risks', {
        sectorId: sector.id,
        factor: 'Synthetic ID21 collective risk',
        status: 'REGISTERED',
        description: 'Synthetic context',
        exposureDescription: 'Synthetic exposure',
        exposedGroupDescription: 'Synthetic team',
        possibleHarms: 'Synthetic harms',
        existingControls: 'Synthetic controls',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Synthetic technical record',
      }).expect(201)
    ).body;
    action = (
      await post(`/risks/${risk.id}/actions`, {
        expectedRiskVersion: risk.version,
        title: 'Synthetic ID21 action',
        description: 'Synthetic preventive measure',
        responsibleName: 'Synthetic team',
        dueDate: '2026-12-20',
        expectedResult: 'Synthetic result',
        verificationCriterion: 'Synthetic collective criterion',
      }).expect(201)
    ).body;
    await post(`/actions/${action.id}/notes`, {
      expectedVersion: action.version,
      text: 'First exact immutable note',
    }).expect(201);
    action = (await get(`/actions/${action.id}`).expect(200)).body;
    await post(`/actions/${action.id}/notes`, {
      expectedVersion: action.version,
      text: 'Second exact immutable note',
    }).expect(201);
  });
  afterAll(async () => {
    if (db) await db.client.session.deleteMany({ where: { userId: { in: [admin, reader] } } });
    if (app) await app.close();
  });
  it('returns a bounded feed, readable actors, exact new revision targets and no secrets', async () => {
    const page = auditEventListSchema.parse(
      (await get('/audit-events?pageSize=2').expect(200)).body,
    );
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(4);
    expect(page.timeZone).toBe('America/New_York');
    expect(page.items[0]).toMatchObject({
      actor: { id: admin, name: 'Synthetic ADMIN' },
      target: { kind: 'action-revision', parentId: action.id },
    });
    expect(page.items[0]!.label).toBe('Nota registrada');
    expect(page.items[0]!.reason).toBe('Second exact immutable note');
    expect(JSON.stringify(page)).not.toMatch(
      /passwordHash|tokenHash|NEVER-EXPOSE|contextSnapshot|fingerprint|proofPackage/,
    );
    const ids = page.items.map((item) => item.id);
    const second = auditEventListSchema.parse(
      (await get('/audit-events?pageSize=2&page=2').expect(200)).body,
    );
    expect(second.items.every((item) => !ids.includes(item.id))).toBe(true);
  });
  it('filters exact operation, resource, actor and resource type', async () => {
    const response = auditEventListSchema.parse(
      (
        await get(
          `/audit-events?resourceType=action&resourceId=${action.id}&actorId=${admin}&operation=ACTION_NOTE`,
        ).expect(200)
      ).body,
    );
    expect(response.items).toHaveLength(2);
    expect(response.items.every((item) => item.operation === 'ACTION_NOTE')).toBe(true);
    expect((await get(`/audit-events?actorId=${reader}`).expect(200)).body.total).toBe(0);
  });
  it('allows readers operational history and opens an exact revision outside the first page', async () => {
    await get('/audit-events', reader).expect(403);
    const page = auditEventListSchema.parse(
      (await get(`/actions/${action.id}/history?pageSize=1&page=2`, reader).expect(200)).body,
    );
    expect(page.items).toHaveLength(1);
    const target = page.items[0]!.target!;
    const record = auditRecordSchema.parse(
      (await get(`/history-records/${target.kind}/${target.id}`, reader).expect(200)).body,
    );
    expect(record.details).toContainEqual({ label: 'Texto', value: 'First exact immutable note' });
    expect(record.event.reason).toBe('First exact immutable note');
    expect(record.details).toContainEqual({
      label: 'Título preservado',
      value: 'Synthetic ID21 action',
    });
    const history = auditEventListSchema.parse(
      (await get(`/risks/${risk.id}/history`, reader).expect(200)).body,
    );
    expect(history.items.some((item) => item.target?.kind === 'action-revision')).toBe(true);
    expect(history.items.every((item) => item.resource.type !== 'access')).toBe(true);
  });
  it('links a real instrument publication to its exact version without exposing questions or secrets', async () => {
    const catalog = (
      await post('/instruments', { name: 'Synthetic audit publication' }).expect(201)
    ).body;
    const path = `/instruments/${catalog.instrument.id}/versions/${catalog.version.id}`;
    const saved = (
      await request(app.getHttpServer())
        .put(base + path)
        .set('Cookie', cookies.get(admin)!)
        .set('Origin', env.CORS_ORIGIN)
        .send({
          expectedRevision: 1,
          title: 'Synthetic published instrument',
          description: '',
          instructions: '',
          usageMode: 'DEMONSTRATION',
          questions: [
            {
              id: randomUUID(),
              label: 'Synthetic collective question',
              type: 'ORDINAL_CHOICE',
              required: false,
              position: 1,
              options: [
                { id: randomUUID(), label: 'First synthetic choice', position: 1 },
                { id: randomUUID(), label: 'Second synthetic choice', position: 2 },
              ],
            },
          ],
        })
        .expect(200)
    ).body;
    await post(path + '/publish', { expectedRevision: saved.revision }).expect(201);
    const feed = auditEventListSchema.parse(
      (
        await get(
          `/audit-events?operation=INSTRUMENT_PUBLISH&resourceId=${catalog.version.id}`,
        ).expect(200)
      ).body,
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      label: 'Instrumento publicado',
      actor: { id: admin },
      target: {
        kind: 'instrument-version',
        id: catalog.version.id,
        parentId: catalog.instrument.id,
      },
    });
    const record = auditRecordSchema.parse(
      (await get(`/history-records/instrument-version/${catalog.version.id}`, reader).expect(200))
        .body,
    );
    expect(record.event.target?.id).toBe(catalog.version.id);
    expect(JSON.stringify(record)).not.toMatch(/questions|answers|token|password/i);
  });

  it('never infers legacy action revisions from time or author', async () => {
    const row = await db.client.auditEvent.create({
      data: {
        organizationId: org,
        actorId: admin,
        resourceId: action.id,
        action: 'ACTION_UPDATED',
      },
    });
    const response = auditEventListSchema.parse(
      (await get('/audit-events?operation=ACTION_UPDATED').expect(200)).body,
    );
    expect(response.items.find((item) => item.id === `audit:${row.id}`)!.target).toBeNull();
  });
  it('uses inclusive local dates across a DST day and deterministic timestamp ties', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort();
    const dates = [
      '2026-03-08T04:59:59.999Z',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T03:59:59.999Z',
      '2026-03-09T04:00:00.000Z',
    ];
    await db.client.auditEvent.createMany({
      data: ids.map((id, index) => ({
        id,
        organizationId: org,
        actorId: admin,
        resourceId: risk.id,
        action: 'DST_BOUNDARY',
        createdAt: new Date(dates[index]!),
      })),
    });
    const response = auditEventListSchema.parse(
      (await get('/audit-events?operation=DST_BOUNDARY&from=2026-03-08&to=2026-03-08').expect(200))
        .body,
    );
    expect(response.items.map((item) => item.id)).toEqual([`audit:${ids[2]}`, `audit:${ids[1]}`]);
    const tied = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    await db.client.auditEvent.createMany({
      data: tied.map((id) => ({
        id,
        organizationId: org,
        resourceId: risk.id,
        action: 'TIE_ORDER',
        createdAt: new Date('2026-04-01T12:00:00Z'),
      })),
    });
    const ordered = auditEventListSchema.parse(
      (await get('/audit-events?operation=TIE_ORDER').expect(200)).body,
    );
    expect(ordered.items.map((item) => item.id)).toEqual(tied.map((id) => `audit:${id}`));
  });
  it.each([
    'page=0',
    'pageSize=101',
    'from=2026-02-30',
    'from=2026-10-02&to=2026-10-01',
    'actorId=not-a-uuid',
    'payload=secret',
  ])('rejects invalid filters %s', async (query) => {
    await get(`/audit-events?${query}`).expect(400);
  });
  it('hides unavailable resources, unknown target kinds and foreign organizations', async () => {
    await get(`/risks/${randomUUID()}/history`).expect(404);
    await get(`/actions/${randomUUID()}/history`).expect(404);
    await get(`/history-records/action-revision/${randomUUID()}`).expect(404);
    await get(`/history-records/raw-json/${action.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${otherOrg}/audit-events`)
      .set('Cookie', cookies.get(admin)!)
      .expect(404);
  });
  it('revalidates revoked membership inside the snapshot', async () => {
    const key = { userId: reader, organizationId: org };
    await db.client.membership.update({
      where: { userId_organizationId: key },
      data: { isActive: false },
    });
    try {
      await expect(
        audit.history(key, 'risk', risk.id, { page: 1, pageSize: 50 }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: key },
        data: { isActive: true },
      });
    }
  });
  it('preserves access reasons and protects exact access records from readers', async () => {
    await post('/access-invites', {
      name: 'Synthetic recipient',
      email: `${randomUUID()}@example.test`,
      role: 'READER',
      capabilities: [],
      reason: 'Synthetic activation reason',
    }).expect(201);
    const page = auditEventListSchema.parse(
      (await get('/audit-events?operation=ACCESS_INVITE_CREATED').expect(200)).body,
    );
    expect(page.items[0]).toMatchObject({
      reason: 'Synthetic activation reason',
      target: { kind: 'access' },
    });
    const id = page.items[0]!.target!.id;
    await get(`/history-records/access/${id}`, reader).expect(403);
    const record = auditRecordSchema.parse(
      (await get(`/history-records/access/${id}`).expect(200)).body,
    );
    expect(record.event.reason).toBe('Synthetic activation reason');
    expect(JSON.stringify(record)).not.toMatch(/token|hash|email/i);
  });
  it('documents the envelope and exact-record endpoint', async () => {
    const doc = (await request(app.getHttpServer()).get('/api/docs-json').expect(200)).body;
    expect(
      doc.paths['/api/v1/organizations/{orgId}/audit-events'].get.responses['200'].content[
        'application/json'
      ].schema.properties,
    ).toHaveProperty('timeZone');
    expect(doc.paths['/api/v1/organizations/{orgId}/history-records/{kind}/{id}']).toBeDefined();
  });
  it('uses the same snapshot for rows and counts during a concurrent append', async () => {
    await repository.snapshot(async (tx) => {
      const before = await tx.auditEvent.count({ where: { organizationId: org } });
      await db.client.auditEvent.create({
        data: { organizationId: org, resourceId: risk.id, action: 'CONCURRENT_APPEND' },
      });
      expect(await tx.auditEvent.count({ where: { organizationId: org } })).toBe(before);
    });
  });
  it('rolls back the mutation and immutable revision when its audit append fails', async () => {
    const before = await db.client.action.findUniqueOrThrow({ where: { id: action.id } });
    const revisions = await db.client.actionRevision.count({ where: { actionId: action.id } });
    const marker = `id21_audit_${randomUUID().replaceAll('-', '')}`;
    expect(marker).toMatch(/^id21_audit_[a-f0-9]{32}$/);
    expect(org).toMatch(/^[a-f0-9-]{36}$/);
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION ${marker}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.action='ACTION_NOTE' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.client.$executeRawUnsafe(
        `CREATE TRIGGER ${marker} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${marker}()`,
      );
      try {
        await expect(
          actions.note({ userId: admin, organizationId: org }, action.id, {
            expectedVersion: before.version,
            text: 'Synthetic note that must roll back atomically',
          }),
        ).rejects.toBeDefined();
        expect(
          (await db.client.action.findUniqueOrThrow({ where: { id: action.id } })).version,
        ).toBe(before.version);
        expect(await db.client.actionRevision.count({ where: { actionId: action.id } })).toBe(
          revisions,
        );
      } finally {
        await db.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${marker} ON audit_events`);
      }
    } finally {
      await db.client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${marker}()`);
    }
  });
  it('unifies preliminary, technical, efficacy, reassessment and closure records without duplicates', async () => {
    await db.client.membership.update({
      where: { userId_organizationId: { userId: admin, organizationId: org } },
      data: { capabilities: ['TECHNICAL_DECISIONS'] },
    });
    const put = (path: string, body: object) =>
      request(app.getHttpServer())
        .put(base + path)
        .set('Cookie', cookies.get(admin)!)
        .set('Origin', env.CORS_ORIGIN)
        .send(body);
    const patch = (path: string, body: object) =>
      request(app.getHttpServer())
        .patch(base + path)
        .set('Cookie', cookies.get(admin)!)
        .set('Origin', env.CORS_ORIGIN)
        .send(body);
    const preliminary = (
      await post(`/risks/${risk.id}/evaluations`, {
        expectedVersion: risk.version,
        methodReference: 'Synthetic preliminary method',
        methodVersion: '1',
        observation: 'Synthetic preliminary observation',
        rationale: 'Synthetic preliminary rationale',
      }).expect(201)
    ).body;
    const draft = (
      await post('/evaluation-methods', {
        name: 'Synthetic ID21 method',
        description: 'Synthetic test definition',
      }).expect(201)
    ).body;
    const method = (
      await put(`/evaluation-method-versions/${draft.id}`, {
        expectedRevision: draft.revision,
        title: draft.title,
        description: draft.description,
        definition: {
          probability: [
            {
              key: 'p1',
              label: 'Synthetic probability',
              description: 'Synthetic criterion',
              position: 1,
            },
          ],
          severity: [
            {
              key: 's1',
              label: 'Synthetic severity',
              description: 'Synthetic criterion',
              position: 1,
            },
          ],
          levels: [{ key: 'l1', label: 'Synthetic level' }],
          priorities: [{ key: 'r1', label: 'Synthetic priority', rank: 1 }],
          matrix: [{ probabilityKey: 'p1', severityKey: 's1', levelKey: 'l1', priorityKey: 'r1' }],
        },
      }).expect(200)
    ).body;
    await post(`/evaluation-method-versions/${method.id}/publish`, {
      expectedRevision: method.revision,
      approvalReference: 'SYNTHETIC LOCAL TEST ONLY',
    }).expect(201);
    const evaluationInput = async () => ({
      expectedVersion: (await get(`/risks/${risk.id}`).expect(200)).body.version,
      methodVersionId: method.id,
      probabilityKey: 'p1',
      severityKey: 's1',
      rationale: 'Synthetic technical rationale for audit',
      context: 'Synthetic collective context for audit',
      sources: [{ kind: 'RISK_RECORD', id: risk.id }],
    });
    const technical = (
      await post(
        `/risk-workspaces/${risk.id}/technical-evaluations`,
        await evaluationInput(),
      ).expect(201)
    ).body;
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED']) {
      action = (await get(`/actions/${action.id}`).expect(200)).body;
      await patch(`/actions/${action.id}`, {
        expectedVersion: action.version,
        status,
        changeReason: 'Synthetic implementation progress reason',
        ...(status === 'IMPLEMENTED'
          ? { implementationNote: 'Synthetic implemented collective preventive measure' }
          : {}),
      }).expect(200);
    }
    const efficacy = (await get(`/actions/${action.id}/efficacy`).expect(200)).body;
    const opinion = (
      await post(`/actions/${action.id}/efficacy-opinions`, {
        expectedVersion: efficacy.actionVersion,
        expectedLatestOpinionId: null,
        expectedContextFingerprint: efficacy.contextFingerprint,
        verifiedOn: efficacy.referenceDate,
        result: 'EFFECTIVE',
        observation: 'Synthetic collective observation for audit',
        rationale: 'Synthetic efficacy rationale for audit',
        evidenceIds: [],
        textualEvidence: [
          {
            reference: 'Synthetic record ID21',
            description: 'Synthetic collective record used in review',
            rationale: 'Synthetic record supports this review',
          },
        ],
      }).expect(201)
    ).body;
    const context = (await get(`/risk-workspaces/${risk.id}/reassessment-context`).expect(200))
      .body;
    const currentEfficacy = (await get(`/actions/${action.id}/efficacy`).expect(200)).body;
    const reassessment = (
      await post(`/risk-workspaces/${risk.id}/reassessments`, {
        evaluation: await evaluationInput(),
        expectedPreviousEvaluationId: context.latestEvaluation.id,
        measures: [
          {
            actionId: action.id,
            expectedVersion: currentEfficacy.actionVersion,
            opinionId: opinion.id,
            expectedContextFingerprint: currentEfficacy.contextFingerprint,
            consideration: 'Synthetic measure explicitly considered for audit',
          },
        ],
      }).expect(201)
    ).body;
    const closureContext = (await get(`/actions/${action.id}/closure-context`).expect(200)).body;
    const closure = (
      await post(`/actions/${action.id}/technical-closures`, {
        expectedVersion: closureContext.efficacy.actionVersion,
        expectedRiskVersion: closureContext.riskVersion,
        expectedLatestEvaluationId: closureContext.latestEvaluation.id,
        expectedLatestClosureId: null,
        expectedContextFingerprint: closureContext.efficacy.contextFingerprint,
        reassessmentId: reassessment.id,
        opinionId: opinion.id,
        rationale: 'Synthetic closure rationale for audit',
      }).expect(201)
    ).body;
    const history = auditEventListSchema.parse(
      (await get(`/risks/${risk.id}/history`, reader).expect(200)).body,
    );
    const expected = [
      ['preliminary-evaluation', preliminary.id],
      ['technical-evaluation', technical.id],
      ['efficacy-opinion', opinion.id],
      ['reassessment', reassessment.id],
      ['technical-closure', closure.id],
    ];
    for (const [kind, id] of expected) {
      expect(
        history.items.filter((item) => item.target?.kind === kind && item.target?.id === id),
      ).toHaveLength(1);
      const record = auditRecordSchema.parse(
        (await get(`/history-records/${kind}/${id}`, reader).expect(200)).body,
      );
      expect(record.event.target).toMatchObject({ kind, id });
      expect(record.event.reason).toMatch(/^Synthetic /);
      const feed = auditEventListSchema.parse(
        (await get(`/audit-events?resourceId=${id}`).expect(200)).body,
      );
      expect(
        feed.items.some((item) => item.target?.id === id && item.reason?.startsWith('Synthetic ')),
      ).toBe(true);
    }
    expect(history.items.filter((item) => item.operation === 'RISK_CREATE')).toHaveLength(1);
    expect(history.items.filter((item) => item.operation === 'ACTION_CREATED')).toHaveLength(1);
    expect(
      history.items.filter((item) => item.target?.kind === 'technical-evaluation'),
    ).toHaveLength(1);
    const correctionContext = (await get(`/actions/${action.id}/efficacy`).expect(200)).body;
    const corrective = (
      await post(`/actions/${action.id}/corrective-actions`, {
        expectedVersion: correctionContext.actionVersion,
        opinionId: correctionContext.latest.id,
        expectedContextFingerprint: correctionContext.contextFingerprint,
        reason: 'Synthetic reason for a linked corrective measure',
        action: {
          expectedRiskVersion: (await get(`/risks/${risk.id}`).expect(200)).body.version,
          title: 'Synthetic corrective action ID21',
          description: 'Synthetic follow-up collective preventive measure',
          responsibleName: 'Synthetic collective team',
          dueDate: '2026-12-20',
          expectedResult: 'Synthetic collective correction',
          verificationCriterion: 'Synthetic corrective verification',
        },
      }).expect(201)
    ).body;
    const correctiveFeed = auditEventListSchema.parse(
      (
        await get(
          `/audit-events?resourceType=action&resourceId=${corrective.action.id}&operation=action.corrective_created`,
        ).expect(200)
      ).body,
    );
    expect(correctiveFeed.items).toHaveLength(1);
    expect(correctiveFeed.items[0]).toMatchObject({
      resource: { type: 'action', id: corrective.action.id },
      target: { kind: 'action', id: corrective.action.id },
      reason: 'Synthetic reason for a linked corrective measure',
    });
    const previousHistory = auditEventListSchema.parse(
      (await get(`/actions/${action.id}/history`, reader).expect(200)).body,
    );
    expect(
      previousHistory.items.filter((item) => item.operation === 'action.corrective_created'),
    ).toHaveLength(1);
    expect(
      previousHistory.items.find((item) => item.operation === 'action.corrective_created'),
    ).toMatchObject({
      target: { kind: 'action', id: corrective.action.id },
    });
    const riskHistory = auditEventListSchema.parse(
      (await get(`/risks/${risk.id}/history`, reader).expect(200)).body,
    );
    expect(
      riskHistory.items.filter((item) => item.operation === 'action.corrective_created'),
    ).toHaveLength(1);
  });
});
