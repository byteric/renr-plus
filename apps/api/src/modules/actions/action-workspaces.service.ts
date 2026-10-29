import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  actionAssignmentChangeSchema,
  actionListItemSchema,
  actionWorkspaceSchema,
  riskContextSnapshotSchema,
  type ActionAssignmentInput,
  type ActionWorkspace,
  type ActionWorkspaceList,
  type ActionWorkspaceQuery,
  type ActionWorkspaceHistoryList,
  type ActionAssigneeList,
  type ActionAssigneeQuery,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { riskInclude, toRisk } from '../risks/risks.repository';
import {
  evaluationState,
  technicalContextFingerprint,
  toTechnicalEvaluation,
} from '../technical-evaluations/risk-workspaces.service';
import {
  ActionsRepository,
  actionInclude,
  referenceDate,
  revisionInclude,
  toAction,
  toRevision,
  type ActionScope,
} from './actions.repository';
import { assertActionVersion } from './actions.service';
import { lockOperationalActor, resolveAssignee } from './operational-access';

const include = {
  ...actionInclude,
  assignedMembership: { include: { user: { select: { name: true } } } },
  risk: {
    include: {
      ...riskInclude,
      diagnosticCycle: {
        select: { instrumentVersion: { select: { isDemo: true, usageMode: true } } },
      },
      technicalEvaluations: {
        orderBy: { sequence: 'desc' },
        take: 1,
        include: { author: { select: { id: true, name: true } } },
      },
    },
  },
  _count: { select: { evidence: true } },
} satisfies Prisma.ActionInclude;
type Record = Prisma.ActionGetPayload<{ include: typeof include }>;
type Actor = { role: string; isActive: boolean; capabilities: readonly string[] } | null;

