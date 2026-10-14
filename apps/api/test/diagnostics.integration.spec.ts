import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  diagnosticCycleSchema,
  diagnosticInstrumentSchema,
  diagnosticResultsSchema,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Missing synthetic fixture');
  return item;
}
describeDatabase('Diagnostic workflow with PostgreSQL', () => {
  const environment = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(environment.DATABASE_URL);
  let app: INestApplication;
  let database: PrismaService;
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const instrumentId = randomUUID();
  const foreignInstrumentId = randomUUID();
  const adminId = randomUUID();
  const readerId = randomUUID();
  const unitId = randomUUID();
  const sectorId = randomUUID();
  const foreignSectorId = randomUUID();
  const questions = Array.from({ length: 5 }, (_, index) => ({
    id: randomUUID(),
    label: `Synthetic question ${index + 1}`,
    type: index < 3 ? ('SINGLE_CHOICE' as const) : ('MULTIPLE_CHOICE' as const),
    required: true,
    position: index + 1,
    options: [
      { id: randomUUID(), label: 'Fictitious A', position: 1 },
      { id: randomUUID(), label: 'Fictitious B', position: 2 },
    ],
  }));
  const answers = () =>
    questions.map((question) => ({
      questionId: question.id,
      optionIds: [at(question.options, 0).id],
    }));
  const adminToken = randomBytes(32).toString('base64url');
  const readerToken = randomBytes(32).toString('base64url');
  const cookie = `renr_session=${adminToken}`;
  const readerCookie = `renr_session=${readerToken}`;
  const endpoint = (cycleId?: string, suffix = '') =>
    `/api/v1/organizations/${organizationId}/diagnostic-cycles${cycleId ? `/${cycleId}` : ''}${suffix}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    database = module.get(PrismaService);
    await database.client.user.createMany({
      data: [
        {
          id: adminId,
          name: 'Synthetic admin',
          email: `${adminId}@renr.example`,
          passwordHash: 'unused',
        },
        {
          id: readerId,
          name: 'Synthetic reader',
          email: `${readerId}@renr.example`,
          passwordHash: 'unused',
        },
      ],
    });
    await database.client.organization.create({
      data: {
        id: organizationId,
        name: `Synthetic diagnostic ${organizationId}`,
        memberships: {
          create: [
            { userId: adminId, role: 'ADMIN' },
            { userId: readerId, role: 'READER' },
          ],
        },
      },
    });
    await database.client.organization.create({
      data: { id: foreignOrganizationId, name: `Synthetic foreign ${foreignOrganizationId}` },
    });
    await database.client.session.createMany({
      data: [
        {
          userId: adminId,
          tokenHash: createHash('sha256').update(adminToken).digest('hex'),
          activeOrganizationId: organizationId,
          expiresAt: new Date(Date.now() + 3600000),
        },
        {
          userId: readerId,
          tokenHash: createHash('sha256').update(readerToken).digest('hex'),
          activeOrganizationId: organizationId,
          expiresAt: new Date(Date.now() + 3600000),
        },
      ],
    });
    await database.client.unit.create({
      data: {
        id: unitId,
        organizationId,
        name: 'Synthetic unit',
        normalizedName: 'synthetic unit',
        sectors: {
          create: {
            id: sectorId,
            organizationId,
            name: 'Synthetic sector',
            normalizedName: 'synthetic sector',
          },
        },
      },
    });
    await database.client.unit.create({
      data: {
        organizationId: foreignOrganizationId,
        name: 'Foreign unit',
        normalizedName: 'foreign unit',
        sectors: {
          create: {
            id: foreignSectorId,
            organizationId: foreignOrganizationId,
            name: 'Foreign sector',
            normalizedName: 'foreign sector',
          },
        },
      },
    });
    await database.client.instrumentVersion.create({
      data: {
        id: instrumentId,
        organizationId,
        title: 'Synthetic demo instrument',
        version: 1,
        questions: {
          create: questions.map((question) => ({
            ...question,
            options: { create: question.options },
          })),
        },
      },
    });
    await database.client.instrumentVersion.create({
      data: {
        id: foreignInstrumentId,
        organizationId: foreignOrganizationId,
        title: 'Foreign demo',
        version: 1,
      },
    });
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  afterAll(async () => {
    if (!database) return;
    const organizations = [organizationId, foreignOrganizationId];
    const versions = [instrumentId, foreignInstrumentId];
    await database.client.responseAnswer.deleteMany({
      where: { response: { organizationId: { in: organizations } } },
    });
    await database.client.diagnosticResponse.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.participationInvite.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.cycleGroup.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.diagnosticCycle.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.assessmentGroup.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.questionOption.deleteMany({
      where: { instrumentVersionId: { in: versions } },
    });
    await database.client.diagnosticQuestion.deleteMany({
      where: { instrumentVersionId: { in: versions } },
    });
    await database.client.instrumentVersion.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.sector.deleteMany({ where: { organizationId: { in: organizations } } });
    await database.client.unit.deleteMany({ where: { organizationId: { in: organizations } } });
    await database.client.auditEvent.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await database.client.organization.deleteMany({ where: { id: { in: organizations } } });
    await database.client.user.deleteMany({ where: { id: { in: [adminId, readerId] } } });
    if (app) await app.close();
    else await database.client.$disconnect();
  });
  const createCycle = async () => {
    const response = await request(app.getHttpServer())
      .post(endpoint())
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({
        name: 'Synthetic collection',
        sectorId,
        instrumentVersionId: instrumentId,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      })
      .expect(201);
    expect(diagnosticCycleSchema.safeParse(response.body).success).toBe(true);
    return diagnosticCycleSchema.parse(response.body).id;
  };
  const transition = (id: string, action: 'open' | 'close') =>
    request(app.getHttpServer())
      .post(endpoint(id, `/${action}`))
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN);
  const issue = async (id: string, count = 1): Promise<string[]> => {
    const response = await request(app.getHttpServer())
      .post(endpoint(id, '/participation-invites'))
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ count })
      .expect(201);
    return response.body.invites.map((invite: { code: string }) => invite.code);
  };
  const submit = (
    code: string | undefined,
    responseAnswers = answers(),
    version = instrumentId,
  ) => {
    if (code === undefined) throw new Error('Missing synthetic invitation');
    return request(app.getHttpServer())
      .post('/api/v1/participation/responses')
      .send({ inviteCode: code, instrumentVersionId: version, answers: responseAnswers });
  };
  const results = (id: string) =>
    request(app.getHttpServer()).get(endpoint(id, '/results')).set('Cookie', readerCookie);

  it('publishes the fixed demo instrument and scopes reads and writes to the active tenant', async () => {
    const instrument = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/diagnostic-instrument`)
      .set('Cookie', readerCookie)
      .expect(200);
    expect(diagnosticInstrumentSchema.safeParse(instrument.body).success).toBe(true);
    expect(
      instrument.body.questions.filter(
        (question: { type: string }) => question.type === 'SINGLE_CHOICE',
      ),
    ).toHaveLength(3);
    const id = await createCycle();
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignOrganizationId}/diagnostic-cycles/${id}`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer())
      .post(endpoint(id, '/open'))
      .set('Cookie', readerCookie)
      .set('Origin', environment.CORS_ORIGIN)
      .expect(403);
    await request(app.getHttpServer())
      .post(endpoint(id, '/open'))
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    await request(app.getHttpServer())
      .get(endpoint(randomUUID()))
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({
        name: 'Invalid',
        sectorId: foreignSectorId,
        instrumentVersionId: instrumentId,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 60000).toISOString(),
      })
      .expect(404);
  });
  it('allows a single accepted submission when two requests race with the same code', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    const stored = await database.client.participationInvite.findFirstOrThrow({
      where: { cycleId: id },
    });
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toContain(at([code], 0));
    const responses = await Promise.all([submit(code), submit(code)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe(
      'INVITE_UNAVAILABLE',
    );
    expect(await database.client.diagnosticResponse.count({ where: { cycleId: id } })).toBe(1);
    expect(
      await database.client.responseAnswer.count({ where: { response: { cycleId: id } } }),
    ).toBe(5);
  });
  it('rejects incomplete, unknown, duplicate, wrong-kind and foreign-version answers without consuming a code', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    const incomplete = await submit(code, answers().slice(1)).expect(400);
    expect(incomplete.body.details).toEqual([
      {
        field: `answers.${at(questions, 0).id}.optionIds`,
        message: 'Responda esta pergunta obrigatória.',
      },
    ]);
    await submit(code, answers(), foreignInstrumentId).expect(400);
    const unknown = answers();
    at(unknown, 0).optionIds = [randomUUID()];
    const unknownOption = await submit(code, unknown).expect(400);
    expect(unknownOption.body.details).toEqual([
      {
        field: `answers.${at(questions, 0).id}.optionIds`,
        message: 'Selecione apenas opções desta pergunta.',
      },
    ]);
    const wrongKind = answers();
    at(wrongKind, 0).optionIds.push(at(at(questions, 0).options, 1).id);
    const multipleForSingle = await submit(code, wrongKind).expect(400);
    expect(multipleForSingle.body.details).toEqual([
      {
        field: `answers.${at(questions, 0).id}.optionIds`,
        message: 'Selecione exatamente uma opção.',
      },
    ]);
    const duplicates = answers();
    at(duplicates, 0).optionIds.push(at(at(duplicates, 0).optionIds, 0));
    await submit(code, duplicates).expect(400);
    await submit(code, [at(answers(), 0), at(answers(), 0), ...answers().slice(2)]).expect(400);
    await submit(code).expect(201);
  });
  it('enforces active structures and the one-way cycle lifecycle', async () => {
    const id = await createCycle();
    await request(app.getHttpServer())
      .post(endpoint(id, '/participation-invites'))
      .set('Cookie', cookie)
      .set('Origin', environment.CORS_ORIGIN)
      .send({})
      .expect(409);
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    await database.client.sector.update({ where: { id: sectorId }, data: { isActive: false } });
    try {
      await submit(code).expect(409);
    } finally {
      await database.client.sector.update({ where: { id: sectorId }, data: { isActive: true } });
    }
    await submit(code).expect(201);
    await transition(id, 'close').expect(201);
    await transition(id, 'open').expect(409);
    await transition(id, 'close').expect(409);
  });
  it('treats expired and revoked invites as the same generic conflict', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const codes = await issue(id, 2);
    await database.client.participationInvite.update({
      where: { tokenHash: createHash('sha256').update(at(codes, 0)).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await database.client.participationInvite.update({
      where: { tokenHash: createHash('sha256').update(at(codes, 1)).digest('hex') },
      data: { revokedAt: new Date() },
    });
    for (const code of codes) {
      const response = await submit(code).expect(409);
      expect(response.body.code).toBe('INVITE_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain(code);
    }
    expect(await database.client.diagnosticResponse.count({ where: { cycleId: id } })).toBe(0);
  });
  it('rejects opening outside the period and collection after its end', async () => {
    const id = await createCycle();
    await database.client.diagnosticCycle.update({
      where: { id },
      data: { startsAt: new Date(Date.now() + 60000) },
    });
    await transition(id, 'open').expect(409);
    await database.client.diagnosticCycle.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60000) },
    });
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    await database.client.diagnosticCycle.update({
      where: { id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    await submit(code).expect(409);
    expect(await database.client.diagnosticResponse.count({ where: { cycleId: id } })).toBe(0);
  });
  it('accepts multiple selections and persists only a date without participant links', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    const multiple = answers();
    at(multiple, 3).optionIds.push(at(at(questions, 3).options, 1).id);
    await submit(code, multiple).expect(201);
    const response = await database.client.diagnosticResponse.findFirstOrThrow({
      where: { cycleId: id },
      include: { answers: true },
    });
    expect(response.submittedPeriod.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(response).not.toHaveProperty('participantId');
    expect(response).not.toHaveProperty('inviteId');
    expect(response).not.toHaveProperty('createdAt');
    expect(
      response.answers.find((answer) => answer.questionId === at(questions, 3).id)?.optionIds,
    ).toHaveLength(2);
  });
  it('rolls back invitation consumption when response insertion fails', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    await database.client.$executeRawUnsafe(
      "CREATE FUNCTION diagnostic_test_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert failure'; END $$",
    );
    // The trigger is limited to this synthetic cycle and removed even if assertions fail.
    await database.client.$executeRawUnsafe(
      `CREATE TRIGGER diagnostic_test_insert_failure BEFORE INSERT ON diagnostic_responses FOR EACH ROW WHEN (NEW.cycle_id = '${id}'::uuid) EXECUTE FUNCTION diagnostic_test_insert_failure()`,
    );
    try {
      await submit(code).expect(500);
    } finally {
      await database.client.$executeRawUnsafe(
        'DROP TRIGGER diagnostic_test_insert_failure ON diagnostic_responses',
      );
      await database.client.$executeRawUnsafe('DROP FUNCTION diagnostic_test_insert_failure()');
    }
    const invite = await database.client.participationInvite.findUniqueOrThrow({
      where: {
        tokenHash: createHash('sha256')
          .update(at([code], 0) ?? '')
          .digest('hex'),
      },
    });
    expect(invite.consumedAt).toBeNull();
    expect(await database.client.diagnosticResponse.count({ where: { cycleId: id } })).toBe(0);
    await submit(code).expect(201);
  });
  it('keeps aggregate results hidden until closure and suppresses a small positive bucket', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const codes = await issue(id, 6);
    for (const code of codes.slice(0, 5)) await submit(code).expect(201);
    const open = await results(id).expect(200);
    expect(open.body).toMatchObject({
      availability: 'CYCLE_OPEN',
      responseCount: null,
      questions: [],
    });
    const different = answers();
    at(different, 0).optionIds = [at(at(questions, 0).options, 1).id];
    await submit(codes[5], different).expect(201);
    await transition(id, 'close').expect(201);
    const response = await results(id).expect(200);
    expect(diagnosticResultsSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ availability: 'AVAILABLE', responseCount: 6 });
    expect(response.body.questions[0]).toMatchObject({ suppressed: true, options: [] });
    expect(response.body.questions[1].options).toMatchObject([
      { count: 6, percentage: 100 },
      { count: 0, percentage: 0 },
    ]);
    await request(app.getHttpServer())
      .get(endpoint(id, '/results?sectorId=anything'))
      .set('Cookie', cookie)
      .expect(400);
  });
  it('hides totals in a closed cycle below the minimum', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    await submit(code).expect(201);
    await transition(id, 'close').expect(201);
    const response = await results(id).expect(200);
    expect(response.body).toMatchObject({
      availability: 'INSUFFICIENT_RESPONSES',
      responseCount: null,
      questions: [],
    });
  });
  it('serializes closure against collection and rejects submissions after closing', async () => {
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const codes = await issue(id, 2);
    const [submission, closure] = await Promise.all([submit(codes[0]), transition(id, 'close')]);
    expect(closure.status).toBe(201);
    expect([201, 409]).toContain(submission.status);
    await submit(codes[1]).expect(409);
    expect(await database.client.diagnosticResponse.count({ where: { cycleId: id } })).toBe(
      submission.status === 201 ? 1 : 0,
    );
  });
  it('rejects cross-tenant and cross-version links through database constraints', async () => {
    await expect(
      database.client.assessmentGroup.create({
        data: { organizationId, sectorId: foreignSectorId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      database.client.diagnosticCycle.create({
        data: {
          organizationId,
          instrumentVersionId: foreignInstrumentId,
          name: 'Invalid FK',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 60000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const id = await createCycle();
    await transition(id, 'open').expect(201);
    const [code] = await issue(id);
    await submit(code).expect(201);
    const response = await database.client.diagnosticResponse.findFirstOrThrow({
      where: { cycleId: id },
    });
    await expect(
      database.client.responseAnswer.create({
        data: {
          responseId: response.id,
          instrumentVersionId: foreignInstrumentId,
          questionId: randomUUID(),
          optionIds: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
