import { z } from 'zod';

const count = z.number().int().nonnegative();
const counts = { total: count, draft: count, registered: count };
const unitSchema = z
  .object({
    kind: z.literal('UNIT'),
    unitId: z.uuid(),
    name: z.string(),
    isActive: z.boolean(),
    ...counts,
  })
  .strict();
const othersSchema = z
  .object({ kind: z.literal('OTHERS'), name: z.literal('Outras unidades'), ...counts })
  .strict();
export const riskOverviewSchema = z
  .object({
    organizationId: z.uuid(),
    generatedAt: z.iso.datetime(),
    totals: z.object({ ...counts, withEvaluation: count, withoutEvaluation: count }).strict(),
    units: z.array(z.discriminatedUnion('kind', [unitSchema, othersSchema])).max(9),
  })
  .strict()
  .superRefine((value, ctx) => {
    const totals = value.totals;
    const units = value.units;
    if (
      totals.total !== totals.draft + totals.registered ||
      totals.total !== totals.withEvaluation + totals.withoutEvaluation ||
      totals.withEvaluation > totals.registered ||
      units.reduce((sum, unit) => sum + unit.total, 0) !== totals.total ||
      units.reduce((sum, unit) => sum + unit.draft, 0) !== totals.draft ||
      units.some((unit) => unit.total !== unit.draft + unit.registered) ||
      units.filter((unit) => unit.kind === 'UNIT').length > 8 ||
      units.filter((unit) => unit.kind === 'OTHERS').length > 1 ||
      new Set(units.filter((unit) => unit.kind === 'UNIT').map((unit) => unit.unitId)).size !==
        units.filter((unit) => unit.kind === 'UNIT').length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['totals'],
        message: 'Operational counts must reconcile',
      });
    }
  });
export type RiskOverview = z.infer<typeof riskOverviewSchema>;
