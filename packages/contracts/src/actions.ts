import { z } from 'zod';
import { riskContextSnapshotSchema, riskStatusSchema } from './risks';

export const actionStatusSchema = z.enum(['PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'CANCELLED']);
export const actionVersionSchema = z.number().int().min(1).max(2147483647);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const actionCivilDateSchema = z.iso
  .date()
  .refine((value) => !value.startsWith('0000-'), 'Civil year must be positive');
export const actionContentSchema = z
  .object({
    title: text(3, 160),
    description: text(10, 2000),
    responsibleName: text(3, 120),
    dueDate: actionCivilDateSchema,
    expectedResult: text(10, 2000),
    verificationCriterion: text(10, 2000),
  })
  .strict();
export const createActionSchema = actionContentSchema
  .extend({
    expectedRiskVersion: actionVersionSchema,
    evaluationId: z.uuid().optional(),
  })
  .strict();
export const updateActionSchema = actionContentSchema
  .partial()
  .extend({
    expectedVersion: actionVersionSchema,
    changeReason: text(10, 1000),
    status: actionStatusSchema.optional(),
    implementationNote: text(20, 2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      Object.keys(value).filter((key) => !['expectedVersion', 'changeReason'].includes(key))
        .length === 0
    )
      ctx.addIssue({ code: 'custom', message: 'Provide at least one change' });
    if (value.status === 'IMPLEMENTED' && !value.implementationNote)
      ctx.addIssue({
        code: 'custom',
        path: ['implementationNote'],
        message: 'Implementation report required',
      });
    if (value.implementationNote && value.status !== 'IMPLEMENTED')
      ctx.addIssue({
        code: 'custom',
        path: ['implementationNote'],
        message: 'Report requires IMPLEMENTED transition',
      });
  });
export const addActionNoteSchema = z
  .object({ expectedVersion: actionVersionSchema, text: text(10, 2000) })
  .strict();
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');
const queryInteger = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(max))
    .default(fallback);
export const actionPaginationQuerySchema = z
  .object({ page: queryInteger(1000000, 1), pageSize: queryInteger(100, 50) })
  .strict();
export const actionListQuerySchema = actionPaginationQuerySchema
  .extend({
    riskId: z.uuid().optional(),
    unitId: z.uuid().optional(),
    sectorId: z.uuid().optional(),
    status: actionStatusSchema.optional(),
    openOnly: booleanQuery.optional(),
    overdue: booleanQuery.optional(),
    q: text(0, 120).optional(),
  })
  .strict();
export const actionAuthorSchema = z.object({ id: z.uuid(), name: z.string() }).strict();
export const actionTimeZoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}, 'Invalid timezone');
const temporal = {
  isOverdue: z.boolean(),
  referenceDate: z.iso.date(),
  timeZone: actionTimeZoneSchema,
};
export const actionListItemSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    title: text(3, 160),
    risk: z.object({ id: z.uuid(), factor: z.string() }).strict(),
    responsibleName: text(3, 120),
    dueDate: z.iso.date(),
    status: actionStatusSchema,
    version: actionVersionSchema,
    ...temporal,
  })
  .strict();
export const actionOperationalSnapshotSchema = actionContentSchema
  .extend({
    status: actionStatusSchema,
    implementationNote: z.string().nullable(),
    implementedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const actionDetailSchema = actionOperationalSnapshotSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    version: actionVersionSchema,
    sourceRiskVersion: actionVersionSchema,
    evaluationId: z.uuid().nullable(),
    contextSnapshot: riskContextSnapshotSchema,
    currentOrigin: z
      .object({
        riskStatus: riskStatusSchema,
        organizationActive: z.boolean(),
        unitActive: z.boolean(),
        sectorActive: z.boolean(),
      })
      .strict(),
    createdBy: actionAuthorSchema,
    updatedBy: actionAuthorSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    ...temporal,
  })
  .strict();
export const actionRevisionSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    actionId: z.uuid(),
    version: actionVersionSchema,
    event: z.enum([
      'CREATED',
      'UPDATED',
      'STARTED',
      'IMPLEMENTED',
      'CANCELLED',
      'NOTE',
      'EVIDENCE_ADDED',
      'EVIDENCE_ARCHIVED',
    ]),
    snapshot: actionOperationalSnapshotSchema,
    changeReason: z.string().nullable(),
    text: z.string().nullable(),
    evidenceId: z.uuid().nullable(),
    author: actionAuthorSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const actionPageSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const actionListSchema = actionPageSchema(actionListItemSchema);
export const actionRevisionListSchema = actionPageSchema(actionRevisionSchema);
export type CreateActionInput = z.infer<typeof createActionSchema>;
export type UpdateActionInput = z.infer<typeof updateActionSchema>;
export type AddActionNoteInput = z.infer<typeof addActionNoteSchema>;
export type ActionListQuery = z.infer<typeof actionListQuerySchema>;
export type ActionDetail = z.infer<typeof actionDetailSchema>;
export type ActionListItem = z.infer<typeof actionListItemSchema>;
export type ActionList = z.infer<typeof actionListSchema>;
export type ActionRevision = z.infer<typeof actionRevisionSchema>;
export type ActionRevisionList = z.infer<typeof actionRevisionListSchema>;
