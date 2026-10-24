import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { apiErrorSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { IdentityService } from '../src/modules/identity/identity.service';
import { AssessmentsService } from '../src/modules/assessments/assessments.service';

describe('Assessment publication capability scope', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const otherOrg = '22222222-2222-4222-8222-222222222222';
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });
  let app: INestApplication;
  const publish = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .overrideProvider(IdentityService)
      .useValue({
        scope: async () => ({ userId: org, organizationId: org }),
        capabilities: async () => ({
          organizationId: otherOrg,
          canManageAccess: true,
          capabilities: ['TECHNICAL_DECISIONS'],
        }),
        assertOrigin: () => undefined,
      })
      .overrideProvider(AssessmentsService)
      .useValue({ publishPolicy: publish })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());
  it('rejects capabilities from another active organization before publication', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/consolidation-policies/${otherOrg}/publish`)
      .send({ expectedRevision: 1, approvalReference: 'Synthetic collective approval' })
      .expect(403);
    expect(publish).not.toHaveBeenCalled();
    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
