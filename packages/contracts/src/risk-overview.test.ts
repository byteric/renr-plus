import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import type { z } from 'zod';
const schemas = contracts as unknown as Record<string, z.ZodType>;
const overview = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  generatedAt: '2026-10-17T12:00:00.000Z',
  totals: { total: 2, draft: 1, registered: 1, withEvaluation: 1, withoutEvaluation: 1 },
  units: [
    {
      kind: 'UNIT',
      unitId: '00000000-0000-4000-8000-000000000002',
      name: 'Unidade',
      isActive: false,
      total: 2,
      draft: 1,
      registered: 1,
    },
  ],
};
describe('risk overview contract', () => {
  it('accepts operational counts including inactive units', () =>
    expect(schemas.riskOverviewSchema?.safeParse(overview).success).toBe(true));
  it.each([
    { totals: { ...overview.totals, total: 3 } },
    { units: [] },
    { score: 3 },
    { totals: { ...overview.totals, withoutEvaluation: 2 } },
    { units: [{ ...overview.units[0], kind: 'OTHERS' }] },
  ])('rejects inconsistent counts or private/normative data', (override) => {
    expect(
      schemas.riskOverviewSchema?.safeParse({ ...overview, ...override }).success ?? false,
    ).toBe(false);
  });
});
