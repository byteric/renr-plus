import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { PasswordRecovery, Prisma } from '../../generated/prisma/client';
import { isContractAccessSuspended } from '../commercial/contract-access';
import { hashPassword } from './password';

const recoveryPolicy = 'id52-assist-v1';
const lifetimeMs = 30 * 60 * 1000;
const attemptWindowMs = 15 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PasswordRecoveryService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();

  constructor(
    private readonly database: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private limit(operation: string, key: string, max: number): void {
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.expires <= now) this.attempts.delete(id);
    const id = digest(operation + ':' + key);
    const current = this.attempts.get(id);
    if ((current?.count ?? 0) >= max || (!current && this.attempts.size >= 10_000)) {
      throw new HttpException('Too many requests', 429);
    }
    if (current) current.count += 1;
    else this.attempts.set(id, { count: 1, expires: now + attemptWindowMs });
  }

  guidance(ip: string): { accepted: true } {
    this.limit('requests', ip, 15);
    // The assisted channel starts with a trusted contact, not an account lookup here.
    return { accepted: true };
  }

  private async lockAuthority(tx: Prisma.TransactionClient, organizationId: string | null) {
    // Same lock as platform and company-group grant writes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
    if (organizationId) {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
    }
  }

  private async lockAccount(tx: Prisma.TransactionClient, userId: string) {
    // Same lock as login, which rechecks the verified password before issuing a session.
    const [account] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
    `;
    return Boolean(account);
  }

  private async issuerAuthorized(
    db: Prisma.TransactionClient,
    issuerId: string,
    organizationId: string | null,
  ): Promise<boolean> {
    const capability = organizationId
      ? 'ASSIST_COMPANY_PASSWORD_RECOVERY'
      : 'MANAGE_PASSWORD_RECOVERY';
    const grant = await db.platformGrant.findUnique({
      where: { userId_capability: { userId: issuerId, capability } },
      select: { isActive: true },
    });
    if (!grant?.isActive) return false;
    if (!organizationId) return true;
    const member = await db.membership.findUnique({
      where: { userId_organizationId: { userId: issuerId, organizationId } },
      select: {
        isActive: true,
        scopeRestricted: true,
        role: true,
        organization: {
          select: { isActive: true, commercialContractAccess: { select: { status: true } } },
        },
      },
    });
    return Boolean(
      member?.isActive &&
      member.role === 'ADMIN' &&
      !member.scopeRestricted &&
      member.organization.isActive &&
      !isContractAccessSuspended(member.organization),
    );
  }

  private async companyOwnsAccount(
    db: Prisma.TransactionClient,
    userId: string,
    organizationId: string | null,
  ): Promise<boolean> {
    if (!organizationId) return true;
    const account = await db.user.findUnique({
      where: { id: userId },
      select: {
        memberships: { take: 2, select: { organizationId: true, isActive: true } },
        platformGrants: { take: 1, select: { userId: true } },
        companyGroupGrants: { take: 1, select: { userId: true } },
      },
    });
    // Keep global, group and multi-company credentials outside the company recovery boundary,
    // including dormant scopes that could later be restored.
    return Boolean(
      account &&
      account.memberships.length === 1 &&
      account.memberships[0]?.organizationId === organizationId &&
      account.memberships[0]?.isActive &&
      account.platformGrants.length === 0 &&
      account.companyGroupGrants.length === 0,
    );
  }

  async issue(
    issuerSession: { id: string; userId: string },
    organizationId: string | null,
    input: { email: string; verificationReference: string },
  ): Promise<{ token: string; expiresAt: string }> {
    if (!this.environment.PASSWORD_RECOVERY_ASSISTED_ENABLED) {
      throw new ServiceUnavailableException();
    }
    const { id: sessionId, userId: issuerId } = issuerSession;
    this.limit('issue', issuerId, 15);
    return this.database.client.$transaction(async (tx) => {
      await this.lockAuthority(tx, organizationId);
      const [session] = await tx.$queryRaw<
        { activeOrganizationId: string | null; expiresAt: Date }[]
      >`
        SELECT active_organization_id AS "activeOrganizationId", expires_at AS "expiresAt"
        FROM sessions
        WHERE id = ${sessionId}::uuid AND user_id = ${issuerId}::uuid
        FOR SHARE
      `;
      if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
      if (organizationId && session.activeOrganizationId !== organizationId) {
        throw new NotFoundException();
      }
      if (!(await this.issuerAuthorized(tx, issuerId, organizationId))) {
        throw new ForbiddenException();
      }
      const user = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (
        !user ||
        user.id === issuerId ||
        !(await this.lockAccount(tx, user.id)) ||
        !(await this.companyOwnsAccount(tx, user.id, organizationId))
      ) {
        throw new ForbiddenException();
      }

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + lifetimeMs);
      const token = randomBytes(32).toString('base64url');
      await tx.passwordRecovery.updateMany({
        where: { userId: user.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: issuedAt },
      });
      const record = await tx.passwordRecovery.create({
        data: {
          tokenHash: digest(token),
          userId: user.id,
          issuerId,
          organizationId,
          verificationReference: input.verificationReference,
          policyVersion: recoveryPolicy,
          issuedAt,
          expiresAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: issuerId,
          organizationId,
          action: 'AUTH_PASSWORD_RECOVERY_ISSUED',
          resourceId: record.id,
          resourceType: 'PASSWORD_RECOVERY',
        },
      });
      return { token, expiresAt: expiresAt.toISOString() };
    });
  }

  private async findOpenLink(db: Prisma.TransactionClient, hash: string) {
    return db.passwordRecovery.findFirst({
      where: {
        tokenHash: hash,
        purpose: 'PASSWORD_RESET',
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  private async matchesAuthority(db: Prisma.TransactionClient, record: PasswordRecovery) {
    return (
      (await this.issuerAuthorized(db, record.issuerId, record.organizationId)) &&
      (await this.companyOwnsAccount(db, record.userId, record.organizationId))
    );
  }

  async status(ip: string, token: string): Promise<{ available: boolean }> {
    this.limit('status', ip, 60);
    if (!this.environment.PASSWORD_RECOVERY_ASSISTED_ENABLED) return { available: false };
    const db = this.database.client;
    const record = await this.findOpenLink(db, digest(token));
    return { available: record ? await this.matchesAuthority(db, record) : false };
  }

  async confirm(ip: string, token: string, password: string): Promise<{ changed: true }> {
    this.limit('confirm', ip, 12);
    if (!this.environment.PASSWORD_RECOVERY_ASSISTED_ENABLED) throw new NotFoundException();

    const hash = digest(token);
    const initial = await this.findOpenLink(this.database.client, hash);
    if (!initial) throw new NotFoundException();

    // Password hashing can be done before locking; the link is fully revalidated in the transaction.
    const passwordHash = await hashPassword(password);
    return this.database.client.$transaction(async (tx) => {
      await this.lockAuthority(tx, initial.organizationId);
      if (!(await this.lockAccount(tx, initial.userId))) throw new NotFoundException();
      const record = await this.findOpenLink(tx, hash);
      if (!record || !(await this.matchesAuthority(tx, record))) throw new NotFoundException();

      const consumedAt = new Date();
      const { count } = await tx.passwordRecovery.updateMany({
        where: { id: record.id, consumedAt: null, revokedAt: null, expiresAt: { gt: consumedAt } },
        data: { consumedAt },
      });
      if (count !== 1) throw new NotFoundException();
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: record.userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId: record.userId } });
      await tx.auditEvent.create({
        data: {
          actorId: record.userId,
          organizationId: record.organizationId,
          action: 'AUTH_PASSWORD_RECOVERY_CONFIRMED',
          resourceId: record.id,
          resourceType: 'PASSWORD_RECOVERY',
        },
      });
      return { changed: true };
    });
  }
}
