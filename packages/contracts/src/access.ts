import { z } from 'zod';

export const capabilitySchema = z.enum(['EXECUTE_ASSIGNED_ACTIONS', 'TECHNICAL_DECISIONS']);
const capabilitiesSchema = z
  .array(capabilitySchema)
  .max(2)
  .refine((values) => new Set(values).size === values.length, 'Duplicate capability');
const roleSchema = z.enum(['ADMIN', 'READER']);
const reasonSchema = z.string().trim().min(3).max(1000);
const personSchema = z.object({ id: z.uuid(), name: z.string() }).strict();
const versionedReason = { expectedVersion: z.number().int().positive(), reason: reasonSchema };
const list = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();

export const accessMembershipSchema = z
  .object({
    organizationId: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.email(),
    role: roleSchema,
    isActive: z.boolean(),
    version: z.number().int().positive(),
    capabilities: capabilitiesSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const accessMembershipListSchema = list(accessMembershipSchema);
export const updateAccessMembershipSchema = z
  .object({ ...versionedReason, role: roleSchema.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.isActive !== undefined, 'Provide a membership change');
export const updateAccessCapabilitiesSchema = z
  .object({ ...versionedReason, capabilities: capabilitiesSchema })
  .strict();
export const sessionCapabilitiesSchema = z
  .object({
    organizationId: z.uuid().nullable(),
    capabilities: capabilitiesSchema,
    canManageAccess: z.boolean(),
  })
  .strict();
export const accessHistorySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid().nullable(),
    actor: personSchema,
    action: z.string(),
    reason: reasonSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export const accessHistoryListSchema = list(accessHistorySchema);

export const createAccessInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    name: z.string().trim().min(2).max(120),
    role: roleSchema,
    capabilities: capabilitiesSchema,
    expiresInHours: z.number().int().min(1).max(168).default(72),
    reason: reasonSchema,
  })
  .strict();
export const accessInviteSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: roleSchema,
    capabilities: capabilitiesSchema,
    status: z.enum(['PENDING', 'EXPIRED', 'REVOKED', 'CONSUMED']),
    version: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    createdBy: personSchema,
    revokedAt: z.iso.datetime().nullable(),
    consumedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const accessInviteListSchema = list(accessInviteSchema);
export const accessInviteSecretSchema = z
  .object({ invite: accessInviteSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const mutateAccessInviteSchema = z.object(versionedReason).strict();
export const acceptAccessInviteSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    name: z.string().trim().min(2).max(120).optional(),
    password: z.string().min(12).max(256).optional(),
  })
  .strict();
export const accessInviteAcceptanceSchema = z
  .object({ organizationId: z.uuid(), userId: z.uuid() })
  .strict();

export type Capability = z.infer<typeof capabilitySchema>;
export type AccessMembership = z.infer<typeof accessMembershipSchema>;
export type AccessMembershipList = z.infer<typeof accessMembershipListSchema>;
export type UpdateAccessMembership = z.infer<typeof updateAccessMembershipSchema>;
export type UpdateAccessCapabilities = z.infer<typeof updateAccessCapabilitiesSchema>;
export type SessionCapabilities = z.infer<typeof sessionCapabilitiesSchema>;
export type AccessInvite = z.infer<typeof accessInviteSchema>;
export type AccessInviteList = z.infer<typeof accessInviteListSchema>;
export type CreateAccessInvite = z.infer<typeof createAccessInviteSchema>;
export type MutateAccessInvite = z.infer<typeof mutateAccessInviteSchema>;
export type AcceptAccessInvite = z.infer<typeof acceptAccessInviteSchema>;
