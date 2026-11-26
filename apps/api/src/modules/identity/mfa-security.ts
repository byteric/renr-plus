import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { Secret, TOTP } from 'otpauth';
import type { MfaChallenge } from '@renr/contracts';
import type { Environment } from '../../config/env';
import type { MfaChallengePurpose, Prisma } from '../../generated/prisma/client';

export const MFA_CHALLENGE_COOKIE = 'renr_mfa_challenge';
export const MFA_COOKIE_PATH = '/api/v1/auth/mfa';
export const challengeLifetimeMs = 5 * 60_000;
export const enrollmentLifetimeMs = 5 * 60_000;
export const recoveryLifetimeMs = 30 * 60_000;
export const recentMfaMs = 10 * 60_000;
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const opaqueToken = (): string => randomBytes(32).toString('base64url');

type MfaErrorCode =
  'AUTH_MFA_CHALLENGE_UNAVAILABLE' | 'AUTH_MFA_CODE_INVALID' | 'AUTH_MFA_REAUTH_REQUIRED';

export class MfaUnauthorizedException extends UnauthorizedException {
  constructor(readonly code: MfaErrorCode) {
    super();
  }
}

export function credentialCookie(request: Request, name: string): string | undefined {
  const token = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + '='))
    ?.slice(name.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

export async function lockPlatformAccess(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
}

export async function lockMfaAccount(tx: Prisma.TransactionClient, userId: string) {
  const [account] = await tx.$queryRaw<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM users WHERE id = ${userId}::uuid FOR UPDATE
  `;
  return account;
}

export function mfaKey(environment: Environment): Buffer {
  if (!environment.MFA_ENCRYPTION_KEY) throw new ServiceUnavailableException();
  return Buffer.from(environment.MFA_ENCRYPTION_KEY, 'base64url');
}

export function sealSecret(key: Buffer, secret: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openSecret(key: Buffer, sealed: string, context: string): string {
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      .setAAD(Buffer.from(context))
      .setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException();
  }
}

export function authenticator(manualKey: string, label: string): TOTP {
  return new TOTP({
    secret: Secret.fromBase32(manualKey),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    issuer: 'ReNR+',
    label,
  });
}

export function totpStep(
  manualKey: string,
  code: string,
  timestamp: number,
  lastAcceptedStep: number | null,
): number | null {
  const totp = authenticator(manualKey, '');
  const delta = totp.validate({
    token: code,
    timestamp,
    window: 1,
    afterCounter: lastAcceptedStep,
  });
  return delta === null ? null : totp.counter({ timestamp }) + delta;
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const code = new Secret({ size: 10 }).base32;
    return [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12), code.slice(12)].join('-');
  });
}

export type PendingLogin = { token: string; expiresAt: Date; challenge: MfaChallenge };

export async function createMfaChallenge(
  tx: Prisma.TransactionClient,
  userId: string,
  purpose: MfaChallengePurpose,
  factorVersion: number | null,
  recovery?: { id: string; expiresAt: Date },
): Promise<PendingLogin> {
  const now = new Date();
  await tx.mfaChallenge.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  if ((await tx.mfaChallenge.count({ where: { userId } })) >= 12)
    throw new HttpException('Too many requests', 429);
  const token = opaqueToken();
  const expiresAt = new Date(
    Math.min(now.getTime() + challengeLifetimeMs, recovery?.expiresAt.getTime() ?? Infinity),
  );
  await tx.mfaChallenge.create({
    data: {
      tokenHash: digest(token),
      userId,
      purpose,
      factorVersion,
      recoveryId: recovery?.id,
      expiresAt,
    },
  });
  return {
    token,
    expiresAt,
    challenge: { kind: 'mfa-required', mode: purpose === 'VERIFY' ? 'verify' : 'enroll' },
  };
}
