import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  actionDetailSchema,
  actionOperationalSnapshotSchema,
  actionRevisionSchema,
  type ActionDetail,
  type ActionRevision,
  type ActionAssignmentChange,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { riskInclude } from '../risks/risks.repository';

export type ActionScope = { userId: string; organizationId: string };
export const actionInclude = {
  risk: { include: riskInclude },
  organization: true,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.ActionInclude;
export type ActionRecord = Prisma.ActionGetPayload<{ include: typeof actionInclude }>;
export const revisionInclude = {
  author: { select: { id: true, name: true } },
} satisfies Prisma.ActionRevisionInclude;
type RevisionRecord = Prisma.ActionRevisionGetPayload<{ include: typeof revisionInclude }>;
export function referenceDate(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function operational(record: ActionRecord) {
  return actionOperationalSnapshotSchema.parse({
    title: record.title,
    description: record.description,
    responsibleName: record.responsibleName,
    dueDate: record.dueDate.toISOString().slice(0, 10),
    expectedResult: record.expectedResult,
    verificationCriterion: record.verificationCriterion,
    status: record.status,
    implementationNote: record.implementationNote,
    implementedAt: record.implementedAt?.toISOString() ?? null,
  });
}
export function toAction(record: ActionRecord, date: string): ActionDetail {
  const sector = record.risk.assessmentGroup.sector;
  const open = record.status === 'PLANNED' || record.status === 'IN_PROGRESS';
  return actionDetailSchema.parse({
    ...operational(record),
    id: record.id,
    organizationId: record.organizationId,
    riskId: record.riskId,
    version: record.version,
    sourceRiskVersion: record.sourceRiskVersion,
    evaluationId: record.evaluationId,
    contextSnapshot: record.contextSnapshot,
    currentOrigin: {
      riskStatus: record.risk.status,
      organizationActive: record.organization.isActive,
      unitActive: sector.unit.isActive,
      sectorActive: sector.isActive,
    },
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    isOverdue: open && record.dueDate.toISOString().slice(0, 10) < date,
    referenceDate: date,
    timeZone: record.organization.timezone,
  });
}
export function toRevision(record: RevisionRecord): ActionRevision {
  return actionRevisionSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    actionId: record.actionId,
    version: record.version,
    event: record.event,
    snapshot: record.snapshot,
    changeReason: record.changeReason,
    text: record.text,
    evidenceId: record.evidenceId,
    author: record.author,
    createdAt: record.createdAt.toISOString(),
  });
}
@Injectable()
export class ActionsRepository {
  constructor(private readonly database: PrismaService) {}
  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client
      .$transaction(operation, { timeout: 15000 })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          const cause = (
            error.meta?.driverAdapterError as
              { cause?: { originalCode?: string; code?: string } } | undefined
          )?.cause;
          if (
            ['P2002', 'P2003', 'P2004', 'P2034'].includes(error.code) ||
            (error.code === 'P2039' && (cause?.originalCode === '23514' || cause?.code === '23514'))
          )
            throw new ConflictException(
              'Action changed or protected assignment reference is unavailable',
            );
        }
        throw error;
      });
  }
  snapshot<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async get(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<ActionRecord> {
    const record = await tx.action.findFirst({
      where: { id, organizationId },
      include: actionInclude,
    });
    if (!record) throw new NotFoundException();
    return record;
  }
  async lock(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<ActionRecord> {
    // Creation locks risk; all subsequent changes lock only action, then its attachment. No reverse lock path.
    await tx.$queryRaw`SELECT id FROM actions WHERE organization_id=${organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
    return this.get(tx, organizationId, id);
  }
  async revision(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    action: ActionRecord,
    event: ActionRevision['event'],
    changeReason: string | null = null,
    text: string | null = null,
    evidenceId: string | null = null,
    assignmentChange?: ActionAssignmentChange,
  ): Promise<ActionRevision> {
    const revision = await tx.actionRevision.create({
      data: {
        organizationId: scope.organizationId,
        actionId: action.id,
        version: action.version,
        event,
        snapshot: operational(action),
        changeReason,
        text,
        evidenceId,
        authorId: scope.userId,
        ...(assignmentChange
          ? { assignmentChange: assignmentChange as Prisma.InputJsonValue }
          : {}),
      },
      include: revisionInclude,
    });
    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        resourceId: action.id,
        action: `ACTION_${event}`,
      },
    });
    return toRevision(revision);
  }
}
