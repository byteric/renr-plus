import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { riskRegistrationsSchema } from '@renr/contracts';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import { RiskRegistrationsRepository } from '../src/modules/risks/risk-registrations.repository';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

describeDatabase('Daily registrations against PostgreSQL', () => {
  const environment = parseEnvironment({
    ...process.env,
    NODE_ENV: 'test',
    S3_ACCESS_KEY: 'synthetic',
    S3_SECRET_KEY: 'synthetic',
  });
  localDatabaseUrl(environment.DATABASE_URL);
  const userId = randomUUID();
  const organizationId = randomUUID();
  const foreignId = randomUUID();
  const emptyId = randomUUID();
  const organizationIds: string[] = [organizationId, foreignId, emptyId];
  const token = randomUUID().replaceAll('-', '') + '12345678901';
  const cookie = `renr_session=${token}`;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let app: INestApplication;
  let database: PrismaService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(environment)],
    }).compile();
    database = module.get(PrismaService);
    app = module.createNestApplication();
    configureApplication(app, environment);
    await app.init();
    await database.client.user.create({
      data: {
        id: userId,
        name: 'Série fictícia',
        email: `${userId}@renr.example`,
        passwordHash: 'unused',
      },
    });
    for (const orgId of organizationIds) {
      await database.client.organization.create({
        data: {
          id: orgId,
          name: 'Série sintética',
          timezone: 'America/Sao_Paulo',
          memberships: { create: { userId, role: 'ADMIN' } },
        },
      });
      if (orgId === emptyId) continue;
      const unit = await database.client.unit.create({
        data: {
          organizationId: orgId,
          name: 'Unidade sintética',
          normalizedName: 'unidade sintética',
          isActive: false,
        },
      });
      const sector = await database.client.sector.create({
        data: {
          organizationId: orgId,
          unitId: unit.id,
          name: 'Setor sintético',
          normalizedName: 'setor sintético',
        },
      });
      const group = await database.client.assessmentGroup.create({
        data: { organizationId: orgId, sectorId: sector.id },
      });
      const records =
        orgId === foreignId
          ? [{ status: 'DRAFT' as const, createdAt: `${today}T04:00:00.000Z` }]
          : [
              { status: 'DRAFT' as const, createdAt: `${today}T01:30:00.000Z` },
              { status: 'REGISTERED' as const, createdAt: `${today}T03:30:00.000Z` },
              { status: 'ARCHIVED' as const, createdAt: `${today}T04:00:00.000Z` },
              { status: 'DRAFT' as const, createdAt: `${shift(today, -6)}T03:00:00.000Z` },
              { status: 'DRAFT' as const, createdAt: `${shift(today, -6)}T02:59:59.999Z` },
              { status: 'DRAFT' as const, createdAt: `${shift(today, -90)}T04:00:00.000Z` },
            ];
      await database.client.risk.createMany({
        data: records.map((record) => ({
          ...record,
          createdAt: new Date(record.createdAt),
          factor: 'Cadastro sintético',
          organizationId: orgId,
          assessmentGroupId: group.id,
          createdById: userId,
          updatedById: userId,
        })),
      });
    }
    await database.client.session.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        activeOrganizationId: organizationId,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
  });
  afterAll(async () => {
    await database.client.auditEvent.deleteMany({ where: { actorId: userId } });
    await database.client.risk.deleteMany({
      where: {
        organizationId: { in: organizationIds },
        createdById: userId,
        evaluations: { none: {} },
      },
    });
    await database.client.assessmentGroup.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await database.client.sector.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await database.client.unit.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await database.client.session.deleteMany({ where: { userId } });
    await database.client.membership.deleteMany({ where: { userId } });
    await database.client.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.client.user.delete({ where: { id: userId } });
    await app.close();
  });
  beforeEach(async () => {
    await database.client.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: organizationId },
    });
    await database.client.organization.update({
      where: { id: organizationId },
      data: { timezone: 'America/Sao_Paulo' },
    });
    await database.client.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { role: 'ADMIN' },
    });
  });
  it.each([7, 30, 90])(
    'returns exactly %i inclusive Sao Paulo dates, zero days, all statuses and only this tenant',
    async (days) => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/risk-registrations?days=${days}`)
        .set('Cookie', cookie)
        .expect(200);
      const series = riskRegistrationsSchema.parse(response.body);
      expect(series).toMatchObject({
        organizationId,
        timeZone: 'America/Sao_Paulo',
        days,
        fromDate: shift(today, 1 - days),
        toDate: today,
        total: days === 7 ? 4 : 5,
      });
      expect(series.points).toHaveLength(days);
      expect(series.points.find((point) => point.date === today)?.count).toBe(2);
      expect(series.points.find((point) => point.date === shift(today, -1))?.count).toBe(1);
      expect(series.points.find((point) => point.date === shift(today, -6))?.count).toBe(1);
      expect(series.points.find((point) => point.date === shift(today, -2))?.count).toBe(0);
      expect(response.headers['cache-control']).toBe('private, no-store');
    },
  );
  it('defaults to 30 days, permits READER and changes calendar boundaries for UTC', async () => {
    await database.client.organization.update({
      where: { id: organizationId },
      data: { timezone: 'UTC' },
    });
    await database.client.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { role: 'READER' },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/risk-registrations`)
      .set('Cookie', cookie)
      .expect(200);
    const series = riskRegistrationsSchema.parse(response.body);
    expect(series.timeZone).toBe('UTC');
    expect(series.days).toBe(30);
    expect(series.toDate).toBe(new Date(series.generatedAt).toISOString().slice(0, 10));
    expect(series.points.find((point) => point.date === today)?.count).toBe(3);
    expect(series.points.find((point) => point.date === shift(today, -1))?.count).toBe(0);
  });
  it('returns zero-filled points for an empty organization and forbids the foreign active scope', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/organizations/${foreignId}/risk-registrations?days=7`)
      .set('Cookie', cookie)
      .expect(404);
    await database.client.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: emptyId },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${emptyId}/risk-registrations?days=7`)
      .set('Cookie', cookie)
      .expect(200);
    const series = riskRegistrationsSchema.parse(response.body);
    expect(series.total).toBe(0);
    expect(series.points).toHaveLength(7);
    expect(series.points.every((point) => point.count === 0)).toBe(true);
  });
  it.each([
    {
      timeZone: 'CST',
      generatedAt: '2026-07-01T05:30:00.000Z',
      timestamps: [
        '2026-06-25T04:59:59.999Z',
        '2026-06-25T05:00:00.000Z',
        '2026-06-30T05:15:00.000Z',
        '2026-07-01T05:30:00.000Z',
        '2026-07-02T04:59:59.999Z',
        '2026-07-02T05:00:00.000Z',
      ],
    },
    {
      timeZone: 'PST',
      generatedAt: '2026-07-01T07:30:00.000Z',
      timestamps: [
        '2026-06-25T06:59:59.999Z',
        '2026-06-25T07:00:00.000Z',
        '2026-06-30T07:15:00.000Z',
        '2026-07-01T07:30:00.000Z',
        '2026-07-02T06:59:59.999Z',
        '2026-07-02T07:00:00.000Z',
      ],
    },
  ])(
    'keeps Intl calendar and daylight-saving boundaries for $timeZone',
    async ({ timeZone, generatedAt, timestamps }) => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ name: `Fuso sintético ${timeZone}`, timezone: timeZone })
        .expect(201);
      const orgId = created.body.id as string;
      organizationIds.push(orgId);
      expect(created.body.timezone).toBe(timeZone);
      const unit = await database.client.unit.create({
        data: { organizationId: orgId, name: 'Fuso', normalizedName: 'fuso' },
      });
      const sector = await database.client.sector.create({
        data: { organizationId: orgId, unitId: unit.id, name: 'Fuso', normalizedName: 'fuso' },
      });
      const group = await database.client.assessmentGroup.create({
        data: { organizationId: orgId, sectorId: sector.id },
      });
      await database.client.risk.createMany({
        data: timestamps.map((createdAt) => ({
          organizationId: orgId,
          assessmentGroupId: group.id,
          factor: 'Limite de horário de verão sintético',
          createdById: userId,
          updatedById: userId,
          createdAt: new Date(createdAt),
        })),
      });
      const snapshot = await app.get(RiskRegistrationsRepository).snapshot(orgId, 7, generatedAt);
      // Literal dates distinguish the region's summer offset from PostgreSQL's fixed abbreviation.
      expect(snapshot).toMatchObject({
        timeZone,
        fromDate: '2026-06-25',
        toDate: '2026-07-01',
        total: 4,
      });
      const series = riskRegistrationsSchema.parse(snapshot);
      expect(
        Object.fromEntries(
          series.points
            .filter((point) => point.count > 0)
            .map((point) => [point.date, point.count]),
        ),
      ).toEqual({ '2026-06-25': 1, '2026-06-30': 1, '2026-07-01': 2 });
    },
  );
  it.each(['+03:00', '-03:00', '+03:30', '-03:30', '+23:00', '+03', '+0330'])(
    'preserves organization create/update compatibility and correct UTC boundaries for %s',
    async (timeZone) => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ name: `Offset sintético ${timeZone}`, timezone: timeZone })
        .expect(201);
      const orgId = created.body.id as string;
      organizationIds.push(orgId);
      expect(created.body.timezone).toBe(timeZone);
      await database.client.session.updateMany({
        where: { userId },
        data: { activeOrganizationId: orgId },
      });
      const update = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${orgId}`)
        .set('Cookie', cookie)
        .set('Origin', environment.CORS_ORIGIN)
        .send({ timezone: timeZone })
        .expect(200);
      expect(update.body.timezone).toBe(timeZone);
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgId}/risk-registrations?days=7`)
        .set('Cookie', cookie)
        .expect(200);
      const unit = await database.client.unit.create({
        data: { organizationId: orgId, name: 'Offset', normalizedName: 'offset' },
      });
      const sector = await database.client.sector.create({
        data: { organizationId: orgId, unitId: unit.id, name: 'Offset', normalizedName: 'offset' },
      });
      const group = await database.client.assessmentGroup.create({
        data: { organizationId: orgId, sectorId: sector.id },
      });
      await database.client.risk.createMany({
        data: [
          '2026-10-17T20:45:00Z',
          '2026-10-17T21:15:00Z',
          '2026-10-17T03:15:00Z',
          '2026-10-17T02:45:00Z',
        ].map((createdAt) => ({
          organizationId: orgId,
          assessmentGroupId: group.id,
          factor: 'Borda sintética',
          createdById: userId,
          updatedById: userId,
          createdAt: new Date(createdAt),
        })),
      });
      // Literal independently checked bins distinguish +/- and the half-hour boundary.
      const expected: Record<string, Record<string, number>> = {
        '+03:00': { '2026-10-17': 3, '2026-10-18': 1 },
        '-03:00': { '2026-10-16': 1, '2026-10-17': 3 },
        '+03:30': { '2026-10-17': 2, '2026-10-18': 2 },
        '-03:30': { '2026-10-16': 2, '2026-10-17': 2 },
        '+23:00': { '2026-10-18': 4 },
        '+03': { '2026-10-17': 3, '2026-10-18': 1 },
        '+0330': { '2026-10-17': 2, '2026-10-18': 2 },
      };
      for (const days of [7, 30, 90] as const) {
        const snapshot = riskRegistrationsSchema.parse(
          await app
            .get(RiskRegistrationsRepository)
            .snapshot(orgId, days, '2026-10-18T12:00:00.000Z'),
        );
        expect(snapshot.timeZone).toBe(timeZone);
        expect(snapshot.days).toBe(days);
        expect(snapshot.total).toBe(4);
        expect(
          Object.fromEntries(
            snapshot.points
              .filter((point) => point.count > 0)
              .map((point) => [point.date, point.count]),
          ),
        ).toEqual(expected[timeZone]);
        const offsetMinutes: Record<string, number> = {
          '+03:00': 180,
          '-03:00': -180,
          '+03:30': 210,
          '-03:30': -210,
          '+23:00': 1380,
          '+03': 180,
          '+0330': 210,
        };
        const offsetMilliseconds = (offsetMinutes[timeZone] ?? 0) * 60000;
        const firstUtc = Date.parse(`${snapshot.fromDate}T00:00:00Z`) - offsetMilliseconds;
        const afterLastUtc =
          Date.parse(`${shift(snapshot.toDate, 1)}T00:00:00Z`) - offsetMilliseconds;
        const boundaryIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        try {
          await database.client.risk.createMany({
            data: [firstUtc - 1, firstUtc, afterLastUtc - 1, afterLastUtc].map(
              (instant, index) => ({
                id: boundaryIds[index],
                organizationId: orgId,
                assessmentGroupId: group.id,
                factor: 'Limite sintético',
                createdById: userId,
                updatedById: userId,
                createdAt: new Date(instant),
              }),
            ),
          });
          const bounded = riskRegistrationsSchema.parse(
            await app
              .get(RiskRegistrationsRepository)
              .snapshot(orgId, days, '2026-10-18T12:00:00.000Z'),
          );
          expect(bounded.total).toBe(6);
          expect(bounded.points[0]?.count).toBe(1);
          expect(bounded.points.at(-1)?.count).toBe(
            (expected[timeZone]?.[snapshot.toDate] ?? 0) + 1,
          );
        } finally {
          await database.client.risk.deleteMany({
            where: {
              id: { in: boundaryIds },
              organizationId: orgId,
              createdById: userId,
              evaluations: { none: {} },
            },
          });
        }
      }
    },
  );
});
