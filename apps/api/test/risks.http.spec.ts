import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Risk HTTP security boundary', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const foreignId = '22222222-2222-4222-8222-222222222222';
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
  });
  let app: INestApplication;
  const client = {
    session: {
      findUnique: async () => ({
        userId: foreignId,
        activeOrganizationId: organizationId,
        expiresAt: new Date(Date.now() + 60000),
        user: { memberships: [{ organizationId, role: 'READER' }] },
      }),
    },
  };
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
  it.each(['risks', 'risk-overview', `risks/${foreignId}`, `risks/${foreignId}/evaluations`])(
    'requires session for %s and prevents caching errors',
    async (route) => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/${route}`)
        .expect(401);
      expect(response.headers['cache-control']).toBe('private, no-store');
    },
  );
  it('rejects reader writes', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/risks`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .set('Origin', environment.CORS_ORIGIN)
      .send({ sectorId: foreignId, factor: 'Fator' })
      .expect(403);
  });
  it('rejects an incorrect origin before writing', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/risks`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .set('Origin', 'https://foreign.example')
      .send({ sectorId: foreignId, factor: 'Fator' })
      .expect(403);
  });
  it('hides organizations outside active session scope', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignId}/risks`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .expect(404);
  });
  it('publishes request and response schemas in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const risk = response.body.paths['/api/v1/organizations/{orgId}/risks'].post;
    expect(risk.requestBody.content['application/json'].schema).toMatchObject({
      required: ['sectorId', 'factor'],
      additionalProperties: false,
    });
    expect(risk.responses['201'].content?.['application/json'].schema.properties).toHaveProperty(
      'latestEvaluation',
    );
    const overview = response.body.paths['/api/v1/organizations/{orgId}/risk-overview'].get;
    expect(
      overview.responses['200'].content?.['application/json'].schema.properties,
    ).toHaveProperty('totals');
  });
});
