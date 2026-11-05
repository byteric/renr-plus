import { z } from 'zod';
import { actionTimeZoneSchema } from './actions';
import { evaluationMethodKeySchema } from './evaluation-methods';

const count = z.number().int().nonnegative();
const filter = { unitId: z.uuid().optional(), sectorId: z.uuid().optional() };
export const managementIndicatorsQuerySchema = z
  .object({ ...filter, page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const managementIndicatorHistoryQuerySchema = z
  .object({ ...filter, from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) < 90 * 86400000, {
    path: ['to'],
    message: 'O período deve ter até 90 dias inclusivos.',
  });
const context = {
  organizationId: z.uuid(),
  generatedAt: z.iso.datetime(),
  timeZone: actionTimeZoneSchema,
  filters: z.object({ unitId: z.uuid().nullable(), sectorId: z.uuid().nullable() }).strict(),
};
const structureCount = z
  .object({ total: count, active: count, inactive: count })
  .strict()
  .refine((value) => value.total === value.active + value.inactive);
const named = z.object({ id: z.uuid(), name: z.string() }).strict();
const level = z
  .object({
    methodVersionId: z.uuid(),
    methodName: z.string(),
    methodVersion: z.number().int().positive(),
    key: evaluationMethodKeySchema,
    label: z.string(),
    count,
  })
  .strict();
const sumLevels = (levels: { count: number }[]) =>
  levels.reduce((sum, item) => sum + item.count, 0);
const unit = z
  .object({
    unitId: z.uuid(),
    name: z.string(),
    count,
    unclassified: count,
    levels: z.array(level),
  })
  .strict()
  .refine((value) => value.count === value.unclassified + sumLevels(value.levels));
export const managementIndicatorsSchema = z
  .object({
    ...context,
    organization: named.extend({ isActive: z.boolean() }).strict(),
    referenceDate: z.iso.date(),
    structure: z
      .object({
        units: structureCount,
        sectors: structureCount,
        employees: structureCount.nullable(),
      })
      .strict(),
    options: z
      .object({
        units: z.array(named),
        sectors: z.array(named.extend({ unitId: z.uuid() }).strict()),
      })
      .strict(),
    risks: z
      .object({
        total: count,
        classified: count,
        unclassified: count,
        levels: z.array(level),
        units: z.array(unit),
      })
      .strict()
      .refine(
        (value) =>
          value.total === value.classified + value.unclassified &&
          value.classified === sumLevels(value.levels) &&
          value.total === value.units.reduce((sum, item) => sum + item.count, 0) &&
          value.unclassified === value.units.reduce((sum, item) => sum + item.unclassified, 0),
      ),
    actions: z
      .object({
        total: count,
        planned: count,
        inProgress: count,
        implemented: count,
        cancelled: count,
        open: count,
        overdue: count,
        technicalPending: count,
        closed: count,
        effective: count,
      })
      .strict()
      .refine(
        (a) =>
          a.total === a.planned + a.inProgress + a.implemented + a.cancelled &&
          a.open === a.planned + a.inProgress &&
          a.overdue <= a.open &&
          a.technicalPending + a.closed === a.implemented &&
          a.closed <= a.effective &&
          a.effective <= a.implemented,
      ),
    priorities: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: count,
        items: z.array(
          z
            .object({
              actionId: z.uuid(),
              title: z.string(),
              riskId: z.uuid(),
              unitId: z.uuid(),
              sectorId: z.uuid(),
              dueDate: z.iso.date(),
              kind: z.enum(['OVERDUE', 'TECHNICAL_PENDING']),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.organization.id === value.organizationId &&
      value.priorities.total === value.actions.overdue + value.actions.technicalPending &&
      value.priorities.items.length ===
        Math.max(
          0,
          Math.min(
            value.priorities.pageSize,
            value.priorities.total - (value.priorities.page - 1) * value.priorities.pageSize,
          ),
        ),
  );
export const managementIndicatorHistorySchema = z
  .object({
    ...context,
    from: z.iso.date(),
    to: z.iso.date(),
    points: z
      .array(
        z
          .object({
            date: z.iso.date(),
            evaluations: count,
            implementations: count,
            closures: count,
          })
          .strict(),
      )
      .max(90),
  })
  .strict();
export type ManagementIndicators = z.infer<typeof managementIndicatorsSchema>;
export type ManagementIndicatorsQuery = z.infer<typeof managementIndicatorsQuerySchema>;
export type ManagementIndicatorHistory = z.infer<typeof managementIndicatorHistorySchema>;
export type ManagementIndicatorHistoryQuery = z.infer<typeof managementIndicatorHistoryQuerySchema>;
