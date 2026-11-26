import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Capability, SessionCapabilities, SessionResponse } from '@renr/contracts';
import { combineCapabilities, type LegacyCapability } from '../access/capabilities';
import type { OrganizationScope } from '../access/delegated-scope';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  ContractAccessSuspendedException,
  isContractAccessSuspended,
} from '../commercial/contract-access';
import {
  createMfaChallenge,
  credentialCookie,
  digest,
  lockMfaAccount,
  lockPlatformAccess,
  mfaKey,
  MfaUnauthorizedException,
  opaqueToken,
  type PendingLogin,
} from './mfa-security';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'renr_session';
const sessionDuration = 8 * 60 * 60 * 1000;
export type IssuedSession = { token: string; session: SessionResponse };
const includeOrganizationAccess = {
  include: {
    commercialContractAccess: {
      select: { status: true, lastReason: true, lastNextStep: true },
    },
  },
} satisfies Prisma.OrganizationDefaultArgs;
const includeUser = {
  user: {
    include: {
      memberships: {
        include: {
          organization: includeOrganizationAccess,
          scopes: {
            select: { unitId: true, sectorId: true },
            orderBy: [{ unitId: 'asc' }, { sectorId: 'asc' }],
          },
        },
      },
      companyGroupGrants: { where: { isActive: true }, select: { groupId: true }, take: 1 },
      mfaFactor: { select: { version: true } },
      platformGrants: {
        where: { isActive: true, capability: 'MANAGE_GRANTS' },
        select: { capability: true },
      },
    },
  },
} satisfies Prisma.SessionInclude;

