import { z } from 'zod';

export const riskStatusSchema = z.enum(['DRAFT', 'REGISTERED', 'ARCHIVED']);
export const riskSourceKindSchema = z.enum(['DIAGNOSTIC_CYCLE', 'TECHNICAL_RECORD']);
const versionSchema = z.number().int().min(1).max(2147483647);
const pendingText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
const contentFields = {
  factor: z.string().trim().min(3).max(160),
  description: pendingText(2000),
  exposureDescription: pendingText(2000),
  exposedGroupDescription: pendingText(2000),
  possibleHarms: pendingText(2000),
  existingControls: pendingText(2000),
  sourceKind: riskSourceKindSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  sourceNote: pendingText(1000),
  diagnosticCycleId: z
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
};

function completeRegistration(value: z.infer<typeof riskContentSchema>, ctx: z.RefinementCtx) {
  const minima = {
    description: 10,
    exposureDescription: 10,
    exposedGroupDescription: 3,
    possibleHarms: 5,
    existingControls: 5,
    sourceNote: 10,
  } as const;
  for (const [field, minimum] of Object.entries(minima)) {
    const key = field as keyof typeof minima;
    if ((value[key]?.length ?? 0) < minimum)
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Minimum ${minimum} characters for registration`,
      });
  }
  if (!value.sourceKind)
    ctx.addIssue({
      code: 'custom',
      path: ['sourceKind'],
      message: 'Source required for registration',
    });
  if (value.sourceKind === 'DIAGNOSTIC_CYCLE' && !value.diagnosticCycleId)
    ctx.addIssue({
      code: 'custom',
      path: ['diagnosticCycleId'],
      message: 'Diagnostic cycle required',
    });
}
export const riskContentSchema = z.object(contentFields).strict();
export const createRiskSchema = z
  .object({
    sectorId: z.uuid(),
    ...contentFields,
    status: z.enum(['DRAFT', 'REGISTERED']).default('DRAFT'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'REGISTERED') completeRegistration(value, ctx);
    if (value.diagnosticCycleId && value.sourceKind !== 'DIAGNOSTIC_CYCLE')
      ctx.addIssue({
        code: 'custom',
        path: ['diagnosticCycleId'],
        message: 'Cycle requires diagnostic source',
      });
  });
export const updateRiskSchema = z
  .object({
    factor: contentFields.factor.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    exposureDescription: z.string().trim().max(2000).nullable().optional(),
    exposedGroupDescription: z.string().trim().max(2000).nullable().optional(),
    possibleHarms: z.string().trim().max(2000).nullable().optional(),
    existingControls: z.string().trim().max(2000).nullable().optional(),
    sourceKind: riskSourceKindSchema.nullable().optional(),
    sourceNote: z.string().trim().max(1000).nullable().optional(),
    diagnosticCycleId: z.uuid().nullable().optional(),
    status: riskStatusSchema.optional(),
    expectedVersion: versionSchema,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, 'Provide at least one change');
export const riskListQuerySchema = z
  .object({
    unitId: z.uuid().optional(),
    sectorId: z.uuid().optional(),
    status: riskStatusSchema.optional(),
    evaluationPresence: z.enum(['WITH', 'WITHOUT']).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const createPreliminaryEvaluationSchema = z
  .object({
    expectedVersion: versionSchema,
    methodReference: z.string().trim().min(3).max(200),
    methodVersion: z.string().trim().min(1).max(40),
    observation: z.string().trim().min(10).max(2000),
    rationale: z.string().trim().min(10).max(2000),
  })
  .strict();
const authorSchema = z.object({ id: z.uuid(), name: z.string() }).strict();
const scopeItemSchema = z
  .object({ id: z.uuid(), name: z.string(), isActive: z.boolean() })
  .strict();
export const riskContextSnapshotSchema = riskContentSchema
  .extend({
    sectorId: z.uuid(),
    assessmentGroupId: z.uuid(),
    unit: scopeItemSchema,
    sector: scopeItemSchema,
    status: z.literal('REGISTERED'),
  })
  .strict();
export const preliminaryEvaluationSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    sequence: versionSchema,
    riskVersion: versionSchema,
    contextSnapshot: riskContextSnapshotSchema,
    label: z.literal('PRELIMINARY'),
    methodReference: z.string().min(3).max(200),
    methodVersion: z.string().min(1).max(40),
    observation: z.string().min(10).max(2000),
    rationale: z.string().min(10).max(2000),
    author: authorSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const riskDetailSchema = riskContentSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    assessmentGroupId: z.uuid(),
    sectorId: z.uuid(),
    unit: scopeItemSchema,
    sector: scopeItemSchema,
    status: riskStatusSchema,
    version: versionSchema,
    createdBy: authorSchema,
    updatedBy: authorSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    latestEvaluation: preliminaryEvaluationSchema.nullable(),
  })
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
export const riskListSchema = list(riskDetailSchema);
export const preliminaryEvaluationListSchema = list(preliminaryEvaluationSchema);
export type CreateRiskInput = z.input<typeof createRiskSchema>;
export type CreateRisk = z.output<typeof createRiskSchema>;
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;
export type RiskListQuery = z.infer<typeof riskListQuerySchema>;
export type RiskDetail = z.infer<typeof riskDetailSchema>;
export type RiskList = z.infer<typeof riskListSchema>;
export type CreatePreliminaryEvaluationInput = z.infer<typeof createPreliminaryEvaluationSchema>;
export type PreliminaryEvaluation = z.infer<typeof preliminaryEvaluationSchema>;
export type PreliminaryEvaluationList = z.infer<typeof preliminaryEvaluationListSchema>;
