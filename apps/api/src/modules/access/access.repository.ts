import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export type AccessScope = { userId: string; organizationId: string };
export type AccessTransaction = Prisma.TransactionClient;
export type Page = { page: number; pageSize: number };
export const memberInclude = { user: { select: { name: true, email: true } } };

@Injectable()
export class AccessRepository {
  constructor(private readonly database: PrismaService) {}

  async transaction<T>(
    organizationId: string,
    operation: (tx: AccessTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(async (tx) => {
        // Every access mutation takes the same tenant row lock before reading permissions.
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
        if (rows.length === 0) throw new NotFoundException();
        return operation(tx);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2025', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }

  async administrator(tx: AccessTransaction, scope: AccessScope): Promise<void> {
    const member = await tx.membership.findUnique({ where: { userId_organizationId: scope } });
    if (!member?.isActive) throw new NotFoundException();
    if (member.role !== 'ADMIN') throw new ForbiddenException();
  }

  async member(tx: AccessTransaction, scope: AccessScope, userId: string) {
    const member = await tx.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: scope.organizationId } },
      include: memberInclude,
    });
    if (!member) throw new NotFoundException();
    return member;
  }

  async history(
    tx: AccessTransaction,
    scope: AccessScope,
    userId: string | null,
    action: string,
    reason: string,
  ): Promise<void> {
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: scope.userId },
      select: { name: true },
    });
    await tx.accessHistory.create({
      data: {
        organizationId: scope.organizationId,
        userId,
        actorId: scope.userId,
        actorName: actor.name,
        action,
        reason,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action,
        resourceId: userId,
      },
    });
  }

  async members(scope: AccessScope, page: Page) {
    return this.transaction(scope.organizationId, async (tx) => {
      await this.administrator(tx, scope);
      const where = { organizationId: scope.organizationId };
      const items = await tx.membership.findMany({
        where,
        include: memberInclude,
        orderBy: { userId: 'asc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return { items, total: await tx.membership.count({ where }), ...page };
    });
  }

  async histories(scope: AccessScope, page: Page) {
    return this.transaction(scope.organizationId, async (tx) => {
      await this.administrator(tx, scope);
      const where = { organizationId: scope.organizationId };
      const items = await tx.accessHistory.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: items.map(({ actorId, actorName, createdAt, ...item }) => ({
          ...item,
          actor: { id: actorId, name: actorName },
          createdAt: createdAt.toISOString(),
        })),
        total: await tx.accessHistory.count({ where }),
        ...page,
      };
    });
  }

  async invites(scope: AccessScope, page: Page) {
    return this.transaction(scope.organizationId, async (tx) => {
      await this.administrator(tx, scope);
      const where = { organizationId: scope.organizationId };
      const items = await tx.accessInvite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      const actors = await tx.user.findMany({
        where: { id: { in: items.map((i) => i.createdBy) } },
        select: { id: true, name: true },
      });
      return {
        items: items.map((item) => ({ item, actor: actors.find((a) => a.id === item.createdBy)! })),
        total: await tx.accessInvite.count({ where }),
        ...page,
      };
    });
  }

  lookupToken(tokenHash: string) {
    return this.database.client.accessInvite.findUnique({ where: { tokenHash } });
  }

  findUser(email: string) {
    return this.database.client.user.findUnique({ where: { email }, select: { id: true } });
  }
}
