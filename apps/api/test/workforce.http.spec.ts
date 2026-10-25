import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
describe('Workforce HTTP security', () => {
  const org = '11111111-1111-4111-8111-111111111111';
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
  it.each(['employees', 'assessment-groups'])(
    'requires authentication and rejects reader for %s',
    async (route) => {
      await request(app.getHttpServer()).get(`/api/v1/organizations/${org}/${route}`).expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${org}/${route}`)
        .set('Cookie', `renr_session=${'a'.repeat(43)}`)
        .expect(403);
    },
  );
  it.each(['employees', 'assessment-groups'])(
    'requires trusted Origin for %s mutations',
    async (route) => {
      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/${route}`)
        .send({})
        .expect(403);
    },
  );
});
