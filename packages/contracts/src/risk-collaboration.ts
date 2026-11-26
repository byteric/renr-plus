import { z } from 'zod';
import type { Capability } from './access';

export const riskContributionSpecialtySchema = z.enum(['SST', 'PSYCHOLOGY_ORGANIZATIONAL']);
export const riskContributionVisibilitySchema = z.enum(['RESTRICTED', 'SHARED']);
export const riskContributionStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const riskContributionKindSchema = z.enum([
  'PSYCHOSOCIAL_ANALYSIS',
  'WORK_ORGANIZATION_NOTE',
  'PREVENTIVE_RECOMMENDATION',
  'TECHNICAL_FOLLOW_UP',
]);
export const riskContributionRevisionEventSchema = z.enum([
  'CREATED',
  'UPDATED',
  'SHARED',
  'ATTACHMENT_ADDED',
  'ATTACHMENT_ARCHIVED',
  'ARCHIVED',
]);

export type RiskContributionSpecialty = z.infer<typeof riskContributionSpecialtySchema>;
export type RiskContributionVisibility = z.infer<typeof riskContributionVisibilitySchema>;
export type RiskContributionStatus = z.infer<typeof riskContributionStatusSchema>;
export type RiskContributionKind = z.infer<typeof riskContributionKindSchema>;
export type RiskContributionRevisionEvent = z.infer<typeof riskContributionRevisionEventSchema>;

export interface RiskContributionActorContext {
  role: 'ADMIN' | 'READER';
  capabilities: readonly Capability[];
  isActive: boolean;
  inScope: boolean;
}

export function requiredCapabilityForSpecialty(specialty: RiskContributionSpecialty): Capability {
  return specialty === 'SST' ? 'TECHNICAL_DECISIONS' : 'PSYCHOLOGY_COLLABORATION';
}

export function viewerSpecialtiesForActor(
  actor: Pick<RiskContributionActorContext, 'capabilities' | 'isActive' | 'inScope'>,
): RiskContributionSpecialty[] {
  if (!actor.isActive || !actor.inScope) return [];
  const specialties: RiskContributionSpecialty[] = [];
  if (actor.capabilities.includes('TECHNICAL_DECISIONS')) specialties.push('SST');
  if (actor.capabilities.includes('PSYCHOLOGY_COLLABORATION'))
    specialties.push('PSYCHOLOGY_ORGANIZATIONAL');
  return specialties;
}

export function canAuthorRiskContribution(
  actor: RiskContributionActorContext,
  specialty: RiskContributionSpecialty,
): boolean {
  if (!actor.isActive || !actor.inScope) return false;
  return actor.capabilities.includes(requiredCapabilityForSpecialty(specialty));
}

export function canViewRiskContribution(
  actor: RiskContributionActorContext,
  contribution: { specialty: RiskContributionSpecialty; visibility: RiskContributionVisibility },
): boolean {
  if (!actor.isActive || !actor.inScope) return false;
  if (contribution.visibility === 'SHARED') return true;
  return actor.capabilities.includes(requiredCapabilityForSpecialty(contribution.specialty));
}

export function canViewRiskContributionRevision(
  actor: RiskContributionActorContext,
  contribution: { specialty: RiskContributionSpecialty; visibility: RiskContributionVisibility },
  revisionVisibility: RiskContributionVisibility,
): boolean {
  if (!canViewRiskContribution(actor, contribution)) return false;
  if (revisionVisibility === 'SHARED') return true;
  return actor.capabilities.includes(requiredCapabilityForSpecialty(contribution.specialty));
}

export function canViewRiskContributionAttachment(
  actor: RiskContributionActorContext,
  contribution: { specialty: RiskContributionSpecialty; visibility: RiskContributionVisibility },
  attachmentVisibility: RiskContributionVisibility,
): boolean {
  if (!canViewRiskContribution(actor, contribution)) return false;
  if (attachmentVisibility === 'SHARED') return true;
  return actor.capabilities.includes(requiredCapabilityForSpecialty(contribution.specialty));
}

const personSchema = z.object({ id: z.uuid(), name: z.string() }).strict();

export const createRiskContributionSchema = z
  .object({
    specialty: riskContributionSpecialtySchema,
    kind: riskContributionKindSchema,
    visibility: riskContributionVisibilitySchema.default('RESTRICTED'),
    title: z.string().trim().min(3).max(160),
    workFactors: z.string().trim().min(10).max(2000),
    preventiveRecommendations: z.string().trim().min(10).max(2000),
    nextStep: z.string().trim().min(3).max(500).optional().nullable(),
    expectedRiskVersion: z.number().int().positive(),
  })
  .strict();

