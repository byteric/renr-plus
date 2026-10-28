import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  actionContentSchema,
  actionListItemSchema,
  actionOverviewSchema,
  riskContentSchema,
  riskContextSnapshotSchema,
  type CreateActionInput,
  type UpdateActionInput,
  type AddActionNoteInput,
  type ActionDetail,
  type ActionList,
  type ActionListQuery,
  type ActionOverview,
  type ActionRevision,
  type ActionRevisionList,
  type ActionAssignmentChange,
  type ActionExecutionInput,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { riskInclude, toRisk } from '../risks/risks.repository';
import {
  ActionsRepository,
  actionInclude,
  referenceDate,
  revisionInclude,
  toAction,
  toRevision,
  type ActionScope,
  type ActionRecord,
} from './actions.repository';
import {
  assertOperationalActor,
  lockOperationalActor,
  resolveAssignee,
} from './operational-access';

export function assertActionVersion(record: { version: number }, expected: number): void {
  if (record.version !== expected || record.version === 2147483647)
    throw new ConflictException('Action version changed');
}
@Injectable()
export class ActionsService {
  constructor(private readonly repository: ActionsRepository) {}
  async create(
    scope: ActionScope,
    riskId: string,
    input: CreateActionInput,
    assignment?: { assignedUserId: string | null },
  ): Promise<ActionDetail> {
    return this.repository.transaction((tx) =>
      this.createInTransaction(tx, scope, riskId, input, assignment),
    );
  }
  async createInTransaction(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    riskId: string,
    input: CreateActionInput,
    assignment?: { assignedUserId: string | null },
  ): Promise<ActionDetail> {
    await lockOperationalActor(
      tx,
      scope,
      true,
      assignment?.assignedUserId ? [assignment.assignedUserId] : [],
    );
    const assigned = assignment
      ? await resolveAssignee(tx, scope, assignment.assignedUserId)
      : { assignedUserId: null, assignedName: null };
    await tx.$queryRaw`SELECT id FROM risks WHERE organization_id=${scope.organizationId}::uuid AND id=${riskId}::uuid FOR UPDATE`;
    const risk = await tx.risk.findFirst({
      where: { id: riskId, organizationId: scope.organizationId },
      include: riskInclude,
    });
    if (!risk) throw new NotFoundException();
    if (risk.version !== input.expectedRiskVersion)
      throw new ConflictException('Risk version changed');
    const sector = risk.assessmentGroup.sector;
    if (
      risk.status !== 'REGISTERED' ||
      !sector.isActive ||
      !sector.unit.isActive ||
      !sector.organization.isActive ||
      sector.unit.organizationId !== scope.organizationId
    )
      throw new ConflictException('Registered active source required');
    if (
      input.evaluationId &&
      !(await tx.riskEvaluation.findFirst({
        where: { id: input.evaluationId, riskId, organizationId: scope.organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    const current = toRisk(risk);
    const contextSnapshot = riskContextSnapshotSchema.parse({
      ...riskContentSchema.strip().parse(current),
      sectorId: current.sectorId,
      assessmentGroupId: current.assessmentGroupId,
      unit: current.unit,
      sector: current.sector,
      status: 'REGISTERED',
    });
    const content = actionContentSchema.strip().parse(input);
    const action = await tx.action.create({
      data: {
        ...content,
        ...assigned,
        dueDate: new Date(`${content.dueDate}T00:00:00Z`),
        organizationId: scope.organizationId,
        riskId,
        evaluationId: input.evaluationId,
        sourceRiskVersion: risk.version,
        contextSnapshot,
        createdById: scope.userId,
        updatedById: scope.userId,
      },
      include: actionInclude,
    });
    const assignmentChange: ActionAssignmentChange | undefined = assigned.assignedUserId
      ? {
          previous: null,
          next: { userId: assigned.assignedUserId, name: assigned.assignedName! },
        }
      : undefined;
    await this.repository.revision(
      tx,
      scope,
      action,
      'CREATED',
      assignmentChange ? 'Responsável associado na criação da ação.' : null,
      null,
      null,
      assignmentChange,
    );
    return toAction(action, referenceDate(action.organization.timezone, new Date()));
  }
  async get(scope: ActionScope, id: string): Promise<ActionDetail> {
    return this.repository.snapshot(async (tx) => {
      const action = await this.repository.get(tx, scope.organizationId, id);
      return toAction(action, referenceDate(action.organization.timezone, new Date()));
    });
  }
  async update(
    scope: ActionScope,
    id: string,
    input: UpdateActionInput,
    operation: 'manage' | 'execute' = 'manage',
  ): Promise<ActionDetail> {
    return this.repository.transaction(async (tx) => {
      const member = await lockOperationalActor(tx, scope, operation === 'manage');
      const action = await this.repository.lock(tx, scope.organizationId, id);
      if (operation === 'execute') assertOperationalActor(member, action);
      assertActionVersion(action, input.expectedVersion);
      if (action.status === 'IMPLEMENTED' || action.status === 'CANCELLED')
        throw new ConflictException('Terminal action');
      const { changeReason, status, implementationNote } = input;
      const content = actionContentSchema.partial().strip().parse(input);
      const allowed =
        action.status === 'PLANNED' ? ['IN_PROGRESS', 'CANCELLED'] : ['IMPLEMENTED', 'CANCELLED'];
      if (status && !allowed.includes(status))
        throw new ConflictException('Invalid action transition');
      if (status === 'IMPLEMENTED' && !implementationNote) throw new BadRequestException();
      const event: ActionRevision['event'] =
        status === 'IN_PROGRESS'
          ? 'STARTED'
          : status === 'IMPLEMENTED'
            ? 'IMPLEMENTED'
            : status === 'CANCELLED'
              ? 'CANCELLED'
              : 'UPDATED';
      const updated = await tx.action.update({
        where: { id },
        data: {
          ...content,
          ...(content.dueDate ? { dueDate: new Date(`${content.dueDate}T00:00:00Z`) } : {}),
          status,
          ...(status === 'IMPLEMENTED' ? { implementationNote, implementedAt: new Date() } : {}),
          version: { increment: 1 },
          updatedById: scope.userId,
        },
        include: actionInclude,
      });
      await this.repository.revision(tx, scope, updated, event, changeReason);
      return toAction(updated, referenceDate(updated.organization.timezone, new Date()));
    });
  }
  async execute(
    scope: ActionScope,
    id: string,
    input: ActionExecutionInput,
  ): Promise<ActionDetail> {
    return this.update(scope, id, input, 'execute');
  }
  async assignmentResource(scope: ActionScope, id: string) {
    return this.repository.snapshot(async (tx) => {
      const action = await this.repository.get(tx, scope.organizationId, id);
      return { organizationId: action.organizationId, assignedUserId: action.assignedUserId };
    });
  }
  async note(
    scope: ActionScope,
    id: string,
    input: AddActionNoteInput,
    operation: 'manage' | 'execute' = 'manage',
  ): Promise<ActionRevision> {
    return this.repository.transaction(async (tx) => {
      const member = await lockOperationalActor(tx, scope, operation === 'manage');
      const action = await this.repository.lock(tx, scope.organizationId, id);
      if (operation === 'execute') assertOperationalActor(member, action);
      assertActionVersion(action, input.expectedVersion);
      const updated = await tx.action.update({
        where: { id },
        data: { version: { increment: 1 }, updatedById: scope.userId },
        include: actionInclude,
      });
      return this.repository.revision(tx, scope, updated, 'NOTE', null, input.text);
    });
  }
  async revisions(
    scope: ActionScope,
    id: string,
    page: { page: number; pageSize: number },
  ): Promise<ActionRevisionList> {
    return this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, id);
      const where = { organizationId: scope.organizationId, actionId: id };
      const [records, total] = await Promise.all([
        tx.actionRevision.findMany({
          where,
          orderBy: { version: 'desc' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
          include: revisionInclude,
        }),
        tx.actionRevision.count({ where }),
      ]);
      return { items: records.map(toRevision), total, ...page };
    });
  }
  private async filters(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    query: ActionListQuery,
    date: string,
  ): Promise<Prisma.ActionWhereInput> {
    if (
      query.riskId &&
      !(await tx.risk.findFirst({
        where: { organizationId: scope.organizationId, id: query.riskId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    if (
      query.unitId &&
      !(await tx.unit.findFirst({
        where: { organizationId: scope.organizationId, id: query.unitId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    if (query.sectorId) {
      const sector = await tx.sector.findFirst({
        where: { organizationId: scope.organizationId, id: query.sectorId },
        select: { unitId: true },
      });
      if (!sector) throw new NotFoundException();
      if (query.unitId && sector.unitId !== query.unitId)
        throw new BadRequestException({
          details: [{ field: 'sectorId', message: 'Setor não pertence à unidade.' }],
        });
    }
    const open = { status: { in: ['PLANNED', 'IN_PROGRESS'] as Array<'PLANNED' | 'IN_PROGRESS'> } };
    const overdue = { ...open, dueDate: { lt: new Date(`${date}T00:00:00Z`) } };
    return {
      organizationId: scope.organizationId,
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
            ],
          }
        : {}),
    };
  }
  async list(scope: ActionScope, query: ActionListQuery): Promise<ActionList> {
    return this.repository.snapshot(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: scope.organizationId },
        select: { timezone: true },
      });
      if (!org) throw new NotFoundException();
      const date = referenceDate(org.timezone, new Date());
      const where = await this.filters(tx, scope, query, date);
      const [records, total] = await Promise.all([
        tx.action.findMany({
          where,
          include: actionInclude,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.action.count({ where }),
      ]);
      return {
        items: records.map((record: ActionRecord) => {
          const detail = toAction(record, date);
          return actionListItemSchema.parse({
            id: detail.id,
            organizationId: detail.organizationId,
            riskId: detail.riskId,
            title: detail.title,
            risk: { id: record.risk.id, factor: record.risk.factor },
            responsibleName: detail.responsibleName,
            dueDate: detail.dueDate,
            status: detail.status,
            version: detail.version,
            isOverdue: detail.isOverdue,
            referenceDate: date,
            timeZone: org.timezone,
          });
        }),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  async overview(scope: ActionScope): Promise<ActionOverview> {
    return this.repository.snapshot(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: scope.organizationId },
        select: { timezone: true },
      });
      if (!org) throw new NotFoundException();
      const now = new Date();
      const date = referenceDate(org.timezone, now);
      const groups = await tx.action.groupBy({
        by: ['status'],
        where: { organizationId: scope.organizationId },
        _count: true,
      });
      const counts = new Map(groups.map((group) => [group.status, group._count]));
      const planned = counts.get('PLANNED') ?? 0,
        inProgress = counts.get('IN_PROGRESS') ?? 0,
        implemented = counts.get('IMPLEMENTED') ?? 0,
        cancelled = counts.get('CANCELLED') ?? 0;
      const overdue = await tx.action.count({
        where: {
          organizationId: scope.organizationId,
          status: { in: ['PLANNED', 'IN_PROGRESS'] },
          dueDate: { lt: new Date(`${date}T00:00:00Z`) },
        },
      });
      return actionOverviewSchema.parse({
        organizationId: scope.organizationId,
        generatedAt: now.toISOString(),
        referenceDate: date,
        timeZone: org.timezone,
        totals: {
          planned,
          inProgress,
          implemented,
          cancelled,
          open: planned + inProgress,
          total: planned + inProgress + implemented + cancelled,
          overdue,
        },
      });
    });
  }
}
