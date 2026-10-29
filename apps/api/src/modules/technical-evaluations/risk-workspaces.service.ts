import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  methodDefinitionSchema,
  resolveEvaluationMethodCell,
  riskContentSchema,
  riskContextSnapshotSchema,
  riskWorkspaceSchema,
  riskMatrixSchema,
  technicalRiskEvaluationSchema,
  technicalRiskEvaluationSummarySchema,
  type RiskDetail,
  type RiskListQuery,
  type RiskWorkspace,
  type RiskWorkspaceList,
  type RiskMatrixQuery,
  type RiskMatrix,
  type CreateTechnicalRiskEvaluationInput,
  type TechnicalRiskEvaluation,
  type TechnicalRiskEvaluationSummary,
  type TechnicalSourceReference,
  type TechnicalSourceSnapshot,
  type RiskSourceOption,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { parse } from '../../http/parse';
import { riskInclude, toRisk, RisksRepository } from '../risks/risks.repository';
import { referenceDate } from '../actions/actions.repository';
import { methodVersionInclude, toMethodVersion } from './evaluation-methods.service';
import { technicalWrite, type TechnicalScope } from './technical-scope';

const author = { select: { id: true, name: true } } as const;
const evaluationInclude = { author } satisfies Prisma.TechnicalRiskEvaluationInclude;
type EvaluationRecord = Prisma.TechnicalRiskEvaluationGetPayload<{
  include: typeof evaluationInclude;
}>;
const include = {
  ...riskInclude,
  diagnosticCycle: { select: { instrumentVersion: { select: { isDemo: true, usageMode: true } } } },
  technicalEvaluations: { orderBy: { sequence: 'desc' }, take: 1, include: evaluationInclude },
} satisfies Prisma.RiskInclude;
type WorkspaceRecord = Prisma.RiskGetPayload<{ include: typeof include }>;
type ActionSummary = RiskWorkspace['actionSummary'];
type Page = { page: number; pageSize: number };

