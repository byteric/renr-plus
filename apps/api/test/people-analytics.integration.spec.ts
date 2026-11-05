import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PeopleAnalyticsService } from '../src/modules/people/people-analytics.service';
import { PrismaService } from '../src/database/prisma.service';
import { parseEnvironment } from '../src/config/env';
import { localDatabaseUrl } from './local-database-url';
import { referenceDate } from '../src/modules/actions/actions.repository';

const describeDatabase = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
describeDatabase('People analytics PostgreSQL', () => {
  const organizationId = randomUUID(),
    userId = randomUUID(),
    unitId = randomUUID(),
    sectorId = randomUUID();
  const employeeIds: string[] = [];
  let database: PrismaService;
  let service: PeopleAnalyticsService;
  const today = referenceDate('America/Sao_Paulo', new Date());
  const date = (value: string) => new Date(value + 'T00:00:00Z');
  const plusDays = (days: number) => new Date(date(today).getTime() + days * 86400000);
  beforeAll(async () => {
    const environment = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      S3_ACCESS_KEY: 'synthetic',
      S3_SECRET_KEY: 'synthetic',
    });
    localDatabaseUrl(environment.DATABASE_URL);
    database = new PrismaService(environment);
    service = new PeopleAnalyticsService(database);
    await database.client.user.create({
      data: {
        id: userId,
        name: 'Synthetic HR',
        email: `${userId}@hr.example`,
        passwordHash: 'unused',
      },
    });
    await database.client.organization.create({
      data: { id: organizationId, name: 'Synthetic HR analytics' },
    });
    await database.client.membership.create({
      data: {
        userId,
        organizationId,
        role: 'ADMIN',
        hrCapabilities: ['HR_ANALYTICS_READ', 'HR_COMPENSATION_READ'],
      },
    });
    await database.client.unit.create({
      data: { id: unitId, organizationId, name: 'HR unit', normalizedName: 'hr unit' },
    });
    await database.client.sector.create({
      data: {
        id: sectorId,
        organizationId,
        unitId,
        name: 'HR sector',
        normalizedName: 'hr sector',
      },
    });
    for (let index = 0; index < 20; index++) {
      const employeeId = randomUUID();
      employeeIds.push(employeeId);
      await database.client.employee.create({
        data: { id: employeeId, organizationId, unitId, sectorId, name: `Synthetic ${index}` },
      });
      await database.client.employeeHrProfile.create({
        data: {
          organizationId,
          employeeId,
          gender: 'FEMALE',
          birthDate: date('2000-02-29'),
          source: 'synthetic fixture',
          updatedById: userId,
          vacationHistoryKnown: index >= 10,
          followUp: index >= 15,
        },
      });
      await database.client.employeeRemuneration.create({
        data: {
          organizationId,
          employeeId,
          competence: today.slice(0, 7),
          salaryCents: 999999999999999n,
          source: 'synthetic fixture',
          updatedById: userId,
        },
      });
      if (index < 5 || (index >= 10 && index < 15))
        await database.client.employeeVacationPeriod.create({
          data: {
            organizationId,
            employeeId,
            acquisitionStart: date('2020-01-01'),
            acquisitionEnd: date('2020-12-31'),
            concessionDeadline: plusDays(index < 5 ? -1 : 60),
            entitlementDays: 30,
            balanceDays: 30,
            historyKnown: true,
            source: 'synthetic fixture',
            updatedById: userId,
          },
        });
    }
    await database.client.employee.create({
      data: { organizationId, unitId, sectorId, name: 'Inactive record', isActive: false },
    });
  }, 60000);
  afterAll(async () => {
    if (!database) return;
    await database.client.employeeSettlementParameters.deleteMany({ where: { organizationId } });
    await database.client.employeeVacationPeriod.deleteMany({ where: { organizationId } });
    await database.client.employmentPeriod.deleteMany({ where: { organizationId } });
    await database.client.employeeRemuneration.deleteMany({ where: { organizationId } });
    await database.client.employeeHrProfile.deleteMany({ where: { organizationId } });
    await database.client.employee.deleteMany({ where: { organizationId } });
    await database.client.sector.deleteMany({ where: { organizationId } });
    await database.client.unit.deleteMany({ where: { organizationId } });
    await database.client.membership.deleteMany({ where: { organizationId } });
    await database.client.organization.deleteMany({ where: { id: organizationId } });
    await database.client.user.deleteMany({ where: { id: userId } });
    await database.onApplicationShutdown();
  });
  it('aggregates exact money and mutually exclusive vacation priority with unknown inputs', async () => {
    const result = await service.overview({ organizationId, userId }, {});
    expect(result.population).toEqual({
      total: 21,
      active: 20,
      inactive: 1,
      unit: 'EMPLOYEE_RECORDS',
    });
    expect(result.metrics.salaryMassCents.value).toBe('19999999999999980');
    expect(result.metrics.averageSalaryCents.value).toBe('999999999999999');
    expect(result.metrics.terminationGrossCents).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      value: null,
      known: 0,
      missing: 20,
    });
    expect(result.distributions.find((item) => item.key === 'vacation')!.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'OVERDUE', count: 5 }),
        expect.objectContaining({ key: 'UNKNOWN', count: 5 }),
        expect.objectContaining({ key: 'DUE_SOON', count: 5 }),
        expect.objectContaining({ key: 'FOLLOW_UP', count: 5 }),
      ]),
    );
  });
  it('returns forbidden monetary metrics without compensation permission', async () => {
    await database.client.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { hrCapabilities: ['HR_ANALYTICS_READ'] },
    });
    const result = await service.overview({ organizationId, userId }, {});
    expect(result.metrics.salaryMassCents).toMatchObject({
      state: 'FORBIDDEN',
      value: null,
      known: null,
      missing: null,
    });
  });
  it('treats a leap-day birthday as March 1 in non-leap years', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'performance',
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
      ],
    });
    try {
      jest.setSystemTime(new Date('2026-02-28T15:00:00Z'));
      expect(
        (await service.overview({ organizationId, userId }, {})).metrics.averageAge.value,
      ).toBe('25.00');
      jest.setSystemTime(new Date('2026-03-01T15:00:00Z'));
      expect(
        (await service.overview({ organizationId, userId }, {})).metrics.averageAge.value,
      ).toBe('26.00');
    } finally {
      jest.useRealTimers();
    }
  });
  it('uses planned age and tenure bands and excludes preference from declaration coverage', async () => {
    for (let index = 0; index < 20; index++) {
      const group = Math.floor(index / 5),
        birth = plusDays(0),
        admission = plusDays(0);
      birth.setUTCFullYear(birth.getUTCFullYear() - [29, 30, 59, 60][group]!);
      admission.setUTCMonth(admission.getUTCMonth() - [0, 12, 60, 120][group]!);
      await database.client.employeeHrProfile.update({
        where: { organizationId_employeeId: { organizationId, employeeId: employeeIds[index]! } },
        data: { birthDate: birth, gender: group === 0 ? 'PREFER_NOT_TO_SAY' : 'FEMALE' },
      });
      await database.client.employmentPeriod.create({
        data: {
          organizationId,
          employeeId: employeeIds[index]!,
          startsOn: admission,
          source: 'synthetic boundaries',
          updatedById: userId,
        },
      });
    }
    const result = await service.overview({ organizationId, userId }, {});
    expect(result.metrics.genderCoveragePercent).toMatchObject({
      state: 'KNOWN',
      value: '75.00',
      known: 15,
      missing: 5,
    });
    expect(result.distributions.find((d) => d.key === 'age')!.items.map((b) => b.key)).toEqual([
      '30_39',
      '50_59',
      '60_PLUS',
      'UNDER_30',
    ]);
    expect(result.distributions.find((d) => d.key === 'tenure')!.items.map((b) => b.key)).toEqual([
      '120_PLUS',
      '12_35',
      '60_119',
      'UNDER_12',
    ]);
    expect(result.distributions.find((d) => d.key === 'gender')!.items).toContainEqual({
      key: 'PREFER_NOT_TO_SAY',
      label: 'Prefere não informar',
      count: 5,
    });
    for (let index = 0; index < 20; index++) {
      const group = Math.floor(index / 5),
        birth = plusDays(0),
        admission = plusDays(0);
      birth.setUTCFullYear(birth.getUTCFullYear() - [39, 40, 49, 50][group]!);
      admission.setUTCMonth(admission.getUTCMonth() - [11, 35, 36, 59][group]!);
      await database.client.employeeHrProfile.update({
        where: { organizationId_employeeId: { organizationId, employeeId: employeeIds[index]! } },
        data: { birthDate: birth },
      });
      await database.client.employmentPeriod.updateMany({
        where: { organizationId, employeeId: employeeIds[index]! },
        data: { startsOn: admission },
      });
    }
    const boundaries = await service.overview({ organizationId, userId }, {});
    expect(boundaries.distributions.find((d) => d.key === 'age')!.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '30_39', count: 5 }),
        expect.objectContaining({ key: '40_49', count: 10 }),
        expect.objectContaining({ key: '50_59', count: 5 }),
      ]),
    );
    expect(boundaries.distributions.find((d) => d.key === 'tenure')!.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'UNDER_12', count: 5 }),
        expect.objectContaining({ key: '12_35', count: 5 }),
        expect.objectContaining({ key: '36_59', count: 10 }),
      ]),
    );
  });
  it('retains exact known salaries with explicit missing coverage and tolerates inconsistent settlement inputs', async () => {
    await database.client.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { hrCapabilities: ['HR_ANALYTICS_READ', 'HR_COMPENSATION_READ'] },
    });
    await database.client.employeeRemuneration.deleteMany({
      where: { organizationId, employeeId: { in: employeeIds.slice(15) } },
    });
    await database.client.employeeSettlementParameters.create({
      data: {
        organizationId,
        employeeId: employeeIds[0]!,
        referenceDate: date(today),
        input: {
          terminationDate: today,
          thirteenthHistoryKnown: true,
          currentAcquisitionHistoryKnown: true,
          currentAcquisitionStart: plusDays(365).toISOString().slice(0, 10),
        },
        source: 'synthetic inconsistent parameters',
        updatedById: userId,
      },
    });
    const result = await service.overview({ organizationId, userId }, {});
    expect(result.metrics.salaryMassCents).toMatchObject({
      state: 'KNOWN',
      value: '14999999999999985',
      known: 15,
      missing: 5,
    });
    expect(result.metrics.averageSalaryCents).toMatchObject({
      state: 'KNOWN',
      value: '999999999999999',
      known: 15,
      missing: 5,
    });
    expect(result.metrics.terminationGrossCents).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      value: null,
      known: 0,
      missing: 20,
    });
  });
  it('protects sensitive sector complements in the company total and hides rare categories', async () => {
    const smallSector = randomUUID();
    await database.client.sector.create({
      data: {
        id: smallSector,
        organizationId,
        unitId,
        name: 'Synthetic small sector',
        normalizedName: 'synthetic small sector',
      },
    });
    for (let index = 0; index < 3; index++) {
      const employeeId = randomUUID();
      await database.client.employee.create({
        data: {
          id: employeeId,
          organizationId,
          unitId,
          sectorId: smallSector,
          name: 'Synthetic complement',
        },
      });
      await database.client.employeeHrProfile.create({
        data: {
          organizationId,
          employeeId,
          gender: 'FEMALE',
          birthDate: date('1985-01-01'),
          source: 'synthetic complement',
          updatedById: userId,
        },
      });
      await database.client.employeeRemuneration.create({
        data: {
          organizationId,
          employeeId,
          competence: today.slice(0, 7),
          salaryCents: 150000n,
          source: 'synthetic complement',
          updatedById: userId,
        },
      });
    }
    const scope = { organizationId, userId };
    const main = await service.overview(scope, { sectorId });
    const total = await service.overview(scope, {});
    const small = await service.overview(scope, { sectorId: smallSector });
    expect(main.metrics.salaryMassCents.state).toBe('KNOWN');
    expect(total.population.active).toBe(23);
    expect(total.metrics.salaryMassCents).toMatchObject({
      state: 'SUPPRESSED',
      value: null,
      known: null,
      missing: null,
    });
    expect(total.metrics.averageAge.state).toBe('SUPPRESSED');
    expect(total.distributions.find((item) => item.key === 'gender')).toMatchObject({
      state: 'SUPPRESSED',
      items: [],
    });
    expect(small.distributions.find((item) => item.key === 'gender')).toMatchObject({
      state: 'SUPPRESSED',
      items: [],
    });
  });
  it('separates demonstration approval from the catalog and requires nominal access for exact real indicators', async () => {
    await database.client.organization.update({
      where: { id: organizationId },
      data: { clientClassification: 'DEMONSTRATION' },
    });
    const production = {
      ...process.env,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://example.test',
      HR_REAL_DATA_ENABLED: 'false',
      HR_DEMO_ORGANIZATION_IDS: '',
    };
    const denied = new PrismaService(parseEnvironment(production));
    const demo = new PrismaService(
      parseEnvironment({ ...production, HR_DEMO_ORGANIZATION_IDS: organizationId }),
    );
    const real = new PrismaService(
      parseEnvironment({ ...production, HR_REAL_DATA_ENABLED: 'true' }),
    );
    const scope = { organizationId, userId };
    try {
      await expect(
        new PeopleAnalyticsService(denied).overview(scope, { sectorId }),
      ).rejects.toHaveProperty('status', 403);
      const authorizedDemo = await new PeopleAnalyticsService(demo).overview(scope, { sectorId });
      expect(authorizedDemo.metrics.averageAge.state).toBe('KNOWN');
      const aggregateOnly = await new PeopleAnalyticsService(real).overview(scope, { sectorId });
      expect(aggregateOnly.population.active).toBe(20);
      expect(aggregateOnly.metrics.averageAge).toMatchObject({
        state: 'FORBIDDEN',
        value: null,
        known: null,
      });
      expect(aggregateOnly.metrics.salaryMassCents.state).toBe('FORBIDDEN');
      expect(aggregateOnly.distributions.find((item) => item.key === 'age')).toMatchObject({
        state: 'FORBIDDEN',
        items: [],
      });
    } finally {
      await Promise.all([denied, demo, real].map((client) => client.onApplicationShutdown()));
    }
  });
});
