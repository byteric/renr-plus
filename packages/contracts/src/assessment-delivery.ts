import { z } from 'zod';
import { assessmentInvitesSchema, createAssessmentInvitesSchema } from './assessment-cycles';

export const previewAssessmentInviteDeliverySchema = z.strictObject({
  channel: z.literal('MANUAL_CODE'),
  count: createAssessmentInvitesSchema.shape.count,
  idempotencyKey: z.uuid(),
});

export const assessmentInviteDeliverySchema = z.strictObject({
  id: z.uuid(),
  channel: z.literal('MANUAL_CODE'),
  count: createAssessmentInvitesSchema.shape.count,
  status: z.enum(['PENDING_CONFIRMATION', 'ISSUED', 'CLOSED', 'EXPIRED']),
  expiresAt: z.iso.datetime(),
  issuedAt: z.iso.datetime().nullable(),
});

export const assessmentInviteDeliveryListSchema = z.strictObject({
  items: z.array(assessmentInviteDeliverySchema).max(20),
});

const issuedDeliverySchema = assessmentInviteDeliverySchema.extend({
  status: z.literal('ISSUED'),
  issuedAt: z.iso.datetime(),
});

export const assessmentInviteDeliveryConfirmationSchema = z.discriminatedUnion('requiresReview', [
  z.strictObject({
    operation: issuedDeliverySchema,
    invites: assessmentInvitesSchema.shape.invites,
    participationPath: assessmentInvitesSchema.shape.participationPath,
    requiresReview: z.literal(false),
  }),
  z.strictObject({
    operation: issuedDeliverySchema,
    invites: z.tuple([]),
    participationPath: assessmentInvitesSchema.shape.participationPath,
    requiresReview: z.literal(true),
  }),
]);

export type PreviewAssessmentInviteDelivery = z.infer<typeof previewAssessmentInviteDeliverySchema>;
export type AssessmentInviteDelivery = z.infer<typeof assessmentInviteDeliverySchema>;
