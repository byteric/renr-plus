import type { CompanyGroupMetrics, CompanyGroupOperationalMetrics } from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';
import { compareAssessmentRates } from '../assessments/assessment-comparison.service';
import { participationProtected } from '../assessments/assessment-eligibility';

const unavailable = { status: 'UNAVAILABLE' } as const;
const protectedResult = { status: 'PROTECTED' } as const;

type Cycle = {
  organizationId: string;
  assessmentGroupId: string;
  instrumentVersionId: string;
  policyVersionId: string;
  startsAt: Date;
  effectiveEnd: Date;
  eligible: number | null;
  responses: number;
  issued: number;
  minimum: number | null;
  position: 1 | 2;
};
type Pair = { current: Cycle; previous: Cycle | undefined };
type Rate = { positive: number; size: number };
type Measurable = Cycle & { eligible: number; minimum: number };
type Collections = CompanyGroupOperationalMetrics['collections'];
type Evaluations = CompanyGroupOperationalMetrics['evaluations'];

export const companyGroupTimeZone = 'America/Sao_Paulo';

const activityActions = [
  'EMPLOYEE_CREATE',
  'EMPLOYEE_UPDATE',
  'EMPLOYEE_IMPORT',
  'EMPLOYEE_BULK_UPDATE',
  'assessment.cycle.created',
  'assessment.cycle.open',
  'assessment.cycle.closed',
  'RISK_CREATE',
  'RISK_UPDATE',
  'RISK_ARCHIVE',
  'RISK_PRELIMINARY_EVALUATION_CREATE',
  'risk.technical_evaluation_created',
  'risk.reassessment_created',
  'ACTION_CREATED',
  'ACTION_UPDATED',
  'ACTION_STARTED',
  'ACTION_IMPLEMENTED',
  'ACTION_CANCELLED',
  'ACTION_NOTE',
  'ACTION_EVIDENCE_ADDED',
  'ACTION_EVIDENCE_ARCHIVED',
  'ACTION_EFFICACY_RECORDED',
  'action.technical_closure_created',
  'action.corrective_created',
  'REPORT_SNAPSHOT_CREATED',
];

function measurable(cycle: Cycle): cycle is Measurable {
  return cycle.eligible !== null && cycle.eligible > 0 && cycle.minimum !== null;
}

function isProtected(cycle: Measurable): boolean {
  return participationProtected(cycle.eligible, cycle.responses, cycle.minimum, cycle.issued);
}

function weightedRate(cycles: Measurable[]): Rate {
  return cycles.reduce(
    (total, cycle) => ({
      positive: total.positive + cycle.responses,
      size: total.size + cycle.eligible,
    }),
    { positive: 0, size: 0 },
  );
}

function participation(cycles: Cycle[]): CompanyGroupMetrics['participation'] {
  const known = cycles.filter(measurable);
  // Omitting a protected child would reveal it by subtraction from a wider total.
  if (known.some(isProtected)) return protectedResult;
  if (known.length === 0 || known.length !== cycles.length) return unavailable;
  const { positive, size } = weightedRate(known);
  return {
    status: 'AVAILABLE',
    eligible: size,
    responses: positive,
    ratePercent: Math.round((positive * 10_000) / size) / 100,
  };
}

function comparable(pair: Pair): pair is { current: Measurable; previous: Measurable } {
  const { previous, current } = pair;
  return Boolean(
    previous &&
    previous.instrumentVersionId === current.instrumentVersionId &&
    previous.policyVersionId === current.policyVersionId &&
    previous.startsAt < previous.effectiveEnd &&
    current.startsAt < current.effectiveEnd &&
    previous.effectiveEnd <= current.startsAt &&
    measurable(previous) &&
    measurable(current),
  );
}

function evolution(pairs: Pair[]): CompanyGroupMetrics['evolution'] {
  const known = pairs.filter(comparable);
  let minimum = 0;
  for (const { previous, current } of known) {
    const pairMinimum = Math.max(previous.minimum, current.minimum);
    minimum = Math.max(minimum, pairMinimum);
    if (
      isProtected(previous) ||
      isProtected(current) ||
      compareAssessmentRates(weightedRate([previous]), weightedRate([current]), pairMinimum)
        .status === 'PROTECTED'
    )
      return protectedResult;
  }
  if (known.length === 0 || known.length !== pairs.length) return unavailable;
  const result = compareAssessmentRates(
    weightedRate(known.map((pair) => pair.previous)),
    weightedRate(known.map((pair) => pair.current)),
    minimum,
  );
  if (result.status === 'AVAILABLE') {
    return {
      status: 'AVAILABLE',
      referencePercent: result.reference,
      currentPercent: result.current,
      deltaPoints: result.difference,
    };
  }
  return result.status === 'PROTECTED' ? protectedResult : unavailable;
}

