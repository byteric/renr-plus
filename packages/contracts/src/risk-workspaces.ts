import { z } from 'zod';
import { riskDetailSchema, riskContextSnapshotSchema, riskListQuerySchema } from './risks';
import { evaluationMethodKeySchema, evaluationMethodVersionSchema } from './evaluation-methods';

const version = z.number().int().min(1).max(2147483647);
const author = z.object({ id: z.uuid(), name: z.string() }).strict();
const choice = z
  .object({ key: evaluationMethodKeySchema, label: z.string().min(1).max(120) })
  .strict();
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const technicalSourceReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('RISK_RECORD'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('ASSESSMENT_CYCLE'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('ASSESSMENT_SOURCE'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('DOCUMENT'), reference: z.string().trim().min(5).max(1000) }).strict(),
]);
export const technicalSourceSnapshotSchema = z
  .object({
    kind: z.enum(['RISK_RECORD', 'ASSESSMENT_CYCLE', 'ASSESSMENT_SOURCE', 'DOCUMENT']),
    id: z.uuid().nullable(),
    title: z.string().min(1).max(1000),
    reference: z.string().min(1).max(1000),
    isDemonstration: z.boolean(),
    capturedAt: z.iso.datetime(),
  })
  .strict();
export const createTechnicalRiskEvaluationSchema = z
  .object({
    expectedVersion: version,
    methodVersionId: z.uuid(),
    probabilityKey: evaluationMethodKeySchema,
    severityKey: evaluationMethodKeySchema,
    rationale: z.string().trim().min(10).max(4000),
    context: z.string().trim().min(10).max(4000),
    sources: z.array(technicalSourceReferenceSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.sources.map(
      (item) => `${item.kind}:${'id' in item ? item.id : item.reference}`,
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Source references must be unique',
      });
  });
export const technicalRiskEvaluationSummarySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    sequence: version,
    riskVersion: version,
    label: z.literal('TECHNICAL'),
    method: z
      .object({
        id: z.uuid(),
        name: z.string(),
        versionId: z.uuid(),
        version,
        approvalReference: z.string().min(5).max(1000),
      })
      .strict(),
    probability: choice,
    severity: choice,
    level: choice,
    priority: choice.extend({ rank: z.number().int().min(1).max(20) }),
    author,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const technicalRiskEvaluationSchema = technicalRiskEvaluationSummarySchema
  .extend({
    rationale: z.string().min(10).max(4000),
    context: z.string().min(10).max(4000),
    contextSnapshot: riskContextSnapshotSchema,
    sources: z.array(technicalSourceSnapshotSchema).min(1).max(20),
  })
  .strict();
export const technicalRiskEvaluationListSchema = list(technicalRiskEvaluationSchema);
export const technicalEvaluationStateSchema = z.enum(['ABSENT', 'CURRENT', 'CONTEXT_CHANGED']);
export const riskWorkspaceSchema = riskDetailSchema
  .extend({
    sourceLabel: z.string(),
    technicalEvaluationState: technicalEvaluationStateSchema,
    latestTechnicalEvaluation: technicalRiskEvaluationSummarySchema.nullable(),
    actionSummary: z
      .object({
        total: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        overdue: z.number().int().nonnegative(),
      })
      .strict(),
    pendingReasons: z.array(
      z.enum(['NO_TECHNICAL_EVALUATION', 'CONTEXT_CHANGED', 'NO_ACTIONS', 'INACTIVE_SCOPE']),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.technicalEvaluationState === 'ABSENT') !==
      (value.latestTechnicalEvaluation === null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['technicalEvaluationState'],
        message: 'Technical state and history must agree',
      });
  });
export const riskWorkspaceListSchema = list(riskWorkspaceSchema);
export const riskWorkspaceQuerySchema = riskListQuerySchema;
export const riskMatrixQuerySchema = riskListQuerySchema
  .extend({ methodVersionId: z.uuid() })
  .strict();
export const riskMatrixSchema = z
  .object({
    methodVersion: evaluationMethodVersionSchema,
    cells: z
      .array(
        z
          .object({
            probabilityKey: evaluationMethodKeySchema,
            severityKey: evaluationMethodKeySchema,
            levelKey: evaluationMethodKeySchema,
            priorityKey: evaluationMethodKeySchema,
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(400),
    totalMatched: z.number().int().nonnegative(),
    classifiedTotal: z.number().int().nonnegative(),
    excluded: z
      .object({
        unclassified: z.number().int().nonnegative(),
        contextChanged: z.number().int().nonnegative(),
        incompatible: z.number().int().nonnegative(),
        inactiveScope: z.number().int().nonnegative(),
        notRegistered: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.methodVersion.status !== 'PUBLISHED')
      ctx.addIssue({
        code: 'custom',
        path: ['methodVersion'],
        message: 'Matrix requires a published method',
      });
    if (
      value.cells.reduce((total, cell) => total + cell.count, 0) !== value.classifiedTotal ||
      value.classifiedTotal +
        Object.values(value.excluded).reduce((sum, count) => sum + count, 0) !==
        value.totalMatched
    )
      ctx.addIssue({ code: 'custom', message: 'Matrix totals must reconcile' });
  });
export const riskSourceOptionSchema = z
  .object({
    kind: z.enum(['RISK_RECORD', 'ASSESSMENT_CYCLE', 'ASSESSMENT_SOURCE']),
    id: z.uuid(),
    label: z.string(),
    reference: z.string(),
    isDemonstration: z.boolean(),
    eligible: z.boolean(),
    unavailableReason: z.string().nullable(),
  })
  .strict();
export const riskSourceOptionListSchema = list(riskSourceOptionSchema);
export type TechnicalSourceReference = z.infer<typeof technicalSourceReferenceSchema>;
export type TechnicalSourceSnapshot = z.infer<typeof technicalSourceSnapshotSchema>;
export type CreateTechnicalRiskEvaluationInput = z.infer<
  typeof createTechnicalRiskEvaluationSchema
>;
export type TechnicalRiskEvaluationSummary = z.infer<typeof technicalRiskEvaluationSummarySchema>;
export type TechnicalRiskEvaluation = z.infer<typeof technicalRiskEvaluationSchema>;
export type TechnicalRiskEvaluationList = z.infer<typeof technicalRiskEvaluationListSchema>;
export type RiskWorkspace = z.infer<typeof riskWorkspaceSchema>;
export type RiskWorkspaceList = z.infer<typeof riskWorkspaceListSchema>;
export type RiskMatrix = z.infer<typeof riskMatrixSchema>;
export type RiskMatrixQuery = z.infer<typeof riskMatrixQuerySchema>;
export type RiskSourceOption = z.infer<typeof riskSourceOptionSchema>;
export type RiskSourceOptionList = z.infer<typeof riskSourceOptionListSchema>;
