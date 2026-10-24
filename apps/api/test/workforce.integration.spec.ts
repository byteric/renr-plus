import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Workforce PostgreSQL isolation and history', () => {
  const env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
  localDatabaseUrl(env.DATABASE_URL);
  let app: INestApplication;
  let db: PrismaService;
  let org: string;
  let foreign: string;
  let unit: string;
  let sector: string;
  let otherUnit: string;
  let otherSector: string;
  let admin: string;
  let linked: string;
  let cookie: string;
  const path = (resource: string) => `/api/v1/organizations/${org}/${resource}`;
  const post = (resource: string, body: object) =>
    request(app.getHttpServer())
      .post(path(resource))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const patch = (resource: string, body: object) =>
    request(app.getHttpServer())
      .patch(path(resource))
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  const get = (resource: string) =>
    request(app.getHttpServer()).get(path(resource)).set('Cookie', cookie);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    org = (await db.client.organization.create({ data: { name: 'Synthetic workforce' } })).id;
    foreign = (await db.client.organization.create({ data: { name: 'Foreign workforce' } })).id;
    admin = (
      await db.client.user.create({
        data: {
          name: 'Synthetic admin',
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      })
    ).id;
    linked = (
      await db.client.user.create({
        data: {
          name: 'Synthetic colleague',
          email: `${randomUUID()}@example.test`,
          passwordHash: 'unused',
        },
      })
    ).id;
    await db.client.membership.createMany({
      data: [
        { userId: admin, organizationId: org, role: 'ADMIN' },
        { userId: linked, organizationId: foreign, role: 'READER' },
      ],
    });
    const token = 'w'.repeat(43);
    cookie = `renr_session=${token}`;
    await db.client.session.create({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        userId: admin,
        activeOrganizationId: org,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    unit = (
      await db.client.unit.create({
        data: { organizationId: org, name: 'Unit alpha', normalizedName: 'unit alpha' },
      })
    ).id;
    otherUnit = (
      await db.client.unit.create({
        data: { organizationId: foreign, name: 'Unit beta', normalizedName: 'unit beta' },
      })
    ).id;
    sector = (
      await db.client.sector.create({
        data: {
          organizationId: org,
          unitId: unit,
          name: 'Sector alpha',
          normalizedName: 'sector alpha',
        },
      })
    ).id;
    otherSector = (
      await db.client.sector.create({
        data: {
          organizationId: foreign,
          unitId: otherUnit,
          name: 'Sector beta',
          normalizedName: 'sector beta',
        },
      })
    ).id;
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => {
    if (!db) return;
    await db.client.auditEvent.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.employee.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.risk.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.assessmentGroup.deleteMany({
      where: { organizationId: { in: [org, foreign] } },
    });
    await db.client.sector.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.unit.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.client.user.deleteMany({ where: { id: { in: [admin, linked] } } });
    await db.client.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await app?.close();
  });
  it('rejects cross-tenant relations and incompatible units at HTTP and FK boundaries', async () => {
    for (const body of [
      { unitId: otherUnit, sectorId: otherSector },
      { unitId: unit, sectorId: otherSector },
      { unitId: unit, sectorId: sector, linkedUserId: linked },
    ])
      await post('employees', { name: 'Synthetic person', ...body }).expect(404);
    await expect(
      db.client.employee.create({
        data: {
          organizationId: org,
          name: 'FK protected',
          unitId: otherUnit,
          sectorId: otherSector,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.employee.create({
        data: {
          organizationId: org,
          name: 'FK protected',
          unitId: unit,
          sectorId: sector,
          linkedUserId: linked,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('normalizes unique identifiers concurrently and allows multiple absent identifiers', async () => {
    const results = await Promise.all(
      [' ABC-123 ', 'abc-123'].map((internalIdentifier) =>
        post('employees', {
          name: 'Synthetic worker',
          unitId: unit,
          sectorId: sector,
          internalIdentifier,
        }),
      ),
    );
    expect(results.map((value) => value.status).sort()).toEqual([201, 409]);
    for (let n = 0; n < 2; n++)
      await post('employees', {
        name: `Without identifier ${n}`,
        unitId: unit,
        sectorId: sector,
      }).expect(201);
    const list = await get('employees?search=abc-123&page=1&pageSize=1').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.headers['cache-control']).toContain('no-store');
  });
  it('accepts bounded Unicode identifiers whose compatibility normalization expands', async () => {
    const internalIdentifier = '\ufb03'.repeat(30);
    await post('employees', {
      name: 'Unicode identifier',
      unitId: unit,
      sectorId: sector,
      internalIdentifier,
    }).expect(201);
    await post('employees', {
      name: 'Unicode duplicate',
      unitId: unit,
      sectorId: sector,
      internalIdentifier,
    }).expect(409);
  });
  it('retains the record and membership when deactivated, detects stale versions and permits unrelated edits after structure deactivation', async () => {
    await db.client.membership.create({
      data: { organizationId: org, userId: linked, role: 'READER' },
    });
    const created = await post('employees', {
      name: 'Linked person',
      unitId: unit,
      sectorId: sector,
      linkedUserId: linked,
    }).expect(201);
    await patch(`employees/${created.body.id}`, { version: 1, isActive: false }).expect(200);
    await patch(`employees/${created.body.id}`, { version: 1, name: 'Stale name' }).expect(409);
    expect(
      await db.client.membership.findUnique({
        where: { userId_organizationId: { userId: linked, organizationId: org } },
      }),
    ).toMatchObject({ isActive: true });
    await db.client.sector.update({ where: { id: sector }, data: { isActive: false } });
    await patch(`employees/${created.body.id}`, { version: 2, name: 'Updated history' }).expect(
      200,
    );
    expect((await get(`employees/${created.body.id}`).expect(200)).body).toMatchObject({
      name: 'Updated history',
      isActive: false,
      version: 3,
    });
    await db.client.sector.update({ where: { id: sector }, data: { isActive: true } });
  });
  it('filters organizational lists while preserving legacy envelopes and fields', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/organizations?search=Synthetic%20workforce&isActive=true')
          .set('Cookie', cookie)
          .expect(200)
      ).body.total,
    ).toBe(1);
    const units = await get('units?search=alpha&isActive=true').expect(200);
    expect(Object.keys(units.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
    expect(units.body.total).toBe(1);
    const sectors = await request(app.getHttpServer())
      .get(`/api/v1/units/${unit}/sectors?search=alpha&isActive=false`)
      .set('Cookie', cookie)
      .expect(200);
    expect(sectors.body.total).toBe(0);
  });
  it('preserves group identity, enforces one group per sector and immutable composition', async () => {
    const created = await post('assessment-groups', {
      name: 'Alpha group',
      sectorId: sector,
    }).expect(201);
    const risk = await post('risks', { sectorId: sector, factor: 'Synthetic exposure' }).expect(
      201,
    );
    await post('assessment-groups', { name: 'Duplicate group', sectorId: sector }).expect(409);
    await patch(`assessment-groups/${created.body.id}`, {
      version: 1,
      sectorId: otherSector,
    }).expect(400);
    await patch(`assessment-groups/${created.body.id}`, {
      version: 1,
      name: 'Historical group',
      isActive: false,
    }).expect(200);
    await post('risks', { sectorId: sector, factor: 'Blocked exposure' }).expect(409);
    expect((await get(`risks/${risk.body.id}`).expect(200)).body.assessmentGroupId).toBe(
      created.body.id,
    );
    expect((await get(`assessment-groups/${created.body.id}`).expect(200)).body).toMatchObject({
      id: created.body.id,
      sectorId: sector,
      unitId: unit,
      isActive: false,
      version: 2,
    });
    expect(
      (await get('assessment-groups?search=Historical&isActive=false').expect(200)).body.total,
    ).toBe(1);
    await post('employees', { name: 'No CPF', unitId: unit, sectorId: sector, cpf: '123' }).expect(
      400,
    );
  });
  it('waits for concurrent group deactivation before creating a risk', async () => {
    const concurrentSector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit,
        name: 'Concurrent sector',
        normalizedName: 'concurrent sector',
      },
    });
    const group = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: concurrentSector.id, name: 'Concurrent group' },
    });
    let signalAcquired!: () => void;
    let releaseDeactivation!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDeactivation = resolve;
    });
    const deactivation = db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${org}))::text`;
      signalAcquired();
      await release;
      await tx.assessmentGroup.update({ where: { id: group.id }, data: { isActive: false } });
    });
    await acquired;
    const creation = post('risks', {
      sectorId: concurrentSector.id,
      factor: 'Concurrent exposure',
    }).then((response) => response);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 20 && !waiting; attempt++) {
        const result = await db.client.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext(${org})::oid) AS waiting`;
        waiting = result[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally {
      releaseDeactivation();
      await deactivation;
    }
    expect((await creation).status).toBe(409);
  });
});
