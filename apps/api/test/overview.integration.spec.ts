import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { organizationOverviewSchema } from '@renr/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Overview with local PostgreSQL', () => {
  const environment = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(environment.DATABASE_URL);
  const prefix = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const userId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const cookie = `renr_session=${token}`;
  let app: INestApplication;
  let database: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    database = module.get(PrismaService);
    await database.client.user.create({
      data: {
        id: userId,
        name: 'Synthetic reader',
        email: `${prefix}@overview.example`,
        passwordHash: 'synthetic-unused-hash',
      },
    });
    await database.client.organization.createMany({
      data: ids.map((id, index) => ({
        id,
        name: `Overview ${prefix} ${index}`,
        isActive: false,
        fiscalIdentifier: 'synthetic-private-fiscal',
      })),
    });
    await database.client.membership.createMany({
      data: ids.map((organizationId) => ({ userId, organizationId, role: 'READER' as const })),
    });
    await database.client.session.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        activeOrganizationId: ids[0],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const unitIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await database.client.unit.createMany({
      data: unitIds.map((id, index) => ({
        id,
        organizationId: index === 3 ? ids[1]! : ids[0]!,
        name: `Unit ${index}`,
        normalizedName: `unit ${index}`,
        isActive: index !== 1,
      })),
    });
    await database.client.sector.createMany({
      data: [
        {
          organizationId: ids[0]!,
          unitId: unitIds[0]!,
          name: 'Inactive sector',
          normalizedName: 'inactive sector',
          isActive: false,
        },
        {
          organizationId: ids[0]!,
          unitId: unitIds[1]!,
          name: 'Active sector under inactive unit',
          normalizedName: 'active sector',
          isActive: true,
        },
        {
          organizationId: ids[1]!,
          unitId: unitIds[3]!,
          name: 'Foreign sector',
          normalizedName: 'foreign sector',
          isActive: true,
        },
      ],
    });
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
  });
  afterAll(async () => {
    if (database) {
      await database.client.sector.deleteMany({ where: { organizationId: { in: ids } } });
      await database.client.unit.deleteMany({ where: { organizationId: { in: ids } } });
      await database.client.organization.deleteMany({ where: { id: { in: ids } } });
      await database.client.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
    else if (database) await database.onApplicationShutdown();
  });

  it('counts only the active session organization and own statuses without private data', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${ids[0]}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(organizationOverviewSchema.parse(response.body)).toEqual({
      organization: { id: ids[0], name: `Overview ${prefix} 0`, isActive: false },
      units: { total: 3, active: 2, inactive: 1 },
      sectors: { total: 2, active: 1, inactive: 1 },
      unitsWithoutSectors: 1,
      generatedAt: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(/fiscal|password|token|email/);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('hides foreign and nonexistent organizations equally', async () => {
    for (const id of [ids[1], randomUUID()]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${id}/overview`)
        .set('Cookie', cookie)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
  });
  it('projects active prerequisites and hides preparation outside the administrator profile', async () => {
    const organizationId = ids[0]!;
    const journey = () =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/journey`)
        .set('Cookie', cookie)
        .expect(200);
    const where = { userId_organizationId: { userId, organizationId } };

    expect((await journey()).body.structure).toBe('INACTIVE');
    await database.client.organization.update({
      where: { id: organizationId },
      data: { isActive: true, clientClassification: 'DEMONSTRATION' },
    });
    const sectorWhere = { organizationId, normalizedName: 'inactive sector' };
    try {
      expect((await journey()).body).toEqual({
        organizationId,
        demo: true,
        structure: 'MISSING_SECTOR',
        preparation: null,
        instruments: 'MISSING_INSTRUMENT',
        collection: 'MISSING',
        result: 'PENDING',
        actions: 'MISSING',
      });
      await database.client.sector.updateMany({ where: sectorWhere, data: { isActive: true } });
      await database.client.membership.update({ where, data: { role: 'ADMIN' } });
      expect((await journey()).body).toMatchObject({
        structure: 'READY',
        preparation: { employees: false, groups: false },
      });
    } finally {
      await database.client.membership.update({ where, data: { role: 'READER' } });
      await database.client.sector.updateMany({ where: sectorWhere, data: { isActive: false } });
      await database.client.organization.update({
        where: { id: organizationId },
        data: { isActive: false, clientClassification: 'UNCLASSIFIED' },
      });
    }
  });

  it('returns zero counts after selecting an empty organization', async () => {
    await database.client.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: ids[2] },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${ids[2]}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body).toMatchObject({
      units: { total: 0, active: 0, inactive: 0 },
      sectors: { total: 0, active: 0, inactive: 0 },
      unitsWithoutSectors: 0,
    });
  });
});
