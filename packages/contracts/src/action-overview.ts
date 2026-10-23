import { z } from 'zod';
import { actionTimeZoneSchema } from './actions';
const count = z.number().int().nonnegative();
export const actionOverviewSchema = z
  .object({
    organizationId: z.uuid(),
    generatedAt: z.iso.datetime(),
    referenceDate: z.iso.date(),
    timeZone: actionTimeZoneSchema,
    totals: z
      .object({
        total: count,
        planned: count,
        inProgress: count,
        implemented: count,
        cancelled: count,
        open: count,
        overdue: count,
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ totals: t }) =>
      t.total === t.planned + t.inProgress + t.implemented + t.cancelled &&
      t.open === t.planned + t.inProgress &&
      t.overdue <= t.open,
    { path: ['totals'], message: 'Operational counts must reconcile' },
  );
export type ActionOverview = z.infer<typeof actionOverviewSchema>;
