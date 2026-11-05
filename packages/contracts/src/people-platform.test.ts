import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import * as c from './index';
const schemas = c as unknown as Record<string, z.ZodType>;
const schema = (name: string) => schemas[name] ?? z.never();
describe('People contracts and explicit scope', () => {
  it('rejects a vacation entitlement that the CLT calculator cannot use', () => {
    expect(
      c.writeVacationPeriodSchema.safeParse({
        expectedVersion: 0,
        reason: 'Initial record',
        source: 'Confirmed record',
        acquisitionStart: '2025-01-01',
        acquisitionEnd: '2025-12-31',
        concessionDeadline: '2026-12-31',
        entitlementDays: 15,
        balanceDays: 15,
        unjustifiedAbsences: 0,
        historyKnown: true,
        uses: [],
      }).success,
    ).toBe(false);
  });
  it('rejects sections from a different report kind', () => {
    expect(
      c.createTenantReportSchema.safeParse({ kind: 'SST', sectionKeys: ['inventory'] }).success,
    ).toBe(true);
    expect(
      c.createTenantReportSchema.safeParse({ kind: 'SST', sectionKeys: ['people-metrics'] })
        .success,
    ).toBe(false);
    expect(
      c.createTenantReportSchema.safeParse({
        kind: 'PEOPLE',
        sectionKeys: ['people-metrics', 'people-metrics'],
      }).success,
    ).toBe(false);
  });
  it('accepts a self-declared profile without guessing missing history', () => {
    expect(
      schema('updateHrProfileSchema').safeParse({
        expectedVersion: 0,
        reason: 'Initial record',
        source: 'Employee declaration',
        birthDate: null,
        gender: 'PREFER_NOT_TO_SAY',
        genderDescription: null,
        vacationHistoryKnown: false,
        complexLeaveHistoryKnown: false,
        hasComplexLeaves: false,
        followUp: false,
      }).success,
    ).toBe(true);
  });
  it('keeps exact salary in a declared competence', () => {
    expect(
      schema('writeRemunerationSchema').safeParse({
        expectedVersion: 0,
        reason: 'Initial payroll',
        source: 'Payroll import',
        competence: '2026-11',
        salaryCents: '300000',
        remunerationType: 'FIXED',
      }).success,
    ).toBe(true);
  });
  it('preserves monetary cent strings through JSON at the full permitted precision', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 999_999_999_999_999n }), (amount) => {
        const salaryCents = amount.toString();
        const transported: unknown = JSON.parse(JSON.stringify(salaryCents));
        expect(BigInt(c.moneyCentsSchema.parse(transported))).toBe(amount);
        expect(c.moneyCentsSchema.safeParse(Number(amount)).success).toBe(false);
      }),
    );
  });
  it('converts every allowed pagination parameter and refuses larger pages', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 101, max: 10_000 }),
        (page, pageSize, oversize) => {
          expect(
            c.hrPaginationSchema.parse({ page: String(page), pageSize: String(pageSize) }),
          ).toEqual({ page, pageSize });
          expect(c.hrPaginationSchema.safeParse({ page, pageSize: oversize }).success).toBe(false);
        },
      ),
    );
  });
  it('requires an explicit global grant and expected version', () => {
    expect(
      schema('writePlatformGrantSchema').safeParse({
        expectedVersion: 0,
        userId: '11111111-1111-4111-8111-111111111111',
        capability: 'READ_OVERVIEW',
        isActive: true,
        reason: 'Authorized manager',
      }).success,
    ).toBe(true);
  });
});
