import { Injectable, NotFoundException } from '@nestjs/common';
import {
  assessmentComparisonSchema,
  compareTechnicalEvaluations,
  type AssessmentComparison,
  type AssessmentComparisonQuery,
  type AssessmentComparisonReason,
  type AssessmentComparisonTrend,
} from '@renr/contracts';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { groupDelegation, type OrganizationScope } from '../access/delegated-scope';
import { participationProtected } from './assessment-eligibility';

const cycleSelect = {
  id: true,
  name: true,
  status: true,
  startsAt: true,
  endsAt: true,
  closedAt: true,
  assessmentGroupId: true,
  policyVersionId: true,
  instrumentVersionId: true,
  eligibleCount: true,
  policyVersion: { select: { minimumResponses: true } },
  assessmentGroup: {
    select: {
      name: true,
      sector: { select: { id: true, name: true, unit: { select: { id: true, name: true } } } },
    },
  },
  _count: { select: { invites: true, responses: true } },
} satisfies Prisma.AssessmentCycleSelect;
type Cycle = Prisma.AssessmentCycleGetPayload<{ select: typeof cycleSelect }>;
type ComparisonOperations = Extract<AssessmentComparison, { status: 'COMPARABLE' }>['operations'];
type ComparisonPeriod = ComparisonOperations['reference'];

function point(cycle: Cycle) {
  return {
    id: cycle.id,
    name: cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    closedAt: cycle.closedAt?.toISOString() ?? null,
  };
}

function effectiveEnd(cycle: Cycle): Date {
  return cycle.closedAt && cycle.closedAt < cycle.endsAt ? cycle.closedAt : cycle.endsAt;
}

type Cohort = { positive: number; size: number };
const small = (count: number, minimum: number) => count > 0 && count < minimum;
const protectedTrend = { status: 'PROTECTED' } as const;
const withoutBase = { status: 'UNKNOWN_BASE' } as const;
const roundRate = (value: number) => Math.round(value * 100) / 100;

/** A difference pair must not expose a small change in the total, cell or complement. */
export function compareAssessmentRates(
  reference: Cohort,
  current: Cohort,
  minimum: number,
): AssessmentComparisonTrend {
  if (!reference.size || !current.size) return withoutBase;
  const baseChecks = (value: Cohort) => [value.size, value.positive, value.size - value.positive];
  const a = baseChecks(reference);
  const b = baseChecks(current);
  if (
    a.some((count, index) => {
      const other = b[index]!;
      return (
        count < 0 ||
        other < 0 ||
        small(count, minimum) ||
        small(other, minimum) ||
        small(Math.abs(other - count), minimum)
      );
    })
  )
    return protectedTrend;

  const previousRate = roundRate((reference.positive * 100) / reference.size);
  const currentRate = roundRate((current.positive * 100) / current.size);
  const difference = roundRate(currentRate - previousRate) || 0;
  return {
    status: 'AVAILABLE',
    reference: previousRate,
    current: currentRate,
    difference,
    direction: difference > 0 ? 'INCREASE' : difference < 0 ? 'DECREASE' : 'STABLE',
  };
}

function protectedCycle(cycle: Cycle, minimum: number): boolean {
  const { responses, invites } = cycle._count;
  return (
    small(responses, minimum) ||
    participationProtected(cycle.eligibleCount, responses, minimum, invites)
  );
}

function compareParticipation(reference: Cycle, current: Cycle, minimum: number) {
  if (!reference.eligibleCount || !current.eligibleCount) return withoutBase;
  if (protectedCycle(reference, minimum) || protectedCycle(current, minimum)) return protectedTrend;
  return compareAssessmentRates(
    { positive: reference._count.responses, size: reference.eligibleCount },
    { positive: current._count.responses, size: current.eligibleCount },
    minimum,
  );
}

