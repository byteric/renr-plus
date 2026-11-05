import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Audit HTTP boundary', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
  });
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());
  it.each([
    'audit-events',
    `risks/${id}/history`,
    `actions/${id}/history`,
    `history-records/action-revision/${id}`,
  ])('requires authentication and prevents caching: %s', async (route) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/${route}`)
      .expect(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});
