import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { instrumentVersionSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Instrument catalog PostgreSQL', () => {
  const env = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(env.DATABASE_URL);
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let foreign: string;
  let admin: string;
  let reader: string;
  let tech: string;
  let cookies: string[];
  const base = () => `/api/v1/organizations/${org}/instruments`;
  const get = (route = '', cookie = cookies[0]!) =>
    request(app.getHttpServer())
      .get(base() + route)
      .set('Cookie', cookie);
  const post = (route: string, body: object, cookie = cookies[0]!) =>
    request(app.getHttpServer())
      .post(base() + route)
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const put = (route: string, body: object, cookie = cookies[0]!) =>
    request(app.getHttpServer())
      .put(base() + route)
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const question = (position = 1) => ({
    id: randomUUID(),
    label: 'Question',
    type: 'ORDINAL_CHOICE' as const,
    required: false,
    position,
    options: [
      { id: randomUUID(), label: 'First', position: 1 },
      { id: randomUUID(), label: 'Second', position: 2 },
    ],
  });
  const content = (usageMode = 'DEMONSTRATION') => ({
    expectedRevision: 1,
    title: 'Synthetic instrument',
    description: '',
    instructions: '',
    usageMode,
    questions: [question()],
  });
  const create = async (name = 'Synthetic catalog') => (await post('', { name }).expect(201)).body;
  const versionPath = (created: { instrument: { id: string }; version: { id: string } }) =>
    `/${created.instrument.id}/versions/${created.version.id}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    org = (await db.client.organization.create({ data: { name: 'Instrument test organization' } }))
      .id;
    foreign = (
      await db.client.organization.create({ data: { name: 'Instrument foreign organization' } })
    ).id;
    const users = [];
    for (const [name, role, capabilities] of [
      ['Admin', 'ADMIN', []],
      ['Reader', 'READER', []],
      ['Technical reader', 'READER', ['TECHNICAL_DECISIONS']],
    ] as const) {
      const user = await db.client.user.create({
        data: { name, email: `${randomUUID()}@example.test`, passwordHash: 'unused' },
      });
      users.push(user.id);
      await db.client.membership.create({
        data: { userId: user.id, organizationId: org, role, capabilities: [...capabilities] },
      });
    }
    [admin, reader, tech] = users as [string, string, string];
    cookies = [];
    for (const userId of users) {
      const token = randomUUID().replaceAll('-', '') + 'a'.repeat(11);
      cookies.push(`renr_session=${token}`);
      await db.client.session.create({
        data: {
          tokenHash: createHash('sha256').update(token).digest('hex'),
          userId,
          activeOrganizationId: org,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    }
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => {
    if (!db) return;
    await db.client.auditEvent.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.diagnosticCycle.deleteMany({
      where: { organizationId: { in: [org, foreign] } },
    });
    await db.client.instrumentVersion.deleteMany({
      where: { organizationId: { in: [org, foreign] } },
    });
    await db.client.instrument.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.sector.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.unit.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.user.deleteMany({ where: { id: { in: [admin, reader, tech] } } });
    await db.client.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await app?.close();
  });
  it('allows readers to inspect, requires ADMIN/Origin to edit and isolates organizations', async () => {
    await get('', cookies[1]).expect(200);
    await post('', { name: 'Denied' }, cookies[1]).expect(403);
    await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookies[0]!)
      .send({ name: 'No origin' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreign}/instruments`)
      .set('Cookie', cookies[0]!)
      .expect(404);
    const catalog = await create();
    const path = versionPath(catalog);
    await put(path, content(), cookies[1]).expect(403);
    await get(`/${randomUUID()}`).expect(404);
    const foreignInstrument = await db.client.instrument.create({
      data: { organizationId: foreign, name: 'Foreign catalog' },
    });
    const foreignVersion = await db.client.instrumentVersion.create({
      data: {
        organizationId: foreign,
        instrumentId: foreignInstrument.id,
        title: '',
        version: 1,
        status: 'DRAFT',
        isDemo: false,
      },
    });
    await get(`/${foreignInstrument.id}/versions/${foreignVersion.id}`).expect(404);
    await expect(
      db.client.instrumentVersion.create({
        data: {
          organizationId: org,
          instrumentId: foreignInstrument.id,
          title: '',
          version: 2,
          status: 'DRAFT',
          isDemo: false,
        },
      }),
    ).rejects.toBeDefined();
    await get(`/${randomUUID()}/versions/${catalog.version.id}`).expect(404);
    expect((await get(`/${catalog.instrument.id}`).expect(200)).headers['cache-control']).toContain(
      'no-store',
    );
  });
  it('keeps incomplete drafts, returns publication fields and detects stale revisions', async () => {
    const catalog = await create();
    const path = versionPath(catalog);
    const failure = await post(path + '/publish', { expectedRevision: 1 }).expect(400);
    expect(failure.body.details).toEqual(
      expect.arrayContaining([
        { field: 'title', message: expect.any(String) },
        { field: 'questions', message: expect.any(String) },
      ]),
    );
    const blank = {
      expectedRevision: 1,
      title: '',
      description: '',
      instructions: '',
      usageMode: 'DEMONSTRATION',
      questions: [],
    };
    const saved = await put(path, blank).expect(200);
    expect(saved.body.revision).toBe(2);
    await put(path, blank).expect(409);
    await post(path + '/fork', { expectedRevision: 2 }).expect(409);
  });
  it('rejects question/option identities borrowed from another version or question', async () => {
    const first = await create();
    const second = await create();
    const data = content();
    await put(versionPath(first), data).expect(200);
    await put(versionPath(second), data).expect(400);
    const existing = data.questions[0]!;
    const other = question(1);
    other.options[0]!.id = existing.options[0]!.id;
    await put(versionPath(first), { ...data, expectedRevision: 2, questions: [other] }).expect(400);
    await put(versionPath(second), { ...content(), unapprovedScore: 10 }).expect(400);
  });
  it('publishes demonstration content immutably, forks fresh identities and allocates concurrent versions', async () => {
    const catalog = await create();
    const path = versionPath(catalog);
    await put(path, content()).expect(200);
    const published = (await post(path + '/publish', { expectedRevision: 2 }).expect(201)).body;
    expect(instrumentVersionSchema.parse(published)).toMatchObject({
      status: 'PUBLISHED',
      revision: 3,
      usageMode: 'DEMONSTRATION',
      approvalReference: null,
    });
    await put(path, { ...content(), expectedRevision: 3 }).expect(409);
    await post(path + '/publish', { expectedRevision: 3 }).expect(409);
    await expect(
      db.client.instrumentVersion.update({
        where: { id: published.id },
        data: { title: 'Changed' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.client.diagnosticQuestion.update({
        where: { id: published.questions[0].id },
        data: { label: 'Changed' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.client.questionOption.update({
        where: { id: published.questions[0].options[0].id },
        data: { label: 'Changed' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.client.questionOption.delete({ where: { id: published.questions[0].options[0].id } }),
    ).rejects.toBeDefined();
    await expect(
      db.client.diagnosticQuestion.create({
        data: {
          id: randomUUID(),
          instrumentVersionId: published.id,
          label: 'Late insert',
          type: 'SINGLE_CHOICE',
          required: true,
          position: 2,
        },
      }),
    ).rejects.toBeDefined();
    const forks = await Promise.all([
      post(path + '/fork', { expectedRevision: 3 }),
      post(path + '/fork', { expectedRevision: 3 }),
    ]);
    expect(forks.map((item) => item.status)).toEqual([201, 201]);
    expect(forks.map((item) => item.body.version).sort()).toEqual([2, 3]);
    const all = new Set(
      published.questions.flatMap((q: { id: string; options: { id: string }[] }) => [
        q.id,
        ...q.options.map((o) => o.id),
      ]),
    );
    for (const fork of forks) {
      expect(fork.body).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        approvalReference: null,
        publishedAt: null,
        publishedById: null,
      });
      for (const q of fork.body.questions) {
        expect(all.has(q.id)).toBe(false);
        for (const option of q.options) expect(all.has(option.id)).toBe(false);
      }
    }
    const list = await get(`/${catalog.instrument.id}/versions?pageSize=2`).expect(200);
    expect(list.body.items.map((item: { version: number }) => item.version)).toEqual([3, 2]);
    expect(list.body.total).toBe(3);
    const persisted = await db.client.instrumentVersion.findMany({
      where: { instrumentId: catalog.instrument.id },
      select: { isDemo: true },
    });
    expect(persisted.every((item) => !item.isDemo)).toBe(true);
  });
  it('requires explicit technical capability and approval for real use, including technical READER publication', async () => {
    const catalog = await create();
    const path = versionPath(catalog);
    await put(path, content('REAL')).expect(200);
    await post(path + '/publish', {
      expectedRevision: 2,
      approvalReference: 'Approved test reference',
    }).expect(403);
    await post(path + '/publish', { expectedRevision: 2 }, cookies[2]).expect(400);
    const published = await post(
      path + '/publish',
      { expectedRevision: 2, approvalReference: 'Approved test reference' },
      cookies[2],
    ).expect(201);
    expect(published.body).toMatchObject({
      usageMode: 'REAL',
      approvalReference: 'Approved test reference',
      publishedById: tech,
    });
    const fork = await post(path + '/fork', { expectedRevision: 3 }).expect(201);
    expect(fork.body.approvalReference).toBeNull();
    expect(fork.body.usageMode).toBe('REAL');
  });
  it.each(['utf8', 'unicode-escaped'] as const)(
    'accepts a valid maximum document encoded as %s JSON',
    async (encoding) => {
      const catalog = await create();
      const questions = Array.from({ length: 100 }, (_, i) => ({
        ...question(i + 1),
        label: '界'.repeat(400),
        options: Array.from({ length: 20 }, (_, j) => ({
          id: randomUUID(),
          label: '界'.repeat(200),
          position: j + 1,
        })),
      }));
      const body = { ...content(), questions };
      const response =
        encoding === 'utf8'
          ? await put(versionPath(catalog), body).expect(200)
          : await request(app.getHttpServer())
              .put(base() + versionPath(catalog))
              .set('Cookie', cookies[0]!)
              .set('Origin', env.CORS_ORIGIN)
              .set('Content-Type', 'application/json')
              .send(JSON.stringify(body).replaceAll('界', '\\u754c'))
              .expect(200);
      expect(response.body.questions).toHaveLength(100);
      expect(response.body.questionCount).toBe(100);
      expect(response.body.questions[0].options[0].label).toBe('界'.repeat(200));
    },
  );
  it('keeps the legacy projection pinned, allows its fork and rejects new catalogs in old cycle endpoints', async () => {
    const legacy = await db.client.instrumentVersion.create({
      data: {
        organizationId: org,
        title: 'Reserved demonstration',
        version: 1,
        questions: {
          create: Array.from({ length: 5 }, (_, i) => ({
            label: `Legacy question ${i + 1}`,
            position: i + 1,
            type: 'SINGLE_CHOICE',
            options: {
              create: [
                { label: 'Yes', position: 1 },
                { label: 'No', position: 2 },
              ],
            },
          })),
        },
      },
      include: { instrument: true, questions: { include: { options: true } } },
    });
    const oldEndpoint = `/api/v1/organizations/${org}/diagnostic-instrument`;
    const original = await request(app.getHttpServer())
      .get(oldEndpoint)
      .set('Cookie', cookies[0]!)
      .expect(200);
    expect(original.body.id).toBe(legacy.id);
    const fork = await post(`/${legacy.instrumentId}/versions/${legacy.id}/fork`, {
      expectedRevision: 1,
    }).expect(201);
    expect(fork.body).toMatchObject({ version: 2, status: 'DRAFT', approvalReference: null });
    expect(
      (await db.client.instrumentVersion.findUniqueOrThrow({ where: { id: fork.body.id } })).isDemo,
    ).toBe(false);
    const unit = await db.client.unit.create({
      data: { organizationId: org, name: 'Legacy unit', normalizedName: 'legacy unit' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Legacy sector',
        normalizedName: 'legacy sector',
      },
    });
    const incompatible = await create('New catalog for old API');
    const failure = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/diagnostic-cycles`)
      .set('Cookie', cookies[0]!)
      .set('Origin', env.CORS_ORIGIN)
      .send({
        name: 'Incompatible cycle',
        sectorId: sector.id,
        instrumentVersionId: incompatible.version.id,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      })
      .expect(400);
    expect(failure.body.details).toEqual(
      expect.arrayContaining([{ field: 'instrumentVersionId', message: expect.any(String) }]),
    );
    const cycle = await db.client.diagnosticCycle.create({
      data: {
        organizationId: org,
        instrumentVersionId: legacy.id,
        name: 'Historical legacy cycle',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
      },
    });
    await expect(
      db.client.instrumentVersion.delete({ where: { id: legacy.id } }),
    ).rejects.toBeDefined();
    expect(
      (await db.client.diagnosticCycle.findUniqueOrThrow({ where: { id: cycle.id } }))
        .instrumentVersionId,
    ).toBe(legacy.id);
    await expect(
      db.client.questionOption.create({
        data: {
          instrumentVersionId: legacy.id,
          questionId: legacy.questions[0]!.id,
          label: 'Late addition',
          position: 3,
        },
      }),
    ).rejects.toBeDefined();
    expect(
      (await request(app.getHttpServer()).get(oldEndpoint).set('Cookie', cookies[0]!).expect(200))
        .body,
    ).toEqual(original.body);
  });
  it('permits owner parent-first deletion only for an unreferenced published version', async () => {
    const catalog = await create('Owner maintenance fixture');
    const path = versionPath(catalog);
    await put(path, content()).expect(200);
    const published = await post(path + '/publish', { expectedRevision: 2 }).expect(201);
    await request(app.getHttpServer())
      .delete(base() + path)
      .set('Cookie', cookies[0]!)
      .set('Origin', env.CORS_ORIGIN)
      .expect(404);
    await db.client.instrumentVersion.delete({ where: { id: published.body.id } });
    expect(
      await db.client.diagnosticQuestion.count({
        where: { instrumentVersionId: published.body.id },
      }),
    ).toBe(0);
    expect(
      await db.client.questionOption.count({ where: { instrumentVersionId: published.body.id } }),
    ).toBe(0);
  });
  it.each(['update', 'insert'] as const)(
    'serializes publication behind an in-flight child %s transaction',
    async (operation) => {
      const catalog = await create(`Concurrent child ${operation}`);
      const path = versionPath(catalog);
      const saved = await put(path, content()).expect(200);
      const parentQuestion = saved.body.questions[0];
      let signalReady!: () => void;
      let releaseWriter!: () => void;
      let writerPid = 0;
      const ready = new Promise<void>((resolve) => {
        signalReady = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = db.client.$transaction(async (tx) => {
        writerPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
        if (operation === 'update')
          await tx.questionOption.update({
            where: { id: parentQuestion.options[0].id },
            data: { label: 'Owner edit before publication' },
          });
        else
          await tx.questionOption.create({
            data: {
              id: randomUUID(),
              instrumentVersionId: catalog.version.id,
              questionId: parentQuestion.id,
              label: 'Owner insertion before publication',
              position: 3,
            },
          });
        signalReady();
        await release;
      });
      await ready;
      let settled = false;
      const publishing = post(path + '/publish', { expectedRevision: 2 }).then((response) => {
        settled = true;
        return response;
      });
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 30 && !waiting && !settled; attempt++) {
          const result = await db.client.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          waiting = result[0]!.waiting;
          if (!waiting && !settled) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
      } finally {
        releaseWriter();
        await writer;
      }
      const published = await publishing;
      expect(published.status).toBe(201);
      expect(
        published.body.questions[0].options.some((option: { label: string }) =>
          option.label.startsWith('Owner '),
        ),
      ).toBe(true);
      await expect(
        db.client.questionOption.update({
          where: { id: parentQuestion.options[0].id },
          data: { label: 'Late change' },
        }),
      ).rejects.toBeDefined();
    },
  );
});