async function compareFactors(
  tx: Prisma.TransactionClient,
  organizationId: string,
  reference: Cycle,
  current: Cycle,
  minimum: number,
) {
  const questions = await tx.diagnosticQuestion.findMany({
    where: { instrumentVersionId: reference.instrumentVersionId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      label: true,
      options: { orderBy: { position: 'asc' }, select: { id: true, label: true } },
    },
  });
  const items = (trend: AssessmentComparisonTrend) =>
    questions.flatMap((question) =>
      question.options.map((option) => ({
        questionId: question.id,
        questionLabel: question.label,
        optionId: option.id,
        optionLabel: option.label,
        trend,
      })),
    );
  if (protectedCycle(reference, minimum) || protectedCycle(current, minimum))
    return items(protectedTrend);
  if (!reference._count.responses || !current._count.responses) return items(withoutBase);

  // Group in PostgreSQL; individual responses and their provenance stay outside the result.
  const cells = await tx.$queryRaw<
    {
      cycleId: string;
      questionId: string;
      optionId: string | null;
      total: number;
    }[]
  >`
    SELECT r.cycle_id::text AS "cycleId", a.question_id::text AS "questionId",
           o.option_id AS "optionId", count(DISTINCT r.id)::int AS total
    FROM assessment_responses r
    JOIN assessment_answers a ON a.response_id = r.id
    CROSS JOIN LATERAL jsonb_array_elements_text(a.option_ids) AS o(option_id)
    WHERE r.organization_id = ${organizationId}::uuid
      AND r.cycle_id IN (${reference.id}::uuid, ${current.id}::uuid)
    GROUP BY GROUPING SETS ((r.cycle_id, a.question_id), (r.cycle_id, a.question_id, o.option_id))`;
  const totals = new Map(
    cells.map((cell) => [`${cell.cycleId}:${cell.questionId}:${cell.optionId ?? ''}`, cell.total]),
  );
  return questions.flatMap((question) => {
    const count = (cycle: Cycle, optionId = '') =>
      totals.get(`${cycle.id}:${question.id}:${optionId}`) ?? 0;
    const referenceAnswers = count(reference);
    const currentAnswers = count(current);
    // Match ID40 distribution rules before inspecting any individual option trend.
    const suppressQuestion = (cycle: Cycle, answers: number) =>
      small(answers, minimum) ||
      small(cycle._count.responses - answers, minimum) ||
      question.options.some(
        ({ id }) => small(count(cycle, id), minimum) || small(answers - count(cycle, id), minimum),
      );
    const omissionDifference =
      current._count.responses - currentAnswers - (reference._count.responses - referenceAnswers);
    const comparisons = question.options.map((option) =>
      compareAssessmentRates(
        { positive: count(reference, option.id), size: referenceAnswers },
        { positive: count(current, option.id), size: currentAnswers },
        minimum,
      ),
    );
    // Sibling options can reveal a hidden change by subtraction, so withhold the whole question.
    const conceal =
      suppressQuestion(reference, referenceAnswers) ||
      suppressQuestion(current, currentAnswers) ||
      small(Math.abs(omissionDifference), minimum) ||
      comparisons.some(({ status }) => status === 'PROTECTED');
    return question.options.map((option, index) => ({
      questionId: question.id,
      questionLabel: question.label,
      optionId: option.id,
      optionLabel: option.label,
      trend: conceal ? protectedTrend : comparisons[index]!,
    }));
  });
}

async function operationPeriod(
  tx: Prisma.TransactionClient,
  organizationId: string,
  groupId: string,
  cutoff: Date,
): Promise<ComparisonPeriod> {
  const [counts] = await tx.$queryRaw<Omit<ComparisonPeriod, 'riskLevels' | 'unclassifiedRisks'>[]>`
    SELECT count(*) FILTER (WHERE revision.status = 'IMPLEMENTED')::int AS implemented,
           count(*) FILTER (WHERE revision.status IN ('PLANNED', 'IN_PROGRESS'))::int AS pending,
           count(*) FILTER (WHERE revision.status = 'CANCELLED')::int AS cancelled,
           count(*) FILTER (WHERE revision.status IS NULL OR revision.status NOT IN ('IMPLEMENTED', 'PLANNED', 'IN_PROGRESS', 'CANCELLED'))::int AS "withoutSnapshot",
           count(*) FILTER (WHERE opinion.result = 'EFFECTIVE')::int AS effective,
           count(*) FILTER (WHERE opinion.result = 'NOT_EFFECTIVE')::int AS "notEffective",
           count(*) FILTER (WHERE opinion.result = 'INCONCLUSIVE')::int AS inconclusive,
           count(*) FILTER (WHERE opinion.result IS NULL OR opinion.result NOT IN ('EFFECTIVE', 'NOT_EFFECTIVE', 'INCONCLUSIVE'))::int AS "withoutOpinion"
    FROM actions a JOIN risks r ON r.id = a.risk_id AND r.organization_id = a.organization_id
    LEFT JOIN LATERAL (
      SELECT ar.snapshot->>'status' AS status FROM action_revisions ar
      WHERE ar.action_id = a.id AND ar.organization_id = a.organization_id AND ar.created_at <= ${cutoff}
      ORDER BY ar.version DESC LIMIT 1
    ) revision ON true
    LEFT JOIN LATERAL (
      SELECT e.result FROM action_efficacy_opinions e
      WHERE e.action_id = a.id AND e.organization_id = a.organization_id AND e.created_at <= ${cutoff}
      ORDER BY e.sequence DESC LIMIT 1
    ) opinion ON true
    WHERE a.organization_id = ${organizationId}::uuid AND r.assessment_group_id = ${groupId}::uuid
      AND a.created_at <= ${cutoff}`;
  const levels = await tx.$queryRaw<
    {
      methodVersionId: string | null;
      methodName: string | null;
      level: string | null;
      total: number;
    }[]
  >`
    SELECT evaluation.method_id AS "methodVersionId", evaluation.method_name AS "methodName",
           evaluation.level, count(*)::int AS total
    FROM risks r
    LEFT JOIN LATERAL (
      SELECT e.method_version_id::text AS method_id, e.method_snapshot->>'name' AS method_name,
             e.result#>>'{level,label}' AS level
      FROM technical_risk_evaluations e
      WHERE e.organization_id = r.organization_id AND e.risk_id = r.id AND e.created_at <= ${cutoff}
      ORDER BY e.sequence DESC LIMIT 1
    ) evaluation ON true
    WHERE r.organization_id = ${organizationId}::uuid AND r.assessment_group_id = ${groupId}::uuid
      AND r.created_at <= ${cutoff}
    GROUP BY evaluation.method_id, evaluation.method_name, evaluation.level
    ORDER BY evaluation.method_name, evaluation.method_id, evaluation.level`;
  const riskLevels = [];
  let unclassifiedRisks = 0;
  for (const { methodVersionId, methodName, level, total } of levels) {
    if (methodVersionId && methodName && level)
      riskLevels.push({ methodVersionId, methodName, level, total });
    else unclassifiedRisks += total;
  }
  return { ...counts!, riskLevels, unclassifiedRisks };
}

