import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createRiskSchema,
  DEMO_MINIMUM_RESPONSES,
  riskContentSchema,
  riskContextSnapshotSchema,
  type CreateRisk,
  type UpdateRiskInput,
  type RiskListQuery,
  type CreatePreliminaryEvaluationInput,
  type RiskDetail,
  type RiskList,
  type PreliminaryEvaluationList,
  type PreliminaryEvaluation,
} from '@renr/contracts';
import { parse } from '../../http/parse';
import { Prisma } from '../../generated/prisma/client';
import {
  RisksRepository,
  riskInclude,
  toEvaluation,
  toRisk,
  type RiskScope,
  type RiskRecord,
} from './risks.repository';

@Injectable()
export class RisksService {
  constructor(private readonly repository: RisksRepository) {}

  private async validateSource(
    tx: Prisma.TransactionClient,
    organizationId: string,
    groupId: string,
    content: CreateRisk,
  ): Promise<void> {
    if (!content.diagnosticCycleId) return;
    const cycle = await tx.diagnosticCycle.findFirst({
      where: {
        id: content.diagnosticCycleId,
        organizationId,
        status: 'CLOSED',
        groups: { some: { assessmentGroupId: groupId, organizationId } },
      },
      select: { id: true },
    });
    if (
      !cycle ||
      (await tx.diagnosticResponse.count({ where: { organizationId, cycleId: cycle.id } })) <
        DEMO_MINIMUM_RESPONSES
    )
      throw new ForbiddenException('Diagnostic source unavailable');
  }
  private active(risk: RiskRecord): void {
    const sector = risk.assessmentGroup.sector;
    if (
      !sector.isActive ||
      !sector.unit.isActive ||
      !sector.organization.isActive ||
      sector.unit.organizationId !== risk.organizationId
    )
      throw new ConflictException('Inactive organizational scope');
  }
  private version(risk: RiskRecord, expectedVersion: number): void {
    if (risk.version !== expectedVersion || risk.version === 2147483647)
      throw new ConflictException('Risk version changed');
  }

