import { z } from 'zod';
import { actionAuthorSchema, actionPageSchema, actionVersionSchema } from './actions';
export const uploadEvidenceSchema = z
  .object({
    description: z.string().trim().min(10).max(1000),
    expectedVersion: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(actionVersionSchema),
  })
  .strict();
export const archiveEvidenceSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    changeReason: z.string().trim().min(10).max(1000),
  })
  .strict();
export const evidenceSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    actionId: z.uuid(),
    description: z.string().min(10).max(1000),
    fileName: z.string(),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    size: z
      .number()
      .int()
      .min(1)
      .max(5 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdBy: actionAuthorSchema,
    createdAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    archivedBy: actionAuthorSchema.nullable(),
    archiveReason: z.string().nullable(),
    actionVersion: actionVersionSchema,
  })
  .strict();
export const evidenceListSchema = actionPageSchema(evidenceSchema);
export type UploadEvidenceInput = z.infer<typeof uploadEvidenceSchema>;
export type ArchiveEvidenceInput = z.infer<typeof archiveEvidenceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceList = z.infer<typeof evidenceListSchema>;

export const evidenceUploadStateSchema = z.enum([
  'UPLOADING',
  'UNCERTAIN',
  'RETRYABLE',
  'COMPLETED',
  'ABANDONED',
]);
export const reconcileEvidenceUploadSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    attemptVersion: actionVersionSchema,
  })
  .strict();
export const retryEvidenceUploadSchema = uploadEvidenceSchema
  .extend({
    attemptVersion: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(actionVersionSchema),
  })
  .strict();
export const abandonEvidenceUploadSchema = z
  .object({
    attemptVersion: actionVersionSchema,
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export const evidenceUploadAttemptSchema = z
  .object({
    key: z.uuid(),
    organizationId: z.uuid(),
    actionId: z.uuid(),
    state: evidenceUploadStateSchema,
    attemptVersion: actionVersionSchema,
    description: z.string().min(10).max(1000),
    fileName: z.string(),
    mimeType: evidenceSchema.shape.mimeType,
    size: evidenceSchema.shape.size,
    sha256: evidenceSchema.shape.sha256,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    leaseExpiresAt: z.iso.datetime().nullable(),
    currentActionVersion: actionVersionSchema,
    retryAllowed: z.boolean(),
    objectState: z.enum(['PRESENT', 'ABSENT', 'UNKNOWN']).nullable(),
    evidence: evidenceSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if ((attempt.state === 'COMPLETED') !== (attempt.evidence !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Completed attempts require exactly one evidence.',
      });
    }
    if (
      attempt.evidence &&
      (attempt.evidence.organizationId !== attempt.organizationId ||
        attempt.evidence.actionId !== attempt.actionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Evidence must belong to the same organization and action.',
      });
    }
    if (
      attempt.retryAllowed &&
      (attempt.state !== 'RETRYABLE' ||
        attempt.objectState !== 'ABSENT' ||
        (attempt.leaseExpiresAt !== null && Date.parse(attempt.leaseExpiresAt) > Date.now()))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retryAllowed'],
        message: 'Retry requires confirmed absence and no active lease.',
      });
    }
  });
export const evidenceUsageSchema = actionPageSchema(
  z
    .object({
      kind: z.enum(['OPINION', 'TECHNICAL_CLOSURE']),
      id: z.uuid(),
      sequence: z.number().int().positive(),
      createdAt: z.iso.datetime(),
    })
    .strict(),
)
  .extend({
    evidenceId: z.uuid(),
    opinionTotal: z.number().int().nonnegative(),
    closureTotal: z.number().int().nonnegative(),
  })
  .strict();
export type EvidenceUploadAttempt = z.infer<typeof evidenceUploadAttemptSchema>;
export type ReconcileEvidenceUploadInput = z.infer<typeof reconcileEvidenceUploadSchema>;
export type RetryEvidenceUploadInput = z.infer<typeof retryEvidenceUploadSchema>;
export type AbandonEvidenceUploadInput = z.infer<typeof abandonEvidenceUploadSchema>;
export type EvidenceUsage = z.infer<typeof evidenceUsageSchema>;
