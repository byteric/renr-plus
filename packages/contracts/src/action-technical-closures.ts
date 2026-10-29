import { z } from 'zod';
import {
  actionAuthorSchema,
  actionDetailSchema,
  actionVersionSchema,
  createActionSchema,
} from './actions';
import {
  efficacyContextSchema,
  efficacyFingerprintSchema,
  efficacyProofPackageSchema,
} from './action-efficacy';
import { riskReassessmentSummarySchema } from './risk-reassessments';
import { technicalRiskEvaluationSummarySchema } from './risk-workspaces';

export const technicalClosureReviewReasonSchema = z.enum([
  'ACTION_CONTENT_CHANGED',
  'RISK_CONTEXT_CHANGED',
  'ORIGIN_INACTIVE',
  'OPINION_SUPERSEDED',
  'SELECTED_EVIDENCE_ARCHIVED',
  'SELECTED_EVIDENCE_UNAVAILABLE',
  'SELECTED_EVIDENCE_CHANGED',
  'REASSESSMENT_SUPERSEDED',
]);
export const createTechnicalClosureSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    expectedRiskVersion: actionVersionSchema,
    expectedLatestEvaluationId: z.uuid(),
    expectedLatestClosureId: z.uuid().nullable(),
    expectedContextFingerprint: efficacyFingerprintSchema,
    reassessmentId: z.uuid(),
    opinionId: z.uuid(),
    rationale: z.string().trim().min(20).max(4000),
  })
  .strict();
export const technicalClosureSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    actionId: z.uuid(),
    sequence: actionVersionSchema,
    supersedesId: z.uuid().nullable(),
    reassessmentId: z.uuid(),
    opinionId: z.uuid(),
    actionVersion: actionVersionSchema,
    riskVersion: actionVersionSchema,
    actionFingerprint: efficacyFingerprintSchema,
    riskContextFingerprint: efficacyFingerprintSchema,
    contextFingerprint: efficacyFingerprintSchema,
    proofPackage: efficacyProofPackageSchema,
    rationale: z.string().min(20).max(4000),
    author: actionAuthorSchema,
    createdAt: z.iso.datetime(),
    validity: z.enum(['CURRENT', 'SUPERSEDED', 'REVIEW_REQUIRED']),
    reviewReasons: z.array(technicalClosureReviewReasonSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.validity === 'REVIEW_REQUIRED') !== value.reviewReasons.length > 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Closure validity must explain review requirements',
      });
  });
export const closureBlockingReasonSchema = z.enum([
  'NO_TECHNICAL_CAPABILITY',
  'ACTION_NOT_IMPLEMENTED',
  'ORIGIN_INACTIVE',
  'NO_CURRENT_EFFECTIVE_OPINION',
  'NO_CURRENT_REASSESSMENT',
  'MEASURE_NOT_CONSIDERED',
  'ALREADY_CLOSED',
]);
export const technicalClosureContextSchema = z
  .object({
    organizationId: z.uuid(),
    actionId: z.uuid(),
    riskId: z.uuid(),
    riskVersion: actionVersionSchema,
    efficacy: efficacyContextSchema,
    latestEvaluation: technicalRiskEvaluationSummarySchema.nullable(),
    latestReassessment: riskReassessmentSummarySchema.nullable(),
    latest: technicalClosureSchema.nullable(),
    permissions: z
      .object({
        hasTechnicalCapability: z.boolean(),
        canClose: z.boolean(),
        canCreateCorrective: z.boolean(),
      })
      .strict(),
    blockingReasons: z.array(closureBlockingReasonSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.actionId !== value.efficacy.actionId ||
      value.riskId !== value.efficacy.riskId ||
      value.organizationId !== value.efficacy.organizationId ||
      value.permissions.canClose !== (value.blockingReasons.length === 0) ||
      (value.permissions.canClose && !value.permissions.hasTechnicalCapability)
    )
      ctx.addIssue({ code: 'custom', message: 'Closure context and eligibility must agree' });
  });
export const technicalClosureListSchema = z
  .object({
    items: z.array(technicalClosureSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();
export const createCorrectiveActionSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    opinionId: z.uuid(),
    expectedContextFingerprint: efficacyFingerprintSchema,
    reason: z.string().trim().min(20).max(4000),
    action: createActionSchema,
  })
  .strict();
export const correctiveActionLinkSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    previousActionId: z.uuid(),
    newActionId: z.uuid(),
    opinionId: z.uuid(),
    reason: z.string().min(20).max(4000),
    author: actionAuthorSchema,
    createdAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) => value.previousActionId !== value.newActionId,
    'A corrective action must be a new record',
  );
export const correctiveActionCreatedSchema = z
  .object({ link: correctiveActionLinkSchema, action: actionDetailSchema })
  .strict();
export const correctiveActionListSchema = z
  .object({
    items: z.array(correctiveActionLinkSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();
export type CreateTechnicalClosureInput = z.infer<typeof createTechnicalClosureSchema>;
export type TechnicalClosure = z.infer<typeof technicalClosureSchema>;
export type TechnicalClosureContext = z.infer<typeof technicalClosureContextSchema>;
export type TechnicalClosureList = z.infer<typeof technicalClosureListSchema>;
export type TechnicalClosureReviewReason = z.infer<typeof technicalClosureReviewReasonSchema>;
export type CreateCorrectiveActionInput = z.infer<typeof createCorrectiveActionSchema>;
export type CorrectiveActionLink = z.infer<typeof correctiveActionLinkSchema>;
export type CorrectiveActionCreated = z.infer<typeof correctiveActionCreatedSchema>;
export type CorrectiveActionList = z.infer<typeof correctiveActionListSchema>;
