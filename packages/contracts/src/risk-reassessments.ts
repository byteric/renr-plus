import { z } from 'zod';
import { actionVersionSchema, actionAuthorSchema } from './actions';
import { efficacyFingerprintSchema, efficacyOpinionSchema } from './action-efficacy';
import {
  createTechnicalRiskEvaluationSchema,
  technicalRiskEvaluationSchema,
  technicalRiskEvaluationSummarySchema,
} from './risk-workspaces';

export const evaluationComparisonStateSchema = z.enum([
  'COMPARABLE',
  'METHOD_VERSION_CHANGED',
  'NO_BASELINE',
]);
export function compareTechnicalEvaluations(
  previous: { method: { versionId: string } } | null,
  current: { method: { versionId: string } } | null,
): z.infer<typeof evaluationComparisonStateSchema> {
  if (!previous || !current) return 'NO_BASELINE';
  return previous.method.versionId === current.method.versionId
    ? 'COMPARABLE'
    : 'METHOD_VERSION_CHANGED';
}
export const reassessmentMeasureInputSchema = z
  .object({
    actionId: z.uuid(),
    expectedVersion: actionVersionSchema,
    opinionId: z.uuid(),
    expectedContextFingerprint: efficacyFingerprintSchema,
    consideration: z.string().trim().min(20).max(4000),
  })
  .strict();
export const createRiskReassessmentSchema = z
  .object({
    evaluation: createTechnicalRiskEvaluationSchema,
    expectedPreviousEvaluationId: z.uuid(),
    measures: z.array(reassessmentMeasureInputSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.measures.map((item) => item.actionId)).size !== value.measures.length)
      ctx.addIssue({ code: 'custom', path: ['measures'], message: 'Each measure must be unique' });
    if (new Set(value.measures.map((item) => item.opinionId)).size !== value.measures.length)
      ctx.addIssue({ code: 'custom', path: ['measures'], message: 'Each opinion must be unique' });
  });
export const reassessmentMeasureSchema = z
  .object({
    id: z.uuid(),
    actionId: z.uuid(),
    actionVersion: actionVersionSchema,
    actionFingerprint: efficacyFingerprintSchema,
    riskContextFingerprint: efficacyFingerprintSchema,
    contextFingerprint: efficacyFingerprintSchema,
    consideration: z.string().min(20).max(4000),
    opinion: efficacyOpinionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.opinion.actionId !== value.actionId ||
      value.opinion.actionVersion > value.actionVersion ||
      value.opinion.actionFingerprint !== value.actionFingerprint ||
      value.opinion.riskContextFingerprint !== value.riskContextFingerprint ||
      value.opinion.contextFingerprint !== value.contextFingerprint
    )
      ctx.addIssue({ code: 'custom', message: 'Preserved measure and opinion must agree' });
  });
const identity = {
  id: z.uuid(),
  organizationId: z.uuid(),
  riskId: z.uuid(),
  author: actionAuthorSchema,
  createdAt: z.iso.datetime(),
};
export const riskReassessmentSummarySchema = z
  .object({
    ...identity,
    evaluation: technicalRiskEvaluationSummarySchema,
    previousEvaluation: technicalRiskEvaluationSummarySchema,
    comparison: evaluationComparisonStateSchema,
    measureCount: z.number().int().min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.evaluation.riskId !== value.riskId ||
      value.previousEvaluation.riskId !== value.riskId ||
      value.evaluation.organizationId !== value.organizationId ||
      value.previousEvaluation.organizationId !== value.organizationId ||
      value.previousEvaluation.sequence + 1 !== value.evaluation.sequence ||
      value.comparison !== compareTechnicalEvaluations(value.previousEvaluation, value.evaluation)
    )
      ctx.addIssue({ code: 'custom', message: 'Reassessment chain and comparison must agree' });
  });
export const riskReassessmentSchema = z
  .object({
    ...identity,
    evaluation: technicalRiskEvaluationSchema,
    previousEvaluation: technicalRiskEvaluationSchema,
    comparison: evaluationComparisonStateSchema,
    measures: z.array(reassessmentMeasureSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.evaluation.riskId !== value.riskId ||
      value.previousEvaluation.riskId !== value.riskId ||
      value.evaluation.organizationId !== value.organizationId ||
      value.previousEvaluation.organizationId !== value.organizationId ||
      value.previousEvaluation.sequence + 1 !== value.evaluation.sequence ||
      value.comparison !==
        compareTechnicalEvaluations(value.previousEvaluation, value.evaluation) ||
      new Set(value.measures.map((item) => item.actionId)).size !== value.measures.length ||
      value.measures.some(
        (item) =>
          item.opinion.riskId !== value.riskId ||
          item.opinion.organizationId !== value.organizationId,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Reassessment must preserve one coherent risk chain',
      });
  });
export const riskReassessmentListSchema = z
  .object({
    items: z.array(riskReassessmentSummarySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();
export const reassessmentContextSchema = z
  .object({
    organizationId: z.uuid(),
    riskId: z.uuid(),
    riskVersion: actionVersionSchema,
    latestEvaluation: technicalRiskEvaluationSchema.nullable(),
    latestReassessment: riskReassessmentSummarySchema.nullable(),
    permissions: z
      .object({ hasTechnicalCapability: z.boolean(), canReassess: z.boolean() })
      .strict(),
    blockingReasons: z.array(z.enum(['NO_TECHNICAL_CAPABILITY', 'NO_BASELINE', 'ORIGIN_INACTIVE'])),
  })
  .strict();
export type CreateRiskReassessmentInput = z.infer<typeof createRiskReassessmentSchema>;
export type ReassessmentMeasureInput = z.infer<typeof reassessmentMeasureInputSchema>;
export type RiskReassessment = z.infer<typeof riskReassessmentSchema>;
export type RiskReassessmentSummary = z.infer<typeof riskReassessmentSummarySchema>;
export type RiskReassessmentList = z.infer<typeof riskReassessmentListSchema>;
export type ReassessmentContext = z.infer<typeof reassessmentContextSchema>;
