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