@Injectable()
export class IdentityService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(
    private readonly database: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  assertOrigin(request: Request): void {
    if (request.get('origin') !== new URL(this.environment.CORS_ORIGIN).origin)
      throw new ForbiddenException();
  }

  async login(email: string, password: string, ip: string): Promise<IssuedSession | PendingLogin> {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    const key = digest(`${ip}:${email}`);
    const ipKey = digest(`ip:${ip}`);
    const ipAttempt = this.attempts.get(ipKey) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    const attempt = this.attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (attempt.count >= 5 || ipAttempt.count >= 60 || this.attempts.size >= 10000)
      throw new HttpException('Too many requests', 429);
    attempt.count += 1;
    ipAttempt.count += 1;
    this.attempts.set(ipKey, ipAttempt);
    this.attempts.set(key, attempt);
    const user = await this.database.client.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const dummy = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
    if (!user || !valid) {
      await this.database.client.auditEvent.create({
        data: { actorId: user?.id, action: 'AUTH_LOGIN_FAILED' },
      });
      throw new UnauthorizedException();
    }
    const result = await this.database.client.$transaction(async (tx) => {
      // Global grant writes and ID 52 use this ordering whenever both locks are needed.
      if (this.environment.MFA_REQUIRE_GLOBAL_ADMINS) await lockPlatformAccess(tx);
      const lockedUser = await lockMfaAccount(tx, user.id);
      if (lockedUser?.passwordHash !== user.passwordHash) throw new UnauthorizedException();
      const state = await this.mfaState(tx, user.id);
      if (state.enabled || state.required) {
        mfaKey(this.environment);
        return createMfaChallenge(tx, user.id, state.enabled ? 'VERIFY' : 'ENROLL', state.version);
      }
      return this.issueSession(tx, user.id);
    });
    this.attempts.delete(key);
    return result;
  }

  async mfaState(tx: Prisma.TransactionClient, userId: string) {
    const factor = await tx.mfaFactor.findUnique({ where: { userId }, select: { version: true } });
    const required = Boolean(
      factor ||
      (this.environment.MFA_REQUIRE_GLOBAL_ADMINS &&
        (await tx.platformGrant.findFirst({
          where: { userId, capability: 'MANAGE_GRANTS', isActive: true },
          select: { userId: true },
        }))),
    );
    return { enabled: Boolean(factor), required, version: factor?.version ?? null };
  }

  async issueSession(
    tx: Prisma.TransactionClient,
    userId: string,
    proof?: { version: number; verifiedAt: Date },
    activeOrganizationId?: string | null,
  ): Promise<IssuedSession> {
    const token = opaqueToken();
    if (activeOrganizationId === undefined) {
      const memberships = await tx.membership.findMany({
        where: { userId, isActive: true },
        include: { organization: includeOrganizationAccess },
      });
      activeOrganizationId =
        memberships.find((member) => !isContractAccessSuspended(member.organization))
          ?.organizationId ?? null;
    }
    const session = await tx.session.create({
      data: {
        userId,
        tokenHash: digest(token),
        activeOrganizationId,
        expiresAt: new Date(Date.now() + sessionDuration),
        mfaVersion: proof?.version,
        mfaVerifiedAt: proof?.verifiedAt,
      },
      include: includeUser,
    });
    await tx.auditEvent.create({
      data: { actorId: userId, action: 'AUTH_LOGIN', resourceId: session.id },
    });
    return { token, session: this.toResponse(session) };
  }

  async authenticate(request: Request, tx: Prisma.TransactionClient = this.database.client) {
    const token = credentialCookie(request, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException();
    const session = await tx.session.findUnique({
      where: { tokenHash: digest(token) },
      include: includeUser,
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    const factor = session.user.mfaFactor;
    const requiresPolicy =
      this.environment.MFA_REQUIRE_GLOBAL_ADMINS && session.user.platformGrants?.length > 0;
    if (
      (factor && (session.mfaVersion !== factor.version || !session.mfaVerifiedAt)) ||
      (requiresPolicy && !factor)
    ) {
      throw new MfaUnauthorizedException('AUTH_MFA_REAUTH_REQUIRED');
    }
    if (factor) mfaKey(this.environment);
    return session;
  }

  async current(request: Request): Promise<SessionResponse> {
    return this.toResponse(await this.authenticate(request));
  }

  async logout(request: Request): Promise<void> {
    await this.withLockedSession(request, async (tx, session) => {
      await tx.session.delete({ where: { id: session.id } });
      await tx.auditEvent.create({
        data: { actorId: session.userId, action: 'AUTH_LOGOUT', resourceId: session.id },
      });
    });
  }

  async activate(request: Request, organizationId: string): Promise<SessionResponse> {
    return this.withLockedSession(request, async (tx, session) => {
      const member = session.user.memberships.find(
        (item) => item.organizationId === organizationId && item.isActive !== false,
      );
      if (!member) throw new ForbiddenException();
      if (isContractAccessSuspended(member.organization)) {
        throw new ContractAccessSuspendedException();
      }
      const updated = await tx.session.update({
        where: { id: session.id },
        data: { activeOrganizationId: organizationId },
        include: includeUser,
      });
      return this.toResponse(updated);
    });
  }

  async withLockedSession<T>(
    request: Request,
    operation: (
      tx: Prisma.TransactionClient,
      session: Awaited<ReturnType<IdentityService['authenticate']>>,
    ) => Promise<T>,
    lockGlobal = false,
  ): Promise<T> {
    const initial = await this.authenticate(request);
    return this.database.client.$transaction(async (tx) => {
      if (lockGlobal) await lockPlatformAccess(tx);
      if (!(await lockMfaAccount(tx, initial.userId))) throw new UnauthorizedException();
      return operation(tx, await this.authenticate(request, tx));
    });
  }

  async scope(
    request: Request,
    organizationId: string | undefined,
    write: boolean,
    delegatedWrite?: Capability,
    allowRestricted = false,
  ): Promise<OrganizationScope> {
    const session = await this.authenticate(request);
    const active = session.activeOrganizationId;
    if (organizationId !== undefined) {
      const target = session.user.memberships.find(
        (item) => item.organizationId === organizationId,
      );
      if (!target || target.isActive === false) throw new HttpException('Not found', 404);
      if (isContractAccessSuspended(target.organization)) {
        throw new ContractAccessSuspendedException();
      }
      if (!active || active !== organizationId) throw new HttpException('Not found', 404);
    }
    const member = session.user.memberships.find((item) => item.organizationId === active);
    if (!active || !member || member.isActive === false) {
      if (
        organizationId === undefined &&
        !active &&
        session.user.memberships.some(
          (item) => item.isActive !== false && isContractAccessSuspended(item.organization),
        ) &&
        !session.user.memberships.some(
          (item) => item.isActive !== false && !isContractAccessSuspended(item.organization),
        )
      ) {
        throw new ContractAccessSuspendedException();
      }
      throw new HttpException('Not found', 404);
    }
    if (isContractAccessSuspended(member.organization)) {
      throw new ContractAccessSuspendedException();
    }
    if (member.scopeRestricted) {
      if (write || !allowRestricted) throw new ForbiddenException();
      return { userId: session.userId, organizationId: active, delegation: [...member.scopes] };
    }
    if (
      write &&
      member.role !== 'ADMIN' &&
      (!delegatedWrite || !combineCapabilities(member).includes(delegatedWrite))
    )
      throw new ForbiddenException();
    return { userId: session.userId, organizationId: active };
  }

  private async activeMembership(request: Request) {
    const session = await this.authenticate(request);
    return session.user.memberships.find(
      (item) =>
        item.organizationId === session.activeOrganizationId &&
        item.isActive !== false &&
        !isContractAccessSuspended(item.organization),
    );
  }

  async capabilities(request: Request): Promise<SessionCapabilities> {
    const member = await this.activeMembership(request);
    return {
      organizationId: member?.organizationId ?? null,
      capabilities: member && !member.scopeRestricted ? combineCapabilities(member) : [],
      canManageAccess: member?.role === 'ADMIN' && !member.scopeRestricted,
    };
  }

  async requireCapability(request: Request, organizationId: string, capability: LegacyCapability) {
    const scope = await this.scope(request, organizationId, false);
    const member = await this.activeMembership(request);
    if (member?.organizationId !== organizationId || !member.capabilities.includes(capability))
      throw new ForbiddenException();
    return scope;
  }

  /** The caller must load assignment from persisted action data in ID13, never from request JSON. */
  async assignedActionScope(
    request: Request,
    organizationId: string,
    resource: { organizationId: string; assignedUserId: string | null },
  ) {
    const scope = await this.requireCapability(request, organizationId, 'EXECUTE_ASSIGNED_ACTIONS');
    if (resource.organizationId !== scope.organizationId) throw new HttpException('Not found', 404);
    if (resource.assignedUserId !== scope.userId) throw new ForbiddenException();
    return scope;
  }
  private toResponse(
    session: Awaited<ReturnType<IdentityService['authenticate']>>,
  ): SessionResponse {
    const activeMemberships = session.user.memberships.filter((item) => item.isActive !== false);
    const operationalMemberships = activeMemberships.filter(
      (item) => !isContractAccessSuspended(item.organization),
    );
    const suspendedMemberships = activeMemberships.filter((item) =>
      isContractAccessSuspended(item.organization),
    );
    const restricted = operationalMemberships.filter((item) => item.scopeRestricted);
    return {
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      memberships: operationalMemberships.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organization.name,
        role: item.role,
      })),
      activeOrganizationId: operationalMemberships.some(
        (item) => item.organizationId === session.activeOrganizationId,
      )
        ? session.activeOrganizationId
        : null,
      expiresAt: session.expiresAt.toISOString(),
      ...(restricted.length
        ? {
            organizationScopes: Object.fromEntries(
              restricted.map((item) => [item.organizationId, item.scopes]),
            ),
          }
        : {}),
      ...(session.user.companyGroupGrants?.length ? { hasCompanyGroups: true } : {}),
      ...(suspendedMemberships.length
        ? {
            suspendedOrganizations: suspendedMemberships.map((item) => {
              const authorizedForDetails = item.role === 'ADMIN' && !item.scopeRestricted;
              const access = item.organization.commercialContractAccess;
              return {
                organizationId: item.organizationId,
                organizationName: item.organization.name,
                role: item.role,
                reason: authorizedForDetails ? (access?.lastReason ?? null) : null,
                nextStep: authorizedForDetails ? (access?.lastNextStep ?? null) : null,
              };
            }),
          }
        : {}),
    };
  }
}
