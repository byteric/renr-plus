import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Daily risk registrations HTTP boundary', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
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
        userId: otherId,
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
  it('documents the bounded period and daily response in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/v1/organizations/{orgId}/risk-registrations'].get;
    expect(
      operation.parameters.find((parameter: { name: string }) => parameter.name === 'days').schema
        .enum,
    ).toEqual([7, 30, 90]);
    expect(operation.responses['200'].content['application/json'].schema.properties).toHaveProperty(
      'points',
    );
  });
  it('requires a session and prevents caching the error', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/risk-registrations`)
      .expect(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('hides another organization from the reader active scope', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${otherId}/risk-registrations`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .expect(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it.each(['days=14', 'days=7&status=ARCHIVED', 'days=7&days=30', 'organizationId=external'])(
    'rejects unsupported query %s',
    async (query) => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/risk-registrations?${query}`)
        .set('Cookie', `renr_session=${'a'.repeat(43)}`)
        .expect(400);
      expect(response.headers['cache-control']).toBe('private, no-store');
    },
  );
});
