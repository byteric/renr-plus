import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Secret } from 'otpauth';
import { toDataURL } from 'qrcode';
import type { Request } from 'express';
import type {
  MfaEnrollmentConfirm,
  MfaEnrollmentRequest,
  MfaProof,
  MfaStatus,
  passwordRecoveryIssueSchema,
} from '@renr/contracts';
import type { z } from 'zod';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type {
  MfaAttemptPurpose,
  MfaChallenge,
  MfaChallengePurpose,
  MfaFactor,
  MfaRecovery,
  Prisma,
} from '../../generated/prisma/client';
import { IdentityService } from './identity.service';
import {
  authenticator,
  createMfaChallenge,
  credentialCookie,
  digest,
  enrollmentLifetimeMs,
  lockMfaAccount,
  lockPlatformAccess,
  MFA_CHALLENGE_COOKIE,
  mfaKey,
  MfaUnauthorizedException,
  newRecoveryCodes,
  opaqueToken,
  openSecret,
  recentMfaMs,
  recoveryLifetimeMs,
  sealSecret,
  totpStep,
} from './mfa-security';
import { verifyPassword } from './password';

const maxFailures = 5;
const attemptWindowMs = 15 * 60_000;
const recoveryCapability = 'RECOVER_ACCOUNT_MFA';
const challengeUnavailable = () => new MfaUnauthorizedException('AUTH_MFA_CHALLENGE_UNAVAILABLE');
const invalidCode = () => new MfaUnauthorizedException('AUTH_MFA_CODE_INVALID');
const factorContext = (userId: string, version: number) => `mfa:factor:${userId}:${version}`;
const pendingContext = (userId: string, id: string) => `mfa:pending:${userId}:${id}`;
type RecoveryInput = { email: string; password: string; token: string };
type EnrollmentScope = { challengeId: string } | { sessionId: string };

@Injectable()
export class MfaService {
  constructor(
    private readonly database: PrismaService,
    private readonly identity: IdentityService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async status(request: Request): Promise<MfaStatus> {
    const { userId } = await this.identity.authenticate(request);
    const { enabled, required } = await this.identity.mfaState(this.database.client, userId);
    return { available: Boolean(this.environment.MFA_ENCRYPTION_KEY), enabled, required };
  }

  async finishLogin(request: Request, proof: MfaProof) {
    const key = mfaKey(this.environment);
    const result = await this.withChallenge(request, ['VERIFY'], async (tx, challenge) => {
      const factor = await tx.mfaFactor.findUnique({ where: { userId: challenge.userId } });
      if (!factor || factor.version !== challenge.factorVersion) throw challengeUnavailable();
      await this.assertBudget(tx, factor.userId, 'PROOF');
      if (!(await this.acceptProof(tx, factor, proof, key))) {
        await this.recordFailure(tx, factor.userId, 'PROOF');
        return null;
      }
      await tx.mfaChallenge.delete({ where: { id: challenge.id } });
      return this.identity.issueSession(tx, factor.userId, {
        version: factor.version,
        verifiedAt: new Date(),
      });
    });
    if (!result) throw invalidCode();
    return result;
  }

  async cancelLogin(request: Request): Promise<void> {
    const token = credentialCookie(request, MFA_CHALLENGE_COOKIE);
    if (!token) return;
    const tokenHash = digest(token);
    const initial = await this.database.client.mfaChallenge.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!initial) return;
    await this.database.client.$transaction(async (tx) => {
      await lockMfaAccount(tx, initial.userId);
      await tx.mfaChallenge.deleteMany({ where: { tokenHash } });
    });
  }