const storedGrade = z.object({
  level: z.object({ label: z.string() }),
  priority: z.object({ rank: z.number().int().min(1).max(20) }),
});
const storedFactor = z.object({ factor: z.string() });

async function readRelatedActions(
  tx: Prisma.TransactionClient,
  organizationId: string,
  groupId: string,
  referenceCycleId: string,
  currentCycleId: string,
) {
  // A technical evaluation records the link. Matching only a group never links an action to a cycle.
  return tx.$queryRaw<ComparisonOperations['relatedActions']>`
    WITH selected_cycles(id) AS (VALUES (${referenceCycleId}::uuid), (${currentCycleId}::uuid)),
    selected_sources(cycle_id, kind, source_id) AS (
      SELECT id, 'ASSESSMENT_CYCLE', id::text FROM selected_cycles
      UNION ALL
      SELECT s.cycle_id, 'ASSESSMENT_SOURCE', s.id::text
      FROM assessment_sources s JOIN selected_cycles c ON c.id = s.cycle_id
      WHERE s.organization_id = ${organizationId}::uuid
    ), linked_risks AS (
      SELECT DISTINCT selected.cycle_id, r.id, r.factor
      FROM risks r
      JOIN technical_risk_evaluations e ON e.risk_id = r.id AND e.organization_id = r.organization_id
      CROSS JOIN LATERAL jsonb_to_recordset(e.sources) source(kind text, id text)
      JOIN selected_sources selected ON selected.kind = source.kind AND selected.source_id = source.id
      WHERE r.organization_id = ${organizationId}::uuid AND r.assessment_group_id = ${groupId}::uuid
        AND r.status = 'REGISTERED'
    )
    SELECT r.cycle_id::text AS "cycleId", r.id::text AS "riskId", r.factor AS "riskLabel",
           a.id::text AS "actionId", a.title AS "actionTitle",
           to_char(a.due_date, 'YYYY-MM-DD') AS "dueDate", a.status::text AS status
    FROM linked_risks r JOIN actions a ON a.risk_id = r.id
    WHERE a.organization_id = ${organizationId}::uuid AND a.status <> 'CANCELLED'
    ORDER BY r.cycle_id = ${currentCycleId}::uuid DESC, a.due_date, a.id, r.cycle_id
    LIMIT 12`;
}

