import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';
import {
  hrProfileSchema,
  employmentPeriodListSchema,
  clientRegistrationSchema,
  platformOverviewSchema,
  employeeListSchema,
  settlementResultSchema,
  validCnpj,
} from '@renr/contracts';
const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('People access, fiscal registration and platform boundaries', () => {
  let app: INestApplication,
    db: PrismaService,
    org: string,
    foreign: string,
    employee: string,
    foreignEmployee: string,
    unit: string,
    sector: string,
    admin: string,
    hr: string,
    platform: string;
  let env: ReturnType<typeof parseEnvironment>;
  let fiscalIdentifier: string;
  const cookies: Record<string, string> = {};
  const get = (path: string, who = 'hr') =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Cookie', cookies[who]!);
  const write = (
    path: string,
    body: object,
    method: 'put' | 'post' | 'patch' = 'put',
    who = 'hr',
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api/v1' + path)
      .set('Cookie', cookies[who]!)
      .set('Origin', env.CORS_ORIGIN)
      .send(body);
  };
  const base = () => `/organizations/${org}/employees/${employee}`;
  beforeAll(async () => {
    env = parseEnvironment({ ...process.env, NODE_ENV: 'test' });
    localDatabaseUrl(env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule.configure(env)],
    }).compile();
    db = module.get(PrismaService);
    const suffix = randomUUID();
    const fiscalBase = 'A' + suffix.replaceAll('-', '').slice(0, 11).toUpperCase();
    fiscalIdentifier = Array.from(
      { length: 100 },
      (_, i) => fiscalBase + String(i).padStart(2, '0'),
    ).find(validCnpj)!;
    org = (await db.client.organization.create({ data: { name: 'People tenant ' + suffix } })).id;
    foreign = (await db.client.organization.create({ data: { name: 'Foreign tenant ' + suffix } }))
      .id;
    const fixture = async (organizationId: string) => {
      const u = await db.client.unit.create({
        data: { organizationId, name: 'Dev', normalizedName: 'dev' },
      });
      const s = await db.client.sector.create({
        data: { organizationId, unitId: u.id, name: 'Engineering', normalizedName: 'engineering' },
      });
      return {
        u,
        s,
        e: await db.client.employee.create({
          data: { organizationId, unitId: u.id, sectorId: s.id, name: 'Synthetic developer' },
        }),
      };
    };
    const local = await fixture(org);
    unit = local.u.id;
    sector = local.s.id;
    employee = local.e.id;
    foreignEmployee = (await fixture(foreign)).e.id;
    for (const key of ['admin', 'hr', 'platform']) {
      const user = await db.client.user.create({
        data: {
          name: 'Synthetic ' + key,
          email: `${key}-${suffix}@example.test`,
          passwordHash: 'unused',
        },
      });
      if (key === 'admin') admin = user.id;
      if (key === 'hr') hr = user.id;
      if (key === 'platform') platform = user.id;
      if (key !== 'platform')
        await db.client.membership.create({
          data: {
            userId: user.id,
            organizationId: org,
            role: key === 'admin' ? 'ADMIN' : 'READER',
            hrCapabilities:
              key === 'hr'
                ? [
                    'HR_PROFILE_READ',
                    'HR_PROFILE_MANAGE',
                    'HR_ANALYTICS_READ',
                    'HR_COMPENSATION_READ',
                    'HR_COMPENSATION_MANAGE',
                    'HR_EXPORT',
                  ]
                : [],
          },
        });
      const token = Buffer.from(randomUUID() + randomUUID())
        .toString('base64url')
        .slice(0, 43);
      cookies[key] = 'renr_session=' + token;
      await db.client.session.create({
        data: {
          userId: user.id,
          activeOrganizationId: key === 'platform' ? null : org,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    }
    await db.client.platformGrant.createMany({
      data: [
        { userId: platform, capability: 'READ_OVERVIEW' },
        { userId: platform, capability: 'MANAGE_CLIENTS' },
        { userId: platform, capability: 'MANAGE_GRANTS' },
      ],
    });
    app = module.createNestApplication();
    configureApplication(app, env);
    await app.init();
  });
  afterAll(async () => app?.close());
  it('keeps HR grants visible in the current API and out of the published API storage contract', async () => {
    const capabilities = ['TECHNICAL_DECISIONS', 'HR_ANALYTICS_READ', 'HR_PROFILE_READ'];
    const updated = await write(
      `/organizations/${org}/access-memberships/${hr}/capabilities`,
      { expectedVersion: 1, reason: 'Synthetic rollback compatibility', capabilities },
      'put',
      'admin',
    ).expect(200);
    expect(updated.body.capabilities).toEqual(expect.arrayContaining(capabilities));
    const stored = await db.client.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: hr, organizationId: org } },
      select: { capabilities: true },
    });
    expect(stored.capabilities).toEqual(['TECHNICAL_DECISIONS']);
    const session = await get('/auth/session-capabilities').expect(200);
    expect(session.body.capabilities).toEqual(expect.arrayContaining(capabilities));
    await write(
      `/organizations/${org}/access-memberships/${hr}/capabilities`,
      {
        expectedVersion: updated.body.version,
        reason: 'Restore original synthetic fixture',
        capabilities: [
          'HR_PROFILE_READ',
          'HR_PROFILE_MANAGE',
          'HR_ANALYTICS_READ',
          'HR_COMPENSATION_READ',
          'HR_COMPENSATION_MANAGE',
          'HR_EXPORT',
        ],
      },
      'put',
      'admin',
    ).expect(200);
  });
  it('preserves the two capability families when a mixed invitation is reissued and accepted', async () => {
    const email = `mixed-${randomUUID()}@example.test`;
    const capabilities = ['EXECUTE_ASSIGNED_ACTIONS', 'HR_ANALYTICS_READ'];
    const invitePath = `/organizations/${org}/access-invites`;
    const created = await write(
      invitePath,
      {
        email,
        name: 'Synthetic mixed invite',
        role: 'READER',
        capabilities,
        reason: 'Verify mixed-capability invitation',
      },
      'post',
      'admin',
    ).expect(201);
    const stored = await db.client.accessInvite.findUniqueOrThrow({
      where: { id: created.body.invite.id },
      select: { capabilities: true, hrCapabilities: true },
    });
    expect(stored).toEqual({
      capabilities: ['EXECUTE_ASSIGNED_ACTIONS'],
      hrCapabilities: ['HR_ANALYTICS_READ'],
    });
    const reissued = await write(
      `${invitePath}/${created.body.invite.id}/reissue`,
      { expectedVersion: 1, reason: 'Verify mixed-capability reissue' },
      'post',
      'admin',
    ).expect(201);
    expect(reissued.body.invite.capabilities).toEqual(expect.arrayContaining(capabilities));
    const accepted = await request(app.getHttpServer())
      .post('/api/v1/access-invites/accept')
      .set('Origin', env.CORS_ORIGIN)
      .send({ token: reissued.body.token, name: 'Synthetic mixed invite', password: randomUUID() })
      .expect(201);
    const member = await db.client.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: accepted.body.userId, organizationId: org } },
      select: { capabilities: true, hrCapabilities: true },
    });
    expect(member).toEqual(stored);
  });
  it('ADMIN and global grants do not implicitly grant private HR', async () => {
    await get(base() + '/hr-profile', 'admin').expect(403);
    await get('/platform/overview', 'admin').expect(403);
    await get(base() + '/hr-profile', 'platform').expect(404);
  });
  it('supports HR records for a non-ADMIN employee without a user login', async () => {
    const list = employeeListSchema.parse(
      (await get(`/organizations/${org}/people/employees?pageSize=1`).expect(200)).body,
    );
    expect(list.total).toBe(1);
    expect(list.items[0]?.linkedUserId).toBeNull();
    const empty = hrProfileSchema.parse((await get(base() + '/hr-profile').expect(200)).body);
    expect(empty.version).toBe(0);
    expect(empty.birthDate).toBeNull();
    const payload = {
      expectedVersion: 0,
      reason: 'Synthetic initial declaration',
      source: 'Synthetic employee declaration',
      birthDate: '1990-02-28',
      gender: 'PREFER_NOT_TO_SAY',
      genderDescription: null,
      vacationHistoryKnown: true,
      complexLeaveHistoryKnown: true,
      hasComplexLeaves: false,
      followUp: false,
    };
    await write(base() + '/hr-profile', payload).expect(200);
    await write(base() + '/hr-profile', payload).expect(409);
    await get(`/organizations/${org}/employees/${foreignEmployee}/hr-profile`).expect(404);
    await get(`/organizations/${foreign}/employees/${foreignEmployee}/hr-profile`).expect(404);
    const audit = await db.client.auditEvent.findMany({
      where: { organizationId: org, resourceId: employee },
    });
    expect(JSON.stringify(audit)).not.toContain('1990-02-28');
    expect(JSON.stringify(audit)).not.toContain('Synthetic initial declaration');
  });
  it('preserves rehire periods and rejects overlaps and stale versions', async () => {
    const row = await write(
      base() + '/employment-periods',
      {
        expectedVersion: 0,
        reason: 'Synthetic admission',
        source: 'Synthetic contract',
        startsOn: '2025-01-01',
        endsOn: null,
      },
      'post',
    ).expect(201);
    await write(
      base() + '/employment-periods',
      {
        expectedVersion: 0,
        reason: 'Synthetic rehire',
        source: 'Synthetic contract',
        startsOn: '2026-01-01',
        endsOn: null,
      },
      'post',
    ).expect(409);
    await write(
      base() + '/employment-periods/' + row.body.id,
      {
        expectedVersion: 1,
        reason: 'Synthetic termination',
        source: 'Synthetic contract',
        startsOn: '2025-01-01',
        endsOn: '2025-12-31',
      },
      'patch',
    ).expect(200);
    await write(
      base() + '/employment-periods',
      {
        expectedVersion: 0,
        reason: 'Synthetic rehire',
        source: 'Synthetic contract',
        startsOn: '2026-01-01',
        endsOn: null,
      },
      'post',
    ).expect(201);
    expect(
      employmentPeriodListSchema.parse((await get(base() + '/employment-periods').expect(200)).body)
        .total,
    ).toBe(2);
  });
  it('uses exact salaries and explicit historical assumptions for itemized CLT preview', async () => {
    await write(
      base() + '/remunerations',
      {
        expectedVersion: 0,
        reason: 'Synthetic payroll',
        source: 'Synthetic fixed payroll',
        competence: '2026-11',
        salaryCents: '300000',
        remunerationType: 'FIXED',
      },
      'post',
    ).expect(201);
    const input = {
      terminationDate: '2026-11-04',
      thirteenthAdvanceCents: '0',
      thirteenthHistoryKnown: true,
      currentAcquisitionStart: '2026-01-01',
      currentAcquisitionHistoryKnown: true,
      unjustifiedAbsences: 0,
      fgts: { terminationBaseCents: '1000000', confirmedIncludesPending: true },
    };
    const result = settlementResultSchema.parse(
      (await write(base() + '/settlement-preview', input, 'post').expect(201)).body,
    );
    expect(result.fgtsPenaltyCents).toBe('400000');
    expect(result.grossTotalCents).not.toBeNull();
    await write(base() + '/settlement-parameters', {
      expectedVersion: 0,
      reason: 'Synthetic scenario confirmation',
      source: 'Synthetic verified payroll',
      parameters: input,
    }).expect(200);
    await db.client.membership.update({
      where: { userId_organizationId: { userId: hr, organizationId: org } },
      data: { hrCapabilities: ['HR_PROFILE_READ', 'HR_PROFILE_MANAGE', 'HR_ANALYTICS_READ'] },
    });
    await get(base() + '/remunerations').expect(403);
    const overview = (await get(`/organizations/${org}/people-overview`).expect(200)).body;
    expect(overview.metrics.salaryMassCents).toMatchObject({ state: 'FORBIDDEN', value: null });
  });
  it('catalogs clients without exposing nominal or financial people data', async () => {
    const registration = clientRegistrationSchema.parse(
      (await get(`/organizations/${org}/client-registration`, 'admin').expect(200)).body,
    );
    await write(
      '/platform/clients/' + org,
      {
        expectedVersion: registration.version,
        reason: 'Synthetic client confirmation',
        fiscalIdentifier,
        clientClassification: 'CLIENT',
        isActive: true,
      },
      'patch',
      'admin',
    ).expect(403);
    await write(
      '/platform/clients/' + org,
      {
        expectedVersion: registration.version,
        reason: 'Synthetic client confirmation',
        fiscalIdentifier,
        clientClassification: 'CLIENT',
        isActive: true,
      },
      'patch',
      'platform',
    ).expect(200);
    const overview = platformOverviewSchema.parse(
      (await get('/platform/overview', 'platform').expect(200)).body,
    );
    expect(overview.validatedCnpjs).toBeGreaterThan(0);
    const catalog = (await get('/platform/clients?pageSize=1', 'platform').expect(200)).body;
    expect(catalog.total).toBeGreaterThan(0);
    expect(JSON.stringify(catalog)).not.toContain('Synthetic developer');
    expect(JSON.stringify(catalog)).not.toContain('salaryCents');
    await db.client.platformGrant.update({
      where: { userId_capability: { userId: platform, capability: 'READ_OVERVIEW' } },
      data: { isActive: false },
    });
    await get('/platform/overview', 'platform').expect(403);
    expect(unit).toBeTruthy();
    expect(sector).toBeTruthy();
    expect(admin).toBeTruthy();
  });
});
