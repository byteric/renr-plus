import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ForbiddenException } from '@nestjs/common';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import { IdentityService } from '../src/modules/identity/identity.service';
import { PlatformController } from '../src/modules/platform/platform.controller';
import { PlatformService } from '../src/modules/platform/platform.service';
import { CommercialDashboardController } from '../src/modules/commercial/commercial-dashboard.controller';
import { CommercialDashboardService } from '../src/modules/commercial/commercial-dashboard.service';

const actorId = '51000000-0000-4000-8000-000000000001';
const orgId = '51000000-0000-4000-8000-000000000002';

describe('ID 51 platform client creation and commercial dashboard HTTP boundaries', () => {
  let app: INestApplication;
  const createClient = jest.fn();
  const overview = jest.fn();
  const authenticate = jest.fn();
  const assertOrigin = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformController, CommercialDashboardController],
      providers: [
        { provide: PlatformService, useValue: { createClient } },
        { provide: CommercialDashboardService, useValue: { overview } },
        { provide: IdentityService, useValue: { authenticate, assertOrigin } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    authenticate.mockResolvedValue({ userId: actorId });
    assertOrigin.mockReturnValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects POST /platform/clients without valid Origin or with invalid payload', async () => {
    assertOrigin.mockImplementationOnce(() => {
      throw new ForbiddenException();
    });
    await request(app.getHttpServer())
      .post('/api/v1/platform/clients')
      .send({
        name: 'Cliente Fictícia',
        fiscalIdentifier: '11.222.333/0001-81',
        reason: 'Cadastro inicial no catálogo.',
      })
      .expect(403);
    expect(createClient).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/platform/clients')
      .send({
        name: 'Cliente Inválida',
        fiscalIdentifier: '00.000.000/0000-00',
        reason: 'Teste de CNPJ inválido.',
      })
      .expect(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('forwards validated POST /platform/clients to PlatformService and propagates 403 for read-only users', async () => {
    createClient.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer())
      .post('/api/v1/platform/clients')
      .send({
        name: 'Cliente Fictícia',
        fiscalIdentifier: '11.222.333/0001-81',
        reason: 'Tentativa sem MANAGE_CLIENTS.',
      })
      .expect(403);

    createClient.mockResolvedValueOnce({
      organizationId: orgId,
      name: 'Cliente Fictícia',
      fiscalIdentifier: '11.222.333/0001-81',
      normalizedFiscalIdentifier: '11222333000181',
      fiscalState: 'VALID',
      clientClassification: 'CLIENT',
      isActive: true,
      version: 1,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/clients')
      .send({
        name: 'Cliente Fictícia',
        fiscalIdentifier: '11.222.333/0001-81',
        reason: 'Cadastro autorizado no catálogo.',
      })
      .expect(201);
    expect(res.body.normalizedFiscalIdentifier).toBe('11222333000181');
    expect(createClient).toHaveBeenLastCalledWith(
      actorId,
      expect.objectContaining({
        name: 'Cliente Fictícia',
        clientClassification: 'CLIENT',
        timezone: 'America/Sao_Paulo',
        isActive: true,
      }),
    );
  });

  it('validates period bounds and sets private no-store header on GET /platform/commercial/dashboard', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/platform/commercial/dashboard?competenceFrom=2026-12&competenceTo=2026-10')
      .expect(400);
    expect(overview).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v1/platform/commercial/dashboard?renewalWindowDays=500')
      .expect(400);

    overview.mockResolvedValueOnce({
      generatedAt: '2026-11-25T12:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
      referenceDate: '2026-11-25',
      period: { competenceFrom: '2026-10', competenceTo: '2026-11', renewalWindowDays: 45 },
      organizationId: null,
      scope: {
        canReadOverview: false,
        canManageClients: false,
        canReadCatalog: true,
        canManageCatalog: false,
        canReadBilling: false,
        canManageBilling: false,
        canReadContractAccess: false,
        canManageContractAccess: false,
        canReadSupport: false,
      },
      catalog: null,
      contracts: null,
      billing: null,
      contractAccess: null,
      supportTickets: null,
      alerts: [],
      reconciliation: {
        source: 'COMMERCIAL_LIVE_RECORDS',
        referenceDate: '2026-11-25',
        timeZone: 'America/Sao_Paulo',
        checkedAt: '2026-11-25T12:00:00.000Z',
        counts: {
          organizations: null,
          contracts: null,
          charges: null,
          accessRecords: null,
          alerts: 0,
        },
      },
    });
    const res = await request(app.getHttpServer())
      .get(
        '/api/v1/platform/commercial/dashboard?competenceFrom=2026-10&competenceTo=2026-11&renewalWindowDays=45',
      )
      .expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.billing).toBeNull();
    expect(overview).toHaveBeenCalledWith(actorId, {
      competenceFrom: '2026-10',
      competenceTo: '2026-11',
      renewalWindowDays: 45,
    });
  });
});
