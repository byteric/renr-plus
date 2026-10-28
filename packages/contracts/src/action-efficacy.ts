import { z } from 'zod';
import {
  actionAuthorSchema,
  actionCivilDateSchema,
  actionOperationalSnapshotSchema,
  actionPageSchema,
  actionPaginationQuerySchema,
  actionVersionSchema,
} from './actions';
import { riskContextSnapshotSchema, riskStatusSchema } from './risks';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const efficacyFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const efficacyResultSchema = z.enum(['EFFECTIVE', 'NOT_EFFECTIVE', 'INCONCLUSIVE']);
export const efficacyReviewReasonSchema = z.enum([
  'ACTION_CONTENT_CHANGED',
  'RISK_CONTEXT_CHANGED',
  'ORIGIN_INACTIVE',
  'SELECTED_EVIDENCE_ARCHIVED',
  'SELECTED_EVIDENCE_UNAVAILABLE',
  'SELECTED_EVIDENCE_CHANGED',
]);
export const efficacyTextInputSchema = z
  .object({
    reference: text(5, 200),
    description: text(20, 4000),
    rationale: text(10, 2000),
  })
  .strict();
export const createEfficacyOpinionSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    expectedLatestOpinionId: z.uuid().nullable(),
    expectedContextFingerprint: efficacyFingerprintSchema,
    result: efficacyResultSchema,
    verifiedOn: actionCivilDateSchema,
    observation: text(20, 4000),
    rationale: text(20, 4000),
    evidenceIds: z.array(z.uuid()).max(20),
    textualEvidence: z.array(efficacyTextInputSchema).max(10),
    nextSteps: text(10, 2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.evidenceIds.length && !value.textualEvidence.length)
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'At least one identified evidence is required',
      });
    if (new Set(value.evidenceIds).size !== value.evidenceIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Evidence references must be unique',
      });
    if (
      new Set(value.textualEvidence.map((item) => item.reference)).size !==
      value.textualEvidence.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['textualEvidence'],
        message: 'Textual references must be unique',
      });
    if (value.result !== 'EFFECTIVE' && !value.nextSteps)
      ctx.addIssue({
        code: 'custom',
        path: ['nextSteps'],
        message: 'Further follow-up is required for this conclusion',
      });
  });
export const efficacyProofPackageSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            id: z.uuid(),
            fileName: z.string().min(1).max(100),
            description: z.string().min(10).max(1000),
            mimeType: z.string().min(1).max(64),
            size: z.number().int().positive(),
            sha256: efficacyFingerprintSchema,
          })
          .strict(),
      )
      .max(20),
    texts: z
      .array(
        efficacyTextInputSchema
          .extend({ id: z.uuid(), sha256: efficacyFingerprintSchema })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.files.length && !value.texts.length)
      ctx.addIssue({ code: 'custom', message: 'Proof package cannot be empty' });
    if (
      new Set([...value.files.map((item) => item.id), ...value.texts.map((item) => item.id)])
        .size !==
        value.files.length + value.texts.length ||
      new Set(value.texts.map((item) => item.reference)).size !== value.texts.length
    )
      ctx.addIssue({ code: 'custom', message: 'Proof identities must be unique' });
  });
export const efficacyOpinionSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    actionId: z.uuid(),
    riskId: z.uuid(),
    sequence: actionVersionSchema,
    supersedesId: z.uuid().nullable(),
    actionVersion: actionVersionSchema,
    actionRevisionId: z.uuid(),
    actionSnapshot: actionOperationalSnapshotSchema,
    riskContextSnapshot: riskContextSnapshotSchema,
    actionFingerprint: efficacyFingerprintSchema,
    riskContextFingerprint: efficacyFingerprintSchema,
    contextFingerprint: efficacyFingerprintSchema,
    criterionReference: z.string().min(10).max(2000),
    result: efficacyResultSchema,
    verifiedOn: actionCivilDateSchema,
    observation: z.string().min(20).max(4000),
    rationale: z.string().min(20).max(4000),
    nextSteps: z.string().min(10).max(2000).nullable(),
    proofPackage: efficacyProofPackageSchema,
    author: actionAuthorSchema,
    createdAt: z.iso.datetime(),
    validity: z.enum(['CURRENT', 'SUPERSEDED', 'REVIEW_REQUIRED']),
    reviewReasons: z.array(efficacyReviewReasonSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.result !== 'EFFECTIVE' && !value.nextSteps)
      ctx.addIssue({
        code: 'custom',
        path: ['nextSteps'],
        message: 'Further follow-up is required',
      });
    if (
      (value.validity === 'CURRENT' && value.reviewReasons.length) ||
      (value.validity === 'REVIEW_REQUIRED' && !value.reviewReasons.length)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['validity'],
        message: 'Validity and review reasons must agree',
      });
  });