function pairCycles(cycles: Cycle[]): Pair[] {
  const previous = new Map(
    cycles
      .filter(({ position }) => position === 2)
      .map((cycle) => [cycle.assessmentGroupId, cycle]),
  );
  return cycles
    .filter(({ position }) => position === 1)
    .map((current) => ({ current, previous: previous.get(current.assessmentGroupId) }));
}

type CompanyCounts = Pick<CompanyGroupMetrics, 'employees' | 'openRisks' | 'actions'>;

function counts(): CompanyCounts {
  return {
    employees: 0,
    openRisks: 0,
    actions: { pending: 0, inProgress: 0, done: 0, cancelled: 0 },
  };
}

export function companyGroupParticipation(
  cycles: Cycle[],
): Pick<CompanyGroupMetrics, 'participation' | 'evolution'> {
  const pairs = pairCycles(cycles);
  return {
    participation: participation(pairs.map((pair) => pair.current)),
    evolution: evolution(pairs),
  };
}

function summarize(totals: CompanyCounts, cycles: Cycle[]): CompanyGroupMetrics {
  return { ...totals, ...companyGroupParticipation(cycles) };
}

const actionName = {
  PLANNED: 'pending',
  IN_PROGRESS: 'inProgress',
  IMPLEMENTED: 'done',
  CANCELLED: 'cancelled',
} as const;

/** Read only the two most recent closed cycles per sector (each sector has one assessment group). */
async function recentCycles(tx: Prisma.TransactionClient, organizationIds: string[]) {
  return tx.$queryRaw<Cycle[]>`
    WITH ranked AS (
      SELECT id, organization_id, assessment_group_id, instrument_version_id, policy_version_id,
        starts_at, LEAST(ends_at, closed_at) AS effective_end, eligible_count,
        ROW_NUMBER() OVER (PARTITION BY organization_id, assessment_group_id
          ORDER BY starts_at DESC, id) AS position
      FROM assessment_cycles
      WHERE organization_id IN (${organizationUuids(organizationIds)})
        AND status = 'CLOSED' AND closed_at IS NOT NULL
    )
    SELECT c.organization_id AS "organizationId", c.assessment_group_id AS "assessmentGroupId",
      c.instrument_version_id AS "instrumentVersionId", c.policy_version_id AS "policyVersionId",
      c.starts_at AS "startsAt", c.effective_end AS "effectiveEnd", c.eligible_count AS eligible,
      p.minimum_responses AS minimum, c.position::integer AS position,
      (SELECT count(*)::integer FROM assessment_invites i
        WHERE i.organization_id = c.organization_id AND i.cycle_id = c.id) AS issued,
      (SELECT count(*)::integer FROM assessment_responses r
        WHERE r.organization_id = c.organization_id AND r.cycle_id = c.id) AS responses
    FROM ranked c JOIN consolidation_policy_versions p
      ON p.organization_id = c.organization_id AND p.id = c.policy_version_id
    WHERE c.position <= 2`;
}

function organizationUuids(organizationIds: string[]) {
  return Prisma.join(organizationIds.map((id) => Prisma.sql`${id}::uuid`));
}

async function collectionsByCompany(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
  now: Date,
) {
  const rows = await tx.$queryRaw<
    { organizationId: string; inProgress: number; completed: number; total: number }[]
  >`
    SELECT organization_id AS "organizationId", count(*)::integer AS total,
      count(*) FILTER (WHERE status = 'OPEN' AND starts_at <= ${now} AND ends_at > ${now})::integer AS "inProgress",
      count(*) FILTER (WHERE status = 'CLOSED')::integer AS completed
    FROM assessment_cycles
    WHERE organization_id IN (${organizationUuids(organizationIds)})
    GROUP BY organization_id`;
  return new Map(
    rows.map(({ organizationId, inProgress, completed, total }) => [
      organizationId,
      { inProgress, completed, pending: total - inProgress - completed },
    ]),
  );
}

async function evaluationsByCompany(tx: Prisma.TransactionClient, organizationIds: string[]) {
  const rows = await tx.$queryRaw<{ organizationId: string; completed: number; records: number }[]>`
    WITH registered AS (
      SELECT organization_id, id FROM risks
      WHERE organization_id IN (${organizationUuids(organizationIds)}) AND status = 'REGISTERED'
    ), evaluations AS (
      SELECT e.organization_id, e.risk_id FROM risk_evaluations e
      JOIN registered r ON r.organization_id = e.organization_id AND r.id = e.risk_id
      UNION ALL
      SELECT e.organization_id, e.risk_id FROM technical_risk_evaluations e
      JOIN registered r ON r.organization_id = e.organization_id AND r.id = e.risk_id
    )
    SELECT organization_id AS "organizationId", count(DISTINCT risk_id)::integer AS completed,
      count(*)::integer AS records
    FROM evaluations GROUP BY organization_id`;
  return new Map(rows.map(({ organizationId, ...aggregate }) => [organizationId, aggregate]));
}

