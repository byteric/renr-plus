import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, healthResponseSchema } from '@renr/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Bootstrap HTTP integration', () => {
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test-access',
    S3_SECRET_KEY: 'test-secret',
  });
  const checkReadiness = jest.fn<Promise<void>, []>();
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({ checkReadiness })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  beforeEach(() => checkReadiness.mockReset().mockResolvedValue(undefined));
  afterAll(async () => app.close());

  it('serves liveness without a database and generates its own request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'untrusted')
      .expect(200);
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves readiness when the probe succeeds', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/ready').expect(200);
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('sanitizes dependency failures and returns the shared error contract', async () => {
    checkReadiness.mockRejectedValue(new Error('postgresql://secret:password@host'));
    const response = await request(app.getHttpServer()).get('/api/v1/ready').expect(503);
    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('formats unknown routes consistently', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('publishes the local OpenAPI JSON', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.paths).toHaveProperty('/api/v1/health');
    expect(response.body.paths).toHaveProperty('/api/v1/ready');
  });
});
