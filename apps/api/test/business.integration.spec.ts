import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  sessionResponseSchema,
  organizationListSchema,
  unitSchema,
  sectorSchema,
} from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword } from '../src/modules/identity/password';
import { localDatabaseUrl } from './local-database-url';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
function cookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie']?.[0];
  if (!header) throw new Error('Expected session cookie');
  return header;
}
describeDatabase('v0.1 HTTP with PostgreSQL', () => {
  const environment = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(environment.DATABASE_URL);
  const origin = environment.CORS_ORIGIN;
  const prefix = randomUUID();
  const email = `${prefix}@renr.example`;
  const readerEmail = `reader-${prefix}@renr.example`;
  const password = 'synthetic-integration-password';
  let app: INestApplication;
  let database: PrismaService;
  let adminId: string;
  let readerId: string;
  let organizationId: string;
  let foreignOrganizationId: string;
  let cookie: string;
  let readerCookie: string;
  let unitId: string;
  let sectorId: string;
  let foreignUnitId: string;
  let foreignSectorId: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    database = module.get(PrismaService);
    const passwordHash = await hashPassword(password);
    const admin = await database.client.user.create({
      data: { email, name: 'Synthetic admin', passwordHash },
    });
    const reader = await database.client.user.create({
      data: { email: readerEmail, name: 'Synthetic reader', passwordHash },
    });
    adminId = admin.id;
    readerId = reader.id;
    const organization = await database.client.organization.create({
      data: {
        name: `Synthetic ${prefix}`,
        memberships: {
          create: [
            { userId: admin.id, role: 'ADMIN' },
            { userId: reader.id, role: 'READER' },
          ],
        },
      },
    });
    const foreign = await database.client.organization.create({
      data: {
        name: `Foreign ${prefix}`,
        memberships: { create: { userId: admin.id, role: 'ADMIN' } },
      },
    });
    organizationId = organization.id;
    foreignOrganizationId = foreign.id;
    const foreignUnit = await database.client.unit.create({
      data: { organizationId: foreign.id, name: 'Foreign unit', normalizedName: 'foreign unit' },
    });
    foreignUnitId = foreignUnit.id;
    const foreignSector = await database.client.sector.create({
      data: {
        organizationId: foreign.id,
        unitId: foreignUnit.id,
        name: 'Foreign sector',
        normalizedName: 'foreign sector',
      },
    });
    foreignSectorId = foreignSector.id;
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password })
      .expect(201);
    cookie = cookieHeader(login).split(';')[0] ?? '';
    await request(app.getHttpServer())
      .put('/api/v1/auth/session/organization')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ organizationId })
      .expect(200);
    const readerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email: readerEmail, password })
      .expect(201);
    readerCookie = cookieHeader(readerLogin).split(';')[0] ?? '';
  }, 30000);
  afterAll(async () => {
    if (database) {
      const memberships = adminId
        ? await database.client.membership.findMany({ where: { userId: adminId } })
        : [];
      const ids = memberships.map((item) => item.organizationId);
      await database.client.sector.deleteMany({ where: { organizationId: { in: ids } } });
      await database.client.unit.deleteMany({ where: { organizationId: { in: ids } } });
      await database.client.auditEvent.deleteMany({
        where: {
          OR: [
            { actorId: { in: [adminId, readerId].filter(Boolean) } },
            { organizationId: { in: ids } },
          ],
        },
      });
      await database.client.organization.deleteMany({ where: { id: { in: ids } } });
      await database.client.user.deleteMany({
        where: { id: { in: [adminId, readerId].filter(Boolean) } },
      });
    }
    if (app) await app.close();
  });
  it('returns session DTO and secure cookie flags, and requires authentication', async () => {
    const session = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(200);
    expect(sessionResponseSchema.safeParse(session.body).success).toBe(true);
    expect(session.body.activeOrganizationId).toBe(organizationId);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password })
      .expect(201);
    expect(cookieHeader(login)).toContain('HttpOnly');
    expect(cookieHeader(login)).toContain('SameSite=Lax');
    expect(cookieHeader(login)).toContain('Path=/api/v1');
    await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401);
    await request(app.getHttpServer()).get('/api/v1/organizations').expect(401);
  });
  it('rejects incorrect passwords, foreign origins and unknown input fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password: 'incorrect' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', 'https://foreign.example')
      .send({ email, password })
      .expect(403);
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password, role: 'ADMIN' })
      .expect(400);
    expect(invalid.body.details).toBeDefined();
  });
  it('lists every authorized organization but scopes resources to the active membership', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/organizations')
      .set('Cookie', cookie)
      .expect(200);
    expect(organizationListSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [organizationId, foreignOrganizationId].sort(),
    );
    const readerList = await request(app.getHttpServer())
      .get('/api/v1/organizations')
      .set('Cookie', readerCookie)
      .expect(200);
    expect(readerList.body.items.map((item: { id: string }) => item.id)).toEqual([organizationId]);
    await request(app.getHttpServer())
      .patch(`/api/v1/units/${foreignUnitId}`)
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/units/${foreignUnitId}/sectors`)
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/sectors/${foreignSectorId}`)
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignOrganizationId}/units`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/units/${foreignUnitId}/sectors`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/units/${foreignUnitId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/sectors/${foreignSectorId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Forbidden' })
      .expect(404);
    await request(app.getHttpServer())
      .put('/api/v1/auth/session/organization')
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ organizationId: foreignOrganizationId })
      .expect(403);
  });
  it('validates bounded pagination, fields and IANA timezone', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/organizations?pageSize=101')
      .set('Cookie', cookie)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'New organization', timezone: 'Invalid/Zone' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/units`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Valid name', organizationId: foreignOrganizationId })
      .expect(400);
  });
  it('creates and edits units/sectors, rejects case insensitive duplicates and writes audits atomically', async () => {
    const unit = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/units`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: ' Test unit ', code: 'A1' })
      .expect(201);
    expect(unitSchema.safeParse(unit.body).success).toBe(true);
    expect(unit.body.name).toBe('Test unit');
    unitId = unit.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/units`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'TEST UNIT' })
      .expect(409);
    const sector = await request(app.getHttpServer())
      .post(`/api/v1/units/${unitId}/sectors`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Test sector' })
      .expect(201);
    expect(sectorSchema.safeParse(sector.body).success).toBe(true);
    sectorId = sector.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/units/${unitId}/sectors`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'TEST SECTOR' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/units/${unitId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Updated unit' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/sectors/${sectorId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ isActive: false })
      .expect(200);
    const audits = await database.client.auditEvent.findMany({
      where: { organizationId, resourceId: { in: [unitId, sectorId] } },
    });
    expect(audits.map((event) => event.action).sort()).toEqual([
      'SECTOR_CREATE',
      'SECTOR_UPDATE',
      'UNIT_CREATE',
      'UNIT_UPDATE',
    ]);
    expect(await database.client.unit.count({ where: { organizationId } })).toBe(1);
    expect(await database.client.sector.count({ where: { organizationId } })).toBe(1);
  });
  it('denies reader mutations but allows reads, immediately honors membership revocation', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/units`)
      .set('Cookie', readerCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/units`)
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ name: 'Reader write' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Origin', origin)
      .set('Cookie', readerCookie)
      .send({ name: 'Reader organization' })
      .expect(403);
    await database.client.membership.delete({
      where: { userId_organizationId: { userId: readerId, organizationId } },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/units`)
      .set('Cookie', readerCookie)
      .expect(404);
  });
  it('creates organization with admin membership and records its edit', async () => {
    const organization = await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: `New ${prefix}` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: `NEW ${prefix}` })
      .expect(409);
    await request(app.getHttpServer())
      .put('/api/v1/auth/session/organization')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ organizationId: organization.body.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/organizations/${organization.body.id}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ fiscalIdentifier: 'synthetic', timezone: 'America/Recife' })
      .expect(200);
    expect(
      await database.client.membership.findUnique({
        where: {
          userId_organizationId: { userId: adminId, organizationId: organization.body.id },
        },
      }),
    ).toMatchObject({ role: 'ADMIN' });
    expect(
      await database.client.auditEvent.count({ where: { organizationId: organization.body.id } }),
    ).toBe(2);
  });
  it('rolls back the business record if its audit cannot be written', async () => {
    const membership = await database.client.membership.findFirstOrThrow({
      where: { userId: adminId, organizationId },
    });
    expect(membership.role).toBe('ADMIN');
    const { OrganizationsService } =
      await import('../src/modules/organizations/organizations.service');
    const service = new OrganizationsService(database);
    await expect(
      service.createUnit({ userId: 'invalid-uuid', organizationId }, { name: 'Must roll back' }),
    ).rejects.toThrow();
    expect(
      await database.client.unit.count({ where: { organizationId, name: 'Must roll back' } }),
    ).toBe(0);
  });
  it('revokes on logout and rejects expired sessions', async () => {
    await request(app.getHttpServer())
      .delete('/api/v1/auth/session')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(401);
    await database.client.session.updateMany({
      where: { userId: readerId },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', readerCookie)
      .expect(401);
  });
  it('requires Origin on mutation and rate limits repeated failed logins', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .send({ email, password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password })
      .expect(201);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/sessions')
        .set('Origin', origin)
        .send({ email, password: 'incorrect' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions')
      .set('Origin', origin)
      .send({ email, password })
      .expect(429);
  });
});