export const efficacyOpinionListSchema = actionPageSchema(efficacyOpinionSchema);
export const efficacyOpinionQuerySchema = actionPaginationQuerySchema;
// Current context may be archived after the opinion; its frozen historical snapshot remains REGISTERED.
export const efficacyCurrentRiskContextSchema = riskContextSnapshotSchema
  .extend({ status: riskStatusSchema })
  .strict();
export const efficacyContextSchema = z
  .object({
    organizationId: z.uuid(),
    actionId: z.uuid(),
    riskId: z.uuid(),
    actionVersion: actionVersionSchema,
    actionRevisionId: z.uuid(),
    actionSnapshot: actionOperationalSnapshotSchema,
    riskContextSnapshot: efficacyCurrentRiskContextSchema,
    contextFingerprint: efficacyFingerprintSchema,
    actionFingerprint: efficacyFingerprintSchema,
    riskContextFingerprint: efficacyFingerprintSchema,
    referenceDate: actionCivilDateSchema,
    timeZone: z.string(),
    state: z.enum(['ABSENT', 'CURRENT', 'REVIEW_REQUIRED']),
    latest: efficacyOpinionSchema.nullable(),
    permissions: z.object({ hasTechnicalCapability: z.boolean(), canRecord: z.boolean() }).strict(),
    blockingReasons: z.array(
      z.enum(['NO_TECHNICAL_CAPABILITY', 'ACTION_NOT_IMPLEMENTED', 'ORIGIN_INACTIVE']),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.state === 'ABSENT') !== (value.latest === null) ||
      (value.latest &&
        (value.latest.validity === 'SUPERSEDED' || value.latest.validity !== value.state))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Current opinion and state must agree',
      });
    if (
      value.latest &&
      (value.latest.organizationId !== value.organizationId ||
        value.latest.actionId !== value.actionId ||
        value.latest.riskId !== value.riskId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['latest'],
        message: 'Opinion must belong to this action and organization',
      });
    if (
      value.permissions.canRecord &&
      (!value.permissions.hasTechnicalCapability || value.blockingReasons.length)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: 'Recording permission requires eligible context',
      });
  });
export type CreateEfficacyOpinionInput = z.infer<typeof createEfficacyOpinionSchema>;
export type EfficacyOpinion = z.infer<typeof efficacyOpinionSchema>;
export type EfficacyOpinionList = z.infer<typeof efficacyOpinionListSchema>;
export type EfficacyContext = z.infer<typeof efficacyContextSchema>;
export type EfficacyProofPackage = z.infer<typeof efficacyProofPackageSchema>;
export type EfficacyTextInput = z.infer<typeof efficacyTextInputSchema>;
export type EfficacyReviewReason = z.infer<typeof efficacyReviewReasonSchema>;

/** Version counters are intentionally absent: notes and unrelated uploads do not alter technical validity. */
export function deriveEfficacyValidity(input: {
  isLatest: boolean;
  actionFingerprint: string;
  opinionActionFingerprint: string;
  riskContextFingerprint: string;
  opinionRiskContextFingerprint: string;
  originActive: boolean;
  selectedEvidence: readonly { available: boolean; archived: boolean; hashMatches: boolean }[];
}): Pick<EfficacyOpinion, 'validity' | 'reviewReasons'> {
  const reviewReasons: EfficacyReviewReason[] = [];
  if (input.actionFingerprint !== input.opinionActionFingerprint)
    reviewReasons.push('ACTION_CONTENT_CHANGED');
  if (input.riskContextFingerprint !== input.opinionRiskContextFingerprint)
    reviewReasons.push('RISK_CONTEXT_CHANGED');
  if (!input.originActive) reviewReasons.push('ORIGIN_INACTIVE');
  if (input.selectedEvidence.some((item) => !item.available))
    reviewReasons.push('SELECTED_EVIDENCE_UNAVAILABLE');
  if (input.selectedEvidence.some((item) => item.available && item.archived))
    reviewReasons.push('SELECTED_EVIDENCE_ARCHIVED');
  if (input.selectedEvidence.some((item) => item.available && !item.hashMatches))
    reviewReasons.push('SELECTED_EVIDENCE_CHANGED');
  return {
    validity: !input.isLatest ? 'SUPERSEDED' : reviewReasons.length ? 'REVIEW_REQUIRED' : 'CURRENT',
    reviewReasons,
  };
}
