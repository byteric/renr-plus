import { z } from 'zod';
import { actionTimeZoneSchema } from './actions';
import { evaluationMethodKeySchema } from './evaluation-methods';

const count = z.number().int().nonnegative();
const filter = { unitId: z.uuid().optional(), sectorId: z.uuid().optional() };
export const managementIndicatorsQuerySchema = z
  .object({ ...filter, page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const managementIndicatorHistoryQuerySchema = z
  .object({ ...filter, from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) < 90 * 86400000, {
    path: ['to'],
    message: 'O período deve ter até 90 dias inclusivos.',
  });
const context = {
  organizationId: z.uuid(),
  generatedAt: z.iso.datetime(),
  timeZone: actionTimeZoneSchema,
  filters: z.object({ unitId: z.uuid().nullable(), sectorId: z.uuid().nullable() }).strict(),
};
const structureCount = z
  .object({ total: count, active: count, inactive: count })
  .strict()
  .refine((value) => value.total === value.active + value.inactive);
const named = z.object({ id: z.uuid(), name: z.string() }).strict();
const level = z
  .object({
    methodVersionId: z.uuid(),
    methodName: z.string(),
    methodVersion: z.number().int().positive(),
    key: evaluationMethodKeySchema,
    label: z.string(),
    count,
  })
  .strict();
const sumLevels = (levels: { count: number }[]) =>
  levels.reduce((sum, item) => sum + item.count, 0);
const unit = z
  .object({
    unitId: z.uuid(),
    name: z.string(),
    count,
    unclassified: count,
    levels: z.array(level),
  })
  .strict()
  .refine((value) => value.count === value.unclassified + sumLevels(value.levels));
export const managementIndicatorsSchema = z
  .object({
    ...context,
    organization: named.extend({ isActive: z.boolean() }).strict(),
    referenceDate: z.iso.date(),
    structure: z
      .object({
        units: structureCount,
        sectors: structureCount,
        employees: structureCount.nullable(),
      })
      .strict(),
    options: z
      .object({
        units: z.array(named),
        sectors: z.array(named.extend({ unitId: z.uuid() }).strict()),
      })
      .strict(),
    risks: z
      .object({
        total: count,
        classified: count,
        unclassified: count,
        levels: z.array(level),
        units: z.array(unit),
      })
      .strict()
      .refine(
        (value) =>
          value.total === value.classified + value.unclassified &&
          value.classified === sumLevels(value.levels) &&
          value.total === value.units.reduce((sum, item) => sum + item.count, 0) &&
          value.unclassified === value.units.reduce((sum, item) => sum + item.unclassified, 0),
      ),
    actions: z
      .object({
        total: count,
        planned: count,
        inProgress: count,
        implemented: count,
        cancelled: count,
        open: count,
        overdue: count,
        technicalPending: count,
        closed: count,
        effective: count,
      })
      .strict()
      .refine(
        (a) =>
          a.total === a.planned + a.inProgress + a.implemented + a.cancelled &&
          a.open === a.planned + a.inProgress &&
          a.overdue <= a.open &&
          a.technicalPending + a.closed === a.implemented &&
          a.closed <= a.effective &&
          a.effective <= a.implemented,
      ),
    priorities: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: count,
        items: z.array(
          z
            .object({
              actionId: z.uuid(),
              title: z.string(),
              riskId: z.uuid(),
              unitId: z.uuid(),
              sectorId: z.uuid(),
              dueDate: z.iso.date(),
              kind: z.enum(['OVERDUE', 'TECHNICAL_PENDING']),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.organization.id === value.organizationId &&
      value.priorities.total === value.actions.overdue + value.actions.technicalPending &&
      value.priorities.items.length ===
        Math.max(
          0,
          Math.min(
            value.priorities.pageSize,
            value.priorities.total - (value.priorities.page - 1) * value.priorities.pageSize,
          ),
        ),
  );
export const managementIndicatorHistorySchema = z
  .object({
    ...context,
    from: z.iso.date(),
    to: z.iso.date(),
    points: z
      .array(
        z
          .object({
            date: z.iso.date(),
            evaluations: count,
            implementations: count,
            closures: count,
          })
          .strict(),
      )
      .max(90),
  })
  .strict();
export const nr01PendencyStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_VALIDATION',
  'NEEDS_REVIEW',
  'COMPLETED',
]);
export const nr01PendencyOriginSchema = z.enum(['RISK', 'ACTION']);
export const nr01PendencyRuleSchema = z.enum([
  'ACTION_OVERDUE',
  'ACTION_MISSING_EVIDENCE',
  'ACTION_PLANNED',
  'ACTION_AWAITING_EFFICACY',
  'ACTION_AWAITING_CLOSURE',
  'ACTION_EFFICACY_REVIEW_REQUIRED',
  'ACTION_EFFICACY_FOLLOW_UP',
  'ACTION_CLOSURE_REVIEW_REQUIRED',
  'ACTION_ASSIGNEE_INACTIVE',
  'ACTION_ORIGIN_CHANGED',
  'RISK_DRAFT',
  'RISK_WITHOUT_ACTION',
  'RISK_AWAITING_EVALUATION',
  'RISK_EVALUATION_REVIEW_REQUIRED',
  'ORIGIN_INACTIVE',
]);
export const nr01PendenciesQuerySchema = z
  .object({
    ...filter,
    status: nr01PendencyStatusSchema.optional(),
    rule: nr01PendencyRuleSchema.optional(),
    origin: nr01PendencyOriginSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export const nr01PendencyItemSchema = z
  .object({
    id: z.string().regex(/^(risk|action):[0-9a-f-]{36}$/i),
    origin: nr01PendencyOriginSchema,
    originId: z.uuid(),
    riskId: z.uuid(),
    actionId: z.uuid().nullable(),
    title: z.string().min(1),
    contextLabel: z.string().min(1),
    unit: named,
    sector: named,
    status: nr01PendencyStatusSchema,
    primaryRule: nr01PendencyRuleSchema.nullable(),
    rules: z.array(nr01PendencyRuleSchema),
    reasonSummary: z.string().min(1),
    missingInfo: z.array(z.string().min(1)),
    dueDate: z.iso.date().nullable(),
    isOverdue: z.boolean(),
    responsible: z
      .object({
        name: z.string().min(1),
        kind: z.enum(['USER', 'EXTERNAL']),
        isActive: z.boolean(),
      })
      .strict()
      .nullable(),
    evidence: z
      .object({
        activeCount: count,
        archivedCount: count,
      })
      .strict()
      .nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (item) =>
      new Set(item.rules).size === item.rules.length &&
      (item.primaryRule === null || item.rules.includes(item.primaryRule)) &&
      (item.origin === 'ACTION'
        ? item.actionId === item.originId && item.evidence !== null
        : item.actionId === null && item.riskId === item.originId && item.evidence === null),
  );
export const nr01PendenciesSchema = z
  .object({
    organizationId: z.uuid(),
    organization: named.extend({ isActive: z.boolean() }).strict(),
    generatedAt: z.iso.datetime(),
    referenceDate: z.iso.date(),
    timeZone: actionTimeZoneSchema,
    ruleSet: z
      .object({
        version: z.literal('nr01-operational-v1'),
        validationStatus: z.literal('OPERATIONAL_FIRST_CUT'),
        scopeNote: z.string().min(1),
      })
      .strict(),
    filters: z
      .object({
        unitId: z.uuid().nullable(),
        sectorId: z.uuid().nullable(),
        status: nr01PendencyStatusSchema.nullable(),
        rule: nr01PendencyRuleSchema.nullable(),
        origin: nr01PendencyOriginSchema.nullable(),
      })
      .strict(),
    summary: z
      .object({
        total: count,
        openPendencies: count,
        byStatus: z
          .object({
            PENDING: count,
            IN_PROGRESS: count,
            AWAITING_VALIDATION: count,
            NEEDS_REVIEW: count,
            COMPLETED: count,
          })
          .strict(),
        byOrigin: z
          .object({
            RISK: count,
            ACTION: count,
          })
          .strict(),
        signals: z
          .object({
            overdueActions: count,
            missingEvidence: count,
            risksWithoutAction: count,
            awaitingEvaluationOrValidation: count,
            needsReview: count,
          })
          .strict(),
      })
      .strict()
      .refine(
        (summary) =>
          summary.total ===
            summary.byStatus.PENDING +
              summary.byStatus.IN_PROGRESS +
              summary.byStatus.AWAITING_VALIDATION +
              summary.byStatus.NEEDS_REVIEW +
              summary.byStatus.COMPLETED &&
          summary.total === summary.byOrigin.RISK + summary.byOrigin.ACTION &&
          summary.openPendencies === summary.total - summary.byStatus.COMPLETED &&
          summary.signals.overdueActions <= summary.byOrigin.ACTION &&
          summary.signals.missingEvidence <= summary.byOrigin.ACTION &&
          summary.signals.risksWithoutAction <= summary.byOrigin.RISK &&
          summary.signals.awaitingEvaluationOrValidation === summary.byStatus.AWAITING_VALIDATION &&
          summary.signals.needsReview === summary.byStatus.NEEDS_REVIEW,
      ),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: count,
    items: z.array(nr01PendencyItemSchema),
  })
  .strict()
  .refine(
    (value) =>
      value.organization.id === value.organizationId &&
      new Set(value.items.map((item) => item.id)).size === value.items.length &&
      (value.filters.status !== null || value.filters.rule !== null || value.filters.origin !== null
        ? value.total <= value.summary.total
        : value.total === value.summary.total) &&
      value.items.length ===
        Math.max(0, Math.min(value.pageSize, value.total - (value.page - 1) * value.pageSize)),
  );
export type ManagementIndicators = z.infer<typeof managementIndicatorsSchema>;
export type ManagementIndicatorsQuery = z.infer<typeof managementIndicatorsQuerySchema>;
export type ManagementIndicatorHistory = z.infer<typeof managementIndicatorHistorySchema>;
export type ManagementIndicatorHistoryQuery = z.infer<typeof managementIndicatorHistoryQuerySchema>;
export type Nr01PendencyStatus = z.infer<typeof nr01PendencyStatusSchema>;
export type Nr01PendencyOrigin = z.infer<typeof nr01PendencyOriginSchema>;
export type Nr01PendencyRule = z.infer<typeof nr01PendencyRuleSchema>;
export type Nr01PendenciesQuery = z.infer<typeof nr01PendenciesQuerySchema>;
export type Nr01PendencyItem = z.infer<typeof nr01PendencyItemSchema>;
export type Nr01Pendencies = z.infer<typeof nr01PendenciesSchema>;
