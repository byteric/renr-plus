import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  managementIndicatorHistorySchema,
  managementIndicatorsSchema,
  type ManagementIndicatorHistoryQuery,
  type ManagementIndicators,
  type ManagementIndicatorsQuery,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { actionInclude, referenceDate, type ActionScope } from '../actions/actions.repository';
import { currentEfficacy } from '../action-efficacy/action-efficacy.service';
import { technicalClosureReviewReasons } from '../risk-continuity/risk-continuity.service';
import {
  currentRiskLevel,
  riskWorkspaceRecords,
} from '../technical-evaluations/risk-workspaces.service';

type Filter = Pick<ManagementIndicatorsQuery, 'unitId' | 'sectorId'>;
type Level = ManagementIndicators['risks']['levels'][number];
type Unit = ManagementIndicators['risks']['units'][number];
type Priority = ManagementIndicators['priorities']['items'][number];
type HistoryPoint = {
  date: string;
  evaluations: number;
  implementations: number;
  closures: number;
};
const priorityPageSize = 5;

function statusCounts(groups: { isActive: boolean; _count: { _all: number } }[]) {
  const active = groups.find((row) => row.isActive)?._count._all ?? 0;
  const inactive = groups.find((row) => !row.isActive)?._count._all ?? 0;
  return { active, inactive, total: active + inactive };
}

function addLevel(levels: Map<string, Level>, level: Omit<Level, 'count'>) {
  const key = `${level.methodVersionId}:${level.key}`;
  const current = levels.get(key);
  if (current) current.count++;
  else levels.set(key, { ...level, count: 1 });
}

function orderedLevels(levels: Map<string, Level>) {
  return [...levels.values()].sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'pt-BR') ||
      a.methodVersionId.localeCompare(b.methodVersionId) ||
      a.key.localeCompare(b.key),
  );
}

const priorityScope = {
  assessmentGroup: { select: { sector: { select: { id: true, unitId: true } } } },
} satisfies Prisma.RiskSelect;
type PriorityRecord = {
  id: string;
  title: string;
  riskId: string;
  dueDate: Date;
  risk: Prisma.RiskGetPayload<{ select: typeof priorityScope }>;
};
function priority(record: PriorityRecord, kind: Priority['kind']): Priority {
  const sector = record.risk.assessmentGroup.sector;
  return {
    actionId: record.id,
    title: record.title,
    riskId: record.riskId,
    unitId: sector.unitId,
    sectorId: sector.id,
    dueDate: record.dueDate.toISOString().slice(0, 10),
    kind,
  };
}

const implementedInclude = {
  ...actionInclude,
  risk: {
    include: {
      ...actionInclude.risk.include,
      technicalEvaluations: { orderBy: { sequence: 'desc' }, take: 1, select: { id: true } },
    },
  },
  efficacyOpinions: {
    orderBy: { sequence: 'desc' },
    take: 1,
    select: {
      id: true,
      result: true,
      actionFingerprint: true,
      riskContextFingerprint: true,
      proofPackage: true,
    },
  },
  actionTechnicalClosures: {
    orderBy: { sequence: 'desc' },
    take: 1,
    select: {
      id: true,
      actionFingerprint: true,
      riskContextFingerprint: true,
      opinionId: true,
      reassessment: { select: { evaluationId: true } },
    },
  },
} satisfies Prisma.ActionInclude;
type Implemented = Prisma.ActionGetPayload<{ include: typeof implementedInclude }>;

@Injectable()
export class ManagementIndicatorsService {
  constructor(private readonly database: PrismaService) {}

