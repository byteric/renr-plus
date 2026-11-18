import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Company group HTTP boundaries', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cookie = `renr_session=${'a'.repeat(43)}`;
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({
        client: {
          session: {
            findUnique: async () => ({
              userId: id,
              activeOrganizationId: null,
              expiresAt: new Date(Date.now() + 60000),
              user: { memberships: [] },
            }),
          },
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });

  afterAll(async () => app.close());

  it('requires a session and rejects unexpected selectors before reading data', async () => {
    const api = request(app.getHttpServer());
    await api.get('/api/v1/company-groups').expect(401);
    await api
      .get(`/api/v1/company-groups/${id}`)
      .set('Cookie', cookie)
      .query({ unitId: id })
      .expect(400);
  });

  it('requires a trusted request origin to change group access', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/platform/company-groups/${id}/grants`)
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example.test')
      .send({ email: 'reader@example.test', active: true, reason: 'Teste sintético', version: 0 })
      .expect(403);
  });
});
