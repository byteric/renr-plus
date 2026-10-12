import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { organizationOverviewSchema } from '@renr/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { OverviewRepository } from '../src/modules/overview/overview.repository';
import { OverviewService } from '../src/modules/overview/overview.service';

const id = '00000000-0000-4000-8000-000000000001';
const foreignId = '00000000-0000-4000-8000-000000000002';
const snapshot = {
  organization: { id, name: 'Synthetic organization', isActive: false },
  units: { total: 2, active: 1, inactive: 1 },
  sectors: { total: 1, active: 1, inactive: 0 },
  unitsWithoutSectors: 1,
};

describe('Organization overview HTTP', () => {
  const environment = parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://renr:test@127.0.0.1:5432/renr',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  const getSnapshot = jest.fn();
  const findUnique = jest.fn();
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule.configure(environment)] })
      .overrideProvider(PrismaService)
      .useValue({ client: { session: { findUnique } } })
      .overrideProvider(OverviewRepository)
      .useValue({ getSnapshot })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  beforeEach(() => {
    getSnapshot.mockReset().mockResolvedValue(snapshot);
    findUnique.mockReset().mockResolvedValue({
      userId: id,
      activeOrganizationId: id,
      expiresAt: new Date(Date.now() + 60000),
      user: {
        memberships: [
          { organizationId: id, role: 'READER' },
          { organizationId: foreignId, role: 'ADMIN' },
        ],
      },
    });
  });
  afterAll(async () => app.close());
  const fetch = (organizationId = id) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/overview`)
      .set('Cookie', `renr_session=${'a'.repeat(43)}`);

  it.each(['READER', 'ADMIN'])(
    'allows %s and returns only the overview with no-store',
    async (role) => {
      findUnique.mockResolvedValue({
        userId: id,
        activeOrganizationId: id,
        expiresAt: new Date(Date.now() + 60000),
        user: { memberships: [{ organizationId: id, role }] },
      });
      const response = await fetch().expect(200);
      expect(organizationOverviewSchema.parse(response.body)).toEqual({
        ...snapshot,
        generatedAt: expect.any(String),
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(getSnapshot).toHaveBeenCalledWith(id);
    },
  );
  it('requires authentication and rejects expired sessions', async () => {
    await request(app.getHttpServer()).get(`/api/v1/organizations/${id}/overview`).expect(401);
    findUnique.mockResolvedValue({ expiresAt: new Date(0) });
    await fetch().expect(401);
    expect(getSnapshot).not.toHaveBeenCalled();
  });
  it('does not disclose organizations outside the active session even with membership', async () => {
    await fetch(foreignId).expect(404);
    expect(getSnapshot).not.toHaveBeenCalled();
  });
  it('honors revoked active membership', async () => {
    findUnique.mockResolvedValue({
      userId: id,
      activeOrganizationId: id,
      expiresAt: new Date(Date.now() + 60000),
      user: { memberships: [] },
    });
    await fetch().expect(404);
    expect(getSnapshot).not.toHaveBeenCalled();
  });
  it('rejects invalid UUID before querying authentication or overview', async () => {
    await fetch('invalid').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });
  it('returns 404 if the organization disappeared', async () => {
    getSnapshot.mockResolvedValue(null);
    await fetch().expect(404);
  });
  it('sanitizes database failures and does not disclose secrets', async () => {
    getSnapshot.mockRejectedValue(new Error('postgresql://private:password@host'));
    const response = await fetch().expect(500);
    expect(JSON.stringify(response.body)).not.toMatch(/private|password|postgresql/);
  });
  it('documents all response members and errors', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const endpoint = response.body.paths['/api/v1/organizations/{id}/overview'].get;
    expect(Object.keys(endpoint.responses)).toEqual(['200', '400', '401', '404', '500']);
    expect(
      Object.keys(response.body.components.schemas.OrganizationOverviewDto.properties),
    ).toEqual(['organization', 'units', 'sectors', 'unitsWithoutSectors', 'generatedAt']);
  });
});

describe('OverviewService', () => {
  it('accepts zeros and stamps the response', async () => {
    const empty = {
      ...snapshot,
      units: { total: 0, active: 0, inactive: 0 },
      sectors: { total: 0, active: 0, inactive: 0 },
      unitsWithoutSectors: 0,
    };
    const service = new OverviewService({
      getSnapshot: jest.fn().mockResolvedValue(empty),
    } as unknown as OverviewRepository);
    expect(organizationOverviewSchema.parse(await service.getOverview(id))).toEqual({
      ...empty,
      generatedAt: expect.any(String),
    });
  });
  it('rejects a missing organization', async () => {
    const service = new OverviewService({
      getSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as OverviewRepository);
    await expect(service.getOverview(id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OverviewRepository', () => {
  it('counts own status and units without any sectors in RepeatableRead', async () => {
    const tx = {
      organization: { findUnique: jest.fn().mockResolvedValue(snapshot.organization) },
      unit: {
        groupBy: jest.fn().mockResolvedValue([{ isActive: false, _count: { _all: 2 } }]),
        count: jest.fn().mockResolvedValue(1),
      },
      sector: { groupBy: jest.fn().mockResolvedValue([{ isActive: true, _count: { _all: 3 } }]) },
    };
    const transaction = jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx));
    const repository = new OverviewRepository({
      client: { $transaction: transaction },
    } as unknown as PrismaService);
    expect(await repository.getSnapshot(id)).toEqual({
      ...snapshot,
      units: { total: 2, active: 0, inactive: 2 },
      sectors: { total: 3, active: 3, inactive: 0 },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(tx.unit.count).toHaveBeenCalledWith({
      where: { organizationId: id, sectors: { none: {} } },
    });
    expect(tx.unit.groupBy).toHaveBeenCalledWith({
      by: ['isActive'],
      where: { organizationId: id },
      _count: { _all: true },
    });
    expect(tx.sector.groupBy).toHaveBeenCalledWith({
      by: ['isActive'],
      where: { organizationId: id },
      _count: { _all: true },
    });
  });
  it('returns no snapshot or counts for a missing organization', async () => {
    const tx = { organization: { findUnique: jest.fn().mockResolvedValue(null) } };
    const repository = new OverviewRepository({
      client: { $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx) },
    } as unknown as PrismaService);
    expect(await repository.getSnapshot(id)).toBeNull();
  });
});
