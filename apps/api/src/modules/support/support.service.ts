import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateSupportTicket,
  type PlatformSupportTicketQuery,
  type SupportTicket,
  type SupportTicketDetail,
  type SupportTicketList,
  type SupportTicketQuery,
  type UpdateSupportTicket,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { OrganizationScope } from '../access/delegated-scope';
import { lockAndAssertContractAccessAllowed } from '../commercial/contract-access';

const ticketInclude = {
  organization: { select: { name: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.SupportTicketInclude;

function toTicket(
  record: Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>,
): SupportTicket {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    subject: record.subject,
    category: record.category,
    description: record.description,
    status: record.status,
    assignee: record.assignee,
    dueOn: record.dueOn?.toISOString().slice(0, 10) ?? null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SupportService {
  constructor(private readonly database: PrismaService) {}

  private async companyActor(tx: Prisma.TransactionClient, scope: OrganizationScope) {
    const { organizationId, userId } = scope;
    await lockAndAssertContractAccessAllowed(tx, organizationId);
    await tx.$queryRaw`SELECT user_id FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
    const member = await tx.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        isActive: true,
        role: true,
        scopeRestricted: true,
        organization: { select: { isActive: true } },
        user: { select: { name: true } },
      },
    });
    if (!member?.isActive || !member.organization.isActive) throw new NotFoundException();
    if (member.role !== 'ADMIN' || member.scopeRestricted) throw new ForbiddenException();
    return member.user;
  }

  private async requireSupport(tx: Prisma.TransactionClient, userId: string, write = false) {
    if (write) {
      // Serialize against grant changes in the platform module.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
    }
    const grant = await tx.platformGrant.findFirst({
      where: {
        userId,
        isActive: true,
        capability: write ? 'MANAGE_SUPPORT' : { in: ['READ_SUPPORT', 'MANAGE_SUPPORT'] },
      },
      select: { user: { select: { name: true } } },
    });
    if (!grant) throw new ForbiddenException();
    return grant.user;
  }

  private async listTickets(
    tx: Prisma.TransactionClient,
    { page, pageSize, status }: SupportTicketQuery,
    organizationId?: string,
  ): Promise<SupportTicketList> {
    const where = {
      ...(organizationId ? { organizationId } : {}),
      ...(status ? { status } : {}),
    } satisfies Prisma.SupportTicketWhereInput;
    const [items, total] = await Promise.all([
      tx.supportTicket.findMany({
        where,
        include: ticketInclude,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
      tx.supportTicket.count({ where }),
    ]);
    return { items: items.map(toTicket), total, page, pageSize };
  }

  private async ticketDetail(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId?: string,
  ): Promise<SupportTicketDetail> {
    const record = await tx.supportTicket.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: { ...ticketInclude, revisions: { orderBy: { version: 'asc' } } },
    });
    if (!record) throw new NotFoundException();
    return {
      ticket: toTicket(record),
      history: record.revisions.map((revision) => ({
        id: revision.id,
        version: revision.version,
        status: revision.status,
        assignee:
          revision.assigneeId && revision.assigneeName !== null
            ? { id: revision.assigneeId, name: revision.assigneeName }
            : null,
        dueOn: revision.dueOn?.toISOString().slice(0, 10) ?? null,
        note: revision.note,
        actorName: revision.actorName,
        createdAt: revision.createdAt.toISOString(),
      })),
    };
  }

  companyList(scope: OrganizationScope, query: SupportTicketQuery) {
    return this.database.client.$transaction(
      async (tx) => {
        await this.companyActor(tx, scope);
        return this.listTickets(tx, query, scope.organizationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  companyDetail(scope: OrganizationScope, id: string) {
    return this.database.client.$transaction(async (tx) => {
      await this.companyActor(tx, scope);
      return this.ticketDetail(tx, id, scope.organizationId);
    });
  }

  open(scope: OrganizationScope, input: CreateSupportTicket) {
    return this.database.client.$transaction(async (tx) => {
      const actor = await this.companyActor(tx, scope);
      const ticket = await tx.supportTicket.create({
        data: { ...input, organizationId: scope.organizationId, openedById: scope.userId },
      });
      await tx.supportTicketRevision.create({
        data: {
          organizationId: scope.organizationId,
          ticketId: ticket.id,
          version: ticket.version,
          status: ticket.status,
          note: 'Chamado aberto.',
          actorId: scope.userId,
          actorName: actor.name,
        },
      });
      return this.ticketDetail(tx, ticket.id, scope.organizationId);
    });
  }

  platformList(userId: string, query: PlatformSupportTicketQuery) {
    return this.database.client.$transaction(
      async (tx) => {
        await this.requireSupport(tx, userId);
        return this.listTickets(tx, query, query.organizationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  platformDetail(userId: string, id: string) {
    return this.database.client.$transaction(
      async (tx) => {
        await this.requireSupport(tx, userId);
        return this.ticketDetail(tx, id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  platformAssignees(userId: string) {
    return this.database.client.$transaction(async (tx) => {
      await this.requireSupport(tx, userId, true);
      const rows = await tx.platformGrant.findMany({
        where: { capability: 'MANAGE_SUPPORT', isActive: true },
        select: { user: { select: { id: true, name: true } } },
        orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
      });
      return { items: rows.map((row) => row.user) };
    });
  }

  update(userId: string, id: string, input: UpdateSupportTicket) {
    return this.database.client.$transaction(async (tx) => {
      const actor = await this.requireSupport(tx, userId, true);
      const ticket = await tx.supportTicket.findUnique({ where: { id } });
      if (!ticket) throw new NotFoundException();
      if (ticket.version !== input.expectedVersion) {
        throw new ConflictException('O chamado mudou. Atualize a fila antes de tentar de novo.');
      }
      if (ticket.status === 'RESOLVED') {
        throw new ConflictException('O chamado já foi resolvido.');
      }

      const assignee = input.assigneeId
        ? await tx.platformGrant.findUnique({
            where: {
              userId_capability: { userId: input.assigneeId, capability: 'MANAGE_SUPPORT' },
            },
            select: { isActive: true, user: { select: { name: true } } },
          })
        : null;
      if (input.assigneeId && !assignee?.isActive) {
        throw new ConflictException('Selecione um responsável ativo na equipe de suporte.');
      }

      const dueOn = input.dueOn ? new Date(`${input.dueOn}T00:00:00.000Z`) : null;
      const version = ticket.version + 1;
      await tx.supportTicket.update({
        where: { id, version: input.expectedVersion },
        data: {
          status: input.status,
          assigneeId: input.assigneeId,
          dueOn,
          resolvedAt: input.status === 'RESOLVED' ? new Date() : null,
          version,
        },
      });
      await tx.supportTicketRevision.create({
        data: {
          organizationId: ticket.organizationId,
          ticketId: ticket.id,
          version,
          status: input.status,
          assigneeId: input.assigneeId,
          assigneeName: assignee?.user.name ?? null,
          dueOn,
          note: input.note,
          actorId: userId,
          actorName: actor.name,
        },
      });
      return this.ticketDetail(tx, ticket.id);
    });
  }
}