  async startEnrollment(request: Request, input: MfaEnrollmentRequest) {
    const key = mfaKey(this.environment);
    if (input.kind === 'login') {
      return this.withChallenge(request, ['ENROLL', 'RECOVER'], async (tx, challenge) => {
        await this.assertBudget(tx, challenge.userId, 'PROOF');
        const user = await tx.user.findUniqueOrThrow({
          where: { id: challenge.userId },
          select: { email: true },
        });
        const scope = { challengeId: challenge.id };
        const existing = await this.resumeEnrollment(tx, key, challenge.userId, user.email, scope);
        if (existing) return existing;
        return this.storeEnrollment(
          tx,
          key,
          challenge.userId,
          user.email,
          scope,
          challenge.expiresAt,
        );
      });
    }
    const initialSession = await this.identity.authenticate(request);
    await this.assertBudget(this.database.client, initialSession.userId, 'ACCOUNT_PASSWORD');
    const passwordValid = await verifyPassword(input.password, initialSession.user.passwordHash);
    const result = await this.identity.withLockedSession(request, async (tx, session) => {
      await this.assertBudget(tx, session.userId, 'ACCOUNT_PASSWORD');
      if (!passwordValid || session.user.passwordHash !== initialSession.user.passwordHash) {
        await this.recordFailure(tx, session.userId, 'ACCOUNT_PASSWORD');
        return false;
      }
      await this.clearFailures(tx, session.userId, 'ACCOUNT_PASSWORD');
      const scope = { sessionId: session.id };
      const existing = await this.resumeEnrollment(
        tx,
        key,
        session.userId,
        session.user.email,
        scope,
      );
      if (existing) return existing;
      await this.assertBudget(tx, session.userId, 'PROOF');
      const factor = await tx.mfaFactor.findUnique({ where: { userId: session.userId } });
      if (factor && (!input.factor || !(await this.acceptProof(tx, factor, input.factor, key)))) {
        await this.recordFailure(tx, session.userId, 'PROOF');
        return null;
      }
      return this.storeEnrollment(
        tx,
        key,
        session.userId,
        session.user.email,
        scope,
        session.expiresAt,
      );
    });
    if (result === false) throw new UnauthorizedException();
    if (!result) throw invalidCode();
    return result;
  }

  async confirmEnrollment(request: Request, input: MfaEnrollmentConfirm) {
    const key = mfaKey(this.environment);
    const result =
      input.kind === 'login'
        ? await this.withChallenge(request, ['ENROLL', 'RECOVER'], (tx, challenge) =>
            this.installFactor(
              tx,
              key,
              challenge.userId,
              { challengeId: challenge.id },
              input.code,
              { recoveryId: challenge.recoveryId ?? undefined },
            ),
          )
        : await this.identity.withLockedSession(request, (tx, session) =>
            this.installFactor(tx, key, session.userId, { sessionId: session.id }, input.code, {
              organizationId: session.activeOrganizationId,
            }),
          );
    if (!result) throw invalidCode();
    return result;
  }

  async cancelEnrollment(request: Request, kind: MfaEnrollmentRequest['kind']): Promise<void> {
    if (kind === 'login') {
      await this.withChallenge(request, ['ENROLL', 'RECOVER'], async (tx, challenge) => {
        await tx.mfaEnrollment.deleteMany({ where: { challengeId: challenge.id } });
      });
    } else {
      await this.identity.withLockedSession(request, async (tx, session) => {
        await tx.mfaEnrollment.deleteMany({ where: { sessionId: session.id } });
      });
    }
  }

