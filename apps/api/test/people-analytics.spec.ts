import { metric, distribution } from '../src/modules/people/people-projection';
import { PeopleAnalyticsService } from '../src/modules/people/people-analytics.service';
import type { PrismaService } from '../src/database/prisma.service';
describe('PeopleAnalytics authorization', () => {
  it.each([
    null,
    { isActive: false, hrCapabilities: ['HR_ANALYTICS_READ'] },
    { isActive: true, role: 'ADMIN', hrCapabilities: [] },
  ])('requires active tenant-specific HR capability', async (membership) => {
    const tx = { membership: { findUnique: jest.fn().mockResolvedValue(membership) } };
    const database = {
      client: {
        $transaction: async (operation: (client: unknown) => Promise<unknown>) => operation(tx),
      },
    };
    await expect(
      new PeopleAnalyticsService(database as unknown as PrismaService).overview(
        { userId: 'user', organizationId: 'org' },
        {},
      ),
    ).rejects.toThrow('Forbidden');
  });
  it('does not read remuneration or settlement parameters without financial capability', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const aggregate = {
      total: 10,
      active: 10,
      inactive: 0,
      eligible: 10,
      ageKnown: 0,
      ageAverage: null,
      tenureKnown: 0,
      tenureAverage: null,
      genderKnown: 0,
      overdue: 0,
      unknown: 10,
      due: 0,
      buckets: [],
    };
    const tx = {
      membership: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ isActive: true, hrCapabilities: ['HR_ANALYTICS_READ'] }),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: organizationId,
          name: 'Synthetic organization',
          timezone: 'America/Sao_Paulo',
          fiscalIdentifier: null,
          normalizedFiscalIdentifier: null,
          fiscalState: 'MISSING',
          clientClassification: 'UNCLASSIFIED',
          isActive: true,
          registrationVersion: 1,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([aggregate]),
    };
    const transaction = jest.fn<
      Promise<unknown>,
      [operation: (client: unknown) => Promise<unknown>, options: unknown]
    >(async (operation) => operation(tx));
    const service = new PeopleAnalyticsService({
      client: { $transaction: transaction },
    } as unknown as PrismaService);
    const result = await service.overview({ userId: 'user', organizationId }, {});
    expect(result.metrics.salaryMassCents.state).toBe('FORBIDDEN');
    expect(result.metrics.terminationGrossCents.state).toBe('FORBIDDEN');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0]![0].sql).not.toMatch(/remuneration|settlement_parameters/);
    expect(transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: 'RepeatableRead' });
  });
});

describe('HR_MIN5_COMPLEMENT_V1', () => {
  it.each([
    [4, 6],
    [6, 4],
    [0, 1],
    [1, 0],
  ])('hides value and both coverage cells for %s/%s', (known, missing) => {
    expect(metric('123', known, missing, 'coverage')).toMatchObject({
      state: 'SUPPRESSED',
      value: null,
      known: null,
      missing: null,
    });
  });
  it('does not confuse known zero with missing data', () => {
    expect(metric('0', 5, 0, 'zero')).toMatchObject({
      state: 'KNOWN',
      value: '0',
      known: 5,
      missing: 0,
    });
    expect(metric(null, 0, 5, 'missing')).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      value: null,
      known: 0,
      missing: 5,
    });
  });
  it('suppresses the complete distribution including unknown and complement', () => {
    expect(
      distribution('gender', 'Gênero', [
        { key: 'FEMALE', label: 'Feminino', count: 1 },
        { key: 'MALE', label: 'Masculino', count: 99 },
        { key: 'UNKNOWN', label: 'Não informado', count: 0 },
      ]),
    ).toMatchObject({ state: 'SUPPRESSED', items: [] });
  });
  it('preserves totals for every releasable partition', () => {
    for (let a = 5; a < 30; a++)
      for (let b = 5; b < 30; b++) {
        const result = distribution('test', 'Test', [
          { key: 'a', label: 'A', count: a },
          { key: 'b', label: 'B', count: b },
        ]);
        expect(result.items.reduce((sum, item) => sum + item.count!, 0)).toBe(a + b);
      }
  });
});
