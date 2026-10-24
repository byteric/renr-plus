import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Access HTTP boundary', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
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
              userId: user,
              activeOrganizationId: org,
              expiresAt: new Date(Date.now() + 60000),
              user: {
                memberships: [
                  { organizationId: org, role: 'ADMIN', isActive: true, capabilities: [] },
                ],
              },
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
  it('returns capabilities separately without implicit technical authority for administrators', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/session-capabilities')
      .set('Cookie', `renr_session=${'a'.repeat(43)}`)
      .expect(200);
    expect(response.body).toEqual({ organizationId: org, capabilities: [], canManageAccess: true });
  });
  it.each(['access-memberships', 'access-invites', 'access-history'])(
    'requires authentication for %s',
    async (route) => {
      await request(app.getHttpServer()).get(`/api/v1/organizations/${org}/${route}`).expect(401);
    },
  );
  it('requires the trusted Origin for accepting invitations', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/access-invites/accept')
      .send({ token: 'a'.repeat(43) })
      .expect(403);
  });
  it('requires authentication when reloading a single membership', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/access-memberships/${user}`)
      .expect(401);
  });
});
