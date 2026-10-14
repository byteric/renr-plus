import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Diagnostic participation HTTP', () => {
  let app: INestApplication;
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({ client: { participationInvite: { findUnique: async () => null } } })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  afterAll(async () => app.close());
  it('rejects malformed body codes before accessing persistence', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/participation/instrument')
      .send({ inviteCode: 'invalid' })
      .expect(400);
  });
  it('returns a generic unavailable conflict for unknown codes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/participation/instrument')
      .send({ inviteCode: 'a'.repeat(43) })
      .expect(409);
    expect(response.body.code).toBe('INVITE_UNAVAILABLE');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('a'.repeat(43));
  });
  it('rejects invite codes in query strings even when a body is supplied', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/participation/instrument?inviteCode=synthetic')
      .send({ inviteCode: 'a'.repeat(43) })
      .expect(400);
  });
  it('documents body-only participation codes and closed answer options in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const instrument = response.body.paths['/api/v1/participation/instrument'].post;
    expect(instrument.tags).toContain('Diagnostics');
    expect(instrument.requestBody?.content['application/json'].schema).toMatchObject({
      required: ['inviteCode'],
      properties: { inviteCode: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
    });
    const submission = response.body.paths['/api/v1/participation/responses'].post;
    expect(submission.requestBody?.content['application/json'].schema).toMatchObject({
      required: ['inviteCode', 'instrumentVersionId', 'answers'],
      properties: {
        answers: {
          type: 'array',
          items: { properties: { optionIds: { type: 'array', uniqueItems: true } } },
        },
      },
    });
  });
});

describe('Diagnostic aggregate privacy HTTP', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const questionId = '33333333-3333-4333-8333-333333333333';
  const optionId = '44444444-4444-4444-8444-444444444444';
  const otherOptionId = '55555555-5555-4555-8555-555555555555';
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
  });
  const count = jest.fn();
  const buckets = jest.fn();
  const cycle = {
    id,
    organizationId,
    status: 'CLOSED',
    instrumentVersion: {
      questions: [
        {
          id: questionId,
          label: 'Fictitious question',
          type: 'SINGLE_CHOICE',
          options: [
            { id: optionId, label: 'A' },
            { id: otherOptionId, label: 'B' },
          ],
        },
      ],
    },
  };
  const client = {
    session: {
      findUnique: async () => ({
        userId: id,
        activeOrganizationId: organizationId,
        expiresAt: new Date(Date.now() + 60000),
        user: { memberships: [{ organizationId, role: 'READER' }] },
      }),
    },
    diagnosticCycle: { findFirst: async () => cycle },
    diagnosticResponse: { count },
    $queryRaw: buckets,
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(client),
  };
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({ client })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  afterAll(async () => app.close());
  const getResults = () =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/diagnostic-cycles/${id}/results`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`);
  it('hides counts and distributions below five responses', async () => {
    count.mockResolvedValue(4);
    buckets.mockResolvedValue([]);
    const response = await getResults().expect(200);
    expect(response.body).toEqual({
      cycleId: id,
      availability: 'INSUFFICIENT_RESPONSES',
      responseCount: null,
      minimumResponses: 5,
      questions: [],
    });
  });
  it('suppresses the entire question if any positive bucket is smaller than five', async () => {
    count.mockResolvedValue(6);
    buckets.mockResolvedValue([
      { questionId, optionId, count: 5n },
      { questionId, optionId: otherOptionId, count: 1n },
    ]);
    const response = await getResults().expect(200);
    expect(response.body.questions[0]).toMatchObject({
      id: questionId,
      suppressed: true,
      options: [],
    });
  });
  it('allows zero buckets alongside safe buckets', async () => {
    count.mockResolvedValue(5);
    buckets.mockResolvedValue([{ questionId, optionId, count: 5n }]);
    const response = await getResults().expect(200);
    expect(response.body.questions[0]).toMatchObject({
      suppressed: false,
      options: [
        { id: optionId, count: 5, percentage: 100 },
        { id: otherOptionId, count: 0, percentage: 0 },
      ],
    });
  });
  it('rejects writes by readers before touching cycle state', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/diagnostic-cycles/${id}/open`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .set('Origin', environment.CORS_ORIGIN)
      .expect(403);
  });
});
