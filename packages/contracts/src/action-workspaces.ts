import { z } from 'zod';
import {
  actionDetailSchema,
  actionListItemSchema,
  actionListQuerySchema,
  actionPageSchema,
  actionPaginationQuerySchema,
  actionRevisionSchema,
  actionVersionSchema,
  createActionSchema,
} from './actions';

const person = z.object({ userId: z.uuid(), name: z.string().min(1).max(120) }).strict();
export const actionAssignmentChangeSchema = z
  .object({ previous: person.nullable(), next: person.nullable() })
  .strict();
export type ActionAssignmentChange = z.infer<typeof actionAssignmentChangeSchema>;
export const actionAssignmentSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    assignedUserId: z.uuid().nullable(),
    changeReason: z.string().trim().min(10).max(1000),
  })
  .strict();
export const createAssignedActionSchema = createActionSchema
  .extend({ assignedUserId: z.uuid().nullable().optional() })
  .strict();
export const actionExecutionSchema = z
  .object({
    expectedVersion: actionVersionSchema,
    status: z.enum(['IN_PROGRESS', 'IMPLEMENTED']),
    changeReason: z.string().trim().min(10).max(1000),
    implementationNote: z.string().trim().min(20).max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'IMPLEMENTED' && !value.implementationNote)
      ctx.addIssue({
        code: 'custom',
        path: ['implementationNote'],
        message: 'Implementation report required',
      });
    if (value.status !== 'IMPLEMENTED' && value.implementationNote)
      ctx.addIssue({
        code: 'custom',
        path: ['implementationNote'],
        message: 'Report requires IMPLEMENTED transition',
      });
  });
export const actionWorkspaceQuerySchema = actionListQuerySchema
  .extend({ assignedTo: z.literal('me').optional() })
  .strict();
export const actionAssigneeQuerySchema = actionPaginationQuerySchema
  .extend({ q: z.string().trim().max(120).optional() })
  .strict();
const scope = z.object({ id: z.uuid(), name: z.string(), isActive: z.boolean() }).strict();
const extra = {
  assignedUser: person
    .extend({ currentName: z.string(), isActive: z.boolean() })
    .strict()
    .nullable(),
  riskContext: z
    .object({
      unit: scope,
      sector: scope,
      technicalEvaluationState: z.enum(['ABSENT', 'CURRENT', 'CONTEXT_CHANGED']),
      contextMatches: z.boolean(),
      priority: z
        .object({
          key: z.string(),
          label: z.string(),
          rank: z.number().int().positive(),
          methodVersionId: z.uuid(),
          methodName: z.string(),
          methodVersion: z.number().int().positive(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  evidenceSummary: z
    .object({ active: z.number().int().nonnegative(), archived: z.number().int().nonnegative() })
    .strict(),
  pendingReasons: z.array(
    z.enum([
      'ASSIGNEE_INACTIVE',
      'OVERDUE',
      'NO_EVIDENCE',
      'ORIGIN_INACTIVE',
      'ORIGIN_CONTEXT_CHANGED',
      'NO_CURRENT_TECHNICAL_EVALUATION',
    ]),
  ),
  permissions: z
    .object({
      canManage: z.boolean(),
      canExecute: z.boolean(),
      canNote: z.boolean(),
      canUploadEvidence: z.boolean(),
      canArchiveEvidence: z.boolean(),
    })
    .strict(),
};
export const actionWorkspaceSchema = actionDetailSchema
  .extend({ ...extra, risk: z.object({ id: z.uuid(), factor: z.string() }).strict() })
  .strict();
export const actionWorkspaceListItemSchema = actionListItemSchema.extend(extra).strict();
export const actionWorkspaceListSchema = actionPageSchema(actionWorkspaceListItemSchema);
export const actionWorkspaceRevisionSchema = actionRevisionSchema
  .extend({ assignmentChange: actionAssignmentChangeSchema.nullable() })
  .strict();
export const actionWorkspaceHistoryListSchema = actionPageSchema(actionWorkspaceRevisionSchema);
export const actionAssigneeSchema = z
  .object({ userId: z.uuid(), name: z.string(), canExecute: z.boolean() })
  .strict();
export const actionAssigneeListSchema = actionPageSchema(actionAssigneeSchema);
export type ActionWorkspace = z.infer<typeof actionWorkspaceSchema>;
export type ActionWorkspaceList = z.infer<typeof actionWorkspaceListSchema>;
export type ActionWorkspaceQuery = z.infer<typeof actionWorkspaceQuerySchema>;
export type ActionAssigneeQuery = z.infer<typeof actionAssigneeQuerySchema>;
export type ActionAssignmentInput = z.infer<typeof actionAssignmentSchema>;
export type CreateAssignedActionInput = z.infer<typeof createAssignedActionSchema>;
export type ActionExecutionInput = z.infer<typeof actionExecutionSchema>;
export type ActionWorkspaceRevision = z.infer<typeof actionWorkspaceRevisionSchema>;
export type ActionWorkspaceHistoryList = z.infer<typeof actionWorkspaceHistoryListSchema>;
export type ActionAssigneeList = z.infer<typeof actionAssigneeListSchema>;
