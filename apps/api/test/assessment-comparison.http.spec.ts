import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Assessment comparison HTTP authorization', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const otherOrg = '11111111-1111-4111-8111-111111111112';
  const referenceCycleId = '22222222-2222-4222-8222-222222222222';
  const currentCycleId = '22222222-2222-4222-8222-222222222223';
  const session = `renr_session=${'a'.repeat(43)}`;
  const path = (organizationId = org) =>
    `/api/v1/organizations/${organizationId}/assessment-comparison`;
  let app: INestApplication;
  beforeAll(async () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
    });
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({
        client: {
          session: {
            findUnique: async () => ({
              userId: org,
              activeOrganizationId: org,
              expiresAt: new Date(Date.now() + 60000),
              user: { memberships: [{ organizationId: org, role: 'READER', isActive: true }] },
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

  it('requires session, a matching active tenant and strictly scoped query input', async () => {
    const query = { referenceCycleId, currentCycleId };
    const api = request(app.getHttpServer());
    await api.get(path()).query(query).expect(401);
    await api.get(path(otherOrg)).set('Cookie', session).query(query).expect(404);
    await api
      .get(path())
      .set('Cookie', session)
      .query({ ...query, unknown: 'a' })
      .expect(400);
  });
});