  async issueRecovery(request: Request, input: z.infer<typeof passwordRecoveryIssueSchema>) {
    return this.identity.withLockedSession(
      request,
      async (tx, session) => {
        const grant = await this.recoveryGrant(tx, session.userId);
        if (!grant?.isActive || session.activeOrganizationId !== null)
          throw new ForbiddenException();
        const now = new Date();
        if (
          !session.mfaVerifiedAt ||
          now.getTime() - session.mfaVerifiedAt.getTime() >= recentMfaMs ||
          session.mfaVerifiedAt > now
        ) {
          throw new MfaUnauthorizedException('AUTH_MFA_REAUTH_REQUIRED');
        }
        mfaKey(this.environment);
        const user = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (!user) throw new NotFoundException();
        if (user.id === session.userId) throw new ForbiddenException();
        if (!(await lockMfaAccount(tx, user.id))) throw new NotFoundException();
        const factor = await tx.mfaFactor.findUnique({
          where: { userId: user.id },
          select: { version: true },
        });
        if (!factor) throw new NotFoundException();
        await this.revokeRecoveries(tx, user.id, now);
        const token = opaqueToken();
        const expiresAt = new Date(now.getTime() + recoveryLifetimeMs);
        const recovery = await tx.mfaRecovery.create({
          data: {
            userId: user.id,
            tokenHash: digest(token),
            issuerId: session.userId,
            issuerGrantVersion: grant.version,
            factorVersion: factor.version,
            verificationReference: input.verificationReference,
            expiresAt,
            issuedAt: now,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: session.userId,
            action: 'AUTH_MFA_ASSISTED_RECOVERY_ISSUED',
            resourceType: 'MFA_RECOVERY',
            resourceId: recovery.id,
          },
        });
        return { token, expiresAt: expiresAt.toISOString() };
      },
      true,
    );
  }

  async startRecovery(input: RecoveryInput) {
    mfaKey(this.environment);
    const tokenHash = digest(input.token);
    const initial = await this.database.client.mfaRecovery.findUnique({
      where: { tokenHash },
      include: { user: { select: { email: true, passwordHash: true } } },
    });
    if (!initial || initial.user.email !== input.email || !this.openRecovery(initial))
      throw new UnauthorizedException();
    await this.assertBudget(this.database.client, initial.userId, 'RECOVERY_PASSWORD');
    const passwordValid = await verifyPassword(input.password, initial.user.passwordHash);
    const result = await this.database.client.$transaction(async (tx) => {
      await lockPlatformAccess(tx);
      const user = await lockMfaAccount(tx, initial.userId);
      const recovery = await tx.mfaRecovery.findUnique({ where: { tokenHash } });
      if (!user || !recovery || !(await this.authorizedRecovery(tx, recovery)))
        throw new UnauthorizedException();
      await this.assertBudget(tx, recovery.userId, 'RECOVERY_PASSWORD');
      if (!passwordValid || user.passwordHash !== initial.user.passwordHash) {
        await this.recordFailure(tx, recovery.userId, 'RECOVERY_PASSWORD');
        return null;
      }
      await this.clearFailures(tx, recovery.userId, 'RECOVERY_PASSWORD');
      return createMfaChallenge(tx, recovery.userId, 'RECOVER', recovery.factorVersion, recovery);
    });
    if (!result) throw new UnauthorizedException();
    return result;
  }

  private async withChallenge<T>(
    request: Request,
    purposes: readonly MfaChallengePurpose[],
    operation: (tx: Prisma.TransactionClient, challenge: MfaChallenge) => Promise<T>,
  ): Promise<T> {
    const token = credentialCookie(request, MFA_CHALLENGE_COOKIE);
    if (!token) throw challengeUnavailable();
    const tokenHash = digest(token);
    const initial = await this.database.client.mfaChallenge.findUnique({ where: { tokenHash } });
    if (!initial || !purposes.includes(initial.purpose)) throw challengeUnavailable();
    return this.database.client.$transaction(async (tx) => {
      if (initial.purpose === 'RECOVER') await lockPlatformAccess(tx);
      if (!(await lockMfaAccount(tx, initial.userId))) throw challengeUnavailable();
      const challenge = await tx.mfaChallenge.findUnique({
        where: { tokenHash },
        include: { recovery: true },
      });
      if (!challenge || challenge.expiresAt.getTime() <= Date.now()) throw challengeUnavailable();
      if (
        challenge.purpose === 'RECOVER' &&
        (!challenge.recovery || !(await this.authorizedRecovery(tx, challenge.recovery)))
      )
        throw challengeUnavailable();
      return operation(tx, challenge);
    });
  }

