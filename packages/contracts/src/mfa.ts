import { z } from 'zod';

const authenticatorCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
const enrollmentKindSchema = z.enum(['login', 'account']);
export const mfaRecoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);

export const mfaChallengeSchema = z.strictObject({
  kind: z.literal('mfa-required'),
  mode: z.enum(['verify', 'enroll']),
});
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

export const mfaProofSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('totp'), code: authenticatorCodeSchema }),
  z.strictObject({ method: z.literal('recovery'), code: mfaRecoveryCodeSchema }),
]);
export type MfaProof = z.infer<typeof mfaProofSchema>;

export const mfaStatusSchema = z.strictObject({
  available: z.boolean(),
  enabled: z.boolean(),
  required: z.boolean(),
});
export type MfaStatus = z.infer<typeof mfaStatusSchema>;

export const mfaEnrollmentRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('login') }),
  z.strictObject({
    kind: z.literal('account'),
    password: z.string().min(1).max(256),
    factor: mfaProofSchema.optional(),
  }),
]);
export type MfaEnrollmentRequest = z.infer<typeof mfaEnrollmentRequestSchema>;

export const mfaEnrollmentSchema = z.strictObject({
  manualKey: z.string().regex(/^[A-Z2-7]{16,64}$/),
  qrCodeDataUrl: z
    .string()
    .max(32_768)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  expiresAt: z.iso.datetime(),
});

export const mfaEnrollmentCancelSchema = z.strictObject({ kind: enrollmentKindSchema });

export const mfaEnrollmentConfirmSchema = mfaEnrollmentCancelSchema.extend({
  code: authenticatorCodeSchema,
});
export type MfaEnrollmentConfirm = z.infer<typeof mfaEnrollmentConfirmSchema>;
