import { calculateCltSettlement } from '../src/modules/people/clt-calculator';

const base = {
  admissionDate: '2026-01-01',
  terminationDate: '2026-06-30',
  monthlySalaryCents: '300000',
  remunerationType: 'FIXED' as const,
  vacationHistoryKnown: true,
  acquiredVacationPeriods: [],
  currentAcquisitionStart: '2026-01-01',
  currentAcquisitionHistoryKnown: true,
  unjustifiedAbsences: 0,
  complexLeaveHistoryKnown: true,
  hasComplexLeaves: false,
  thirteenthHistoryKnown: true,
  thirteenthAdvanceCents: '0',
  fgts: { terminationBaseCents: '0', confirmedIncludesPending: true },
};

function item(input: Parameters<typeof calculateCltSettlement>[0], code: string) {
  return calculateCltSettlement(input).items.find((entry) => entry.code === code);
}

describe('CLT settlement', () => {
  it('rejects overlapping acquired periods instead of counting the same entitlement twice', () => {
    expect(() =>
      calculateCltSettlement({
        ...base,
        admissionDate: '2024-01-01',
        acquiredVacationPeriods: [
          {
            acquisitionStart: '2024-01-01',
            entitlementDays: 30,
            balanceDays: 30,
            concessionDeadline: '2025-12-31',
            historyKnown: true,
          },
          {
            acquisitionStart: '2024-07-01',
            entitlementDays: 30,
            balanceDays: 30,
            concessionDeadline: '2026-06-30',
            historyKnown: true,
          },
        ],
      }),
    ).toThrow('overlapping');
  });

  it('calculates the fixed-salary example with notice projection and separates FGTS', () => {
    const result = calculateCltSettlement({
      admissionDate: '2025-01-01',
      terminationDate: '2026-06-30',
      monthlySalaryCents: '300000',
      remunerationType: 'FIXED',
      vacationHistoryKnown: true,
      complexLeaveHistoryKnown: true,
      hasComplexLeaves: false,
      acquiredVacationPeriods: [
        {
          acquisitionStart: '2025-01-01',
          entitlementDays: 30,
          balanceDays: 30,
          concessionDeadline: '2026-12-31',
          historyKnown: true,
        },
      ],
      currentAcquisitionStart: '2026-01-01',
      currentAcquisitionHistoryKnown: true,
      unjustifiedAbsences: 0,
      thirteenthHistoryKnown: true,
      thirteenthAdvanceCents: '0',
      fgts: { terminationBaseCents: '2000000', confirmedIncludesPending: true },
    });
    expect(result).toMatchObject({
      status: 'complete',
      noticeDays: 33,
      projectedTerminationDate: '2026-08-02',
      grossTotalCents: '1438333',
      subtotalCents: '1438333',
      fgtsPenaltyCents: '800000',
    });
    expect(result.items.map((item) => [item.code, item.amountCents])).toEqual([
      ['SALARY_BALANCE', '300000'],
      ['NOTICE_INDEMNITY', '330000'],
      ['ACQUIRED_VACATION', '400000'],
      ['PROPORTIONAL_VACATION', '233333'],
      ['THIRTEENTH', '175000'],
      ['THIRTEENTH_ADVANCE', '0'],
    ]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it.each([
    ['2026-01-01', '2026-06-30', 30, '2026-07-30'],
    ['2025-01-01', '2026-06-30', 33, '2026-08-02'],
    ['2000-01-01', '2026-06-30', 90, '2026-09-28'],
    ['2024-02-29', '2025-02-28', 33, '2025-04-02'],
  ])(
    'projects notice using completed service years %s to %s',
    (admissionDate, terminationDate, noticeDays, projectedTerminationDate) => {
      expect(
        calculateCltSettlement({
          ...base,
          admissionDate,
          terminationDate,
          currentAcquisitionStart: terminationDate,
        }),
      ).toMatchObject({ noticeDays, projectedTerminationDate });
    },
  );

  it.each([
    [5, '233333'],
    [6, '186667'],
    [14, '186667'],
    [15, '140000'],
    [23, '140000'],
    [24, '93333'],
    [32, '93333'],
    [33, '0'],
  ])('applies vacation absences bracket %i', (unjustifiedAbsences, expected) => {
    expect(item({ ...base, unjustifiedAbsences }, 'PROPORTIONAL_VACATION')?.amountCents).toBe(
      expected,
    );
  });

  it.each([
    ['2026-01-15', '13333'],
    ['2026-01-16', '26667'],
  ])('counts vacation service residual of 14/15 days, ending %s', (terminationDate, expected) => {
    // 30-day notice ends February 14/15: one complete service month plus 14/15 days.
    expect(
      item({ ...base, monthlySalaryCents: '120000', terminationDate }, 'PROPORTIONAL_VACATION')
        ?.amountCents,
    ).toBe(expected);
  });

  it.each([
    ['2026-01-15', '10000'],
    ['2026-01-16', '20000'],
  ])(
    'counts 13th civil month only with at least 15 days through projection %s',
    (terminationDate, expected) => {
      expect(
        item({ ...base, monthlySalaryCents: '120000', terminationDate }, 'THIRTEENTH')?.amountCents,
      ).toBe(expected);
    },
  );

  it('separates 13th years and advancement across year boundary', () => {
    const result = calculateCltSettlement({
      ...base,
      admissionDate: '2026-06-01',
      currentAcquisitionStart: '2026-06-01',
      terminationDate: '2026-12-20',
      monthlySalaryCents: '120000',
      thirteenthAdvanceCents: '20000',
    });
    expect(result.projectedTerminationDate).toBe('2027-01-19');
    expect(
      result.items
        .filter((entry) => entry.code === 'THIRTEENTH')
        .map((entry) => [entry.reference, entry.amountCents]),
    ).toEqual([
      ['2026', '70000'],
      ['2027', '10000'],
    ]);
    expect(
      item({ ...base, thirteenthAdvanceCents: '20000' }, 'THIRTEENTH_ADVANCE')?.amountCents,
    ).toBe('-20000');
  });

  it('uses the real leap-month divisor and bounds same-month admission', () => {
    expect(
      item(
        {
          ...base,
          admissionDate: '2024-02-10',
          currentAcquisitionStart: '2024-02-10',
          terminationDate: '2024-02-29',
          monthlySalaryCents: '290000',
        },
        'SALARY_BALANCE',
      )?.amountCents,
    ).toBe('200000');
    expect(
      item(
        {
          ...base,
          admissionDate: '2024-01-01',
          currentAcquisitionStart: '2024-01-01',
          terminationDate: '2024-02-29',
          monthlySalaryCents: '290000',
        },
        'SALARY_BALANCE',
      )?.amountCents,
    ).toBe('290000');
  });

  it('allows explicit due salary days including zero', () => {
    expect(item({ ...base, paidSalaryDays: 10 }, 'SALARY_BALANCE')?.amountCents).toBe('100000');
    expect(item({ ...base, paidSalaryDays: 0 }, 'SALARY_BALANCE')?.amountCents).toBe('0');
  });

  it('indemnifies only the remaining acquired balance, doubled after concession deadline', () => {
    const input = {
      ...base,
      admissionDate: '2024-01-01',
      acquiredVacationPeriods: [
        {
          acquisitionStart: '2024-01-01',
          entitlementDays: 30,
          balanceDays: 10,
          concessionDeadline: '2025-12-31',
          historyKnown: true,
        },
      ],
    };
    expect(item(input, 'ACQUIRED_VACATION')?.amountCents).toBe('266667');
    expect(
      item(
        {
          ...input,
          acquiredVacationPeriods: [
            { ...input.acquiredVacationPeriods[0]!, concessionDeadline: '2026-12-31' },
          ],
        },
        'ACQUIRED_VACATION',
      )?.amountCents,
    ).toBe('133333');
  });

  it('rolls an acquisition period completed by notice into acquired vacation', () => {
    const result = calculateCltSettlement({ ...base, terminationDate: '2026-12-20' });
    expect(
      result.items
        .filter((entry) => entry.code === 'ACQUIRED_VACATION')
        .map((entry) => entry.amountCents),
    ).toEqual(['400000']);
    expect(result.items.find((entry) => entry.code === 'PROPORTIONAL_VACATION')?.amountCents).toBe(
      '33333',
    );
  });

  it('keeps gross known with missing FGTS but never estimates penalty from salary', () => {
    const result = calculateCltSettlement({ ...base, fgts: undefined });
    expect(result.status).toBe('partial');
    expect(result.fgtsPenaltyCents).toBeNull();
    expect(result.grossTotalCents).not.toBeNull();
    expect(result.missingInputs).toContain('fgts.terminationBaseCents');
    expect(
      calculateCltSettlement({ ...base, fgts: { terminationBaseCents: '2000000' } })
        .fgtsPenaltyCents,
    ).toBeNull();
  });

  it('does not turn unknown histories or advance into zero', () => {
    const result = calculateCltSettlement({
      admissionDate: base.admissionDate,
      terminationDate: base.terminationDate,
      monthlySalaryCents: base.monthlySalaryCents,
    });
    expect(result.status).toBe('partial');
    expect(result.grossTotalCents).toBeNull();
    expect(result.items.some((entry) => entry.amountCents === null)).toBe(true);
    expect(result.missingInputs).toEqual(
      expect.arrayContaining([
        'vacationHistoryKnown',
        'thirteenthAdvanceCents',
        'complexLeaveHistoryKnown',
      ]),
    );
  });

  it('requires an assessed base for variable remuneration and does not process complex leave blindly', () => {
    expect(
      calculateCltSettlement({ ...base, remunerationType: 'VARIABLE' }).grossTotalCents,
    ).toBeNull();
    expect(calculateCltSettlement({ ...base, hasComplexLeaves: true }).grossTotalCents).toBeNull();
  });

  it('uses explicit computable days and does not invent the location of absences', () => {
    expect(
      item({ ...base, thirteenthHistoryKnown: false, unjustifiedAbsences: 6 }, 'THIRTEENTH')
        ?.amountCents,
    ).toBeNull();
    expect(
      item(
        {
          ...base,
          thirteenthComputableDaysByMonth: {
            '2026-01': 14,
            '2026-02': 15,
            '2026-03': 31,
            '2026-04': 30,
            '2026-05': 31,
            '2026-06': 30,
            '2026-07': 30,
          },
        },
        'THIRTEENTH',
      )?.amountCents,
    ).toBe('150000');
  });

  it.each([
    { terminationDate: '2026-02-30' },
    { admissionDate: '2027-01-01' },
    { monthlySalaryCents: '1.00' },
    { monthlySalaryCents: '-1' },
    { monthlySalaryCents: '1000000000000000' },
    { paidSalaryDays: 31 },
    { paidSalaryDays: -1 },
    { unjustifiedAbsences: 1.5 },
    { currentAcquisitionStart: '2027-01-01' },
    {
      acquiredVacationPeriods: [
        {
          acquisitionStart: '2025-01-01',
          entitlementDays: 30,
          balanceDays: 31,
          concessionDeadline: '2026-12-31',
          historyKnown: true,
        },
      ],
    },
  ])('rejects invalid input %j', (override) => {
    expect(() => calculateCltSettlement({ ...base, ...override })).toThrow();
  });

  it('preserves large integer cents and deterministic output without changing input', () => {
    const input = { ...base, monthlySalaryCents: '999999999999999' };
    const before = JSON.stringify(input);
    expect(item(input, 'NOTICE_INDEMNITY')?.amountCents).toBe('999999999999999');
    expect(calculateCltSettlement(input)).toEqual(calculateCltSettlement(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});