  private async resumeEnrollment(
    tx: Prisma.TransactionClient,
    key: Buffer,
    userId: string,
    label: string,
    scope: EnrollmentScope,
  ) {
    const pending = await tx.mfaEnrollment.findFirst({
      where: { ...scope, userId, expiresAt: { gt: new Date() } },
    });
    if (!pending) return null;
    const manualKey = openSecret(key, pending.encryptedSecret, pendingContext(userId, pending.id));
    return this.enrollmentResponse(manualKey, label, pending.expiresAt);
  }

  private async storeEnrollment(
    tx: Prisma.TransactionClient,
    key: Buffer,
    userId: string,
    label: string,
    scope: EnrollmentScope,
    credentialExpiry: Date,
  ) {
    const now = new Date();
    const expiresAt = new Date(Math.min(now.getTime() + enrollmentLifetimeMs, +credentialExpiry));
    if (expiresAt <= now) throw challengeUnavailable();
    const id = randomUUID();
    const manualKey = new Secret({ size: 20 }).base32;
    const response = await this.enrollmentResponse(manualKey, label, expiresAt);
    await tx.mfaEnrollment.deleteMany({
      where: { userId, OR: [scope, { expiresAt: { lte: now } }] },
    });
    await tx.mfaEnrollment.create({
      data: {
        id,
        userId,
        ...scope,
        encryptedSecret: sealSecret(key, manualKey, pendingContext(userId, id)),
        expiresAt,
      },
    });
    return response;
  }

  private async enrollmentResponse(manualKey: string, label: string, expiresAt: Date) {
    const qrCodeDataUrl = await toDataURL(authenticator(manualKey, label).toString(), {
      width: 240,
    });
    return { manualKey, qrCodeDataUrl, expiresAt: expiresAt.toISOString() };
  }