  async list(scope: RiskScope, query: RiskListQuery): Promise<RiskList> {
    return this.repository.snapshot(async (tx) => {
      if (
        query.unitId &&
        !(await tx.unit.findFirst({
          where: { id: query.unitId, organizationId: scope.organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      if (query.sectorId) {
        const sector = await tx.sector.findFirst({
          where: { id: query.sectorId, organizationId: scope.organizationId },
          select: { unitId: true },
        });
        if (!sector) throw new NotFoundException();
        if (query.unitId && sector.unitId !== query.unitId)
          throw new BadRequestException({
            details: [{ field: 'sectorId', message: 'Setor não pertence à unidade.' }],
          });
      }
      const where: Prisma.RiskWhereInput = {
        organizationId: scope.organizationId,
        status: query.status ?? { in: ['DRAFT', 'REGISTERED'] },
        assessmentGroup: {
          sector: {
            ...(query.unitId ? { unitId: query.unitId } : {}),
            ...(query.sectorId ? { id: query.sectorId } : {}),
          },
        },
        ...(query.evaluationPresence
          ? { evaluations: query.evaluationPresence === 'WITH' ? { some: {} } : { none: {} } }
          : {}),
        ...(query.q ? { factor: { contains: query.q, mode: 'insensitive' } } : {}),
      };
      const [records, total] = await Promise.all([
        tx.risk.findMany({
          where,
          include: riskInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.risk.count({ where }),
      ]);
      return { items: records.map(toRisk), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async get(scope: RiskScope, id: string): Promise<RiskDetail> {
    return this.repository.snapshot(async (tx) =>
      toRisk(await this.repository.get(tx, scope.organizationId, id)),
    );
  }
  async create(scope: RiskScope, input: CreateRisk): Promise<RiskDetail> {
    return this.repository.transaction(async (tx) => {
      const sector = await tx.sector.findFirst({
        where: { id: input.sectorId, organizationId: scope.organizationId },
        include: { unit: true, organization: true },
      });
      if (!sector) throw new NotFoundException();
      if (
        !sector.isActive ||
        !sector.unit.isActive ||
        !sector.organization.isActive ||
        sector.unit.organizationId !== scope.organizationId
      )
        throw new ConflictException('Inactive organizational scope');
      const group = await tx.assessmentGroup.upsert({
        where: {
          organizationId_sectorId: { organizationId: scope.organizationId, sectorId: sector.id },
        },
        create: { organizationId: scope.organizationId, sectorId: sector.id },
        update: {},
      });
      await this.validateSource(tx, scope.organizationId, group.id, input);
      const content = riskContentSchema.strip().parse(input);
      const risk = await tx.risk.create({
        data: {
          ...content,
          status: input.status,
          organizationId: scope.organizationId,
          assessmentGroupId: group.id,
          createdById: scope.userId,
          updatedById: scope.userId,
        },
        include: riskInclude,
      });
      await this.repository.audit(tx, scope, risk.id, 'RISK_CREATE');
      return toRisk(risk);
    });
  }
  async update(scope: RiskScope, id: string, input: UpdateRiskInput): Promise<RiskDetail> {
    const { expectedVersion, ...changes } = input;
    return this.repository.transaction(async (tx) => {
      await this.repository.lock(tx, scope.organizationId, id);
      const risk = await this.repository.get(tx, scope.organizationId, id);
      this.version(risk, expectedVersion);
      if (risk.status === 'ARCHIVED') throw new ConflictException('Archived risk is read-only');
      if (
        risk.status === 'REGISTERED' &&
        (input.status === 'DRAFT' ||
          (input.sourceKind !== undefined && input.sourceKind !== risk.sourceKind) ||
          (input.diagnosticCycleId !== undefined &&
            input.diagnosticCycleId !== risk.diagnosticCycleId))
      )
        throw new BadRequestException('Registered scope and origin are immutable');
      const current = toRisk(risk);
      const merged = parse(createRiskSchema, {
        ...riskContentSchema.strip().parse(current),
        ...changes,
        sectorId: current.sectorId,
        status: input.status === 'ARCHIVED' ? risk.status : (input.status ?? risk.status),
      });
      if (input.status !== 'ARCHIVED') this.active(risk);
      await this.validateSource(tx, scope.organizationId, risk.assessmentGroupId, merged);
      const content = riskContentSchema.strip().parse(merged);
      const updated = await tx.risk.update({
        where: { id },
        data: {
          ...content,
          status: input.status ?? risk.status,
          version: { increment: 1 },
          updatedById: scope.userId,
        },
        include: riskInclude,
      });
      await this.repository.audit(
        tx,
        scope,
        id,
        input.status === 'ARCHIVED' ? 'RISK_ARCHIVE' : 'RISK_UPDATE',
      );
      return toRisk(updated);
    });
  }
  async evaluations(
    scope: RiskScope,
    id: string,
    page: { page: number; pageSize: number },
  ): Promise<PreliminaryEvaluationList> {
    return this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, id);
      const where = { organizationId: scope.organizationId, riskId: id };
      const [items, total] = await Promise.all([
        tx.riskEvaluation.findMany({
          where,
          orderBy: { sequence: 'desc' },
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
          include: { author: { select: { id: true, name: true } } },
        }),
        tx.riskEvaluation.count({ where }),
      ]);
      return { items: items.map(toEvaluation), total, ...page };
    });
  }
  async evaluate(
    scope: RiskScope,
    id: string,
    input: CreatePreliminaryEvaluationInput,
  ): Promise<PreliminaryEvaluation> {
    const { expectedVersion, ...content } = input;
    return this.repository.transaction(async (tx) => {
      await this.repository.lock(tx, scope.organizationId, id);
      const risk = await this.repository.get(tx, scope.organizationId, id);
      this.version(risk, expectedVersion);
      if (risk.status !== 'REGISTERED')
        throw new ConflictException('Only registered risks receive preliminary evaluations');
      this.active(risk);
      const current = toRisk(risk);
      const contextSnapshot = riskContextSnapshotSchema.parse({
        ...riskContentSchema.strip().parse(current),
        sectorId: current.sectorId,
        assessmentGroupId: current.assessmentGroupId,
        unit: current.unit,
        sector: current.sector,
        status: 'REGISTERED',
      });
      const evaluation = await tx.riskEvaluation.create({
        data: {
          ...content,
          organizationId: scope.organizationId,
          riskId: id,
          sequence: (risk.evaluations[0]?.sequence ?? 0) + 1,
          riskVersion: risk.version,
          contextSnapshot,
          authorId: scope.userId,
        },
        include: { author: { select: { id: true, name: true } } },
      });
      await tx.risk.update({
        where: { id },
        data: { version: { increment: 1 }, updatedById: scope.userId },
      });
      await this.repository.audit(tx, scope, evaluation.id, 'RISK_PRELIMINARY_EVALUATION_CREATE');
      return toEvaluation(evaluation);
    });
  }
}
