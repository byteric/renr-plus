import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  managementIndicatorHistoryQuerySchema,
  managementIndicatorsSchema,
} from './management-indicators';

const id = '10000000-0000-4000-8000-000000000001';
const context = {
  organizationId: id,
  organization: { id, name: 'Empresa sintética', isActive: true },
  generatedAt: '2026-10-17T12:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
  referenceDate: '2026-10-17',
  filters: { unitId: null, sectorId: null },
  structure: {
    units: { total: 1, active: 1, inactive: 0 },
    sectors: { total: 1, active: 1, inactive: 0 },
    employees: null,
  },
  options: { units: [{ id, name: 'Unidade' }], sectors: [] },
};

it('reconciles arbitrary nonnegative totals and rejects out-of-scope subtotals', () => {
  fc.assert(
    fc.property(
      fc.record({
        planned: fc.nat(500),
        inProgress: fc.nat(500),
        closed: fc.nat(500),
        technicalPending: fc.nat(500),
        cancelled: fc.nat(500),
        classified: fc.nat(500),
        unclassified: fc.nat(500),
        selector: fc.nat(1000),
      }),
      ({
        planned,
        inProgress,
        closed,
        technicalPending,
        cancelled,
        classified,
        unclassified,
        selector,
      }) => {
        const open = planned + inProgress;
        const overdue = selector % (open + 1);
        const implemented = closed + technicalPending;
        const effective = closed + (selector % (technicalPending + 1));
        const levels = classified
          ? [
              {
                methodVersionId: id,
                methodName: 'Matriz',
                methodVersion: 1,
                key: 'high',
                label: 'Alto',
                count: classified,
              },
            ]
          : [];
        const actions = {
          planned,
          inProgress,
          implemented,
          cancelled,
          open,
          overdue,
          technicalPending,
          closed,
          effective,
          total: open + implemented + cancelled,
        };
        const risks = {
          total: classified + unclassified,
          classified,
          unclassified,
          levels,
          units: [
            { unitId: id, name: 'Unidade', count: classified + unclassified, unclassified, levels },
          ],
        };
        const result = {
          ...context,
          actions,
          risks,
          priorities: { total: overdue + technicalPending, items: [], pageSize: 5, page: 10000 },
        };
        expect(managementIndicatorsSchema.safeParse(result).success).toBe(true);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            actions: { ...actions, overdue: open + 1 },
            priorities: { ...result.priorities, total: open + 1 + technicalPending },
          }).success,
        ).toBe(false);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            actions: { ...actions, effective: implemented + 1 },
          }).success,
        ).toBe(false);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            risks: { ...risks, unclassified: unclassified + 1 },
          }).success,
        ).toBe(false);
      },
    ),
  );
});

it('accepts exactly 1–90 inclusive days and validates both boundaries', () => {
  fc.assert(
    fc.property(fc.integer({ min: -15, max: 120 }), (days) => {
      const from = '2026-01-15';
      const to = new Date(Date.parse(from) + days * 86_400_000).toISOString().slice(0, 10);
      expect(managementIndicatorHistoryQuerySchema.safeParse({ from, to }).success).toBe(
        days >= 0 && days < 90,
      );
    }),
  );
});
