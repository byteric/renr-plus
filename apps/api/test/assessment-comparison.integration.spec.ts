import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { assessmentComparisonSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('Assessment comparison HTTP with persisted cohorts and action history', () => {
  let app: INestApplication;
  let db: PrismaService;

  beforeAll(async () => {
    const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });

  afterAll(async () => app?.close());

  it('compares complete periods, masks small differences and uses persisted action snapshots', async () => {
    const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    const api = request(app.getHttpServer());
    const { id: organizationId } = await db.client.organization.create({
      data: { name: 'ID42 synthetic comparison' },
    });
    const { id: userId } = await db.client.user.create({
      data: {
        name: 'ID42 synthetic administrator',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused',
      },
    });
    await db.client.membership.create({
      data: { organizationId, userId, role: 'ADMIN', capabilities: ['TECHNICAL_DECISIONS'] },
    });
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId,
        activeOrganizationId: organizationId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const cookie = `renr_session=${token}`;
    const path = `/api/v1/organizations/${organizationId}`;
    const post = (route: string, body: object) =>
      api.post(`${path}/${route}`).set('Cookie', cookie).set('Origin', env.CORS_ORIGIN).send(body);
    const compare = (
      referenceCycleId: string,
      currentCycleId: string,
      extra: Record<string, string> = {},
    ) =>
      api
        .get(`${path}/assessment-comparison`)
        .set('Cookie', cookie)
        .query({ referenceCycleId, currentCycleId, ...extra });
    const unit = await db.client.unit.create({
      data: { organizationId, name: 'ID42 synthetic unit', normalizedName: 'id42 synthetic unit' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId,
        unitId: unit.id,
        name: 'ID42 synthetic sector',
        normalizedName: 'id42 synthetic sector',
      },
    });
    const group = await db.client.assessmentGroup.create({
      data: { organizationId, sectorId: sector.id },
    });
    const created = (await post('instruments', { name: 'ID42 synthetic instrument' }).expect(201))
      .body;
    const instrumentVersionId: string = created.version.id;
    const instrumentPath = `${path}/instruments/${created.instrument.id}/versions/${instrumentVersionId}`;
    const questionId = randomUUID();
    const choices = ['One', 'Two', 'Three'].map((label, index) => ({
      id: randomUUID(),
      label,
      position: index + 1,
    }));
    await api
      .put(instrumentPath)
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedRevision: 1,
        title: 'ID42 synthetic instrument',
        description: '',
        instructions: '',
        usageMode: 'REAL',
        questions: [
          {
            id: questionId,
            label: 'Collective factor',
            type: 'SINGLE_CHOICE',
            required: true,
            position: 1,
            options: choices,
          },
        ],
      })
      .expect(200);
    await api
      .post(`${instrumentPath}/publish`)
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ expectedRevision: 2, approvalReference: 'Synthetic local integration test only.' })
      .expect(201);
    const policyVersionId: string = (
      await post('consolidation-policies', {
        usageMode: 'REAL',
        minimumResponses: 5,
      }).expect(201)
    ).body.id;
    await post(`consolidation-policies/${policyVersionId}/publish`, {
      expectedRevision: 1,
      approvalReference: 'Synthetic local integration test only.',
    }).expect(201);

    async function cycle(name: string, startsAt: Date, distribution: number[]) {
      // No test-only mutation of the database clock. Use sequential live intervals.
      while (Date.now() < startsAt.getTime())
        await new Promise((resolve) => setTimeout(resolve, 1));
      const draft = await db.client.assessmentCycle.create({
        data: {
          name,
          organizationId,
          startsAt,
          endsAt: new Date(Date.now() + 60_000),
          assessmentGroupId: group.id,
          instrumentVersionId,
          policyVersionId,
        },
      });
      await db.client.assessmentCycle.update({
        where: { id: draft.id },
        data: { status: 'OPEN', eligibleCount: 40, revision: 2 },
      });
      const entries = distribution.flatMap((size, index) =>
        Array.from({ length: size }, () => ({ id: randomUUID(), option: choices[index]!.id })),
      );
      await db.client.assessmentInvite.createMany({
        data: Array.from({ length: 40 }, () => ({
          organizationId,
          cycleId: draft.id,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: draft.endsAt,
        })),
      });
      await db.client.assessmentResponse.createMany({
        data: entries.map(({ id }) => ({
          id,
          organizationId,
          cycleId: draft.id,
          instrumentVersionId,
        })),
      });
      await db.client.assessmentAnswer.createMany({
        data: entries.map(({ id, option }) => ({
          responseId: id,
          instrumentVersionId,
          questionId,
          optionIds: [option],
        })),
      });
      return draft.id;
    }
    async function close(id: string) {
      const closedAt = new Date();
      await db.client.assessmentCycle.update({
        where: { id },
        data: { status: 'CLOSED', closedAt, revision: 3 },
      });
      return closedAt;
    }

    const referenceCycle = await cycle(
      'ID42 previous period',
      new Date(Date.now() - 60_000),
      [5, 10, 5],
    );
    const risk = await db.client.risk.create({
      data: {
        organizationId,
        assessmentGroupId: group.id,
        factor: 'ID42 independent registry risk',
        createdById: userId,
        updatedById: userId,
      },
    });
    const action = await db.client.action.create({
      data: {
        organizationId,
        riskId: risk.id,
        sourceRiskVersion: 1,
        title: 'ID42 registered action',
        description: 'Synthetic action',
        contextSnapshot: {},
        responsibleName: 'Synthetic owner',
        dueDate: new Date(),
        expectedResult: 'Synthetic result',
        verificationCriterion: 'Synthetic criterion',
        createdById: userId,
        updatedById: userId,
      },
    });
    await db.client.actionRevision.create({
      data: {
        actionId: action.id,
        organizationId,
        version: 1,
        event: 'CREATED',
        snapshot: { status: 'PLANNED' },
        authorId: userId,
      },
    });
    const referenceClose = await close(referenceCycle);
    await db.client.action.update({
      where: { id: action.id },
      data: {
        status: 'IMPLEMENTED',
        version: 2,
        implementationNote: 'Synthetic recorded implementation',
        implementedAt: new Date(referenceClose.getTime() + 1),
      },
    });
    await db.client.actionRevision.create({
      data: {
        actionId: action.id,
        organizationId,
        version: 2,
        event: 'IMPLEMENTED',
        snapshot: { status: 'IMPLEMENTED' },
        authorId: userId,
        createdAt: new Date(referenceClose.getTime() + 1),
      },
    });
    const currentCycle = await cycle(
      'ID42 current period',
      new Date(referenceClose.getTime() + 1),
      [10, 5, 5],
    );

    const open = assessmentComparisonSchema.parse(
      (await compare(referenceCycle, currentCycle).expect(200)).body,
    );
    expect(open).toMatchObject({
      status: 'INCOMPATIBLE',
      reasons: ['OPEN_CYCLE'],
      factors: [],
      operations: null,
    });
    const currentClose = await close(currentCycle);
    const source = (
      await post(`assessment-cycles/${currentCycle}/sources`, {
        kind: 'DOCUMENT_ANALYSIS',
        context: 'Synthetic collective work organization',
        occurredOn: '2026-01-01',
        summary: 'Synthetic collective observations without identifying participants.',
      }).expect(201)
    ).body;
    const methodDraft = (
      await post('evaluation-methods', {
        name: 'ID42 synthetic technical method',
        description: 'Synthetic comparison fixture for source link checks.',
      }).expect(201)
    ).body;
    const method = (
      await api
        .put(`${path}/evaluation-method-versions/${methodDraft.id}`)
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send({
          expectedRevision: methodDraft.revision,
          title: methodDraft.title,
          description: methodDraft.description,
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
        })
        .expect(200)
    ).body;
    await post(`evaluation-method-versions/${method.id}/publish`, {
      expectedRevision: method.revision,
      approvalReference: 'Synthetic local integration test only.',
    }).expect(201);
    const linkedRisk = (
      await post('risks', {
        sectorId: sector.id,
        factor: 'ID42 linked registry risk',
        status: 'REGISTERED',
        description: 'Synthetic collective work organization.',
        exposureDescription: 'Synthetic collective exposure.',
        exposedGroupDescription: 'Synthetic team.',
        possibleHarms: 'Synthetic possible harms.',
        existingControls: 'Synthetic preventive controls.',
        sourceKind: 'TECHNICAL_RECORD',
        sourceNote: 'Synthetic record without professional or regulatory certification.',
      }).expect(201)
    ).body;
    await post(`risk-workspaces/${linkedRisk.id}/technical-evaluations`, {
      expectedVersion: linkedRisk.version,
      methodVersionId: method.id,
      probabilityKey: 'p1',
      severityKey: 's1',
      rationale: 'Synthetic collective technical rationale.',
      context: 'Synthetic working context limited to the comparison group.',
      sources: [
        { kind: 'ASSESSMENT_CYCLE', id: referenceCycle },
        { kind: 'ASSESSMENT_SOURCE', id: source.id },
      ],
    }).expect(201);
    const linkedAction = await db.client.action.create({
      data: {
        organizationId,
        riskId: linkedRisk.id,
        sourceRiskVersion: 1,
        title: 'ID42 action with recorded source',
        description: 'Synthetic action',
        contextSnapshot: {},
        responsibleName: 'Synthetic owner',
        dueDate: new Date('2027-02-01T00:00:00.000Z'),
        expectedResult: 'Synthetic result',
        verificationCriterion: 'Synthetic criterion',
        createdById: userId,
        updatedById: userId,
      },
    });
    const valid = assessmentComparisonSchema.parse(
      (
        await compare(referenceCycle, currentCycle, {
          unitId: unit.id,
          sectorId: sector.id,
        }).expect(200)
      ).body,
    );
    expect(valid).toMatchObject({
      status: 'COMPARABLE',
      scope: { groupId: group.id, unitId: unit.id, sectorId: sector.id },
      participation: {
        status: 'AVAILABLE',
        reference: 50,
        current: 50,
        difference: 0,
        direction: 'STABLE',
      },
      operations: {
        source: 'GROUP_AT_PERIOD_CLOSE',
        reference: { implemented: 0, pending: 1, unclassifiedRisks: 1 },
        current: { implemented: 1, pending: 0, withoutOpinion: 1 },
        relatedActions: expect.arrayContaining(
          [referenceCycle, currentCycle].map((cycleId) => ({
            cycleId,
            riskId: linkedRisk.id,
            riskLabel: linkedRisk.factor,
            actionId: linkedAction.id,
            actionTitle: linkedAction.title,
            dueDate: '2027-02-01',
            status: 'PLANNED',
          })),
        ),
      },
    });
    expect(valid.operations?.relatedActions).toHaveLength(2);
    expect(valid.factors.map((item) => item.trend)).toEqual([
      { status: 'AVAILABLE', reference: 25, current: 50, difference: 25, direction: 'INCREASE' },
      { status: 'AVAILABLE', reference: 50, current: 25, difference: -25, direction: 'DECREASE' },
      { status: 'AVAILABLE', reference: 25, current: 25, difference: 0, direction: 'STABLE' },
    ]);
    const protectedCycle = await cycle(
      'ID42 withheld difference',
      new Date(currentClose.getTime() + 1),
      [6, 9, 5],
    );
    await close(protectedCycle);
    const protectedResult = assessmentComparisonSchema.parse(
      (await compare(referenceCycle, protectedCycle).expect(200)).body,
    );
    expect(protectedResult.factors.map((item) => item.trend)).toEqual(
      Array(3).fill({ status: 'PROTECTED' }),
    );
    expect(protectedResult.operations).toMatchObject({
      reference: { riskLevels: [] },
      current: {
        riskLevels: [
          {
            methodVersionId: method.id,
            methodName: 'ID42 synthetic technical method',
            level: 'Synthetic class',
            total: 1,
          },
        ],
        unclassifiedRisks: 1,
      },
      relatedActions: [{ cycleId: referenceCycle, actionId: linkedAction.id }],
    });
    const reversed = assessmentComparisonSchema.parse(
      (await compare(currentCycle, referenceCycle).expect(200)).body,
    );
    expect(reversed).toMatchObject({
      status: 'INCOMPATIBLE',
      reasons: ['PERIOD_ORDER'],
      operations: null,
    });
    await compare(referenceCycle, randomUUID()).expect(404);
    await compare(referenceCycle, currentCycle, { unitId: randomUUID() }).expect(404);
    await db.client.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { isActive: false },
    });
    await compare(referenceCycle, currentCycle).expect(404);
  }, 60_000);
});
