import { z } from 'zod';
const usageMode = z.enum(['DEMONSTRATION', 'REAL']);
const revision = z.number().int().min(1).max(2147483647);
const pageFields = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
const policyFields = { usageMode, minimumResponses: z.number().int().min(2).max(1000).nullable() };
export const createConsolidationPolicySchema = z
  .object(policyFields)
  .strict()
  .refine(
    (v) => v.usageMode !== 'DEMONSTRATION' || v.minimumResponses === 5,
    'Demonstration requires threshold 5',
  );
export const updateConsolidationPolicySchema = z
  .object({ ...policyFields, expectedRevision: revision })
  .strict()
  .refine(
    (v) => v.usageMode !== 'DEMONSTRATION' || v.minimumResponses === 5,
    'Demonstration requires threshold 5',
  );
export const publishConsolidationPolicySchema = z
  .object({
    expectedRevision: revision,
    approvalReference: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const forkConsolidationPolicySchema = z.object({ expectedRevision: revision }).strict();
export const consolidationPolicySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    version: z.number().int().positive(),
    revision,
    status: z.enum(['DRAFT', 'PUBLISHED']),
    ...policyFields,
    algorithmVersion: z.literal('CONSERVATIVE_V1'),
    approvalReference: z.string().nullable(),
    publishedById: z.uuid().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const consolidationPolicyListSchema = list(consolidationPolicySchema);
const cycleFields = {
  name: z.string().trim().min(3).max(160),
  assessmentGroupId: z.uuid(),
  instrumentVersionId: z.uuid(),
  policyVersionId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
};
export const createAssessmentCycleSchema = z
  .object(cycleFields)
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), 'End must follow start');
export const updateAssessmentCycleSchema = z
  .object({ ...cycleFields, expectedRevision: revision })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), 'End must follow start');
export const assessmentTransitionSchema = z.object({ expectedRevision: revision }).strict();
export const assessmentCycleQuerySchema = z
  .object({
    ...pageFields,
    status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).optional(),
    assessmentGroupId: z.uuid().optional(),
  })
  .strict();
export const assessmentCycleSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    assessmentGroupId: z.uuid(),
    assessmentGroupName: z.string(),
    sectorId: z.uuid(),
    sectorName: z.string(),
    unitId: z.uuid(),
    unitName: z.string(),
    instrumentId: z.uuid(),
    instrumentTitle: z.string(),
    instrumentVersionId: z.uuid(),
    instrumentVersion: z.number().int().positive(),
    usageMode,
    policyVersionId: z.uuid(),
    policyVersion: z.number().int().positive(),
    minimumResponses: z.number().int().min(2).max(1000),
    status: z.enum(['DRAFT', 'OPEN', 'CLOSED']),
    revision,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const assessmentCycleListSchema = list(assessmentCycleSchema);
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const createAssessmentInvitesSchema = z
  .object({ count: z.number().int().min(1).max(20) })
  .strict();
export const assessmentInvitesSchema = z
  .object({
    cycleId: z.uuid(),
    participationPath: z.literal('/#/responder'),
    invites: z
      .array(z.object({ code: secret, expiresAt: z.iso.datetime() }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export const assessmentAccessSchema = z.object({ inviteCode: secret }).strict();
const publicQuestion = z
  .object({
    id: z.uuid(),
    label: z.string(),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE']),
    required: z.boolean(),
    position: z.number().int().positive(),
    options: z.array(
      z.object({ id: z.uuid(), label: z.string(), position: z.number().int().positive() }).strict(),
    ),
  })
  .strict();
export const assessmentParticipationSchema = z
  .object({
    cycleName: z.string(),
    endsAt: z.iso.datetime(),
    usageMode,
    instrument: z
      .object({
        id: z.uuid(),
        title: z.string(),
        version: z.number().int().positive(),
        description: z.string(),
        instructions: z.string(),
        questions: z.array(publicQuestion),
      })
      .strict(),
  })
  .strict();
export const submitAssessmentResponseSchema = z
  .object({
    inviteCode: secret,
    instrumentVersionId: z.uuid(),
    submissionSecret: secret,
    answers: z
      .array(z.object({ questionId: z.uuid(), optionIds: z.array(z.uuid()).max(20) }).strict())
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    const questions = new Set<string>();
    v.answers.forEach((a, i) => {
      if (questions.has(a.questionId))
        ctx.addIssue({
          code: 'custom',
          path: ['answers', i, 'questionId'],
          message: 'Duplicate question',
        });
      questions.add(a.questionId);
      if (new Set(a.optionIds).size !== a.optionIds.length)
        ctx.addIssue({
          code: 'custom',
          path: ['answers', i, 'optionIds'],
          message: 'Duplicate option',
        });
    });
  });
export const assessmentSubmissionSchema = z.object({ status: z.literal('accepted') }).strict();
export const createAssessmentSourceSchema = z
  .object({
    kind: z.enum(['OBSERVATION', 'INTERVIEW', 'WORKSHOP', 'DOCUMENT_ANALYSIS']),
    context: z.string().trim().min(3).max(1000),
    occurredOn: z.iso.date(),
    summary: z.string().trim().min(3).max(4000),
  })
  .strict();
export const assessmentSourceSchema = createAssessmentSourceSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    cycleId: z.uuid(),
    createdAt: z.iso.datetime(),
    createdBy: z.object({ id: z.uuid(), name: z.string() }).strict(),
  })
  .strict();
export const assessmentSourceListSchema = list(assessmentSourceSchema);
export const assessmentQuestionResultSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'ORDINAL_CHOICE']),
    required: z.boolean(),
    availability: z.enum(['AVAILABLE', 'NO_RESPONSES', 'SUPPRESSED']),
    answerCount: z.number().int().nonnegative().nullable(),
    options: z.array(
      z
        .object({
          id: z.uuid(),
          label: z.string(),
          count: z.number().int().nonnegative(),
          percentage: z.number().min(0).max(100),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.availability === 'AVAILABLE'
        ? value.answerCount === null
        : value.answerCount !== null || value.options.length > 0
    )
      context.addIssue({
        code: 'custom',
        message: 'Protected question must hide denominator and options',
      });
  });