function workspace(
  record: Record,
  actor: Actor,
  userId: string,
  activeEvidence: number,
): ActionWorkspace {
  const detail = toAction(record, referenceDate(record.organization.timezone, new Date()));
  const currentRisk = toRisk(record.risk);
  const captured = riskContextSnapshotSchema.parse(record.contextSnapshot);
  const contextMatches =
    technicalContextFingerprint(currentRisk) ===
    technicalContextFingerprint({ ...currentRisk, ...captured });
  const state = evaluationState(record.risk);
  const latest = record.risk.technicalEvaluations[0];
  const technical = latest ? toTechnicalEvaluation(latest) : null;
  const member = record.assignedMembership;
  const assignedUser =
    record.assignedUserId && record.assignedName && member
      ? {
          userId: record.assignedUserId,
          name: record.assignedName,
          currentName: member.user.name,
          isActive: member.isActive && record.organization.isActive,
        }
      : null;
  const manager = Boolean(
    actor?.isActive && record.organization.isActive && actor.role === 'ADMIN',
  );
  const operator =
    manager ||
    Boolean(
      actor?.isActive &&
      record.organization.isActive &&
      actor.capabilities.includes('EXECUTE_ASSIGNED_ACTIONS') &&
      record.assignedUserId === userId,
    );
  const open = record.status === 'PLANNED' || record.status === 'IN_PROGRESS';
  const originActive =
    record.risk.status === 'REGISTERED' &&
    record.risk.assessmentGroup.isActive &&
    record.risk.assessmentGroup.sector.isActive &&
    record.risk.assessmentGroup.sector.unit.isActive &&
    record.organization.isActive;
  const pendingReasons: ActionWorkspace['pendingReasons'] = [];
  if (assignedUser && !assignedUser.isActive) pendingReasons.push('ASSIGNEE_INACTIVE');
  if (detail.isOverdue) pendingReasons.push('OVERDUE');
  if (!activeEvidence) pendingReasons.push('NO_EVIDENCE');
  if (!originActive) pendingReasons.push('ORIGIN_INACTIVE');
  if (!contextMatches) pendingReasons.push('ORIGIN_CONTEXT_CHANGED');
  if (state !== 'CURRENT') pendingReasons.push('NO_CURRENT_TECHNICAL_EVALUATION');
  return actionWorkspaceSchema.parse({
    ...detail,
    risk: { id: record.riskId, factor: record.risk.factor },
    assignedUser,
    riskContext: {
      unit: currentRisk.unit,
      sector: currentRisk.sector,
      technicalEvaluationState: state,
      contextMatches,
      priority:
        technical && state === 'CURRENT' && contextMatches
          ? {
              ...technical.priority,
              methodVersionId: technical.method.versionId,
              methodName: technical.method.name,
              methodVersion: technical.method.version,
            }
          : null,
    },
    evidenceSummary: { active: activeEvidence, archived: record._count.evidence - activeEvidence },
    pendingReasons,
    permissions: {
      canManage: manager && open,
      canExecute: operator && open,
      canNote: operator,
      canUploadEvidence: operator,
      canArchiveEvidence: manager,
    },
  });
}
@Injectable()
export class ActionWorkspacesService {
  constructor(private readonly repository: ActionsRepository) {}
  private actor(tx: Prisma.TransactionClient, scope: ActionScope) {
    return tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
      },
    });
  }
  private async record(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    id: string,
  ): Promise<Record> {
    const record = await tx.action.findFirst({
      where: { id, organizationId: scope.organizationId },
      include,
    });
    if (!record) throw new NotFoundException();
    return record;
  }
  private async counts(tx: Prisma.TransactionClient, scope: ActionScope, ids: string[]) {
    const groups = ids.length
      ? await tx.actionEvidence.groupBy({
          by: ['actionId'],
          where: { organizationId: scope.organizationId, actionId: { in: ids }, archivedAt: null },
          _count: { _all: true },
        })
      : [];
    return new Map(groups.map((group) => [group.actionId, group._count._all]));
  }
  async get(scope: ActionScope, id: string): Promise<ActionWorkspace> {
    return this.repository.snapshot(async (tx) => {
      const record = await this.record(tx, scope, id);
      const counts = await this.counts(tx, scope, [id]);
      return workspace(record, await this.actor(tx, scope), scope.userId, counts.get(id) ?? 0);
    });
  }
  private async where(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    query: ActionWorkspaceQuery,
  ): Promise<Prisma.ActionWhereInput> {
    for (const [kind, id] of [
      ['risk', query.riskId],
      ['unit', query.unitId],
    ] as const) {
      if (!id) continue;
      const found =
        kind === 'risk'
          ? await tx.risk.findFirst({
              where: { id, organizationId: scope.organizationId },
              select: { id: true },
            })
          : await tx.unit.findFirst({
              where: { id, organizationId: scope.organizationId },
              select: { id: true },
            });
      if (!found) throw new NotFoundException();
    }
    if (query.sectorId) {
      const sector = await tx.sector.findFirst({
        where: { id: query.sectorId, organizationId: scope.organizationId },
        select: { unitId: true },
      });
      if (!sector) throw new NotFoundException();
      if (query.unitId && sector.unitId !== query.unitId) throw new BadRequestException();
    }
    const org = await tx.organization.findUnique({
      where: { id: scope.organizationId },
      select: { timezone: true },
    });
    if (!org) throw new NotFoundException();
    const open = { status: { in: ['PLANNED', 'IN_PROGRESS'] as ('PLANNED' | 'IN_PROGRESS')[] } };
    const overdue = {
      ...open,
      dueDate: { lt: new Date(`${referenceDate(org.timezone, new Date())}T00:00:00Z`) },
    };
    return {
      organizationId: scope.organizationId,
      ...(query.assignedTo ? { assignedUserId: scope.userId } : {}),
      ...(query.riskId ? { riskId: query.riskId } : {}),
      ...(query.status ? { status: query.status } : {}),
      risk: {
        assessmentGroup: {
          sector: {
            ...(query.unitId ? { unitId: query.unitId } : {}),
            ...(query.sectorId ? { id: query.sectorId } : {}),
          },
        },
      },
      AND: [
        ...(query.openOnly ? [open] : []),
        ...(query.overdue === true ? [overdue] : query.overdue === false ? [{ NOT: overdue }] : []),
      ],
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { responsibleName: { contains: query.q, mode: 'insensitive' } },
              {
                assignedMembership: { user: { name: { contains: query.q, mode: 'insensitive' } } },
              },
            ],
          }
        : {}),
    };
  }
  async list(scope: ActionScope, query: ActionWorkspaceQuery): Promise<ActionWorkspaceList> {
    return this.repository.snapshot(async (tx) => {
      const where = await this.where(tx, scope, query);
      const records = await tx.action.findMany({
        where,
        include,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await tx.action.count({ where });
      const actor = await this.actor(tx, scope);
      const counts = await this.counts(
        tx,
        scope,
        records.map((record) => record.id),
      );
      return {
        items: records.map((record) => {
          const value = workspace(record, actor, scope.userId, counts.get(record.id) ?? 0);
          const legacy = actionListItemSchema.parse({
            id: value.id,
            organizationId: value.organizationId,
            riskId: value.riskId,
            title: value.title,
            risk: value.risk,
            responsibleName: value.responsibleName,
            dueDate: value.dueDate,
            status: value.status,
            version: value.version,
            isOverdue: value.isOverdue,
            referenceDate: value.referenceDate,
            timeZone: value.timeZone,
          });
          return {
            ...legacy,
            assignedUser: value.assignedUser,
            riskContext: value.riskContext,
            evidenceSummary: value.evidenceSummary,
            pendingReasons: value.pendingReasons,
            permissions: value.permissions,
          };
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  async assignees(scope: ActionScope, query: ActionAssigneeQuery): Promise<ActionAssigneeList> {
    return this.repository.snapshot(async (tx) => {
      const actor = await this.actor(tx, scope);
      const org = await tx.organization.findUnique({
        where: { id: scope.organizationId },
        select: { isActive: true },
      });
      if (!actor?.isActive || actor.role !== 'ADMIN' || !org?.isActive)
        throw new ForbiddenException();
      const where = {
        organizationId: scope.organizationId,
        isActive: true,
        ...(query.q ? { user: { name: { contains: query.q, mode: 'insensitive' as const } } } : {}),
      };
      const items = await tx.membership.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: items.map((member) => ({
          userId: member.userId,
          name: member.user.name,
          canExecute:
            member.role === 'ADMIN' || member.capabilities.includes('EXECUTE_ASSIGNED_ACTIONS'),
        })),
        total: await tx.membership.count({ where }),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  async history(
    scope: ActionScope,
    id: string,
    page: { page: number; pageSize: number },
  ): Promise<ActionWorkspaceHistoryList> {
    return this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, id);
      const where = { organizationId: scope.organizationId, actionId: id };
      const records = await tx.actionRevision.findMany({
        where,
        include: revisionInclude,
        orderBy: { version: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: records.map((record) => ({
          ...toRevision(record),
          assignmentChange: record.assignmentChange
            ? actionAssignmentChangeSchema.parse(record.assignmentChange)
            : null,
        })),
        total: await tx.actionRevision.count({ where }),
        ...page,
      };
    });
  }
  async assign(scope: ActionScope, id: string, input: ActionAssignmentInput) {
    return this.repository.transaction(async (tx) => {
      await lockOperationalActor(
        tx,
        scope,
        true,
        input.assignedUserId ? [input.assignedUserId] : [],
      );
      const assigned = await resolveAssignee(tx, scope, input.assignedUserId);
      const action = await this.repository.lock(tx, scope.organizationId, id);
      assertActionVersion(action, input.expectedVersion);
      if (action.status === 'IMPLEMENTED' || action.status === 'CANCELLED')
        throw new ConflictException('Terminal action');
      if (action.assignedUserId === assigned.assignedUserId)
        throw new ConflictException('Assignment is unchanged');
      const change = {
        previous: action.assignedUserId
          ? { userId: action.assignedUserId, name: action.assignedName! }
          : null,
        next: assigned.assignedUserId
          ? { userId: assigned.assignedUserId, name: assigned.assignedName! }
          : null,
      };
      const updated = await tx.action.update({
        where: { id },
        data: { ...assigned, version: { increment: 1 }, updatedById: scope.userId },
        include: actionInclude,
      });
      await this.repository.revision(
        tx,
        scope,
        updated,
        'UPDATED',
        input.changeReason,
        null,
        null,
        change,
      );
      return toAction(updated, referenceDate(updated.organization.timezone, new Date()));
    });
  }
}
