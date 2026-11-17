import { z } from 'zod';
import { actionStatusSchema } from './actions';

export const assessmentComparisonQuerySchema = z.strictObject({
  referenceCycleId: z.uuid(),
  currentCycleId: z.uuid(),
  unitId: z.uuid().optional(),
  sectorId: z.uuid().optional(),
});

export const assessmentComparisonReasonSchema = z.enum([
  'SAME_CYCLE',
  'OPEN_CYCLE',
  'SCOPE_MISMATCH',
  'INSTRUMENT_VERSION',
  'POLICY_VERSION',
  'PERIOD_ORDER',
]);

const point = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});
const scope = z.strictObject({
  unitId: z.uuid(),
  unitName: z.string(),
  sectorId: z.uuid(),
  sectorName: z.string(),
  groupId: z.uuid(),
  groupName: z.string(),
});
const rate = z.number().min(0).max(100);
const count = z.number().int().nonnegative();

export const assessmentComparisonTrendSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('AVAILABLE'),
    reference: rate,
    current: rate,
    difference: z.number().min(-100).max(100),
    direction: z.enum(['INCREASE', 'DECREASE', 'STABLE']),
  }),
  z.strictObject({ status: z.enum(['PROTECTED', 'UNKNOWN_BASE', 'NOT_COMPARABLE']) }),
]);

const operationsPeriod = z.strictObject({
  implemented: count,
  pending: count,
  cancelled: count,
  withoutSnapshot: count,
  effective: count,
  notEffective: count,
  inconclusive: count,
  withoutOpinion: count,
  riskLevels: z.array(
    z.strictObject({
      methodVersionId: z.uuid(),
      methodName: z.string(),
      level: z.string(),
      total: count,
    }),
  ),
  unclassifiedRisks: count,
});

const operations = z.strictObject({
  source: z.literal('GROUP_AT_PERIOD_CLOSE'),
  reference: operationsPeriod,
  current: operationsPeriod,
  reassessmentTotal: count,
  relatedActions: z
    .array(
      z.strictObject({
        cycleId: z.uuid(),
        riskId: z.uuid(),
        riskLabel: z.string(),
        actionId: z.uuid(),
        actionTitle: z.string(),
        dueDate: z.iso.date(),
        status: actionStatusSchema.exclude(['CANCELLED']),
      }),
    )
    .max(12),
  reassessments: z
    .array(
      z.strictObject({
        id: z.uuid(),
        riskId: z.uuid(),
        riskLabel: z.string(),
        recordedAt: z.iso.datetime(),
        referenceLevel: z.string().nullable(),
        currentLevel: z.string().nullable(),
        direction: z.enum(['IMPROVED', 'WORSENED', 'STABLE', 'NOT_COMPARABLE']),
        actionIds: z.array(z.uuid()),
      }),
    )
    .max(12),
});

export const assessmentComparisonSchema = z.discriminatedUnion('status', [
  z.strictObject({
    organizationId: z.uuid(),
    reference: point,
    current: point,
    status: z.literal('COMPARABLE'),
    reasons: z.tuple([]),
    scope,
    participation: assessmentComparisonTrendSchema,
    factors: z.array(
      z.strictObject({
        questionId: z.uuid(),
        questionLabel: z.string(),
        optionId: z.uuid(),
        optionLabel: z.string(),
        trend: assessmentComparisonTrendSchema,
      }),
    ),
    operations,
  }),
  z.strictObject({
    organizationId: z.uuid(),
    reference: point,
    current: point,
    status: z.literal('INCOMPATIBLE'),
    reasons: z.array(assessmentComparisonReasonSchema).min(1),
    scope: scope.nullable(),
    participation: z.strictObject({ status: z.literal('NOT_COMPARABLE') }),
    factors: z.tuple([]),
    operations: z.null(),
  }),
]);

export type AssessmentComparisonQuery = z.infer<typeof assessmentComparisonQuerySchema>;
export type AssessmentComparisonReason = z.infer<typeof assessmentComparisonReasonSchema>;
export type AssessmentComparisonTrend = z.infer<typeof assessmentComparisonTrendSchema>;
export type AssessmentComparison = z.infer<typeof assessmentComparisonSchema>;
