import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import {
  assessmentParticipationSchema,
  assessmentResultsSchema,
  assessmentConsolidationSchema,
  apiErrorSchema,
} from '@renr/contracts';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Assessment HTTP contract', () => {
  let env: ReturnType<typeof parseEnvironment>;
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let user: string;
  let group: string;
  let cookie: string;
  let instrument: string;
  let question: string;
  let option: string;
  const path = (route: string) => `/api/v1/organizations/${org}/${route}`;
  const post = (route: string, body: object) =>
    request(app.getHttpServer())
      .post(path(route))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const get = (route: string) =>
    request(app.getHttpServer()).get(path(route)).set('Cookie', cookie);
  const publicPost = (route: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1/assessment-participation/${route}`).send(body);
  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    org = (await db.client.organization.create({ data: { name: 'Assessment HTTP synthetic' } })).id;
    user = (
      await db.client.user.create({
        data: {
          name: 'Assessment author',
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      })
    ).id;
    await db.client.membership.create({
      data: {
        organizationId: org,
        userId: user,
        role: 'ADMIN',
        capabilities: ['TECHNICAL_DECISIONS'],
      },
    });
    const token = randomUUID().replaceAll('-', '') + 'a'.repeat(11);
    cookie = `renr_session=${token}`;
    await db.client.session.create({
      data: {
        userId: user,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        activeOrganizationId: org,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const unit = await db.client.unit.create({
      data: { organizationId: org, name: 'Synthetic unit', normalizedName: 'synthetic unit' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic sector',
      },
    });
    group = (
      await db.client.assessmentGroup.create({ data: { organizationId: org, sectorId: sector.id } })
    ).id;
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => {
    if (db && org) {
      await db.client.session.deleteMany({ where: { userId: user } });
      await db.client.membership.updateMany({
        where: { organizationId: org },
        data: { isActive: false },
      });
      await db.client.organization.updateMany({
        where: { id: org, name: 'Assessment HTTP synthetic' },
        data: { isActive: false },
      });
    }
    await app?.close();
  });
  it('exposes participation validation through the live HTTP application', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await publicPost('access', {}).expect(400);
  });
  it('enforces origin, active organization, ADMIN edits and explicit technical REAL publication', async () => {
    await request(app.getHttpServer()).get(path('assessment-cycles')).expect(401);
    await request(app.getHttpServer())
      .post(path('consolidation-policies'))
      .set('Cookie', cookie)
      .send({ usageMode: 'REAL', minimumResponses: null })
      .expect(403);
    const foreign = (
      await db.client.organization.create({ data: { name: 'Assessment foreign synthetic' } })
    ).id;
    try {
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${foreign}/assessment-cycles`)
        .set('Cookie', cookie)
        .expect(404);
      const policy = (
        await post('consolidation-policies', { usageMode: 'REAL', minimumResponses: null }).expect(
          201,
        )
      ).body;
      await post(`consolidation-policies/${policy.id}/publish`, {
        expectedRevision: 1,
        approvalReference: 'Synthetic approval',
      }).expect(400);
      await request(app.getHttpServer())
        .put(path(`consolidation-policies/${policy.id}`))
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send({ usageMode: 'REAL', minimumResponses: 2, expectedRevision: 1 })
        .expect(200);
      await db.client.membership.update({
        where: { userId_organizationId: { userId: user, organizationId: org } },
        data: { capabilities: [] },
      });
      await post(`consolidation-policies/${policy.id}/publish`, {
        expectedRevision: 2,
        approvalReference: 'Synthetic approval',
      }).expect(403);
      await db.client.membership.update({
        where: { userId_organizationId: { userId: user, organizationId: org } },
        data: { role: 'READER', capabilities: ['TECHNICAL_DECISIONS'] },
      });
      await post('consolidation-policies', {
        usageMode: 'DEMONSTRATION',
        minimumResponses: 5,
      }).expect(403);
      const published = (
        await post(`consolidation-policies/${policy.id}/publish`, {
          expectedRevision: 2,
          approvalReference: 'Synthetic approval',
        }).expect(201)
      ).body;
      expect(published.status).toBe('PUBLISHED');
      await db.client.membership.update({
        where: { userId_organizationId: { userId: user, organizationId: org } },
        data: { role: 'ADMIN' },
      });
      await request(app.getHttpServer())
        .put(path(`consolidation-policies/${policy.id}`))
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send({ usageMode: 'REAL', minimumResponses: 3, expectedRevision: 3 })
        .expect(409);
      const fork = (
        await post(`consolidation-policies/${policy.id}/fork`, { expectedRevision: 3 }).expect(201)
      ).body;
      expect(fork).toMatchObject({
        status: 'DRAFT',
        approvalReference: null,
        publishedAt: null,
        publishedById: null,
        minimumResponses: 2,
      });
    } finally {
      await db.client.membership.update({
        where: { userId_organizationId: { userId: user, organizationId: org } },
        data: { role: 'ADMIN', capabilities: ['TECHNICAL_DECISIONS'] },
      });
      await db.client.organization.delete({ where: { id: foreign } });
    }
  });
  it('runs immutable collection, incomplete invitation, anonymous replay, sources and both projections', async () => {
    const created = (await post('instruments', { name: 'Assessment instrument' }).expect(201)).body;
    instrument = created.version.id;
    question = randomUUID();
    option = randomUUID();
    const versionPath = `instruments/${created.instrument.id}/versions/${instrument}`;
    const foreignOption = randomUUID();
    await request(app.getHttpServer())
      .put(path(versionPath))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        expectedRevision: 1,
        title: 'Assessment instrument',
        description: '',
        instructions: '',
        usageMode: 'DEMONSTRATION',
        questions: [
          {
            id: question,
            label: 'Collective question',
            type: 'ORDINAL_CHOICE',
            required: true,
            position: 1,
            options: [
              { id: option, label: 'Option one', position: 1 },
              { id: randomUUID(), label: 'Option two', position: 2 },
            ],
          },
          {
            id: randomUUID(),
            label: 'Optional collective question',
            type: 'MULTIPLE_CHOICE',
            required: false,
            position: 2,
            options: [
              { id: foreignOption, label: 'Other question option', position: 1 },
              { id: randomUUID(), label: 'Other question alternative', position: 2 },
            ],
          },
        ],
      })
      .expect(200);
    await post(`${versionPath}/publish`, { expectedRevision: 2 }).expect(201);
    const policy = (
      await post('consolidation-policies', {
        usageMode: 'DEMONSTRATION',
        minimumResponses: 5,
      }).expect(201)
    ).body;
    const published = (
      await post(`consolidation-policies/${policy.id}/publish`, { expectedRevision: 1 }).expect(201)
    ).body;
    expect(published.minimumResponses).toBe(5);
    const draft = {
      name: 'Synthetic collection',
      assessmentGroupId: group,
      instrumentVersionId: instrument,
      policyVersionId: policy.id,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const cycle = (await post('assessment-cycles', draft).expect(201)).body;
    await post(`assessment-cycles/${cycle.id}/open`, { expectedRevision: 2 }).expect(409);
    await post(`assessment-cycles/${cycle.id}/open`, { expectedRevision: 1 }).expect(201);
    const invitations = (
      await post(`assessment-cycles/${cycle.id}/invites`, { count: 1 }).expect(201)
    ).body;
    expect(invitations.participationPath).toBe('/#/responder');
    const inviteCode = invitations.invites[0].code;
    const access = (await publicPost('access', { inviteCode }).expect(201)).body;
    expect(assessmentParticipationSchema.safeParse(access).success).toBe(true);
    expect(access.instrument.questions[0].type).toBe('ORDINAL_CHOICE');
    expect(access.organizationId).toBeUndefined();
    const payload = {
      inviteCode,
      instrumentVersionId: instrument,
      submissionSecret: 's'.repeat(43),
      answers: [{ questionId: question, optionIds: [option] }],
    };
    await publicPost('submissions', { ...payload, answers: [] }).expect(400);
    await publicPost('submissions', {
      ...payload,
      answers: [{ questionId: question, optionIds: [foreignOption] }],
    }).expect(400);
    await publicPost('submissions', {
      ...payload,
      answers: [{ questionId: question, optionIds: [randomUUID()] }],
    }).expect(400);
    await publicPost('submissions', { ...payload, instrumentVersionId: randomUUID() }).expect(400);
    await publicPost('submissions', {
      ...payload,
      answers: [...payload.answers, ...payload.answers],
    }).expect(400);
    expect(await db.client.assessmentResponse.count({ where: { cycleId: cycle.id } })).toBe(0);
    expect(
      (
        await db.client.assessmentInvite.findUniqueOrThrow({
          where: { tokenHash: createHash('sha256').update(inviteCode).digest('hex') },
        })
      ).consumedAt,
    ).toBeNull();
    expect(
      await db.client.assessmentSubmissionReceipt.count({
        where: { inviteHash: createHash('sha256').update(inviteCode).digest('hex') },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .put(path(`assessment-cycles/${cycle.id}`))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ ...draft, name: 'Changed frozen collection', expectedRevision: 2 })
      .expect(409);
    const collecting = (await get(`assessment-cycles/${cycle.id}/results`).expect(200)).body;
    expect(collecting.node).toMatchObject({ availability: 'COLLECTING', responseCount: null });
    const accepted = await Promise.all([
      publicPost('submissions', payload),
      publicPost('submissions', payload),
    ]);
    expect(accepted.map((v) => v.status)).toEqual([201, 201]);
    expect(await db.client.assessmentResponse.count({ where: { cycleId: cycle.id } })).toBe(1);
    expect(
      await db.client.assessmentSubmissionReceipt.count({
        where: { inviteHash: createHash('sha256').update(inviteCode).digest('hex') },
      }),
    ).toBe(1);
    await publicPost('submissions', {
      ...payload,
      answers: [{ questionId: question, optionIds: [] }],
    }).expect(409);
    await publicPost('submissions', { ...payload, submissionSecret: 'z'.repeat(43) }).expect(409);
    await post(`assessment-cycles/${cycle.id}/close`, { expectedRevision: 2 }).expect(201);
    await publicPost('submissions', payload).expect(201);
    const results = (await get(`assessment-cycles/${cycle.id}/results`).expect(200)).body;
    expect(assessmentResultsSchema.safeParse(results).success).toBe(true);
    expect(results.node.availability).toBe('SUPPRESSED');
    expect(results.node.responseCount).toBeNull();
    const consolidated = (
      await get(
        `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}`,
      ).expect(200)
    ).body;
    expect(assessmentConsolidationSchema.safeParse(consolidated).success).toBe(true);
    expect(consolidated.node.availability).toBe('SUPPRESSED');
    expect(consolidated.node.responseCount).toBeNull();
    const source = (
      await post(`assessment-cycles/${cycle.id}/sources`, {
        kind: 'OBSERVATION',
        context: 'Collective workshop',
        occurredOn: '2026-01-01',
        summary: 'Collective context only',
      }).expect(201)
    ).body;
    expect(source.createdBy).toEqual({ id: user, name: 'Assessment author' });
    await post(`assessment-cycles/${cycle.id}/sources`, {
      kind: 'OBSERVATION',
      context: 'Collective',
      occurredOn: '2026-02-30',
      summary: 'Invalid civil date',
    }).expect(400);
    await post(`assessment-cycles/${cycle.id}/sources`, {
      kind: 'OBSERVATION',
      context: 'Collective',
      occurredOn: '2026-01-01',
      summary: 'Collective source',
      createdById: randomUUID(),
    }).expect(400);
    await post(`assessment-cycles/${cycle.id}/sources`, {
      kind: 'OBSERVATION',
      context: 'Collective',
      occurredOn: '2099-01-01',
      summary: 'Future source',
    }).expect(400);
    expect((await get(versionPath).expect(200)).body.cycleCount).toBe(1);
    const safe = (
      await post('assessment-cycles', { ...draft, name: 'Sufficient closed collection' }).expect(
        201,
      )
    ).body;
    await post(`assessment-cycles/${safe.id}/open`, { expectedRevision: 1 }).expect(201);
    const batch = (await post(`assessment-cycles/${safe.id}/invites`, { count: 10 }).expect(201))
      .body;
    for (const invitation of batch.invites)
      await publicPost('submissions', { ...payload, inviteCode: invitation.code }).expect(201);
    await post(`assessment-cycles/${safe.id}/close`, { expectedRevision: 2 }).expect(201);
    const safeResult = (await get(`assessment-cycles/${safe.id}/results`).expect(200)).body;
    expect(safeResult.node).toMatchObject({ availability: 'AVAILABLE', responseCount: 10 });
    expect(safeResult.node.questions[0]).toMatchObject({
      availability: 'AVAILABLE',
      answerCount: 10,
    });
    const family = (
      await get(
        `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}`,
      ).expect(200)
    ).body;
    expect(family.node).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
    await get(
      `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}&cycleId=${safe.id}`,
    ).expect(400);
  });
  it('returns private errors and rate limits public participation attempts', async () => {
    const invalid = await publicPost('access', {}).expect(400);
    expect(apiErrorSchema.safeParse(invalid.body).success).toBe(true);
    expect(invalid.headers['cache-control']).toContain('no-store');
    let limited = false;
    for (let attempt = 0; attempt < 65; attempt++) {
      const response = await publicPost('access', {});
      if (response.status === 429) {
        expect(response.headers['cache-control']).toContain('no-store');
        expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
        limited = true;
        break;
      }
      expect(response.status).toBe(400);
    }
    expect(limited).toBe(true);
  });
});