export type AssessmentResultNode = {
  id: string;
  name: string;
  nodeType: 'ORGANIZATION' | 'UNIT' | 'GROUP' | 'CYCLE';
  availability: 'NOT_STARTED' | 'COLLECTING' | 'NO_RESPONSES' | 'AVAILABLE' | 'SUPPRESSED';
  responseCount: number | null;
  questions: z.infer<typeof assessmentQuestionResultSchema>[];
  children: AssessmentResultNode[];
};
export const assessmentResultNodeSchema: z.ZodType<AssessmentResultNode> = z
  .object({
    id: z.uuid(),
    name: z.string(),
    nodeType: z.enum(['ORGANIZATION', 'UNIT', 'GROUP', 'CYCLE']),
    availability: z.enum(['NOT_STARTED', 'COLLECTING', 'NO_RESPONSES', 'AVAILABLE', 'SUPPRESSED']),
    responseCount: z.number().int().nonnegative().nullable(),
    questions: z.array(assessmentQuestionResultSchema),
    children: z.lazy(() => z.array(assessmentResultNodeSchema)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.availability === 'AVAILABLE'
        ? value.responseCount === null
        : value.responseCount !== null ||
          value.questions.some(
            (q) => q.availability === 'AVAILABLE' || q.answerCount !== null || q.options.length > 0,
          )
    )
      context.addIssue({
        code: 'custom',
        message: 'Protected node must hide counts and distributions',
      });
  });
export const assessmentResultsSchema = z
  .object({
    organizationId: z.uuid(),
    instrumentVersionId: z.uuid(),
    policyVersionId: z.uuid(),
    minimumResponses: z.number().int().min(2).max(1000),
    node: assessmentResultNodeSchema,
  })
  .strict();
export const assessmentConsolidationSchema = assessmentResultsSchema;
export const assessmentConsolidationQuerySchema = z
  .object({ instrumentVersionId: z.uuid(), policyVersionId: z.uuid(), unitId: z.uuid().optional() })
  .strict();
export type ConsolidationPolicy = z.infer<typeof consolidationPolicySchema>;
export type ConsolidationPolicyList = z.infer<typeof consolidationPolicyListSchema>;
export type CreateConsolidationPolicy = z.infer<typeof createConsolidationPolicySchema>;
export type UpdateConsolidationPolicy = z.infer<typeof updateConsolidationPolicySchema>;
export type PublishConsolidationPolicy = z.infer<typeof publishConsolidationPolicySchema>;
export type ForkConsolidationPolicy = z.infer<typeof forkConsolidationPolicySchema>;
export type AssessmentCycle = z.infer<typeof assessmentCycleSchema>;
export type AssessmentCycleList = z.infer<typeof assessmentCycleListSchema>;
export type CreateAssessmentCycle = z.infer<typeof createAssessmentCycleSchema>;
export type UpdateAssessmentCycle = z.infer<typeof updateAssessmentCycleSchema>;
export type AssessmentCycleQuery = z.infer<typeof assessmentCycleQuerySchema>;
export type AssessmentTransition = z.infer<typeof assessmentTransitionSchema>;
export type AssessmentInvites = z.infer<typeof assessmentInvitesSchema>;
export type AssessmentParticipation = z.infer<typeof assessmentParticipationSchema>;
export type SubmitAssessmentResponse = z.infer<typeof submitAssessmentResponseSchema>;
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
export type CreateAssessmentSource = z.infer<typeof createAssessmentSourceSchema>;
export type AssessmentSource = z.infer<typeof assessmentSourceSchema>;
export type AssessmentSourceList = z.infer<typeof assessmentSourceListSchema>;
export type AssessmentResults = z.infer<typeof assessmentResultsSchema>;
export type AssessmentConsolidation = z.infer<typeof assessmentConsolidationSchema>;
export type AssessmentConsolidationQuery = z.infer<typeof assessmentConsolidationQuerySchema>;
