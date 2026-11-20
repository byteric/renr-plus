import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

describe('ID56 risk collaboration homologation write-gate & HTTP boundary', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const riskId = '55555555-5555-4555-8555-555555555551';
  const psychUser = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
    name: 'Beatriz Psicologia',
    token: 'p'.repeat(43),
    role: 'READER' as const,
    capabilities: ['PSYCHOLOGY_COLLABORATION'],
    hrCapabilities: [] as string[],
    scopeRestricted: false,
  };
  const tokenHash = createHash('sha256').update(psychUser.token).digest('hex');

  const envDisabled = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/synthetic',
    // Default RISK_COLLABORATION_WRITES_ENABLED must be false (homologation safe)
  });

  const membership = {
    userId: psychUser.id,
    organizationId: org,
    role: psychUser.role,
    isActive: true,
    capabilities: psychUser.capabilities,
    hrCapabilities: psychUser.hrCapabilities,
    scopeRestricted: false,
    scopes: [],
    user: { id: psychUser.id, name: psychUser.name },
    organization: {
      id: org,
      name: 'Empresa Piloto',
      isActive: true,
      commercialContractAccess: null,
    },
  };

  const fakeClient = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash
          ? {
              id: 'session-psych',
              userId: psychUser.id,
              activeOrganizationId: org,
              expiresAt: new Date(Date.now() + 60_000),
              user: {
                id: psychUser.id,
                name: psychUser.name,
                email: 'beatriz@example.test',
                companyGroupGrants: [],
                memberships: [membership],
              },
            }
          : null,
    },
    $transaction: async <T>(op: (tx: unknown) => Promise<T>) => op(fakeClient),
    $queryRaw: async () => [],
    commercialContractAccess: { findUnique: async () => null },
    membership: { findUnique: async () => membership },
    risk: {
      findFirst: async () => ({
        id: riskId,
        organizationId: org,
        version: 1,
        status: 'REGISTERED',
        assessmentGroup: {
          isActive: true,
          sector: { isActive: true, unit: { isActive: true }, organization: { isActive: true } },
        },
      }),
    },
    riskTechnicalContribution: {
      findMany: async () => [],
      count: async () => 0,
    },
  };

  let app: INestApplication;
  beforeAll(async () => {
    expect(envDisabled.RISK_COLLABORATION_WRITES_ENABLED).toBe(false);
    const module = await Test.createTestingModule({ imports: [AppModule.configure(envDisabled)] })
      .overrideProvider(PrismaService)
      .useValue({ client: fakeClient })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, envDisabled);
    await app.init();
  });
  afterAll(async () => app.close());

  it('mantém RISK_COLLABORATION_WRITES_ENABLED=false por padrão, permite leitura segura e bloqueia gravações com 403 COLLABORATION_WRITES_DISABLED', async () => {
    const caps = await request(app.getHttpServer())
      .get('/api/v1/auth/session-capabilities')
      .set('Cookie', `renr_session=${psychUser.token}`)
      .expect(200);
    expect(caps.body.capabilities).toEqual(['PSYCHOLOGY_COLLABORATION']);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${org}/risks/${riskId}/technical-contributions`)
      .set('Cookie', `renr_session=${psychUser.token}`)
      .expect(200);
    expect(list.body).toMatchObject({
      writesEnabled: false,
      viewerSpecialties: ['PSYCHOLOGY_ORGANIZATIONAL'],
      items: [],
      total: 0,
    });

    const createBlocked = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/risks/${riskId}/technical-contributions`)
      .set('Cookie', `renr_session=${psychUser.token}`)
      .set('Origin', envDisabled.CORS_ORIGIN)
      .send({
        specialty: 'PSYCHOLOGY_ORGANIZATIONAL',
        kind: 'PSYCHOSOCIAL_ANALYSIS',
        visibility: 'RESTRICTED',
        title: 'Análise bloqueada na homologação',
        workFactors: 'Sobrecarga coletiva de demandas sem pausas definidas no turno.',
        preventiveRecommendations: 'Reorganizar escala coletiva e pausas regulares.',
        expectedRiskVersion: 1,
      })
      .expect(403);
    expect(createBlocked.body.code).toBe('COLLABORATION_WRITES_DISABLED');

    const attachBlocked = await request(app.getHttpServer())
      .post(
        `/api/v1/organizations/${org}/risks/${riskId}/technical-contributions/${riskId}/attachments`,
      )
      .set('Cookie', `renr_session=${psychUser.token}`)
      .set('Origin', envDisabled.CORS_ORIGIN)
      .field('expectedVersion', '1')
      .field('description', 'Anexo bloqueado em homologação')
      .attach('file', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'), {
        filename: 'nota.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
    expect(attachBlocked.body.code).toBe('COLLABORATION_WRITES_DISABLED');
  });

  it('garante que PSYCHOLOGY_COLLABORATION não concede decisões formais de SST nem criação de ações preventivas', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/risk-workspaces/${riskId}/technical-evaluations`)
      .set('Cookie', `renr_session=${psychUser.token}`)
      .set('Origin', envDisabled.CORS_ORIGIN)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${org}/risks/${riskId}/action-workspaces`)
      .set('Cookie', `renr_session=${psychUser.token}`)
      .set('Origin', envDisabled.CORS_ORIGIN)
      .send({})
      .expect(403);
  });
});
