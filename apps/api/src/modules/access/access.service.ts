import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type {
  AccessInvite,
  AccessMembership,
  AcceptAccessInvite,
  CreateAccessInvite,
  MutateAccessInvite,
  UpdateAccessCapabilities,
  UpdateAccessMembership,
} from '@renr/contracts';
import type { AccessInvite as InviteRecord, Membership } from '../../generated/prisma/client';
import { IdentityService } from '../identity/identity.service';
import { hashPassword } from '../identity/password';
import { AccessInviteUnavailableException } from './access.errors';
import {
  AccessRepository,
  memberInclude,
  type AccessScope,
  type AccessTransaction,
  type Page,
} from './access.repository';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const personSelect = { id: true, name: true };

@Injectable()
export class AccessService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly repository: AccessRepository,
    private readonly identity: IdentityService,
  ) {}

  private memberDto(
    member: Membership & { user: { name: string; email: string } },
  ): AccessMembership {
    return {
      organizationId: member.organizationId,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      isActive: member.isActive,
      capabilities: member.capabilities,
      version: member.version,
      updatedAt: member.updatedAt.toISOString(),
    };
  }
  private inviteDto(record: InviteRecord, actor: { id: string; name: string }): AccessInvite {
    return {
      id: record.id,
      organizationId: record.organizationId,
      email: record.email,
      name: record.name,
      role: record.role,
      capabilities: record.capabilities,
      version: record.version,
      status: record.consumedAt
        ? 'CONSUMED'
        : record.revokedAt
          ? 'REVOKED'
          : record.expiresAt.getTime() <= Date.now()
            ? 'EXPIRED'
            : 'PENDING',
      expiresAt: record.expiresAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      createdBy: actor,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      consumedAt: record.consumedAt?.toISOString() ?? null,
    };
  }
  async members(scope: AccessScope, page: Page) {
    const result = await this.repository.members(scope, page);
    return { ...result, items: result.items.map((i) => this.memberDto(i)) };
  }
  histories(scope: AccessScope, page: Page) {
    return this.repository.histories(scope, page);
  }
  member(scope: AccessScope, userId: string): Promise<AccessMembership> {
    return this.repository.transaction(scope.organizationId, async (tx) => {
      await this.repository.administrator(tx, scope);
      return this.memberDto(await this.repository.member(tx, scope, userId));
    });
  }
  async invites(scope: AccessScope, page: Page) {
    const result = await this.repository.invites(scope, page);
    return { ...result, items: result.items.map((i) => this.inviteDto(i.item, i.actor)) };
  }

  async update(
    scope: AccessScope,
    userId: string,
    input: UpdateAccessMembership | UpdateAccessCapabilities,
  ): Promise<AccessMembership> {
    return this.repository.transaction(scope.organizationId, async (tx) => {
      await this.repository.administrator(tx, scope);
      const current = await this.repository.member(tx, scope, userId);
      if (current.version !== input.expectedVersion) throw new ConflictException();
      const change =
        'capabilities' in input
          ? { capabilities: input.capabilities }
          : { role: input.role, isActive: input.isActive };
      const role = 'role' in input ? (input.role ?? current.role) : current.role;
      const active = 'isActive' in input ? (input.isActive ?? current.isActive) : current.isActive;
      if (current.isActive && current.role === 'ADMIN' && (!active || role !== 'ADMIN')) {
        if (
          (await tx.membership.count({
            where: { organizationId: scope.organizationId, isActive: true, role: 'ADMIN' },
          })) <= 1
        )
          throw new ConflictException('Last active administrator');
      }
      const member = await tx.membership.update({
        where: { userId_organizationId: { userId, organizationId: scope.organizationId } },
        data: { ...change, version: { increment: 1 } },
        include: memberInclude,
      });
      if (current.isActive && !member.isActive) {
        await tx.session.updateMany({
          where: { userId, activeOrganizationId: scope.organizationId },
          data: { activeOrganizationId: null },
        });
      }
      if ('capabilities' in input) {
        await this.capabilityHistory(
          tx,
          scope,
          userId,
          current.capabilities,
          input.capabilities,
          input.reason,
        );
      } else {
        await this.repository.history(
          tx,
          scope,
          userId,
          current.isActive !== member.isActive
            ? member.isActive
              ? 'ACCESS_MEMBERSHIP_ACTIVATED'
              : 'ACCESS_MEMBERSHIP_DEACTIVATED'
            : 'ACCESS_MEMBERSHIP_UPDATED',
          input.reason,
        );
      }
      return this.memberDto(member);
    });
  }

  private async capabilityHistory(
    tx: AccessTransaction,
    scope: AccessScope,
    userId: string,
    previous: Membership['capabilities'],
    next: Membership['capabilities'],
    reason: string,
  ): Promise<void> {
    for (const capability of previous.filter((c) => !next.includes(c)))
      await this.repository.history(
        tx,
        scope,
        userId,
        `ACCESS_CAPABILITY_REVOKED:${capability}`,
        reason,
      );
    for (const capability of next.filter((c) => !previous.includes(c)))
      await this.repository.history(
        tx,
        scope,
        userId,
        `ACCESS_CAPABILITY_GRANTED:${capability}`,
        reason,
      );
  }

  private async createInvite(tx: AccessTransaction, scope: AccessScope, input: CreateAccessInvite) {
    const token = randomBytes(32).toString('base64url');
    const invite = await tx.accessInvite.create({
      data: {
        organizationId: scope.organizationId,
        email: input.email,
        name: input.name,
        role: input.role,
        capabilities: input.capabilities,
        tokenHash: digest(token),
        createdBy: scope.userId,
        expiresAt: new Date(Date.now() + input.expiresInHours * 3600000),
      },
    });
    await this.repository.history(tx, scope, null, 'ACCESS_INVITE_CREATED', input.reason);
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: scope.userId },
      select: personSelect,
    });
    return { invite: this.inviteDto(invite, actor), token };
  }

  create(scope: AccessScope, input: CreateAccessInvite) {
    return this.repository.transaction(scope.organizationId, async (tx) => {
      await this.repository.administrator(tx, scope);
      return this.createInvite(tx, scope, input);
    });
  }

  mutateInvite(scope: AccessScope, id: string, input: MutateAccessInvite, reissue: boolean) {
    return this.repository.transaction(scope.organizationId, async (tx) => {
      await this.repository.administrator(tx, scope);
      const current = await tx.accessInvite.findFirst({
        where: { id, organizationId: scope.organizationId },
      });
      if (!current) throw new NotFoundException();
      if (current.version !== input.expectedVersion || current.consumedAt || current.revokedAt)
        throw new ConflictException();
      const record = await tx.accessInvite.update({
        where: { id },
        data: { revokedAt: new Date(), version: { increment: 1 } },
      });
      await this.repository.history(
        tx,
        scope,
        null,
        reissue ? 'ACCESS_INVITE_REISSUED' : 'ACCESS_INVITE_REVOKED',
        input.reason,
      );
      if (reissue)
        return this.createInvite(tx, scope, {
          email: current.email,
          name: current.name,
          role: current.role,
          capabilities: current.capabilities,
          expiresInHours: 72,
          reason: input.reason,
        });
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: current.createdBy },
        select: personSelect,
      });
      return this.inviteDto(record, actor);
    });
  }

  private rateLimit(request: Request): void {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const key = digest(request.ip ?? 'unknown');
    const current = this.attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (current.count >= 60 || this.attempts.size >= 10000)
      throw new HttpException('Too many requests', 429);
    current.count++;
    this.attempts.set(key, current);
  }

  async accept(
    request: Request,
    input: AcceptAccessInvite,
  ): Promise<{ organizationId: string; userId: string }> {
    this.rateLimit(request);
    const tokenHash = digest(input.token);
    const preview = await this.repository.lookupToken(tokenHash);
    if (!preview) throw new AccessInviteUnavailableException();
    if (preview.consumedAt || preview.revokedAt || preview.expiresAt.getTime() <= Date.now())
      throw new AccessInviteUnavailableException();
    const existing = await this.repository.findUser(preview.email);
    let authenticatedId: string | undefined;
    if (existing) {
      const session = await this.identity.authenticate(request);
      authenticatedId = session.userId;
      if (authenticatedId !== existing.id) throw new ForbiddenException();
      if (input.password !== undefined)
        throw new BadRequestException('Existing identities keep their password');
    } else if (!input.name || !input.password)
      throw new BadRequestException('Name and password required');
    // Expensive password derivation happens outside the short transaction; all authority is rechecked inside.
    const encoded = !existing && input.password ? await hashPassword(input.password) : undefined;
    return this.repository.transaction(preview.organizationId, async (tx) => {
      const invite = await tx.accessInvite.findUnique({ where: { tokenHash } });
      if (
        !invite ||
        invite.consumedAt ||
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now()
      )
        throw new AccessInviteUnavailableException();
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: invite.organizationId },
      });
      if (!organization.isActive) throw new AccessInviteUnavailableException();
      let user = await tx.user.findUnique({ where: { email: invite.email } });
      if (user) {
        if (!authenticatedId) throw new UnauthorizedException();
        if (user.id !== authenticatedId) throw new ForbiddenException();
        if (input.password !== undefined) throw new BadRequestException();
      } else {
        if (!encoded || !input.name) throw new ConflictException();
        user = await tx.user.create({
          data: { name: input.name, email: invite.email, passwordHash: encoded },
        });
      }
      const where = {
        userId_organizationId: { userId: user.id, organizationId: invite.organizationId },
      };
      const previous = await tx.membership.findUnique({ where });
      // An outstanding invitation cannot downgrade or silently change an active membership.
      if (previous?.isActive) throw new ConflictException('Membership already active');
      await tx.membership.upsert({
        where,
        create: {
          userId: user.id,
          organizationId: invite.organizationId,
          role: invite.role,
          capabilities: invite.capabilities,
        },
        update: {
          isActive: true,
          role: invite.role,
          capabilities: invite.capabilities,
          version: { increment: 1 },
        },
      });
      await tx.accessInvite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date(), version: { increment: 1 } },
      });
      const scope = { userId: user.id, organizationId: invite.organizationId };
      await this.repository.history(
        tx,
        scope,
        user.id,
        'ACCESS_INVITE_ACCEPTED',
        'Invitation accepted by the identified recipient',
      );
      // The granting actor is the inviter, not the recipient who consumes the token.
      await this.capabilityHistory(
        tx,
        { userId: invite.createdBy, organizationId: invite.organizationId },
        user.id,
        previous?.capabilities ?? [],
        invite.capabilities,
        'Capabilities authorized through activation invitation',
      );
      return { organizationId: invite.organizationId, userId: user.id };
    });
  }
}