export function technicalContextFingerprint(risk: RiskDetail): string {
  const content = {
    ...riskContentSchema.strip().parse(risk),
    assessmentGroupId: risk.assessmentGroupId,
    sectorId: risk.sectorId,
    unitId: risk.unit.id,
  };
  const sorted = Object.fromEntries(
    Object.entries(content).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
export function toTechnicalEvaluation(record: EvaluationRecord): TechnicalRiskEvaluation {
  return technicalRiskEvaluationSchema.parse({
    ...(record.result as object),
    id: record.id,
    organizationId: record.organizationId,
    riskId: record.riskId,
    sequence: record.sequence,
    riskVersion: record.riskVersion,
    label: 'TECHNICAL',
    method: record.methodSnapshot,
    rationale: record.rationale,
    context: record.context,
    contextSnapshot: record.contextSnapshot,
    sources: record.sources,
    author: record.author,
    createdAt: record.createdAt.toISOString(),
  });
}
function summary(record: EvaluationRecord): TechnicalRiskEvaluationSummary {
  return technicalRiskEvaluationSummarySchema.strip().parse(toTechnicalEvaluation(record));
}
function active(record: WorkspaceRecord): boolean {
  const sector = record.assessmentGroup.sector;
  return (
    record.assessmentGroup.isActive &&
    sector.isActive &&
    sector.unit.isActive &&
    sector.organization.isActive
  );
}
export function evaluationState(
  record: WorkspaceRecord,
): RiskWorkspace['technicalEvaluationState'] {
  const latest = record.technicalEvaluations[0];
  if (!latest) return 'ABSENT';
  return record.status === 'REGISTERED' &&
    active(record) &&
    latest.contextFingerprint === technicalContextFingerprint(toRisk(record))
    ? 'CURRENT'
    : 'CONTEXT_CHANGED';
}
function workspace(record: WorkspaceRecord, actions: ActionSummary): RiskWorkspace {
  const state = evaluationState(record);
  const pending: RiskWorkspace['pendingReasons'] = [];
  if (state === 'ABSENT') pending.push('NO_TECHNICAL_EVALUATION');
  if (state === 'CONTEXT_CHANGED') pending.push('CONTEXT_CHANGED');
  if (!actions.total) pending.push('NO_ACTIONS');
  if (!active(record)) pending.push('INACTIVE_SCOPE');
  const demo =
    record.diagnosticCycle?.instrumentVersion.isDemo ||
    record.diagnosticCycle?.instrumentVersion.usageMode === 'DEMONSTRATION';
  return riskWorkspaceSchema.parse({
    ...toRisk(record),
    sourceLabel:
      record.sourceKind === 'DIAGNOSTIC_CYCLE'
        ? demo
          ? 'Diagnóstico demonstrativo legado'
          : 'Diagnóstico legado'
        : record.sourceKind === 'TECHNICAL_RECORD'
          ? 'Registro técnico'
          : 'Origem pendente',
    technicalEvaluationState: state,
    latestTechnicalEvaluation: record.technicalEvaluations[0]
      ? summary(record.technicalEvaluations[0])
      : null,
    actionSummary: actions,
    pendingReasons: pending,
  });
}

@Injectable()
export class RiskWorkspacesService {
  constructor(
    private readonly database: PrismaService,
    private readonly risks: RisksRepository,
  ) {}
  private async record(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    id: string,
  ): Promise<WorkspaceRecord> {
    const record = await tx.risk.findFirst({
      where: { id, organizationId: scope.organizationId },
      include,
    });
    if (!record) throw new NotFoundException();
    return record;
  }
  private async where(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    query: RiskListQuery,
  ): Promise<Prisma.RiskWhereInput> {
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
      if (query.unitId && sector.unitId !== query.unitId) {
        throw new BadRequestException({
          details: [{ field: 'sectorId', message: 'Setor não pertence à unidade.' }],
        });
      }
    }
    return {
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
  }
  private async actions(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    records: WorkspaceRecord[],
  ): Promise<Map<string, ActionSummary>> {
    const result = new Map(records.map((item) => [item.id, { total: 0, open: 0, overdue: 0 }]));
    if (!records.length) return result;
    const where = {
      organizationId: scope.organizationId,
      riskId: { in: records.map((item) => item.id) },
    };
    const open = {
      ...where,
      status: { in: ['PLANNED', 'IN_PROGRESS'] as ('PLANNED' | 'IN_PROGRESS')[] },
    };
    const today = referenceDate(
      records[0]!.assessmentGroup.sector.organization.timezone,
      new Date(),
    );
    const groups = await Promise.all([
      tx.action.groupBy({ by: ['riskId'], where, _count: { _all: true } }),
      tx.action.groupBy({ by: ['riskId'], where: open, _count: { _all: true } }),
      tx.action.groupBy({
        by: ['riskId'],
        where: { ...open, dueDate: { lt: new Date(`${today}T00:00:00Z`) } },
        _count: { _all: true },
      }),
    ]);
    for (const [index, items] of groups.entries())
      for (const item of items) {
        const target = result.get(item.riskId);
        if (target)
          target[index === 0 ? 'total' : index === 1 ? 'open' : 'overdue'] = item._count._all;
      }
    return result;
  }
  async list(scope: TechnicalScope, query: RiskListQuery): Promise<RiskWorkspaceList> {
    return this.database.client.$transaction(
      async (tx) => {
        const where = await this.where(tx, scope, query);
        const [records, total] = await Promise.all([
          tx.risk.findMany({
            where,
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.risk.count({ where }),
        ]);
        const actions = await this.actions(tx, scope, records);
        return {
          items: records.map((record) => workspace(record, actions.get(record.id)!)),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(scope: TechnicalScope, id: string): Promise<RiskWorkspace> {
    return this.database.client.$transaction(
      async (tx) => {
        const record = await this.record(tx, scope, id);
        return workspace(record, (await this.actions(tx, scope, [record])).get(id)!);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async evaluations(scope: TechnicalScope, id: string, page: Page) {
    return this.database.client.$transaction(
      async (tx) => {
        await this.record(tx, scope, id);
        const where = { organizationId: scope.organizationId, riskId: id };
        const [items, total] = await Promise.all([
          tx.technicalRiskEvaluation.findMany({
            where,
            include: evaluationInclude,
            orderBy: { sequence: 'desc' },
            skip: (page.page - 1) * page.pageSize,
            take: page.pageSize,
          }),
          tx.technicalRiskEvaluation.count({ where }),
        ]);
        return { items: items.map(toTechnicalEvaluation), total, ...page };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async matrix(scope: TechnicalScope, query: RiskMatrixQuery): Promise<RiskMatrix> {
    return this.database.client.$transaction(
      async (tx) => {
        const method = await tx.evaluationMethodVersion.findFirst({
          where: { id: query.methodVersionId, organizationId: scope.organizationId },
          include: methodVersionInclude,
        });
        if (!method) throw new NotFoundException();
        if (method.status !== 'PUBLISHED')
          throw new ConflictException('Matrix requires a published method version');
        const methodVersion = toMethodVersion(method);
        const cells = methodVersion.definition.matrix.map((cell) => ({ ...cell, count: 0 }));
        const byPair = new Map(
          cells.map((cell) => [`${cell.probabilityKey}:${cell.severityKey}`, cell]),
        );
        const excluded = {
          unclassified: 0,
          contextChanged: 0,
          incompatible: 0,
          inactiveScope: 0,
          notRegistered: 0,
        };
        const where = await this.where(tx, scope, query);
        let cursor: string | undefined;
        let totalMatched = 0;
        let classifiedTotal = 0;
        // Process the entire filtered set in bounded batches; never aggregate only the visible page.
        while (true) {
          const records: WorkspaceRecord[] = await tx.risk.findMany({
            where,
            include,
            orderBy: { id: 'asc' },
            take: 200,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          for (const record of records) {
            totalMatched++;
            const latest = record.technicalEvaluations[0];
            if (record.status !== 'REGISTERED') excluded.notRegistered++;
            else if (!active(record)) excluded.inactiveScope++;
            else if (!latest) excluded.unclassified++;
            else if (evaluationState(record) !== 'CURRENT') excluded.contextChanged++;
            else if (latest.methodVersionId !== method.id) excluded.incompatible++;
            else {
              const cell = byPair.get(`${latest.probabilityKey}:${latest.severityKey}`);
              if (!cell)
                throw new ConflictException(
                  'Stored evaluation is incompatible with the method definition',
                );
              cell.count++;
              classifiedTotal++;
            }
          }
          if (records.length < 200) break;
          cursor = records.at(-1)!.id;
        }
        return riskMatrixSchema.parse({
          methodVersion,
          cells,
          totalMatched,
          classifiedTotal,
          excluded,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    );
  }
  private async sourceOption(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    risk: WorkspaceRecord,
    source: Exclude<TechnicalSourceReference, { kind: 'DOCUMENT' }>,
  ): Promise<RiskSourceOption> {
    if (source.kind === 'RISK_RECORD') {
      if (source.id !== risk.id) throw new NotFoundException();
      const demo = Boolean(
        risk.diagnosticCycle?.instrumentVersion.isDemo ||
        risk.diagnosticCycle?.instrumentVersion.usageMode === 'DEMONSTRATION',
      );
      return {
        kind: source.kind,
        id: risk.id,
        label: `Registro: ${risk.factor}`,
        reference: `risk:${risk.id}:v${risk.version}`,
        isDemonstration: demo,
        eligible: !demo,
        unavailableReason: demo
          ? 'Origem demonstrativa não sustenta classificação técnica real.'
          : null,
      };
    }
    const cycleInclude = {
      instrumentVersion: { select: { isDemo: true, usageMode: true } },
      policyVersion: { select: { usageMode: true } },
    } as const;
    if (source.kind === 'ASSESSMENT_CYCLE') {
      const cycle = await tx.assessmentCycle.findFirst({
        where: {
          id: source.id,
          organizationId: scope.organizationId,
          assessmentGroupId: risk.assessmentGroupId,
        },
        include: cycleInclude,
      });
      if (!cycle) throw new NotFoundException();
      const demo =
        cycle.instrumentVersion.isDemo ||
        cycle.instrumentVersion.usageMode !== 'REAL' ||
        cycle.policyVersion.usageMode !== 'REAL';
      return {
        kind: source.kind,
        id: cycle.id,
        label: `Coleta: ${cycle.name}`,
        reference: `assessment-cycle:${cycle.id}:r${cycle.revision}`,
        isDemonstration: demo,
        eligible: !demo,
        unavailableReason: demo ? 'Coleta demonstrativa; não usar como aprovação técnica.' : null,
      };
    }
    const item = await tx.assessmentSource.findFirst({
      where: {
        id: source.id,
        organizationId: scope.organizationId,
        cycle: { assessmentGroupId: risk.assessmentGroupId },
      },
      include: { cycle: { include: cycleInclude } },
    });
    if (!item) throw new NotFoundException();
    const demo =
      item.cycle.instrumentVersion.isDemo ||
      item.cycle.instrumentVersion.usageMode !== 'REAL' ||
      item.cycle.policyVersion.usageMode !== 'REAL';
    return {
      kind: source.kind,
      id: item.id,
      label: `Fonte complementar · ${item.occurredOn.toISOString().slice(0, 10)}`,
      reference: `assessment-source:${item.id}`,
      isDemonstration: demo,
      eligible: !demo,
      unavailableReason: demo ? 'Fonte associada a uma coleta demonstrativa.' : null,
    };
  }
  async sourceOptions(scope: TechnicalScope, id: string, page: Page) {
    return this.database.client.$transaction(
      async (tx) => {
        const risk = await this.record(tx, scope, id);
        const cycleWhere = {
          organizationId: scope.organizationId,
          assessmentGroupId: risk.assessmentGroupId,
        };
        const sourceWhere = {
          organizationId: scope.organizationId,
          cycle: { assessmentGroupId: risk.assessmentGroupId },
        };
        const [cycleCount, sourceCount] = await Promise.all([
          tx.assessmentCycle.count({ where: cycleWhere }),
          tx.assessmentSource.count({ where: sourceWhere }),
        ]);
        const offset = (page.page - 1) * page.pageSize;
        const references: Exclude<TechnicalSourceReference, { kind: 'DOCUMENT' }>[] =
          offset === 0 ? [{ kind: 'RISK_RECORD', id }] : [];
        const cycleSkip = Math.max(0, offset - 1);
        const cycleTake = Math.max(
          0,
          Math.min(page.pageSize - references.length, cycleCount - cycleSkip),
        );
        if (cycleTake)
          references.push(
            ...(
              await tx.assessmentCycle.findMany({
                where: cycleWhere,
                select: { id: true },
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                skip: cycleSkip,
                take: cycleTake,
              })
            ).map((item) => ({ kind: 'ASSESSMENT_CYCLE' as const, id: item.id })),
          );
        const sourceTake = Math.max(0, page.pageSize - references.length);
        if (sourceTake)
          references.push(
            ...(
              await tx.assessmentSource.findMany({
                where: sourceWhere,
                select: { id: true },
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                skip: Math.max(0, offset - 1 - cycleCount),
                take: sourceTake,
              })
            ).map((item) => ({ kind: 'ASSESSMENT_SOURCE' as const, id: item.id })),
          );
        const items: RiskSourceOption[] = [];
        for (const reference of references)
          items.push(await this.sourceOption(tx, scope, risk, reference));
        return { items, total: 1 + cycleCount + sourceCount, ...page };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async evaluate(
    scope: TechnicalScope,
    id: string,
    input: CreateTechnicalRiskEvaluationInput,
  ): Promise<TechnicalRiskEvaluation> {
    return technicalWrite(this.database, scope, (tx) =>
      this.evaluateInTransaction(tx, scope, id, input),
    );
  }
  async evaluateInTransaction(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    id: string,
    input: CreateTechnicalRiskEvaluationInput,
  ): Promise<TechnicalRiskEvaluation> {
    await this.risks.lock(tx, scope.organizationId, id);
    const record = await this.record(tx, scope, id);
    if (record.version !== input.expectedVersion || record.version === 2147483647)
      throw new ConflictException('Risk version changed');
    if (record.status !== 'REGISTERED' || !active(record))
      throw new ConflictException('Registered risk and active organizational context required');
    if (
      record.diagnosticCycle?.instrumentVersion.isDemo ||
      record.diagnosticCycle?.instrumentVersion.usageMode === 'DEMONSTRATION'
    )
      throw new ConflictException(
        'Demonstration records cannot be promoted to a technical classification',
      );
    const method = await tx.evaluationMethodVersion.findFirst({
      where: { id: input.methodVersionId, organizationId: scope.organizationId },
      include: methodVersionInclude,
    });
    if (!method) throw new NotFoundException();
    if (method.status !== 'PUBLISHED')
      throw new ConflictException('Method version is not published');
    const definition = parse(methodDefinitionSchema, method.definition);
    const result = resolveEvaluationMethodCell(definition, input.probabilityKey, input.severityKey);
    if (!result)
      throw new BadRequestException({
        details: [
          { field: 'probabilityKey', message: 'Entradas fora das escalas do método publicado.' },
        ],
      });
    const sources: TechnicalSourceSnapshot[] = [];
    const capturedAt = new Date().toISOString();
    for (const reference of input.sources) {
      if (reference.kind === 'DOCUMENT')
        sources.push({
          kind: reference.kind,
          id: null,
          title: 'Documento técnico referenciado',
          reference: reference.reference,
          isDemonstration: false,
          capturedAt,
        });
      else {
        const option = await this.sourceOption(tx, scope, record, reference);
        if (!option.eligible)
          throw new ConflictException(
            'Demonstration sources cannot support technical classifications',
          );
        sources.push({
          kind: option.kind,
          id: option.id,
          title: option.label,
          reference: option.reference,
          isDemonstration: option.isDemonstration,
          capturedAt,
        });
      }
    }
    const risk = toRisk(record);
    const contextSnapshot = riskContextSnapshotSchema.parse({
      ...riskContentSchema.strip().parse(risk),
      assessmentGroupId: risk.assessmentGroupId,
      sectorId: risk.sectorId,
      unit: risk.unit,
      sector: risk.sector,
      status: 'REGISTERED',
    });
    const methodSnapshot = {
      id: method.methodId,
      name: method.method.name,
      versionId: method.id,
      version: method.version,
      approvalReference: method.approvalReference,
    };
    const sequence = (record.technicalEvaluations[0]?.sequence ?? 0) + 1;
    if (sequence > 2147483647) throw new ConflictException('Evaluation sequence limit reached');
    const evaluation = await tx.technicalRiskEvaluation.create({
      data: {
        organizationId: scope.organizationId,
        riskId: id,
        sequence,
        riskVersion: record.version,
        methodVersionId: method.id,
        probabilityKey: input.probabilityKey,
        severityKey: input.severityKey,
        result,
        methodSnapshot: methodSnapshot as Prisma.InputJsonValue,
        contextSnapshot: contextSnapshot as Prisma.InputJsonValue,
        contextFingerprint: technicalContextFingerprint(risk),
        rationale: input.rationale,
        context: input.context,
        sources: sources as unknown as Prisma.InputJsonValue,
        authorId: scope.userId,
      },
      include: evaluationInclude,
    });
    await tx.risk.update({
      where: { id },
      data: { version: { increment: 1 }, updatedById: scope.userId },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        resourceId: evaluation.id,
        action: 'risk.technical_evaluation_created',
      },
    });
    return toTechnicalEvaluation(evaluation);
  }
}