export async function companyGroupOperationalMetrics(
  tx: Prisma.TransactionClient,
  companies: ReadonlyMap<string, CompanyGroupMetrics>,
  now: Date,
) {
  const date = referenceDate(companyGroupTimeZone, now);
  const emptyCollections: Collections = { inProgress: 0, completed: 0, pending: 0 };
  const emptyEvaluations: Evaluations = { completed: 0, pending: 0, records: 0 };
  const totals: CompanyGroupOperationalMetrics = {
    collections: { ...emptyCollections },
    evaluations: { ...emptyEvaluations },
    overdueActions: 0,
    lastActivity: unavailable,
  };
  const byCompany = new Map<string, CompanyGroupOperationalMetrics>();
  const organizationIds = [...companies.keys()];
  if (organizationIds.length === 0) return { date, totals, byCompany };

  const where = { organizationId: { in: organizationIds } };
  const [collections, evaluations, actionsOverdue, events] = await Promise.all([
    collectionsByCompany(tx, organizationIds, now),
    evaluationsByCompany(tx, organizationIds),
    tx.action.groupBy({
      by: ['organizationId'],
      where: {
        ...where,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        dueDate: { lt: new Date(`${date}T00:00:00.000Z`) },
      },
      _count: { _all: true },
    }),
    tx.auditEvent.groupBy({
      by: ['organizationId'],
      where: { ...where, action: { in: activityActions }, createdAt: { lte: now } },
      _max: { createdAt: true },
    }),
  ]);
  const overdue = new Map(actionsOverdue.map((row) => [row.organizationId, row._count._all]));
  const activity = new Map(events.map((row) => [row.organizationId, row._max.createdAt]));

  for (const [id, metrics] of companies) {
    const cycles = collections.get(id) ?? emptyCollections;
    const evaluated = evaluations.get(id) ?? emptyEvaluations;
    const pendingEvaluation = metrics.openRisks - evaluated.completed;
    const overdueActions = overdue.get(id) ?? 0;
    const lastActivity = activity.get(id);
    const recent = lastActivity
      ? { status: 'AVAILABLE' as const, date: referenceDate(companyGroupTimeZone, lastActivity) }
      : unavailable;
    byCompany.set(id, {
      collections: cycles,
      evaluations: { ...evaluated, pending: pendingEvaluation },
      overdueActions,
      lastActivity: recent,
    });
    totals.collections.inProgress += cycles.inProgress;
    totals.collections.completed += cycles.completed;
    totals.collections.pending += cycles.pending;
    totals.evaluations.completed += evaluated.completed;
    totals.evaluations.pending += pendingEvaluation;
    totals.evaluations.records += evaluated.records;
    totals.overdueActions += overdueActions;
    if (
      recent.status === 'AVAILABLE' &&
      (totals.lastActivity.status === 'UNAVAILABLE' || recent.date > totals.lastActivity.date)
    )
      totals.lastActivity = recent;
  }
  return { date, totals, byCompany };
}

export async function companyGroupMetrics(tx: Prisma.TransactionClient, organizationIds: string[]) {
  const totals = counts();
  const companies = new Map<string, CompanyGroupMetrics>();
  if (organizationIds.length === 0) return { totals: summarize(totals, []), companies };

  const where = { organizationId: { in: organizationIds } };
  const [employees, risks, actions, cycles] = await Promise.all([
    tx.employee.groupBy({
      by: ['organizationId'],
      where: { ...where, isActive: true },
      _count: { _all: true },
    }),
    tx.risk.groupBy({
      by: ['organizationId'],
      where: { ...where, status: 'REGISTERED' },
      _count: { _all: true },
    }),
    tx.action.groupBy({ by: ['organizationId', 'status'], where, _count: { _all: true } }),
    recentCycles(tx, organizationIds),
  ]);
  const cyclesByCompany = new Map<string, Cycle[]>();
  for (const cycle of cycles) {
    const company = cyclesByCompany.get(cycle.organizationId);
    if (company) company.push(cycle);
    else cyclesByCompany.set(cycle.organizationId, [cycle]);
  }
  const countsByCompany = new Map(organizationIds.map((id) => [id, counts()]));
  for (const row of employees) {
    countsByCompany.get(row.organizationId)!.employees = row._count._all;
    totals.employees += row._count._all;
  }
  for (const row of risks) {
    countsByCompany.get(row.organizationId)!.openRisks = row._count._all;
    totals.openRisks += row._count._all;
  }
  for (const row of actions) {
    const status = actionName[row.status];
    countsByCompany.get(row.organizationId)!.actions[status] = row._count._all;
    totals.actions[status] += row._count._all;
  }
  for (const [id, company] of countsByCompany) {
    companies.set(id, summarize(company, cyclesByCompany.get(id) ?? []));
  }
  return { totals: summarize(totals, cycles), companies };
}