async function compareOperations(
  tx: Prisma.TransactionClient,
  organizationId: string,
  groupId: string,
  reference: Cycle,
  current: Cycle,
) {
  const currentCutoff = effectiveEnd(current);
  const referencePeriod = await operationPeriod(
    tx,
    organizationId,
    groupId,
    effectiveEnd(reference),
  );
  const currentPeriod = await operationPeriod(tx, organizationId, groupId, currentCutoff);
  const where = {
    organizationId,
    risk: { organizationId, assessmentGroupId: groupId },
    createdAt: { gte: current.startsAt, lte: currentCutoff },
  };
  const reassessmentTotal = await tx.riskReassessment.count({ where });
  const entries = await tx.riskReassessment.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 12,
    select: {
      id: true,
      riskId: true,
      createdAt: true,
      previousEvaluation: { select: { methodVersionId: true, result: true } },
      evaluation: { select: { methodVersionId: true, result: true, contextSnapshot: true } },
      measures: { orderBy: { actionId: 'asc' }, select: { actionId: true } },
    },
  });
  const relatedActions = await readRelatedActions(
    tx,
    organizationId,
    groupId,
    reference.id,
    current.id,
  );
  return {
    source: 'GROUP_AT_PERIOD_CLOSE' as const,
    reference: referencePeriod,
    current: currentPeriod,
    reassessmentTotal,
    relatedActions,
    reassessments: entries.map((entry) => {
      const then = storedGrade.safeParse(entry.previousEvaluation.result).data;
      const now = storedGrade.safeParse(entry.evaluation.result).data;
      const compared = compareTechnicalEvaluations(
        { method: { versionId: entry.previousEvaluation.methodVersionId } },
        { method: { versionId: entry.evaluation.methodVersionId } },
      );
      const direction =
        !then || !now || compared !== 'COMPARABLE'
          ? 'NOT_COMPARABLE'
          : now.priority.rank > then.priority.rank
            ? 'IMPROVED'
            : now.priority.rank < then.priority.rank
              ? 'WORSENED'
              : 'STABLE';
      return {
        id: entry.id,
        riskId: entry.riskId,
        riskLabel:
          storedFactor.safeParse(entry.evaluation.contextSnapshot).data?.factor ??
          'Risco reavaliado',
        recordedAt: entry.createdAt.toISOString(),
        referenceLevel: then?.level.label ?? null,
        currentLevel: now?.level.label ?? null,
        direction,
        actionIds: entry.measures.map(({ actionId }) => actionId),
      };
    }),
  };
}

/** Report capture calls this inside its authorized repeatable-read transaction. */
export async function readAssessmentComparison(
  tx: Prisma.TransactionClient,
  organizationId: string,
  query: AssessmentComparisonQuery,
  delegation?: OrganizationScope['delegation'],
): Promise<AssessmentComparison> {
  const cycles = await tx.assessmentCycle.findMany({
    where: {
      organizationId,
      id: { in: [query.referenceCycleId, query.currentCycleId] },
      assessmentGroup: groupDelegation(delegation),
    },
    select: cycleSelect,
  });
  const reference = cycles.find(({ id }) => id === query.referenceCycleId);
  const current = cycles.find(({ id }) => id === query.currentCycleId);
  if (
    !reference ||
    !current ||
    cycles.some(
      ({ assessmentGroup: { sector } }) =>
        (query.unitId && query.unitId !== sector.unit.id) ||
        (query.sectorId && query.sectorId !== sector.id),
    )
  )
    throw new NotFoundException();

  const { assessmentGroup } = reference;
  const { sector } = assessmentGroup;
  const scope =
    reference.assessmentGroupId === current.assessmentGroupId
      ? {
          groupId: reference.assessmentGroupId,
          groupName: assessmentGroup.name,
          sectorId: sector.id,
          sectorName: sector.name,
          unitId: sector.unit.id,
          unitName: sector.unit.name,
        }
      : null;
  const minimum = reference.policyVersion.minimumResponses;
  const reasons: AssessmentComparisonReason[] = [];
  if (current.id === reference.id) reasons.push('SAME_CYCLE');
  if (reference.status !== 'CLOSED' || current.status !== 'CLOSED') reasons.push('OPEN_CYCLE');
  if (!scope) reasons.push('SCOPE_MISMATCH');
  if (reference.instrumentVersionId !== current.instrumentVersionId)
    reasons.push('INSTRUMENT_VERSION');
  if (reference.policyVersionId !== current.policyVersionId || !minimum)
    reasons.push('POLICY_VERSION');
  if (current.startsAt <= reference.startsAt || effectiveEnd(reference) > current.startsAt)
    reasons.push('PERIOD_ORDER');
  const context = { organizationId, reference: point(reference), current: point(current), scope };
  if (reasons.length || !scope || !minimum)
    return assessmentComparisonSchema.parse({
      ...context,
      status: 'INCOMPATIBLE',
      reasons,
      participation: { status: 'NOT_COMPARABLE' },
      factors: [],
      operations: null,
    });

  const participation = compareParticipation(reference, current, minimum);
  const factors = await compareFactors(tx, organizationId, reference, current, minimum);
  const operations = await compareOperations(tx, organizationId, scope.groupId, reference, current);
  return assessmentComparisonSchema.parse({
    ...context,
    status: 'COMPARABLE',
    reasons: [],
    participation,
    factors,
    operations,
  });
}

@Injectable()
export class AssessmentComparisonService {
  constructor(private readonly database: PrismaService) {}

  compare(scope: OrganizationScope, query: AssessmentComparisonQuery) {
    const { organizationId, userId, delegation } = scope;
    return this.database.client.$transaction(
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { userId_organizationId: { organizationId, userId } },
          select: { isActive: true },
        });
        if (!membership?.isActive) throw new NotFoundException();
        return readAssessmentComparison(tx, organizationId, query, delegation);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
