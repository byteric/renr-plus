import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  actionDetailSchema,
  riskDetailSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  evaluationMethodVersionSchema,
  technicalRiskEvaluationSchema,
  reassessmentContextSchema,
  riskReassessmentSchema,
  riskReassessmentListSchema,
  technicalClosureContextSchema,
  technicalClosureSchema,
  technicalClosureListSchema,
  correctiveActionCreatedSchema,
  correctiveActionListSchema,
  evidenceSchema,
  type ActionDetail,
  type RiskDetail,
  type TechnicalRiskEvaluation,
  type EfficacyOpinion,
  type TechnicalClosureContext,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('ID17 reassessment and technical closure', () => {
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let riskId: string;
  let actionId: string;
  let cookie: string;
  let origin: string;
  let sectorId: string;
  let methodId: string;
  const cookies = new Map<string, string>();
  const actorIds = new Map<string, string>();
  const base = () => `/api/v1/organizations/${org}`;
  const get = (tail: string, actor = 'admin') =>
    request(app.getHttpServer())
      .get(base() + tail)
      .set('Cookie', cookies.get(actor) ?? cookie);
  const post = (tail: string, data: object, actor = 'admin') =>
    request(app.getHttpServer())
      .post(base() + tail)
      .set('Cookie', cookies.get(actor) ?? cookie)
      .set('Origin', origin)
      .send(data);
  const patch = (tail: string, data: object, actor = 'admin') =>
    request(app.getHttpServer())
      .patch(base() + tail)
      .set('Cookie', cookies.get(actor) ?? cookie)
      .set('Origin', origin)
      .send(data);
  const put = (tail: string, data: object, actor = 'tech') =>
    request(app.getHttpServer())
      .put(base() + tail)
      .set('Cookie', cookies.get(actor) ?? cookie)
      .set('Origin', origin)
      .send(data);
  const currentRisk = async (id: string) =>
    riskDetailSchema.parse((await get(`/risks/${id}`).expect(200)).body);
  const currentAction = async (id: string) =>
    actionDetailSchema.parse((await get(`/actions/${id}`).expect(200)).body);
  const efficacy = async (id: string) =>
    efficacyContextSchema.parse((await get(`/actions/${id}/efficacy`, 'tech').expect(200)).body);
  const closureContext = async (id: string, actor = 'tech') =>
    technicalClosureContextSchema.parse(
      (await get(`/actions/${id}/closure-context`, actor).expect(200)).body,
    );
  const actionFields = {
    title: 'Synthetic measure ID17',
    description: 'Synthetic collective preventive measure.',
    responsibleName: 'Synthetic external responsible',
    dueDate: '2026-12-20',
    expectedResult: 'Synthetic expected collective improvement.',
    verificationCriterion: 'Compare collective records.',
  };
  const evaluationInput = (risk: RiskDetail, versionId = methodId) => ({
    expectedVersion: risk.version,
    methodVersionId: versionId,
    probabilityKey: 'p1',
    severityKey: 's1',
    rationale: 'Synthetic technical rationale supporting the configured cell.',
    context: 'Synthetic collective context without real technical certification.',
    sources: [{ kind: 'RISK_RECORD', id: risk.id }],
  });
  async function publishMethod() {
    const draft = evaluationMethodVersionSchema.parse(
      (
        await post(
          '/evaluation-methods',
          {
            name: `Synthetic ID17 method ${randomUUID()}`,
            description: 'Synthetic test method, not professional approval.',
          },
          'tech',
        ).expect(201)
      ).body,
    );
    const updated = evaluationMethodVersionSchema.parse(
      (
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
            levels: [{ key: 'l1', label: 'Synthetic class' }],
            priorities: [{ key: 'r1', label: 'Synthetic priority', rank: 1 }],
            matrix: [
              { probabilityKey: 'p1', severityKey: 's1', levelKey: 'l1', priorityKey: 'r1' },
            ],
          },
        }).expect(200)
      ).body,
    );
    return evaluationMethodVersionSchema.parse(
      (
        await post(
          `/evaluation-method-versions/${draft.id}/publish`,
          {
            expectedRevision: updated.revision,
            approvalReference: 'SYNTHETIC local test approval, not valid for real use.',
          },
          'tech',
        ).expect(201)
      ).body,
    ).id;
  }
  async function newRisk() {
    return riskDetailSchema.parse(
      (
        await post('/risks', {
          sectorId,
          factor: `Synthetic collective risk ${randomUUID()}`,
          status: 'REGISTERED',
          description: 'Synthetic collective work organization.',
          exposureDescription: 'Synthetic collective exposure.',
          exposedGroupDescription: 'Synthetic team.',
          possibleHarms: 'Synthetic possible harms.',
          existingControls: 'Synthetic preventive controls.',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic record without professional or regulatory certification.',
        }).expect(201)
      ).body,
    );
  }
  async function newOpinion(
    id: string,
    result: 'EFFECTIVE' | 'NOT_EFFECTIVE' | 'INCONCLUSIVE' = 'EFFECTIVE',
    evidenceIds: string[] = [],
  ) {
    const context = await efficacy(id);
    return efficacyOpinionSchema.parse(
      (
        await post(
          `/actions/${id}/efficacy-opinions`,
          {
            expectedVersion: context.actionVersion,
            expectedLatestOpinionId: context.latest?.id ?? null,
            expectedContextFingerprint: context.contextFingerprint,
            verifiedOn: context.referenceDate,
            result,
            observation: 'Synthetic collective observation supporting this technical review.',
            rationale: 'Synthetic technical rationale tied to the preserved criterion.',
            evidenceIds,
            textualEvidence: [
              {
                reference: 'Synthetic record ID17',
                description: 'Synthetic collective record identified for this review.',
                rationale: 'The identified record supports this synthetic conclusion.',
              },
            ],
            ...(result === 'EFFECTIVE'
              ? {}
              : {
                  nextSteps:
                    'Gather further collective records and perform another technical review.',
                }),
          },
          'tech',
        ).expect(201)
      ).body,
    );
  }
  type Prepared = {
    risk: RiskDetail;
    action: ActionDetail;
    baseline: TechnicalRiskEvaluation;
    opinion: EfficacyOpinion;
  };
  async function prepare(
    result: 'EFFECTIVE' | 'NOT_EFFECTIVE' | 'INCONCLUSIVE' = 'EFFECTIVE',
  ): Promise<Prepared> {
    let risk = await newRisk();
    const baseline = technicalRiskEvaluationSchema.parse(
      (
        await post(
          `/risk-workspaces/${risk.id}/technical-evaluations`,
          evaluationInput(risk),
          'tech',
        ).expect(201)
      ).body,
    );
    risk = await currentRisk(risk.id);
    let action = actionDetailSchema.parse(
      (
        await post(`/risks/${risk.id}/actions`, {
          ...actionFields,
          expectedRiskVersion: risk.version,
        }).expect(201)
      ).body,
    );
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED'] as const)
      action = actionDetailSchema.parse(
        (
          await patch(`/actions/${action.id}`, {
            expectedVersion: action.version,
            status,
            changeReason: 'Synthetic operational progress recorded.',
            ...(status === 'IMPLEMENTED'
              ? {
                  implementationNote:
                    'Synthetic collective team reported the measure as implemented.',
                }
              : {}),
          }).expect(200)
        ).body,
      );
    return { risk, action, baseline, opinion: await newOpinion(action.id, result) };
  }
  async function reassess(record: Prepared, versionId = methodId) {
    const context = reassessmentContextSchema.parse(
      (await get(`/risk-workspaces/${record.risk.id}/reassessment-context`, 'tech').expect(200))
        .body,
    );
    const opinion = await efficacy(record.action.id);
    return riskReassessmentSchema.parse(
      (
        await post(
          `/risk-workspaces/${record.risk.id}/reassessments`,
          {
            evaluation: evaluationInput(await currentRisk(record.risk.id), versionId),
            expectedPreviousEvaluationId: context.latestEvaluation!.id,
            measures: [
              {
                actionId: record.action.id,
                expectedVersion: opinion.actionVersion,
                opinionId: opinion.latest!.id,
                expectedContextFingerprint: opinion.contextFingerprint,
                consideration:
                  'The collective measure and its preserved opinion were explicitly considered.',
              },
            ],
          },
          'tech',
        ).expect(201)
      ).body,
    );
  }
  function closeInput(context: TechnicalClosureContext) {
    return {
      expectedVersion: context.efficacy.actionVersion,
      expectedRiskVersion: context.riskVersion,
      expectedLatestEvaluationId: context.latestEvaluation!.id,
      expectedLatestClosureId: context.latest?.id ?? null,
      expectedContextFingerprint: context.efficacy.contextFingerprint,
      reassessmentId: context.latestReassessment!.id,
      opinionId: context.efficacy.latest!.id,
      rationale:
        'Synthetic technical closure justified by the reassessment and current effective opinion.',
    };
  }
  async function withAuditFailure(action: string, operation: () => Promise<void>) {
    const name = `id17_audit_${randomUUID().replaceAll('-', '')}`;
    expect(name).toMatch(/^id17_audit_[a-f0-9]{32}$/);
    expect(org).toMatch(/^[a-f0-9-]{36}$/);
    expect(['risk.reassessment_created', 'action.corrective_created']).toContain(action);
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.action='${action}' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.client.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        await operation();
      } finally {
        await db.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON audit_events`);
      }
    } finally {
      await db.client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  }

  beforeAll(async () => {
    const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    origin = env.CORS_ORIGIN;
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app, env);
    await app.init();
    db = module.get(PrismaService);
    org = (
      await db.client.organization.create({ data: { name: `Synthetic ID17 ${randomUUID()}` } })
    ).id;
    const user = await db.client.user.create({
      data: {
        name: 'Synthetic ID17 administrator',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused',
      },
    });
    await db.client.membership.create({
      data: {
        userId: user.id,
        organizationId: org,
        role: 'ADMIN',
        capabilities: [],
      },
    });
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: org,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    cookie = `renr_session=${token}`;
    cookies.set('admin', cookie);
    actorIds.set('admin', user.id);
    for (const actor of ['tech', 'manager', 'reader']) {
      const extra = await db.client.user.create({
        data: {
          name: `Synthetic ID17 ${actor}`,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      });
      actorIds.set(actor, extra.id);
      await db.client.membership.create({
        data: {
          userId: extra.id,
          organizationId: org,
          role: actor === 'manager' ? 'ADMIN' : 'READER',
          capabilities: actor === 'reader' ? [] : ['TECHNICAL_DECISIONS'],
        },
      });
      const secret = randomBytes(32).toString('base64url');
      await db.client.session.create({
        data: {
          userId: extra.id,
          activeOrganizationId: org,
          tokenHash: createHash('sha256').update(secret).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      cookies.set(actor, `renr_session=${secret}`);
    }
    const unit = await db.client.unit.create({
      data: {
        organizationId: org,
        name: 'Synthetic unit ID17',
        normalizedName: 'synthetic unit id17',
      },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector ID17',
        normalizedName: 'synthetic sector id17',
      },
    });
    sectorId = sector.id;
    const risk = riskDetailSchema.parse(
      (
        await post('/risks', {
          sectorId: sector.id,
          factor: 'Synthetic collective risk ID17',
          status: 'REGISTERED',
          description: 'Synthetic collective work organization.',
          exposureDescription: 'Synthetic collective exposure.',
          exposedGroupDescription: 'Synthetic team.',
          possibleHarms: 'Synthetic possible harms.',
          existingControls: 'Synthetic preventive controls.',
          sourceKind: 'TECHNICAL_RECORD',
          sourceNote: 'Synthetic record without professional or regulatory certification.',
        }).expect(201)
      ).body,
    );
    riskId = risk.id;
    actionId = actionDetailSchema.parse(
      (
        await post(`/risks/${riskId}/actions`, {
          title: 'Synthetic measure ID17',
          description: 'Synthetic collective preventive measure.',
          responsibleName: 'Synthetic external responsible',
          dueDate: '2026-12-20',
          expectedResult: 'Synthetic expected collective improvement.',
          verificationCriterion: 'Compare collective records.',
          expectedRiskVersion: risk.version,
        }).expect(201)
      ).body,
    ).id;
    methodId = await publishMethod();
  }, 60000);

  afterAll(async () => {
    if (db && org)
      await db.client.organization.update({ where: { id: org }, data: { isActive: false } });
    await app?.close();
  });

  it('exposes reassessment context without inventing a prior technical evaluation', async () => {
    const response = await get(`/risk-workspaces/${riskId}/reassessment-context`).expect(200);
    expect(response.body.riskId).toBe(riskId);
    expect(response.body.latestEvaluation).toBeNull();
  });

  it('exposes technical closure eligibility separately from operational state', async () => {
    const response = await get(`/actions/${actionId}/closure-context`).expect(200);
    expect(response.body.actionId).toBe(actionId);
    expect(response.body.permissions.canClose).toBe(false);
    expect(response.body.latest).toBeNull();
  });

  it('records a coherent reassessment and closes separately with preserved proofs, authors and legacy DTOs', async () => {
    const record = await prepare();
    const before = await currentAction(record.action.id);
    const review = await reassess(record);
    expect(review.previousEvaluation).toEqual(record.baseline);
    expect(review.comparison).toBe('COMPARABLE');
    expect(review.measures[0]?.opinion.id).toBe(record.opinion.id);
    expect(review.author.id).toBe(actorIds.get('tech'));
    expect(
      (
        await get(
          `/risk-workspaces/${record.risk.id}/technical-evaluations/${record.baseline.id}`,
          'reader',
        ).expect(200)
      ).body,
    ).toEqual(record.baseline);
    const context = await closureContext(record.action.id);
    expect(context.permissions.canClose).toBe(true);
    const closed = technicalClosureSchema.parse(
      (
        await post(
          `/actions/${record.action.id}/technical-closures`,
          closeInput(context),
          'tech',
        ).expect(201)
      ).body,
    );
    expect(closed.validity).toBe('CURRENT');
    expect(closed.proofPackage).toEqual(record.opinion.proofPackage);
    expect(await currentAction(record.action.id)).toEqual(before);
    expect((await closureContext(record.action.id)).blockingReasons).toContain('ALREADY_CLOSED');
    await post(
      `/actions/${record.action.id}/technical-closures`,
      closeInput(context),
      'tech',
    ).expect(409);
    expect(
      (
        await db.client.auditEvent.findMany({
          where: { organizationId: org, resourceId: closed.id },
        })
      ).map((item) => item.action),
    ).toContain('action.technical_closure_created');
    expect(
      riskReassessmentListSchema.parse(
        (
          await get(`/risk-workspaces/${record.risk.id}/reassessments?pageSize=1`, 'reader').expect(
            200,
          )
        ).body,
      ).total,
    ).toBe(1);
    expect(
      (
        await get(`/risk-workspaces/${record.risk.id}/reassessments/${review.id}`, 'reader').expect(
          200,
        )
      ).body.id,
    ).toBe(review.id);
    expect(
      technicalClosureListSchema.parse(
        (await get(`/actions/${record.action.id}/technical-closures`, 'reader').expect(200)).body,
      ).total,
    ).toBe(1);
    expect(
      (
        await get(`/actions/${record.action.id}/technical-closures/${closed.id}`, 'reader').expect(
          200,
        )
      ).body.id,
    ).toBe(closed.id);
  });

  it('requires explicit technical capability, Origin and an authenticated active scope', async () => {
    const record = await prepare();
    await reassess(record);
    const payload = closeInput(await closureContext(record.action.id));
    for (const actor of ['admin', 'reader'])
      await post(`/actions/${record.action.id}/technical-closures`, payload, actor).expect(403);
    await request(app.getHttpServer())
      .post(base() + `/actions/${record.action.id}/technical-closures`)
      .set('Cookie', cookies.get('tech')!)
      .set('Origin', 'https://foreign.example')
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .get(base() + `/actions/${record.action.id}/closure-context`)
      .expect(401);
    const foreign = await db.client.organization.create({
      data: { name: 'Synthetic ID17 isolated organization' },
    });
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${foreign.id}/actions/${record.action.id}/closure-context`)
        .set('Cookie', cookie)
        .expect(404);
    } finally {
      await db.client.organization.update({ where: { id: foreign.id }, data: { isActive: false } });
    }
    await get(`/actions/${record.action.id}/technical-closures?page=1&page=2`).expect(400);
    await get(`/risk-workspaces/${record.risk.id}/reassessments?unknown=1`).expect(400);
  });

  it.each(['NOT_EFFECTIVE', 'INCONCLUSIVE'] as const)(
    'considers a current %s opinion without allowing technical closure',
    async (result) => {
      const record = await prepare(result);
      const review = await reassess(record);
      expect(review.measures[0]?.opinion.result).toBe(result);
      const context = await closureContext(record.action.id);
      expect(context.blockingReasons).toContain('NO_CURRENT_EFFECTIVE_OPINION');
      await post(
        `/actions/${record.action.id}/technical-closures`,
        closeInput(context),
        'tech',
      ).expect(409);
      expect(
        await db.client.actionTechnicalClosure.count({ where: { actionId: record.action.id } }),
      ).toBe(0);
    },
  );

  it('shows an incompatible method without fabricating reduction or requiring equal methods for closure', async () => {
    const record = await prepare();
    const otherMethod = await publishMethod();
    const review = await reassess(record, otherMethod);
    expect(review.comparison).toBe('METHOD_VERSION_CHANGED');
    expect(review).not.toHaveProperty('reduction');
    const context = await closureContext(record.action.id);
    expect(context.permissions.canClose).toBe(true);
    await post(
      `/actions/${record.action.id}/technical-closures`,
      closeInput(context),
      'tech',
    ).expect(201);
  });

  it('does not infer closure eligibility from a reassessment that considered another measure', async () => {
    const record = await prepare();
    const sibling = actionDetailSchema.parse(
      (
        await post(`/risks/${record.risk.id}/actions`, {
          ...actionFields,
          expectedRiskVersion: (await currentRisk(record.risk.id)).version,
        }).expect(201)
      ).body,
    );
    let action = sibling;
    for (const status of ['IN_PROGRESS', 'IMPLEMENTED'] as const)
      action = actionDetailSchema.parse(
        (
          await patch(`/actions/${action.id}`, {
            expectedVersion: action.version,
            status,
            changeReason: 'Synthetic operational progress recorded.',
            ...(status === 'IMPLEMENTED'
              ? {
                  implementationNote:
                    'The synthetic team reported a separate measure as implemented.',
                }
              : {}),
          }).expect(200)
        ).body,
      );
    const opinion = await newOpinion(action.id);
    await reassess({ ...record, action, opinion });
    const context = await closureContext(record.action.id);
    expect(context.blockingReasons).toContain('MEASURE_NOT_CONSIDERED');
    await post(
      `/actions/${record.action.id}/technical-closures`,
      closeInput(context),
      'tech',
    ).expect(409);
  });

  it('requires coherent unique measures and the immediate predecessor without partial evaluations', async () => {
    const record = await prepare();
    const context = await efficacy(record.action.id);
    const measure = {
      actionId: record.action.id,
      expectedVersion: context.actionVersion,
      opinionId: record.opinion.id,
      expectedContextFingerprint: context.contextFingerprint,
      consideration: 'Explicit consideration of this synthetic collective measure.',
    };
    const payload = {
      evaluation: evaluationInput(await currentRisk(record.risk.id)),
      expectedPreviousEvaluationId: record.baseline.id,
      measures: [measure],
    };
    const route = `/risk-workspaces/${record.risk.id}/reassessments`;
    await post(route, { ...payload, measures: [] }, 'tech').expect(400);
    await post(route, { ...payload, measures: [measure, measure] }, 'tech').expect(400);
    await post(route, { ...payload, expectedPreviousEvaluationId: randomUUID() }, 'tech').expect(
      409,
    );
    const foreign = await prepare();
    await post(
      route,
      {
        ...payload,
        measures: [{ ...measure, actionId: foreign.action.id, opinionId: foreign.opinion.id }],
      },
      'tech',
    ).expect(404);
    expect(
      await db.client.technicalRiskEvaluation.count({ where: { riskId: record.risk.id } }),
    ).toBe(1);
    expect(await db.client.riskReassessment.count({ where: { riskId: record.risk.id } })).toBe(0);
  });

  it('keeps ordinary notes valid before reassessment, before closure and after closure', async () => {
    const record = await prepare();
    const note = async () =>
      post(`/actions/${record.action.id}/notes`, {
        expectedVersion: (await currentAction(record.action.id)).version,
        text: 'Synthetic administrative follow-up without a technical change.',
      }).expect(201);
    await note();
    const review = await reassess(record);
    expect(review.measures[0]!.actionVersion).toBeGreaterThan(record.opinion.actionVersion);
    await note();
    const closed = technicalClosureSchema.parse(
      (
        await post(
          `/actions/${record.action.id}/technical-closures`,
          closeInput(await closureContext(record.action.id)),
          'tech',
        ).expect(201)
      ).body,
    );
    await note();
    expect((await closureContext(record.action.id)).latest?.validity).toBe('CURRENT');
    expect(
      (await get(`/actions/${record.action.id}/technical-closures/${closed.id}`).expect(200)).body
        .proofPackage,
    ).toEqual(record.opinion.proofPackage);
  });

  it('serializes concurrent confirmations and preserves the operational action version', async () => {
    const record = await prepare();
    await reassess(record);
    const payload = closeInput(await closureContext(record.action.id));
    const responses = await Promise.all([
      post(`/actions/${record.action.id}/technical-closures`, payload, 'tech'),
      post(`/actions/${record.action.id}/technical-closures`, payload, 'tech'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await db.client.actionTechnicalClosure.count({ where: { actionId: record.action.id } }),
    ).toBe(1);
    expect((await currentAction(record.action.id)).version).toBe(payload.expectedVersion);
  });

  it('rejects a relevant edit before confirmation and requires review without discarding history', async () => {
    const record = await prepare();
    const review = await reassess(record);
    const payload = closeInput(await closureContext(record.action.id));
    const risk = await currentRisk(record.risk.id);
    await patch(`/risks/${risk.id}`, {
      expectedVersion: risk.version,
      description: 'Updated collective description requires a new technical review.',
    }).expect(200);
    await post(`/actions/${record.action.id}/technical-closures`, payload, 'tech').expect(409);
    expect((await closureContext(record.action.id)).blockingReasons).toContain(
      'NO_CURRENT_REASSESSMENT',
    );
    expect(
      (await get(`/risk-workspaces/${risk.id}/reassessments/${review.id}`).expect(200)).body
        .previousEvaluation.id,
    ).toBe(record.baseline.id);
  });

  it('marks an old closure for review on a new evaluation and preserves superseded closures after renewal', async () => {
    const record = await prepare();
    await reassess(record);
    const first = technicalClosureSchema.parse(
      (
        await post(
          `/actions/${record.action.id}/technical-closures`,
          closeInput(await closureContext(record.action.id)),
          'tech',
        ).expect(201)
      ).body,
    );
    await post(
      `/risk-workspaces/${record.risk.id}/technical-evaluations`,
      evaluationInput(await currentRisk(record.risk.id)),
      'tech',
    ).expect(201);
    expect((await closureContext(record.action.id)).latest?.reviewReasons).toContain(
      'REASSESSMENT_SUPERSEDED',
    );
    await reassess(record);
    const second = technicalClosureSchema.parse(
      (
        await post(
          `/actions/${record.action.id}/technical-closures`,
          closeInput(await closureContext(record.action.id)),
          'tech',
        ).expect(201)
      ).body,
    );
    expect(second.supersedesId).toBe(first.id);
    expect(second.sequence).toBe(2);
    expect(
      (await get(`/actions/${record.action.id}/technical-closures/${first.id}`).expect(200)).body
        .validity,
    ).toBe('SUPERSEDED');
    expect(
      (await get(`/actions/${record.action.id}/technical-closures/${first.id}`).expect(200)).body
        .proofPackage,
    ).toEqual(first.proofPackage);
  });

  it('creates an explicitly confirmed corrective action with a technical link without reopening the original', async () => {
    const record = await prepare('NOT_EFFECTIVE');
    const before = await currentAction(record.action.id);
    const context = await closureContext(record.action.id, 'manager');
    expect(context.permissions.canCreateCorrective).toBe(true);
    const payload = {
      expectedVersion: before.version,
      opinionId: record.opinion.id,
      expectedContextFingerprint: context.efficacy.contextFingerprint,
      reason:
        'The recorded synthetic conclusion motivates an additional collective preventive measure.',
      action: {
        ...actionFields,
        title: 'Synthetic corrective measure',
        expectedRiskVersion: context.riskVersion,
      },
    };
    await post(`/actions/${before.id}/corrective-actions`, payload, 'admin').expect(403);
    await post(`/actions/${before.id}/corrective-actions`, payload, 'tech').expect(403);
    const created = correctiveActionCreatedSchema.parse(
      (await post(`/actions/${before.id}/corrective-actions`, payload, 'manager').expect(201)).body,
    );
    expect(created.action.id).not.toBe(before.id);
    expect(created.action.status).toBe('PLANNED');
    expect(created.link.previousActionId).toBe(before.id);
    expect(created.link.newActionId).toBe(created.action.id);
    expect(await currentAction(before.id)).toEqual(before);
    expect(
      correctiveActionListSchema.parse(
        (await get(`/actions/${before.id}/corrective-actions`, 'reader').expect(200)).body,
      ).items[0]?.id,
    ).toBe(created.link.id);
  });

  it('requires review after a newer opinion and provides no editing or deletion of technical closure', async () => {
    const record = await prepare();
    await reassess(record);
    const closed = technicalClosureSchema.parse(
      (
        await post(
          `/actions/${record.action.id}/technical-closures`,
          closeInput(await closureContext(record.action.id)),
          'tech',
        ).expect(201)
      ).body,
    );
    await newOpinion(record.action.id, 'INCONCLUSIVE');
    const context = await closureContext(record.action.id);
    expect(context.latest?.validity).toBe('REVIEW_REQUIRED');
    expect(context.latest?.reviewReasons).toContain('OPINION_SUPERSEDED');
    expect(context.permissions.canClose).toBe(false);
    await patch(
      `/actions/${record.action.id}/technical-closures/${closed.id}`,
      { rationale: 'Attempted retrospective alteration is not allowed.' },
      'tech',
    ).expect(404);
    await request(app.getHttpServer())
      .delete(base() + `/actions/${record.action.id}/technical-closures/${closed.id}`)
      .set('Cookie', cookies.get('tech')!)
      .set('Origin', origin)
      .expect(404);
  });

  it('rolls back the technical closure if its audit write fails', async () => {
    const record = await prepare();
    await reassess(record);
    const payload = closeInput(await closureContext(record.action.id));
    const name = `id17_audit_${randomUUID().replaceAll('-', '')}`;
    expect(name).toMatch(/^id17_audit_[a-f0-9]{32}$/);
    expect(org).toMatch(/^[a-f0-9-]{36}$/);
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.action='action.technical_closure_created' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.client.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        await post(`/actions/${record.action.id}/technical-closures`, payload, 'tech').expect(409);
        expect(
          await db.client.actionTechnicalClosure.count({ where: { actionId: record.action.id } }),
        ).toBe(0);
        expect((await closureContext(record.action.id)).latest).toBeNull();
        expect((await currentAction(record.action.id)).version).toBe(payload.expectedVersion);
      } finally {
        await db.client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON audit_events`);
      }
    } finally {
      await db.client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });

  it('rolls back evaluation, risk version, reassessment and measures if reassessment auditing fails', async () => {
    const record = await prepare();
    const risk = await currentRisk(record.risk.id);
    const context = await efficacy(record.action.id);
    const payload = {
      evaluation: evaluationInput(risk),
      expectedPreviousEvaluationId: record.baseline.id,
      measures: [
        {
          actionId: record.action.id,
          expectedVersion: context.actionVersion,
          opinionId: record.opinion.id,
          expectedContextFingerprint: context.contextFingerprint,
          consideration: 'Explicit synthetic consideration of this collective preventive measure.',
        },
      ],
    };
    await withAuditFailure('risk.reassessment_created', async () => {
      await post(`/risk-workspaces/${risk.id}/reassessments`, payload, 'tech').expect(409);
      expect(await db.client.technicalRiskEvaluation.count({ where: { riskId: risk.id } })).toBe(1);
      expect(await db.client.riskReassessment.count({ where: { riskId: risk.id } })).toBe(0);
      expect(await db.client.reassessmentMeasure.count({ where: { riskId: risk.id } })).toBe(0);
      expect((await currentRisk(risk.id)).version).toBe(risk.version);
    });
  });

  it('rolls back a corrective action and its revision and link if corrective auditing fails', async () => {
    const record = await prepare('NOT_EFFECTIVE');
    const before = await currentAction(record.action.id);
    const context = await closureContext(before.id, 'manager');
    const payload = {
      expectedVersion: before.version,
      opinionId: record.opinion.id,
      expectedContextFingerprint: context.efficacy.contextFingerprint,
      reason: 'The technical conclusion motivates a separate collective preventive measure.',
      action: { ...actionFields, expectedRiskVersion: context.riskVersion },
    };
    const revisionsBefore = await db.client.actionRevision.count({
      where: { organizationId: org },
    });
    const auditBefore = await db.client.auditEvent.count({ where: { organizationId: org } });
    await withAuditFailure('action.corrective_created', async () => {
      await post(`/actions/${before.id}/corrective-actions`, payload, 'manager').expect(409);
      expect(await db.client.action.count({ where: { riskId: record.risk.id } })).toBe(1);
      expect(
        await db.client.actionCorrectiveLink.count({ where: { previousActionId: before.id } }),
      ).toBe(0);
      expect(await db.client.actionRevision.count({ where: { organizationId: org } })).toBe(
        revisionsBefore,
      );
      expect(await db.client.auditEvent.count({ where: { organizationId: org } })).toBe(
        auditBefore,
      );
      expect(await currentAction(before.id)).toEqual(before);
    });
  });

  it('revalidates operational authority before creating a correction with a previously prepared payload', async () => {
    const record = await prepare('NOT_EFFECTIVE');
    const context = await closureContext(record.action.id, 'manager');
    const payload = {
      expectedVersion: record.action.version,
      opinionId: record.opinion.id,
      expectedContextFingerprint: context.efficacy.contextFingerprint,
      reason: 'The technical conclusion motivates a separate collective preventive measure.',
      action: { ...actionFields, expectedRiskVersion: context.riskVersion },
    };
    const key = {
      userId_organizationId: { userId: actorIds.get('manager')!, organizationId: org },
    };
    await db.client.membership.update({ where: key, data: { role: 'READER' } });
    try {
      await post(`/actions/${record.action.id}/corrective-actions`, payload, 'manager').expect(403);
      expect(await db.client.action.count({ where: { riskId: record.risk.id } })).toBe(1);
      expect(
        await db.client.actionCorrectiveLink.count({
          where: { previousActionId: record.action.id },
        }),
      ).toBe(0);
    } finally {
      await db.client.membership.update({ where: key, data: { role: 'ADMIN' } });
    }
  });

  it('revalidates technical authority without erasing an existing decision on capability revocation', async () => {
    const record = await prepare();
    await reassess(record);
    const payload = closeInput(await closureContext(record.action.id));
    await db.client.membership.update({
      where: { userId_organizationId: { userId: actorIds.get('tech')!, organizationId: org } },
      data: { capabilities: [] },
    });
    try {
      await post(`/actions/${record.action.id}/technical-closures`, payload, 'tech').expect(403);
      expect((await closureContext(record.action.id, 'reader')).permissions.canClose).toBe(false);
      expect(
        (await get(`/risk-workspaces/${record.risk.id}/reassessments`, 'reader').expect(200)).body
          .total,
      ).toBe(1);
      expect(
        await db.client.actionTechnicalClosure.count({ where: { actionId: record.action.id } }),
      ).toBe(0);
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: actorIds.get('tech')!, organizationId: org } },
        data: { capabilities: ['TECHNICAL_DECISIONS'] },
      });
    }
  });

  (process.env.STORAGE_ENABLED === 'true' ? it : it.skip)(
    'does not invalidate technical closure for upload and archival of an unselected attachment',
    async () => {
      const record = await prepare();
      await reassess(record);
      const closed = technicalClosureSchema.parse(
        (
          await post(
            `/actions/${record.action.id}/technical-closures`,
            closeInput(await closureContext(record.action.id)),
            'tech',
          ).expect(201)
        ).body,
      );
      const currentVersion = (await currentAction(record.action.id)).version;
      const upload = await request(app.getHttpServer())
        .post(base() + `/actions/${record.action.id}/evidence`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('expectedVersion', String(currentVersion))
        .field('description', 'Synthetic unselected attachment added after technical closure.')
        .attach('file', Buffer.from('%PDF-1.7\nSynthetic unselected ID17\n%%EOF'), {
          filename: 'synthetic-unselected.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const file = evidenceSchema.parse(upload.body);
      await patch(`/actions/${record.action.id}/evidence/${file.id}`, {
        expectedVersion: (await currentAction(record.action.id)).version,
        changeReason:
          'Synthetic unselected attachment archived without changing the decision proofs.',
      }).expect(200);
      const context = await closureContext(record.action.id);
      expect(context.latest?.id).toBe(closed.id);
      expect(context.latest?.validity).toBe('CURRENT');
      expect(context.latest?.proofPackage).toEqual(closed.proofPackage);
    },
  );

  (process.env.STORAGE_ENABLED === 'true' ? it : it.skip)(
    'retains the frozen proof package and explicitly requires review after selected evidence archival',
    async () => {
      const record = await prepare();
      const upload = await request(app.getHttpServer())
        .post(base() + `/actions/${record.action.id}/evidence`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('expectedVersion', String(record.action.version))
        .field('description', 'Synthetic collective proof for technical closure ID17.')
        .attach('file', Buffer.from('%PDF-1.7\nSynthetic proof ID17\n%%EOF'), {
          filename: 'synthetic-id17.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const file = evidenceSchema.parse(upload.body);
      record.opinion = await newOpinion(record.action.id, 'EFFECTIVE', [file.id]);
      await reassess(record);
      const closed = technicalClosureSchema.parse(
        (
          await post(
            `/actions/${record.action.id}/technical-closures`,
            closeInput(await closureContext(record.action.id)),
            'tech',
          ).expect(201)
        ).body,
      );
      const usageRoute = `/actions/${record.action.id}/evidence/${file.id}/usage`;
      const usage = (await get(`${usageRoute}?pageSize=1`, 'reader').expect(200)).body;
      expect(usage).toMatchObject({
        evidenceId: file.id,
        opinionTotal: 1,
        closureTotal: 1,
        total: 2,
        page: 1,
        pageSize: 1,
      });
      expect(usage.items).toHaveLength(1);
      expect(usage.items[0]).toMatchObject({ kind: 'TECHNICAL_CLOSURE', id: closed.id });
      const pageTwo = (await get(`${usageRoute}?pageSize=1&page=2`).expect(200)).body;
      expect(pageTwo.items[0]).toMatchObject({ kind: 'OPINION', id: record.opinion.id });
      await patch(`/actions/${record.action.id}/evidence/${file.id}`, {
        expectedVersion: (await currentAction(record.action.id)).version,
        changeReason: 'Synthetic selected proof withdrawn, requiring a new technical review.',
      }).expect(200);
      const context = await closureContext(record.action.id);
      expect(context.latest?.validity).toBe('REVIEW_REQUIRED');
      expect(context.latest?.reviewReasons).toContain('SELECTED_EVIDENCE_ARCHIVED');
      expect(context.latest?.proofPackage).toEqual(closed.proofPackage);
      expect(
        (await get(`/actions/${record.action.id}/technical-closures/${closed.id}`).expect(200)).body
          .proofPackage.files[0]?.sha256,
      ).toBe(file.sha256);
      expect((await get(usageRoute).expect(200)).body.total).toBe(2);
    },
  );
});
