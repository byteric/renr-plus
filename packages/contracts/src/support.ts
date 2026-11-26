import { z } from 'zod';
import { hrListSchema, hrPaginationSchema } from './people-analytics';

export const supportTicketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']);
export const supportTicketCategorySchema = z.enum(['ACCESS', 'BILLING', 'TECHNICAL', 'OTHER']);
export const supportTicketAssigneeSchema = z.object({ id: z.uuid(), name: z.string() }).strict();

export const createSupportTicketSchema = z
  .object({
    subject: z.string().trim().min(3).max(160),
    category: supportTicketCategorySchema,
    description: z.string().trim().min(3).max(2000),
  })
  .strict();

export const updateSupportTicketSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: supportTicketStatusSchema,
    assigneeId: z.uuid().nullable(),
    dueOn: z.iso.date().nullable(),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();

export const supportTicketQuerySchema = hrPaginationSchema
  .extend({ status: supportTicketStatusSchema.optional() })
  .strict();

export const platformSupportTicketQuerySchema = supportTicketQuerySchema
  .extend({ organizationId: z.uuid().optional() })
  .strict();

export const supportTicketSchema = createSupportTicketSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    status: supportTicketStatusSchema,
    assignee: supportTicketAssigneeSchema.nullable(),
    dueOn: z.iso.date().nullable(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const supportTicketRevisionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    status: supportTicketStatusSchema,
    assignee: supportTicketAssigneeSchema.nullable(),
    dueOn: z.iso.date().nullable(),
    note: z.string(),
    actorName: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const supportTicketDetailSchema = z
  .object({ ticket: supportTicketSchema, history: z.array(supportTicketRevisionSchema) })
  .strict();

export const supportTicketListSchema = hrListSchema(supportTicketSchema);
export const supportTicketAssigneesSchema = z
  .object({ items: z.array(supportTicketAssigneeSchema) })
  .strict();

export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;
export type SupportTicketCategory = z.infer<typeof supportTicketCategorySchema>;
export type CreateSupportTicket = z.infer<typeof createSupportTicketSchema>;
export type UpdateSupportTicket = z.infer<typeof updateSupportTicketSchema>;
export type PlatformSupportTicketQuery = z.infer<typeof platformSupportTicketQuerySchema>;
export type SupportTicketQuery = z.infer<typeof supportTicketQuerySchema>;
export type SupportTicket = z.infer<typeof supportTicketSchema>;
export type SupportTicketDetail = z.infer<typeof supportTicketDetailSchema>;
export type SupportTicketList = z.infer<typeof supportTicketListSchema>;
export type SupportTicketAssignees = z.infer<typeof supportTicketAssigneesSchema>;
