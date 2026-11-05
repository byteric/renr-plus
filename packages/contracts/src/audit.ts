import { z } from 'zod';
import { actionTimeZoneSchema } from './actions';

export const auditTargetKindSchema = z.enum([
  'risk',
  'action',
  'action-revision',
  'preliminary-evaluation',
  'technical-evaluation',
  'efficacy-opinion',
  'reassessment',
  'technical-closure',
  'instrument-version',
  'access',
]);
const directTarget = (kind: 'risk' | 'action' | 'access') =>
  z.object({ kind: z.literal(kind), id: z.uuid() }).strict();
const childTarget = (
  kind:
    | 'action-revision'
    | 'preliminary-evaluation'
    | 'technical-evaluation'
    | 'efficacy-opinion'
    | 'reassessment'
    | 'technical-closure'
    | 'instrument-version',
) =>
  z
    .object({
      kind: z.literal(kind),
      id: z.uuid(),
      parentId: z.uuid(),
      revision: z.number().int().positive().optional(),
    })
    .strict();
export const auditTargetSchema = z.discriminatedUnion('kind', [
  directTarget('risk'),
  directTarget('action'),
  directTarget('access'),
  childTarget('action-revision'),
  childTarget('preliminary-evaluation'),
  childTarget('technical-evaluation'),
  childTarget('efficacy-opinion'),
  childTarget('reassessment'),
  childTarget('technical-closure'),
  childTarget('instrument-version'),
]);
const date = z.iso.date().refine((value) => {
  const parsed = new Date(value);
  return (
    value >= '0001-01-01' &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}, 'Invalid calendar date');
const historyFields = {
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
const orderedDates = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;
export const auditHistoryQuerySchema = z
  .object(historyFields)
  .strict()
  .refine(orderedDates, 'from must precede to');
export const auditListQuerySchema = z
  .object({
    ...historyFields,
    resourceType: z.string().min(1).max(80).optional(),
    resourceId: z.uuid().optional(),
    operation: z.string().min(1).max(80).optional(),
    actorId: z.uuid().optional(),
  })
  .strict()
  .refine(orderedDates, 'from must precede to');
export const auditEventSchema = z
  .object({
    id: z.string().min(1),
    operation: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    actor: z.object({ id: z.uuid(), name: z.string() }).strict().nullable(),
    createdAt: z.iso.datetime(),
    reason: z.string().max(4000).nullable(),
    resource: z.object({ type: z.string(), id: z.uuid(), label: z.string() }).strict(),
    target: auditTargetSchema.nullable(),
  })
  .strict();
export const auditEventListSchema = z
  .object({
    items: z.array(auditEventSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    timeZone: actionTimeZoneSchema,
  })
  .strict();
export const auditRecordSchema = z
  .object({
    event: auditEventSchema,
    timeZone: actionTimeZoneSchema,
    details: z
      .array(z.object({ label: z.string().min(1).max(160), value: z.string().max(4000) }).strict())
      .max(30),
  })
  .strict();
export type AuditTargetKind = z.infer<typeof auditTargetKindSchema>;
export type AuditTarget = z.infer<typeof auditTargetSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventList = z.infer<typeof auditEventListSchema>;
export type AuditRecord = z.infer<typeof auditRecordSchema>;
