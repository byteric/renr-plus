import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  assessmentInviteDeliveryConfirmationSchema,
  assessmentInviteDeliveryListSchema,
  assessmentInviteDeliverySchema,
  type AssessmentInviteDelivery,
  type PreviewAssessmentInviteDelivery,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

type Scope = { userId: string; organizationId: string };
type Cycle = { status: 'DRAFT' | 'OPEN' | 'CLOSED'; startsAt: Date; endsAt: Date; active: boolean };
type Operation = {
  id: string;
  channel: string;
  count: number;
  expiresAt: Date;
  issuedAt: Date | null;
};
const manualChannel = 'MANUAL_CODE';
const participationPath = '/#/responder';
const previewLifetime = 15 * 60 * 1000;

function isOpen(cycle: Cycle, now: Date) {
  return cycle.active && cycle.status === 'OPEN' && cycle.startsAt <= now;
}

function operationStatus(
  operation: Operation,
  cycle: Cycle,
  now: Date,
): AssessmentInviteDelivery['status'] {
  if (operation.issuedAt) return 'ISSUED';
  if (!isOpen(cycle, now)) return 'CLOSED';
  if (operation.expiresAt <= now || cycle.endsAt <= now) return 'EXPIRED';
  return 'PENDING_CONFIRMATION';
}

function summary(operation: Operation, cycle: Cycle, now: Date) {
  return assessmentInviteDeliverySchema.parse({
    id: operation.id,
    channel: operation.channel,
    count: operation.count,
    status: operationStatus(operation, cycle, now),
    expiresAt: operation.expiresAt.toISOString(),
    issuedAt: operation.issuedAt?.toISOString() ?? null,
  });
}

@Injectable()
export class AssessmentDeliveryService {
  constructor(private readonly database: PrismaService) {}

  private async authorizedCycle(
    tx: Prisma.TransactionClient,
    scope: Scope,
    cycleId: string,
    mutation: boolean,
  ) {
    const { organizationId, userId } = scope;
    if (mutation) {
      // Use the collection lock also held by its close transition and response submission.
      await tx.$queryRaw`SELECT id FROM assessment_cycles WHERE id = ${cycleId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      // Prevent authorization or organization changes from interleaving with issuance.
      await tx.$queryRaw`SELECT m.user_id FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ${userId}::uuid AND m.organization_id = ${organizationId}::uuid FOR SHARE OF m, o`;
    }
    const membership = await tx.membership.findUnique({
      where: { userId_organizationId: scope },
      select: { role: true, isActive: true, hrCapabilities: true, scopeRestricted: true },
    });
    if (!membership?.isActive) throw new NotFoundException();
    if (
      membership.scopeRestricted ||
      (membership.role !== 'ADMIN' &&
        !membership.hrCapabilities.includes('HR_ASSESSMENT_INVITES_ISSUE'))
    )
      throw new ForbiddenException();

    const cycle = await tx.assessmentCycle.findFirst({
      where: { id: cycleId, organizationId },
      select: {
        startsAt: true,
        endsAt: true,
        status: true,
        organization: { select: { isActive: true } },
      },
    });
    if (!cycle) throw new NotFoundException();
    const { organization, ...cycleState } = cycle;
    return { ...cycleState, active: organization.isActive };
  }

  private async find(
    tx: Prisma.TransactionClient,
    scope: Scope,
    cycleId: string,
    operationId: string,
  ) {
    const operation = await tx.assessmentInviteDelivery.findFirst({
      where: {
        id: operationId,
        organizationId: scope.organizationId,
        cycleId,
        actorId: scope.userId,
      },
    });
    if (!operation) throw new NotFoundException();
    return operation;
  }

  private async change<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }

  preview(scope: Scope, cycleId: string, input: PreviewAssessmentInviteDelivery) {
    return this.change(async (tx) => {
      const cycle = await this.authorizedCycle(tx, scope, cycleId, true);
      const now = new Date();
      const keys = {
        organizationId: scope.organizationId,
        cycleId,
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
      };
      const existing = await tx.assessmentInviteDelivery.findFirst({ where: keys });
      if (existing) {
        if (existing.actorId !== scope.userId || existing.count !== input.count)
          throw new ConflictException();
        return summary(existing, cycle, now);
      }
      if (!isOpen(cycle, now) || cycle.endsAt <= now)
        throw new ConflictException('Collection unavailable');
      const operation = await tx.assessmentInviteDelivery.create({
        data: {
          ...keys,
          actorId: scope.userId,
          count: input.count,
          createdAt: now,
          expiresAt: new Date(Math.min(cycle.endsAt.getTime(), now.getTime() + previewLifetime)),
        },
      });
      return summary(operation, cycle, now);
    });
  }

  list(scope: Scope, cycleId: string) {
    return this.database.client.$transaction(async (tx) => {
      const cycle = await this.authorizedCycle(tx, scope, cycleId, false);
      const operations = await tx.assessmentInviteDelivery.findMany({
        where: {
          organizationId: scope.organizationId,
          cycleId,
          actorId: scope.userId,
          channel: manualChannel,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      });
      const now = new Date();
      return assessmentInviteDeliveryListSchema.parse({
        items: operations.map((operation) => summary(operation, cycle, now)),
      });
    });
  }

  get(scope: Scope, cycleId: string, operationId: string) {
    return this.database.client.$transaction(async (tx) => {
      const cycle = await this.authorizedCycle(tx, scope, cycleId, false);
      const operation = await this.find(tx, scope, cycleId, operationId);
      return summary(operation, cycle, new Date());
    });
  }

  confirm(scope: Scope, cycleId: string, operationId: string) {
    return this.change(async (tx) => {
      const cycle = await this.authorizedCycle(tx, scope, cycleId, true);
      const operation = await this.find(tx, scope, cycleId, operationId);
      const now = new Date();
      if (operation.issuedAt)
        return assessmentInviteDeliveryConfirmationSchema.parse({
          operation: summary(operation, cycle, now),
          invites: [],
          participationPath,
          requiresReview: true,
        });
      if (operationStatus(operation, cycle, now) !== 'PENDING_CONFIRMATION')
        throw new ConflictException('Collection closed or delivery expired');

      const invites = Array.from({ length: operation.count }, () => ({
        code: randomBytes(32).toString('base64url'),
        expiresAt: cycle.endsAt.toISOString(),
      }));
      await tx.assessmentInvite.createMany({
        data: invites.map(({ code }) => ({
          organizationId: scope.organizationId,
          cycleId,
          tokenHash: createHash('sha256').update(code).digest('hex'),
          expiresAt: cycle.endsAt,
        })),
      });
      const issued = await tx.assessmentInviteDelivery.update({
        where: { id: operation.id },
        data: { issuedAt: now },
      });
      await tx.auditEvent.create({
        data: {
          actorId: scope.userId,
          organizationId: scope.organizationId,
          action: 'assessment.invites.manual.issued',
          resourceType: 'assessment_invite_delivery',
          resourceId: issued.id,
          referenceType: 'assessment_cycle',
          referenceId: cycleId,
        },
      });
      return assessmentInviteDeliveryConfirmationSchema.parse({
        operation: summary(issued, cycle, now),
        invites,
        participationPath,
        requiresReview: false,
      });
    });
  }
}