  private async context(tx: Prisma.TransactionClient, scope: ActionScope, query: Filter) {
    const organization = await tx.organization.findUnique({
      where: { id: scope.organizationId },
      select: { id: true, name: true, isActive: true, timezone: true },
    });
    const member = await tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
      },
      select: { isActive: true, role: true },
    });
    if (!organization || !member?.isActive) throw new NotFoundException();
    if (
      query.unitId &&
      !(await tx.unit.findFirst({
        where: { organizationId: scope.organizationId, id: query.unitId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();

    let unitId = query.unitId;
    if (query.sectorId) {
      const sector = await tx.sector.findFirst({
        where: { organizationId: scope.organizationId, id: query.sectorId },
        select: { unitId: true },
      });
      if (!sector) throw new NotFoundException();
      if (unitId && unitId !== sector.unitId)
        throw new BadRequestException('Setor não pertence à unidade.');
      unitId = sector.unitId;
    }
    const now = new Date();
    const { timezone: timeZone, ...org } = organization;
    return {
      organization: org,
      canReadEmployees: member.role === 'ADMIN',
      generatedAt: now.toISOString(),
      referenceDate: referenceDate(timeZone, now),
      timeZone,
      filters: { unitId: unitId ?? null, sectorId: query.sectorId ?? null },
    };
  }

  private async structure(
    tx: Prisma.TransactionClient,
    organizationId: string,
    filters: ManagementIndicators['filters'],
    canReadEmployees: boolean,
  ) {
    const unitId = filters.unitId ?? undefined;
    const sectorId = filters.sectorId ?? undefined;
    const [units, sectors, employees, unitOptions, sectorOptions] = await Promise.all([
      tx.unit.groupBy({
        by: ['isActive'],
        where: { organizationId, id: unitId },
        _count: { _all: true },
      }),
      tx.sector.groupBy({
        by: ['isActive'],
        where: { organizationId, unitId, id: sectorId },
        _count: { _all: true },
      }),
      canReadEmployees
        ? tx.employee.groupBy({
            by: ['isActive'],
            where: { organizationId, unitId, sectorId },
            _count: { _all: true },
          })
        : null,
      tx.unit.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      tx.sector.findMany({
        where: { organizationId },
        select: { id: true, name: true, unitId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      structure: {
        units: statusCounts(units),
        sectors: statusCounts(sectors),
        employees: employees ? statusCounts(employees) : null,
      },
      options: { units: unitOptions, sectors: sectorOptions },
    };
  }

  private async risks(tx: Prisma.TransactionClient, where: Prisma.RiskWhereInput) {
    const levels = new Map<string, Level>();
    const units = new Map<string, Omit<Unit, 'levels'> & { levels: Map<string, Level> }>();
    let classified = 0;
    let unclassified = 0;
    for await (const risk of riskWorkspaceRecords(tx, {
      ...where,
      status: { in: ['DRAFT', 'REGISTERED'] },
    })) {
      const scope = risk.assessmentGroup.sector.unit;
      let unit = units.get(scope.id);
      if (!unit) {
        unit = { unitId: scope.id, name: scope.name, count: 0, unclassified: 0, levels: new Map() };
        units.set(scope.id, unit);
      }
      unit.count++;
      const level = currentRiskLevel(risk);
      if (level) {
        addLevel(levels, level);
        addLevel(unit.levels, level);
        classified++;
      } else {
        unit.unclassified++;
        unclassified++;
      }
    }
    return {
      total: classified + unclassified,
      classified,
      unclassified,
      levels: orderedLevels(levels),
      units: [...units.values()]
        .map((unit) => ({ ...unit, levels: orderedLevels(unit.levels) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.unitId.localeCompare(b.unitId)),
    };
  }

  private async actions(
    tx: Prisma.TransactionClient,
    where: Prisma.ActionWhereInput & { organizationId: string },
    date: string,
    page: number,
  ) {
    const offset = (page - 1) * priorityPageSize;
    const orderBy = [
      { dueDate: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.ActionOrderByWithRelationInput[];
    const overdueWhere = {
      ...where,
      status: { in: ['PLANNED', 'IN_PROGRESS'] },
      dueDate: { lt: new Date(`${date}T00:00:00Z`) },
    } satisfies Prisma.ActionWhereInput;
    const [grouped, overdue, overduePage] = await Promise.all([
      tx.action.groupBy({ by: ['status'], where, _count: { _all: true } }),
      tx.action.count({ where: overdueWhere }),
      tx.action.findMany({
        where: overdueWhere,
        orderBy,
        skip: offset,
        take: priorityPageSize,
        select: {
          id: true,
          title: true,
          riskId: true,
          dueDate: true,
          risk: { select: priorityScope },
        },
      }),
    ]);
    const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
    const planned = counts.get('PLANNED') ?? 0;
    const inProgress = counts.get('IN_PROGRESS') ?? 0;
    const implemented = counts.get('IMPLEMENTED') ?? 0;
    const cancelled = counts.get('CANCELLED') ?? 0;
    const items = overduePage.map((record) => priority(record, 'OVERDUE'));
    let closed = 0;
    let effective = 0;
    let technicalPending = 0;
    let cursor: string | undefined;
    while (implemented > 0) {
      const records: Implemented[] = await tx.action.findMany({
        where: { ...where, status: 'IMPLEMENTED' },
        include: implementedInclude,
        orderBy,
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const proofs = await tx.actionEvidence.findMany({
        where: {
          organizationId: where.organizationId,
          actionId: { in: records.filter((r) => r.efficacyOpinions.length).map((r) => r.id) },
        },
        select: { id: true, actionId: true, archivedAt: true, sha256: true },
      });
      const evidence = new Map<string, Map<string, (typeof proofs)[number]>>();
      for (const proof of proofs) {
        const actionFiles = evidence.get(proof.actionId) ?? new Map();
        actionFiles.set(proof.id, proof);
        evidence.set(proof.actionId, actionFiles);
      }
      for (const record of records) {
        const opinion = record.efficacyOpinions[0];
        const closure = record.actionTechnicalClosures[0];
        if (opinion?.result === 'EFFECTIVE') {
          const state = currentEfficacy(
            record,
            opinion,
            evidence.get(record.id) ?? new Map(),
            true,
          );
          if (state.validity === 'CURRENT') {
            effective++;
            if (
              closure &&
              !technicalClosureReviewReasons(
                closure,
                closure.id,
                {
                  ...state,
                  originInactive: false,
                  latest: { id: opinion.id, reviewReasons: state.reviewReasons },
                },
                record.risk.technicalEvaluations[0]?.id ?? null,
              ).length
            ) {
              closed++;
              continue;
            }
          }
        }
        if (overdue + technicalPending >= offset && items.length < priorityPageSize) {
          items.push(priority(record, 'TECHNICAL_PENDING'));
        }
        technicalPending++;
      }
      if (records.length < 100) break;
      cursor = records.at(-1)!.id;
    }
    return {
      actions: {
        total: planned + inProgress + implemented + cancelled,
        planned,
        inProgress,
        implemented,
        cancelled,
        open: planned + inProgress,
        overdue,
        technicalPending,
        closed,
        effective,
      },
      priorities: { items, total: overdue + technicalPending, page, pageSize: priorityPageSize },
    };
  }

  snapshot(scope: ActionScope, query: ManagementIndicatorsQuery) {
    return this.database.client.$transaction(
      async (tx) => {
        const { canReadEmployees, ...context } = await this.context(tx, scope, query);
        const organizationId = scope.organizationId;
        const { unitId, sectorId } = context.filters;
        const riskWhere = {
          organizationId,
          assessmentGroup: { sector: { unitId: unitId ?? undefined, id: sectorId ?? undefined } },
        } satisfies Prisma.RiskWhereInput;
        const [structure, risks, actions] = await Promise.all([
          this.structure(tx, organizationId, context.filters, canReadEmployees),
          this.risks(tx, riskWhere),
          this.actions(tx, { organizationId, risk: riskWhere }, context.referenceDate, query.page),
        ]);
        return managementIndicatorsSchema.parse({
          organizationId,
          ...context,
          ...structure,
          risks,
          ...actions,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    );
  }

  history(scope: ActionScope, query: ManagementIndicatorHistoryQuery) {
    return this.database.client.$transaction(
      async (tx) => {
        const {
          timeZone,
          filters,
          generatedAt,
          referenceDate: today,
        } = await this.context(tx, scope, query);
        const { from, to } = query;
        const organizationId = scope.organizationId;
        if (to > today) throw new BadRequestException('O período não pode terminar no futuro.');
        const canonicalZone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions()
          .timeZone;
        const offset = /^([+-])(\d{2}):(\d{2})$/.exec(canonicalZone);
        const seconds = offset
          ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 3600 + Number(offset[3]) * 60)
          : 0;
        const interval = offset
          ? Prisma.sql`make_interval(secs => ${seconds}::double precision)`
          : null;
        // Stored timestamps are UTC; numeric offsets keep ISO signs, independent of SQL zone parsing.
        const local = interval
          ? Prisma.sql`created_at + ${interval}`
          : Prisma.sql`(created_at AT TIME ZONE 'UTC') AT TIME ZONE ${canonicalZone}`;
        const scoped = (snapshot: Prisma.Sql) => Prisma.sql`
        ${filters.unitId ? Prisma.sql`AND ${snapshot}->'unit'->>'id' = ${filters.unitId}` : Prisma.empty}
        ${filters.sectorId ? Prisma.sql`AND ${snapshot}->>'sectorId' = ${filters.sectorId}` : Prisma.empty}
      `;
        const period = (date: Prisma.Sql) => Prisma.sql`
        AND ${date} >= (${from}::date - 1)::timestamp
        AND ${date} < (${to}::date + 2)::timestamp
      `;
        const rows = await tx.$queryRaw<HistoryPoint[]>`
        WITH events AS (
          SELECT e.created_at, 'evaluation' AS kind FROM technical_risk_evaluations e
          WHERE e.organization_id = ${organizationId}::uuid
            ${period(Prisma.sql`e.created_at`)} ${scoped(Prisma.sql`e.context_snapshot`)}
          UNION ALL
          SELECT e.created_at, 'implementation' FROM action_revisions e
          JOIN actions a ON a.id = e.action_id AND a.organization_id = e.organization_id
          WHERE e.organization_id = ${organizationId}::uuid
            AND e.event = 'IMPLEMENTED' AND e.snapshot->>'status' = 'IMPLEMENTED'
            ${period(Prisma.sql`e.created_at`)} ${scoped(Prisma.sql`a.context_snapshot`)}
          UNION ALL
          SELECT e.created_at, 'closure' FROM action_technical_closures e
          JOIN risk_reassessments r ON r.id = e.reassessment_id AND r.organization_id = e.organization_id
          JOIN technical_risk_evaluations v ON v.id = r.evaluation_id AND v.organization_id = r.organization_id
          WHERE e.organization_id = ${organizationId}::uuid
            ${period(Prisma.sql`e.created_at`)} ${scoped(Prisma.sql`v.context_snapshot`)}
        )
        SELECT to_char(${local}, 'YYYY-MM-DD') AS date,
          count(*) FILTER (WHERE kind = 'evaluation')::int AS evaluations,
          count(*) FILTER (WHERE kind = 'implementation')::int AS implementations,
          count(*) FILTER (WHERE kind = 'closure')::int AS closures
        FROM events
        WHERE (${local})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1 ORDER BY 1
      `;
        const byDate = new Map(rows.map((row) => [row.date, row]));
        const points: HistoryPoint[] = [];
        if (rows.length) {
          for (let day = Date.parse(from); day <= Date.parse(to); day += 86_400_000) {
            const date = new Date(day).toISOString().slice(0, 10);
            points.push(
              byDate.get(date) ?? { date, evaluations: 0, implementations: 0, closures: 0 },
            );
          }
        }
        return managementIndicatorHistorySchema.parse({
          organizationId,
          filters,
          generatedAt,
          timeZone,
          from,
          to,
          points,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