export const updateRiskContributionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    kind: riskContributionKindSchema.optional(),
    title: z.string().trim().min(3).max(160).optional(),
    workFactors: z.string().trim().min(10).max(2000).optional(),
    preventiveRecommendations: z.string().trim().min(10).max(2000).optional(),
    nextStep: z.string().trim().min(3).max(500).nullable().optional(),
    changeReason: z.string().trim().min(10).max(1000),
  })
  .strict()
  .refine(
    (v) =>
      v.kind !== undefined ||
      v.title !== undefined ||
      v.workFactors !== undefined ||
      v.preventiveRecommendations !== undefined ||
      v.nextStep !== undefined,
    'Informe ao menos um campo técnico para atualizar.',
  );

export const shareRiskContributionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(10).max(1000),
    shareAttachments: z.boolean().default(false),
  })
  .strict();

export const archiveRiskContributionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

export const uploadRiskContributionAttachmentSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    description: z.string().trim().min(5).max(1000),
  })
  .strict();

export const archiveRiskContributionAttachmentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

export const riskContributionAttachmentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    contributionId: z.uuid(),
    contributionVersion: z.number().int().positive(),
    visibility: riskContributionVisibilitySchema,
    description: z.string(),
    fileName: z.string(),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    version: z.number().int().positive(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    archivedBy: personSchema.nullable(),
    archiveReason: z.string().nullable(),
  })
  .strict();

export const riskContributionRevisionSnapshotSchema = z
  .object({
    kind: riskContributionKindSchema,
    title: z.string(),
    workFactors: z.string(),
    preventiveRecommendations: z.string(),
    nextStep: z.string().nullable(),
    status: riskContributionStatusSchema,
    visibility: riskContributionVisibilitySchema,
  })
  .strict();

export const riskContributionRevisionSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    contributionId: z.uuid(),
    version: z.number().int().positive(),
    event: riskContributionRevisionEventSchema,
    visibility: riskContributionVisibilitySchema,
    snapshot: riskContributionRevisionSnapshotSchema,
    changeReason: z.string().nullable(),
    author: personSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const riskContributionPermissionsSchema = z
  .object({
    canEdit: z.boolean(),
    canShare: z.boolean(),
    canArchive: z.boolean(),
    canAttach: z.boolean(),
    unavailableReason: z.string().nullable(),
  })
  .strict();

export const riskContributionSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    riskId: z.uuid(),
    specialty: riskContributionSpecialtySchema,
    kind: riskContributionKindSchema,
    status: riskContributionStatusSchema,
    visibility: riskContributionVisibilitySchema,
    title: z.string(),
    workFactors: z.string(),
    preventiveRecommendations: z.string(),
    nextStep: z.string().nullable(),
    sourceRiskVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    author: personSchema,
    sharedAt: z.iso.datetime().nullable(),
    sharedBy: personSchema.nullable(),
    archivedAt: z.iso.datetime().nullable(),
    archivedBy: personSchema.nullable(),
    archiveReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    attachments: z.array(riskContributionAttachmentSchema),
    revisions: z.array(riskContributionRevisionSchema),
    permissions: riskContributionPermissionsSchema,
  })
  .strict();

export const riskContributionListSchema = z
  .object({
    writesEnabled: z.boolean().default(false),
    viewerSpecialties: z.array(riskContributionSpecialtySchema).default([]),
    items: z.array(riskContributionSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export const riskContributionQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    specialty: riskContributionSpecialtySchema.optional(),
    visibility: riskContributionVisibilitySchema.optional(),
    includeArchived: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
  })
  .strict();

export type CreateRiskContributionInput = z.infer<typeof createRiskContributionSchema>;
export type UpdateRiskContributionInput = z.infer<typeof updateRiskContributionSchema>;
export type ShareRiskContributionInput = z.infer<typeof shareRiskContributionSchema>;
export type ArchiveRiskContributionInput = z.infer<typeof archiveRiskContributionSchema>;
export type UploadRiskContributionAttachmentInput = z.infer<
  typeof uploadRiskContributionAttachmentSchema
>;
export type ArchiveRiskContributionAttachmentInput = z.infer<
  typeof archiveRiskContributionAttachmentSchema
>;
export type RiskContributionAttachment = z.infer<typeof riskContributionAttachmentSchema>;
export type RiskContributionRevision = z.infer<typeof riskContributionRevisionSchema>;
export type RiskContribution = z.infer<typeof riskContributionSchema>;
export type RiskContributionList = z.infer<typeof riskContributionListSchema>;
export type RiskContributionQuery = z.infer<typeof riskContributionQuerySchema>;
