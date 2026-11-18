import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import type { Prisma } from '../src/generated/prisma/client';
import { localDatabaseUrl } from './local-database-url';
import {
  assessmentParticipationSchema,
  assessmentResultsSchema,
  assessmentConsolidationSchema,
  apiErrorSchema,
  reportSnapshotSchema,
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
  const get = (route: string, session = cookie) =>
    request(app.getHttpServer()).get(path(route)).set('Cookie', session);
  const publicPost = (route: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1/assessment-participation/${route}`).send(body);
  async function whileDatabaseLock<T>(
    prepare: (tx: Prisma.TransactionClient) => Promise<unknown>,
    action: () => PromiseLike<T>,
    whileBlocked?: () => PromiseLike<unknown>,
  ) {
    let signalLocked!: (pid: number) => void;
    let releaseLock!: () => void;
    const locked = new Promise<number>((resolve) => {
      signalLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locker = db.client.$transaction(async (tx) => {
      const [owner] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await prepare(tx);
      signalLocked(owner!.pid);
      await release;
    });
    const lockPid = await Promise.race([locked, locker.then(() => 0)]);
    const pending = Promise.resolve(action());
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
        const [result] = await db.client.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${lockPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = result!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await whileBlocked?.();
    } finally {
      releaseLock();
      await locker;
    }
    return pending;
  }
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
      await db.client.session.deleteMany({ where: { activeOrganizationId: org } });
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
      const foreignUnit = await db.client.unit.create({
        data: { organizationId: foreign, name: 'Foreign office', normalizedName: 'foreign office' },
      });
      const foreignSector = await db.client.sector.create({
        data: {
          organizationId: foreign,
          unitId: foreignUnit.id,
          name: 'Foreign team',
          normalizedName: 'foreign team',
        },
      });
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${foreign}/assessment-cycles`)
        .set('Cookie', cookie)
        .expect(404);
      await get(`assessment-cycles?unitId=${foreignUnit.id}`).expect(404);
      await get(`assessment-cycles?sectorId=${foreignSector.id}`).expect(404);
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
      await db.client.sector.deleteMany({ where: { organizationId: foreign } });
      await db.client.unit.deleteMany({ where: { organizationId: foreign } });
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
    const hr = await db.client.user.create({
      data: { name: 'RH sintético', email: `${randomUUID()}@example.test`, passwordHash: 'unused' },
    });
    await db.client.membership.create({
      data: {
        organizationId: org,
        userId: hr.id,
        role: 'READER',
        hrCapabilities: ['HR_ANALYTICS_READ'],
      },
    });
    const hrToken = randomUUID().replaceAll('-', '') + 'b'.repeat(11);
    const hrCookie = `renr_session=${hrToken}`;
    await db.client.session.create({
      data: {
        userId: hr.id,
        tokenHash: createHash('sha256').update(hrToken).digest('hex'),
        activeOrganizationId: org,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const issueAsHr = (organizationId: string, cycleId: string, origin = env.CORS_ORIGIN) =>
      request(app.getHttpServer())
        .post(`/api/v1/organizations/${organizationId}/assessment-cycles/${cycleId}/invites`)
        .set('Cookie', hrCookie)
        .set('Origin', origin)
        .send({ count: 1 });
    const setHrGrants = (capabilities: string[], expectedVersion: number) =>
      request(app.getHttpServer())
        .put(path(`access-memberships/${hr.id}/capabilities`))
        .set('Cookie', cookie)
        .set('Origin', env.CORS_ORIGIN)
        .send({ capabilities, expectedVersion, reason: 'Synthetic invitation authorization' });
    await issueAsHr(org, cycle.id).expect(403);
    const hrGrant = (
      await setHrGrants(['HR_ANALYTICS_READ', 'HR_ASSESSMENT_INVITES_ISSUE'], 1).expect(200)
    ).body;
    await issueAsHr(org, cycle.id, 'https://foreign.example.test').expect(403);
    await issueAsHr(randomUUID(), cycle.id).expect(404);
    await issueAsHr(org, randomUUID()).expect(404);
    const issuedByHr = (await issueAsHr(org, cycle.id).expect(201)).body;
    expect(issuedByHr.invites).toHaveLength(1);
    await publicPost('access', { inviteCode: issuedByHr.invites[0].code }).expect(201);
    await request(app.getHttpServer())
      .post(path(`assessment-cycles/${cycle.id}/close`))
      .set('Cookie', hrCookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ expectedRevision: 2 })
      .expect(403);
    const pendingIssue = await whileDatabaseLock(
      (tx) =>
        tx.$queryRaw`SELECT id FROM assessment_cycles WHERE id = ${cycle.id}::uuid FOR UPDATE`,
      () => issueAsHr(org, cycle.id),
      () => setHrGrants(['HR_ANALYTICS_READ'], hrGrant.version).expect(200),
    );
    expect(pendingIssue.status).toBe(403);
    await issueAsHr(org, cycle.id).expect(403);
    const invitations = (
      await post(`assessment-cycles/${cycle.id}/invites`, { count: 1 }).expect(201)
    ).body;
    expect(invitations.participationPath).toBe('/#/responder');
    const inviteCode = invitations.invites[0].code;
    const access = (await publicPost('access', { inviteCode }).expect(201)).body;
    expect(assessmentParticipationSchema.safeParse(access).success).toBe(true);
    expect(access.instrument.questions[0].type).toBe('ORDINAL_CHOICE');
    expect(access.privacy).toEqual({ minimumResponses: 5 });
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
    expect(collecting.participation).toEqual({ status: 'NOT_AVAILABLE' });
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
    expect(results.participation).toEqual({ status: 'UNKNOWN_BASE' });
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
    const roster = { organizationId: org, unitId: cycle.unitId, sectorId: cycle.sectorId };
    await db.client.employee.createMany({
      data: [
        ...Array.from({ length: 19 }, (_, i) => ({ ...roster, name: `Eligible ${i}` })),
        { ...roster, name: 'Inactive roster entry', isActive: false },
      ],
    });
    const safe = (
      await post('assessment-cycles', { ...draft, name: 'Sufficient closed collection' }).expect(
        201,
      )
    ).body;
    const opening = await whileDatabaseLock(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${org}))::text`;
        await tx.employee.create({ data: { ...roster, name: 'Roster update in progress' } });
      },
      () => post(`assessment-cycles/${safe.id}/open`, { expectedRevision: 1 }),
    );
    expect(opening.status).toBe(201);
    await db.client.employee.create({ data: { ...roster, name: 'Joined after opening' } });
    const batch = (await post(`assessment-cycles/${safe.id}/invites`, { count: 15 }).expect(201))
      .body;
    for (const invitation of batch.invites.slice(0, 10))
      await publicPost('submissions', { ...payload, inviteCode: invitation.code }).expect(201);
    const whileCollecting = (await get(`assessment-cycles/${safe.id}/results`).expect(200)).body;
    expect(whileCollecting.participation).toEqual({ status: 'NOT_AVAILABLE' });
    expect(whileCollecting.node).toMatchObject({ availability: 'COLLECTING', responseCount: null });
    await post(`assessment-cycles/${safe.id}/close`, { expectedRevision: 2 }).expect(201);
    const safeResult = (await get(`assessment-cycles/${safe.id}/results`).expect(200)).body;
    expect(safeResult.node).toMatchObject({ availability: 'AVAILABLE', responseCount: 10 });
    expect(safeResult.node.questions[0]).toMatchObject({
      availability: 'AVAILABLE',
      answerCount: 10,
    });
    expect(safeResult.participation).toEqual({
      status: 'AVAILABLE',
      eligible: 20,
      issued: 15,
      responses: 10,
      percentage: 50,
    });
    await expect(
      db.client
        .$executeRaw`UPDATE assessment_cycles SET eligible_count = 21 WHERE id = ${safe.id}::uuid`,
    ).rejects.toThrow();
    const family = (
      await get(
        `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}`,
      ).expect(200)
    ).body;
    expect(family.node).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
    expect(family.participation).toBeUndefined();
    const individualResponses = await db.client.assessmentResponse.findMany({
      where: { organizationId: org, cycleId: { in: [cycle.id, safe.id] } },
      select: { id: true, answers: { select: { id: true } } },
    });
    const individualIds = individualResponses.flatMap(({ id, answers }) => [
      id,
      ...answers.map((answer) => answer.id),
    ]);
    const readerProfiles = [
      { name: 'Manager', hrCapabilities: [] },
      { name: 'HR', hrCapabilities: ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'] },
    ] as const;
    for (const { name, hrCapabilities } of readerProfiles) {
      const reader = await db.client.user.create({
        data: {
          name: `Assessment ${name}`,
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      });
      await db.client.membership.create({
        data: {
          organizationId: org,
          userId: reader.id,
          role: 'READER',
          hrCapabilities: [...hrCapabilities],
        },
      });
      const token = randomUUID().replaceAll('-', '') + 'b'.repeat(11);
      await db.client.session.create({
        data: {
          userId: reader.id,
          activeOrganizationId: org,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const readerCookie = `renr_session=${token}`;
      for (const [route, expected] of [
        [`assessment-cycles/${cycle.id}/results`, results],
        [`assessment-cycles/${safe.id}/results`, safeResult],
      ] as const) {
        const response = await get(route, readerCookie).expect(200);
        expect(assessmentResultsSchema.parse(response.body)).toEqual(expected);
        for (const id of individualIds) expect(response.text).not.toContain(id);
      }
      const response = await get(
        `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}`,
        readerCookie,
      ).expect(200);
      const projection = assessmentConsolidationSchema.parse(response.body);
      expect(projection.node).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
      for (const id of individualIds) expect(response.text).not.toContain(id);
    }
    await get(
      `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}&cycleId=${safe.id}`,
    ).expect(400);
    const unitB = await db.client.unit.create({
      data: { organizationId: org, name: 'Branch office', normalizedName: 'branch office' },
    });
    const sectorB = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unitB.id,
        name: 'Branch team',
        normalizedName: 'branch team',
      },
    });
    const groupB = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: sectorB.id },
    });
    const otherCycle = (
      await post('assessment-cycles', { ...draft, assessmentGroupId: groupB.id }).expect(201)
    ).body;
    await post(`assessment-cycles/${otherCycle.id}/open`, { expectedRevision: 1 }).expect(201);
    await post(`assessment-cycles/${otherCycle.id}/close`, { expectedRevision: 2 }).expect(201);
    const list = (query: string) => get(`assessment-cycles?status=CLOSED&${query}`);
    const local = (await list(`unitId=${cycle.unitId}&sectorId=${cycle.sectorId}`).expect(200))
      .body;
    expect(local.total).toBe(2);
    expect(local.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([cycle.id, safe.id]),
    );
    const branch = (await list(`sectorId=${sectorB.id}`).expect(200)).body;
    expect(branch.total).toBe(1);
    expect(branch.items[0]).toMatchObject({
      id: otherCycle.id,
      unitId: unitB.id,
      sectorId: sectorB.id,
    });
    await list(`unitId=${cycle.unitId}&sectorId=${sectorB.id}`).expect(400);
    await list(`unitId=${randomUUID()}`).expect(404);

    await db.client.employee.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        organizationId: org,
        unitId: unitB.id,
        sectorId: sectorB.id,
        name: `Branch staff ${i}`,
      })),
    });
    const protectedCases = [
      { groupId: groupB.id, issued: 10, responses: 5 },
      { groupId: group, issued: 5, responses: 5 },
      { groupId: groupB.id, issued: 14, responses: 9 },
      { groupId: groupB.id, issued: 0, responses: 0 },
    ];
    for (const [index, scenario] of protectedCases.entries()) {
      const created = (
        await post('assessment-cycles', {
          ...draft,
          assessmentGroupId: scenario.groupId,
          name: `Protected collection ${index}`,
        }).expect(201)
      ).body;
      const route = `assessment-cycles/${created.id}`;
      await post(`${route}/open`, { expectedRevision: 1 }).expect(201);
      if (scenario.issued) {
        const { invites } = (await post(`${route}/invites`, { count: scenario.issued }).expect(201))
          .body;
        for (const invite of invites.slice(0, scenario.responses))
          await publicPost('submissions', { ...payload, inviteCode: invite.code }).expect(201);
      }
      await post(`${route}/close`, { expectedRevision: 2 }).expect(201);
      const response = (await get(`${route}/results`).expect(200)).body;
      expect(response.participation).toEqual({ status: 'PROTECTED' });
      expect(response.node).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
      expect(response.node.questions[0]).toMatchObject({ answerCount: null, options: [] });
      const selectedUnit = (
        await get(
          `assessment-consolidation?instrumentVersionId=${instrument}&policyVersionId=${policy.id}&unitId=${created.unitId}`,
        ).expect(200)
      ).body;
      expect(selectedUnit.node).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
      expect(selectedUnit.participation).toBeUndefined();
      const selectedCycle = selectedUnit.node.children
        .flatMap((groupNode: { children: object[] }) => groupNode.children)
        .find((cycleNode: { id: string }) => cycleNode.id === created.id);
      expect(selectedCycle).toMatchObject({ availability: 'SUPPRESSED', responseCount: null });
      expect((await get(`${route}/results`).expect(200)).body).toEqual(response);
      if (index === 0) {
        const [journey, report] = await Promise.all([
          get('journey').expect(200),
          post('reports', {
            kind: 'SST',
            unitId: created.unitId,
            sectionKeys: ['diagnostics', 'diagnostic-questions'],
          }).expect(201),
        ]);
        const sections = reportSnapshotSchema.parse(report.body).sections;
        expect({
          journey: journey.body.result,
          summary: sections
            .find(({ key }) => key === 'diagnostics')
            ?.rows.find(([name]) => name === created.name),
          distribution: sections
            .find(({ key }) => key === 'diagnostic-questions')
            ?.rows.find(
              ([name, label]) => name === created.name && label === 'Collective question',
            ),
        }).toEqual({
          journey: 'PROTECTED',
          summary: [created.name, 'CLOSED', 'Indisponível / protegido'],
          distribution: [created.name, 'Collective question', 'Indisponível / protegido'],
        });
      }
    }
  }, 45_000);
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