  private async installFactor(
    tx: Prisma.TransactionClient,
    key: Buffer,
    userId: string,
    scope: EnrollmentScope,
    code: string,
    options: { recoveryId?: string; organizationId?: string | null },
  ) {
    const now = new Date();
    const pending = await tx.mfaEnrollment.findFirst({
      where: { userId, ...scope, expiresAt: { gt: now } },
    });
    if (!pending) throw challengeUnavailable();
    await this.assertBudget(tx, userId, 'PROOF');
    const manualKey = openSecret(key, pending.encryptedSecret, pendingContext(userId, pending.id));
    const step = totpStep(manualKey, code, now.getTime(), null);
    if (step === null) {
      await this.recordFailure(tx, userId, 'PROOF');
      return null;
    }
    if (options.recoveryId) {
      const { count } = await tx.mfaRecovery.updateMany({
        where: {
          id: options.recoveryId,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (count !== 1) throw challengeUnavailable();
    }
    const previous = await tx.mfaFactor.findUnique({
      where: { userId },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;
    const data = {
      version,
      encryptedSecret: sealSecret(key, manualKey, factorContext(userId, version)),
      lastAcceptedStep: step,
    };
    await tx.mfaFactor.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await tx.session.deleteMany({ where: { userId } });
    await tx.mfaChallenge.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await this.revokeRecoveries(tx, userId, now);
    await this.clearFailures(tx, userId, 'PROOF');
    const recoveryCodes = newRecoveryCodes();
    await tx.mfaRecoveryCode.createMany({
      data: recoveryCodes.map((value) => ({
        userId,
        factorVersion: version,
        codeHash: digest(value),
      })),
    });
    await tx.auditEvent.create({
      data: {
        actorId: userId,
        action: options.recoveryId
          ? 'AUTH_MFA_ASSISTED_RECOVERY_CONFIRMED'
          : previous
            ? 'AUTH_MFA_FACTOR_REPLACED'
            : 'AUTH_MFA_ENROLLED',
        resourceType: options.recoveryId ? 'MFA_RECOVERY' : 'MFA_FACTOR',
        resourceId: options.recoveryId ?? userId,
      },
    });
    if (previous) {
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          action: 'AUTH_MFA_PREVIOUS_FACTOR_REVOKED',
          resourceType: 'MFA_FACTOR',
          resourceId: userId,
        },
      });
    }
    const issued = await this.identity.issueSession(
      tx,
      userId,
      { version, verifiedAt: now },
      options.organizationId,
    );
    return { ...issued, recoveryCodes };
  }

  private async acceptProof(
    tx: Prisma.TransactionClient,
    factor: MfaFactor,
    proof: MfaProof,
    key: Buffer,
  ): Promise<boolean> {
    if (proof.method === 'totp') {
      const secret = openSecret(
        key,
        factor.encryptedSecret,
        factorContext(factor.userId, factor.version),
      );
      const step = totpStep(secret, proof.code, Date.now(), factor.lastAcceptedStep);
      if (step === null) return false;
      await tx.mfaFactor.update({
        where: { userId: factor.userId },
        data: { lastAcceptedStep: step },
      });
    } else {
      const { count } = await tx.mfaRecoveryCode.deleteMany({
        where: {
          userId: factor.userId,
          factorVersion: factor.version,
          codeHash: digest(proof.code),
        },
      });
      if (count !== 1) return false;
      await tx.auditEvent.create({
        data: {
          actorId: factor.userId,
          action: 'AUTH_MFA_RECOVERY_CODE_USED',
          resourceType: 'MFA_FACTOR',
          resourceId: factor.userId,
        },
      });
    }
    await this.clearFailures(tx, factor.userId, 'PROOF');
    return true;
  }

  private async assertBudget(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: MfaAttemptPurpose,
  ) {
    const attempt = await tx.mfaAttempt.findUnique({
      where: { userId_purpose: { userId, purpose } },
    });
    if (attempt && attempt.expiresAt.getTime() > Date.now() && attempt.failures >= maxFailures)
      throw new HttpException('Too many requests', 429);
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: MfaAttemptPurpose,
  ) {
    const where = { userId_purpose: { userId, purpose } };
    const attempt = await tx.mfaAttempt.findUnique({ where });
    const now = Date.now();
    const update =
      attempt && attempt.expiresAt.getTime() > now
        ? { failures: attempt.failures + 1, expiresAt: attempt.expiresAt }
        : { failures: 1, expiresAt: new Date(now + attemptWindowMs) };
    await tx.mfaAttempt.upsert({ where, create: { userId, purpose, ...update }, update });
  }

  private async clearFailures(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: MfaAttemptPurpose,
  ) {
    await tx.mfaAttempt.deleteMany({ where: { userId, purpose } });
  }

  private async recoveryGrant(tx: Prisma.TransactionClient, userId: string) {
    return tx.platformGrant.findUnique({
      where: { userId_capability: { userId, capability: recoveryCapability } },
      select: { isActive: true, version: true },
    });
  }

  private openRecovery(recovery: MfaRecovery): boolean {
    return !recovery.consumedAt && !recovery.revokedAt && recovery.expiresAt.getTime() > Date.now();
  }

  private async authorizedRecovery(tx: Prisma.TransactionClient, recovery: MfaRecovery) {
    if (!this.openRecovery(recovery)) return false;
    const grant = await this.recoveryGrant(tx, recovery.issuerId);
    if (!grant?.isActive || grant.version !== recovery.issuerGrantVersion) return false;
    const factor = await tx.mfaFactor.findUnique({
      where: { userId: recovery.userId },
      select: { version: true },
    });
    return factor?.version === recovery.factorVersion;
  }

  private async revokeRecoveries(tx: Prisma.TransactionClient, userId: string, revokedAt: Date) {
    await tx.mfaRecovery.updateMany({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt },
    });
  }
}
