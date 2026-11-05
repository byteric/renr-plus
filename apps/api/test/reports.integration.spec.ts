import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import { reportSnapshotSchema } from '@renr/contracts';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('Immutable reports and download authorization', () => {
  let app: INestApplication,
    db: PrismaService,
    org: string,
    user: string,
    cookie: string,
    risk: string,
    foreign: string,
    reportId: string;
  let env: ReturnType<typeof parseEnvironment>;
  const base = () => `/api/v1/organizations/${org}/reports`;
  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const m = await Test.createTestingModule({ imports: [AppModule.configure(env)] }).compile();
    db = m.get(PrismaService);
    org = (
      await db.client.organization.create({
        data: { name: 'Synthetic immutable report ' + randomUUID() },
      })
    ).id;
    foreign = (
      await db.client.organization.create({ data: { name: 'Foreign report ' + randomUUID() } })
    ).id;
    user = (
      await db.client.user.create({
        data: {
          name: 'Synthetic reader',
          email: randomUUID() + '@example.test',
          passwordHash: 'unused',
        },
      })
    ).id;
    await db.client.membership.create({
      data: { userId: user, organizationId: org, role: 'READER' },
    });
    const token = Buffer.from(randomUUID() + randomUUID())
      .toString('base64url')
      .slice(0, 43);
    cookie = 'renr_session=' + token;
    await db.client.session.create({
      data: {
        userId: user,
        activeOrganizationId: org,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const unit = await db.client.unit.create({
      data: { organizationId: org, name: 'Synthetic unit', normalizedName: 'synthetic unit' },
    });
    const sector = await db.client.sector.create({
      data: {
        organizationId: org,
        unitId: unit.id,
        name: 'Synthetic sector',
        normalizedName: 'synthetic sector',
      },
    });
    const group = await db.client.assessmentGroup.create({
      data: { organizationId: org, sectorId: sector.id, name: 'Synthetic group' },
    });
    risk = (
      await db.client.risk.create({
        data: {
          organizationId: org,
          assessmentGroupId: group.id,
          factor: 'Synthetic original report risk',
          createdById: user,
          updatedById: user,
        },
      })
    ).id;
    app = m.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app?.close());
  it('captures one immutable snapshot and does not mix HR into SST', async () => {
    const result = await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'SST' })
      .expect(201);
    const snapshot = reportSnapshotSchema.parse(result.body);
    reportId = snapshot.id;
    expect(snapshot.financial).toBe(false);
    expect(snapshot.nominal).toBe(false);
    expect(JSON.stringify(snapshot)).toContain('Synthetic original report risk');
    await db.client.risk.update({ where: { id: risk }, data: { factor: 'Changed AFTER report' } });
    const persisted = reportSnapshotSchema.parse(
      (
        await request(app.getHttpServer())
          .get(base() + '/' + reportId)
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    );
    expect(persisted).toEqual(snapshot);
    expect(JSON.stringify(persisted)).not.toContain('Changed AFTER report');
    await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'PEOPLE', includeFinancial: true })
      .expect(403);
  });
  it('emits exactly the selected report sections', async () => {
    const response = await request(app.getHttpServer())
      .post(base())
      .set('Cookie', cookie)
      .set('Origin', env.CORS_ORIGIN)
      .send({ kind: 'SST', sectionKeys: ['inventory', 'assessment-sources'] })
      .expect(201);
    const snapshot = reportSnapshotSchema.parse(response.body);
    expect(snapshot.sections.map((section) => section.key)).toEqual([
      'inventory',
      'assessment-sources',
    ]);
  });
  it('serves PDF privately from the snapshot and refuses foreign/revoked access', async () => {
    const pdf = await request(app.getHttpServer())
      .get(base() + '/' + reportId + '/pdf')
      .set('Cookie', cookie)
      .expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreign}/reports/${reportId}`)
      .set('Cookie', cookie)
      .expect(404);
    await db.client.membership.update({
      where: { userId_organizationId: { userId: user, organizationId: org } },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get(base() + '/' + reportId + '/pdf')
      .set('Cookie', cookie)
      .expect(404);
  });
});
