import { describe, expect, it } from 'vitest';
import {
  loginResultSchema,
  mfaEnrollmentRequestSchema,
  mfaEnrollmentSchema,
  mfaProofSchema,
  mfaRecoverSchema,
} from './index';
import { platformCapabilitySchema } from './platform-administration';

describe('privileged MFA', () => {
  it('defines an independent global permission for assisted factor recovery', () => {
    expect(platformCapabilitySchema.safeParse('RECOVER_ACCOUNT_MFA').success).toBe(true);
    expect(platformCapabilitySchema.options).toContain('MANAGE_PASSWORD_RECOVERY');
  });

  it('distinguishes the limited challenge from a full session and rejects extra identity fields', () => {
    const challenge = { kind: 'mfa-required', mode: 'verify' };
    expect(loginResultSchema.parse(challenge)).toEqual(challenge);
    expect(loginResultSchema.safeParse({ ...challenge, userId: 'arbitrary' }).success).toBe(false);
    expect(loginResultSchema.safeParse({ kind: 'mfa-required', mode: 'arbitrary' }).success).toBe(
      false,
    );
  });

  it('keeps leading zeroes and normalizes recovery code casing', () => {
    expect(mfaProofSchema.parse({ method: 'totp', code: ' 004912 ' }).code).toBe('004912');
    expect(mfaProofSchema.parse({ method: 'recovery', code: 'abcd-EF23-G456-789Z' }).code).toBe(
      'ABCD-EF23-G456-789Z',
    );
    expect(mfaProofSchema.safeParse({ method: 'totp', code: 4912 }).success).toBe(false);
  });

  it('rejects identity hints on enrollment and network URLs for the QR image', () => {
    expect(mfaEnrollmentRequestSchema.safeParse({ kind: 'login', password: 'guess' }).success).toBe(
      false,
    );
    expect(
      mfaEnrollmentSchema.safeParse({
        manualKey: 'ABCDEFGHIJKLMNOP',
        qrCodeDataUrl: 'https://example.com/qr',
        expiresAt: '2026-11-25T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('requires the current password alongside the assisted recovery token', () => {
    const input = { email: ' Account@Example.com ', token: 'x'.repeat(43) };
    expect(mfaRecoverSchema.safeParse(input).success).toBe(false);
    expect(mfaRecoverSchema.parse({ ...input, password: 'current' }).email).toBe(
      'account@example.com',
    );
  });
});
