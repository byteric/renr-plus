import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { apiErrorSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { IdentityService } from '../src/modules/identity/identity.service';
import { InstrumentsService } from '../src/modules/instruments/instruments.service';
describe('Instrument catalog HTTP', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });
  let app: INestApplication;
  beforeAll(async () => {
    const tx = {
      $queryRaw: async () => [],
      instrument: {
        create: async () => ({
          id,
          organizationId: org,
          name: 'Work survey',
          isLegacy: false,
          createdAt: new Date('2026-10-24T00:00:00Z'),
        }),
      },
      instrumentVersion: {
        create: async () => ({
          id: org,
          organizationId: org,
          instrumentId: id,
          title: '',
          description: '',
          instructions: '',
          version: 1,
          revision: 1,
          status: 'DRAFT',
          usageMode: 'DEMONSTRATION',
          approvalReference: null,
          publishedAt: null,
          publishedById: null,
          createdAt: new Date('2026-10-24T00:00:00Z'),
          updatedAt: new Date('2026-10-24T00:00:00Z'),
          questions: [],
          _count: { cycles: 0, questions: 0 },
        }),
      },
      auditEvent: { create: async () => ({}) },
    };
    const module = await Test.createTestingModule({ imports: [AppModule.configure(env)] })
      .overrideProvider(PrismaService)
      .useValue({
        client: { $transaction: async (operation: (value: unknown) => unknown) => operation(tx) },
      })
      .overrideProvider(IdentityService)
      .useValue({
        scope: async () => ({ userId: id, organizationId: org, role: 'ADMIN', capabilities: [] }),
        assertOrigin: () => undefined,
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());
  it('creates a catalog identity and incomplete draft without publishing it', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/instruments`)
      .send({ name: 'Work survey' })
      .expect(201);
    expect(response.body.instrument).toMatchObject({ name: 'Work survey', isLegacy: false });
    expect(response.body.version).toMatchObject({
      status: 'DRAFT',
      version: 1,
      revision: 1,
      usageMode: 'DEMONSTRATION',
      questions: [],
      approvalReference: null,
    });
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('rejects an oversized JSON document with a safe 413 envelope before any catalog write', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/instruments`)
      .send({ name: 'synthetic-private-payload-' + 'a'.repeat(4 * 1024 * 1024) })
      .expect(413);
    expect(apiErrorSchema.parse(response.body).code).toBe('PAYLOAD_TOO_LARGE');
    expect(JSON.stringify(response.body)).not.toContain('synthetic-private-payload');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});

describe('Instrument publication capability scope', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const otherOrg = '22222222-2222-4222-8222-222222222222';
  const env = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
  });
  let app: INestApplication;
  let writes = 0;
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
      .overrideProvider(InstrumentsService)
      .useValue({
        publish: async () => {
          writes++;
          return { status: 'PUBLISHED' };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app.close());
  it('rejects capabilities from a concurrently selected organization before any publication write', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/instruments/${org}/versions/${otherOrg}/publish`)
      .send({ expectedRevision: 1, approvalReference: 'Synthetic reference' });
    expect(response.status).toBe(403);
    expect(writes).toBe(0);
  });
});
