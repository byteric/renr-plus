import { z } from 'zod';

const recoveryEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
const recoveryToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const passwordRecoveryRequestSchema = z.strictObject({ email: recoveryEmail });
export const passwordRecoveryRequestedSchema = z.strictObject({ accepted: z.literal(true) });
export const passwordRecoveryTokenSchema = z.strictObject({ token: recoveryToken });
export const passwordRecoveryStatusSchema = z.strictObject({ available: z.boolean() });
export const passwordRecoveryConfirmSchema = passwordRecoveryTokenSchema.extend({
  password: z.string().min(12).max(256),
});
export const passwordRecoveryConfirmedSchema = z.strictObject({ changed: z.literal(true) });
export const passwordRecoveryIssueSchema = passwordRecoveryRequestSchema.extend({
  verificationConfirmed: z.literal(true),
  verificationReference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,64}$/),
});
export const passwordRecoveryIssuedSchema = passwordRecoveryTokenSchema.extend({
  expiresAt: z.iso.datetime(),
});
