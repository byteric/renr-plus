import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('Action HTTP boundary', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(PrismaService)
      .useValue({
        client: {
          session: {
            findUnique: async () => ({
              userId: id,
              activeOrganizationId: org,
              expiresAt: new Date(Date.now() + 60000),
              user: { memberships: [{ organizationId: org, role: 'READER' }] },
            }),
          },
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());
  it.each([
    'actions',
    `actions/${id}`,
    `actions/${id}/revisions`,
    'action-overview',
    `actions/${id}/evidence`,
    `actions/${id}/evidence/${id}/download`,
  ])('requires session and private no-store for %s', async (route) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/${route}`)
      .expect(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('rejects reader and incorrect Origin before processing upload', async () => {
    for (const origin of [env.CORS_ORIGIN, 'https://foreign.example']) {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/organizations/${org}/actions/${id}/evidence`)
        .set('Cookie', `renr_session=${'a'.repeat(43)}`)
        .set('Origin', origin)
        .attach('file', Buffer.from('invalid'), 'bad.exe')
        .expect(403);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
  });
  it('documents strict requests and public responses', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(
      response.body.paths[`/api/v1/organizations/{orgId}/risks/{riskId}/actions`]?.post?.requestBody
        ?.content?.['application/json']?.schema?.additionalProperties,
    ).toBe(false);
  });
});
