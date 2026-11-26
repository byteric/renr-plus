import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  managementIndicatorHistoryQuerySchema,
  managementIndicatorsSchema,
  nr01PendenciesQuerySchema,
  nr01PendenciesSchema,
} from './management-indicators';

const id = '10000000-0000-4000-8000-000000000001';
const context = {
  organizationId: id,
  organization: { id, name: 'Empresa sintética', isActive: true },
  generatedAt: '2026-10-17T12:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
  referenceDate: '2026-10-17',
  filters: { unitId: null, sectorId: null },
  structure: {
    units: { total: 1, active: 1, inactive: 0 },
    sectors: { total: 1, active: 1, inactive: 0 },
    employees: null,
  },
  options: { units: [{ id, name: 'Unidade' }], sectors: [] },
};

it('reconciles arbitrary nonnegative totals and rejects out-of-scope subtotals', () => {
  fc.assert(
    fc.property(
      fc.record({
        planned: fc.nat(500),
        inProgress: fc.nat(500),
        closed: fc.nat(500),
        technicalPending: fc.nat(500),
        cancelled: fc.nat(500),
        classified: fc.nat(500),
        unclassified: fc.nat(500),
        selector: fc.nat(1000),
      }),
      ({
        planned,
        inProgress,
        closed,
        technicalPending,
        cancelled,
        classified,
        unclassified,
        selector,
      }) => {
        const open = planned + inProgress;
        const overdue = selector % (open + 1);
        const implemented = closed + technicalPending;
        const effective = closed + (selector % (technicalPending + 1));
        const levels = classified
          ? [
              {
                methodVersionId: id,
                methodName: 'Matriz',
                methodVersion: 1,
                key: 'high',
                label: 'Alto',
                count: classified,
              },
            ]
          : [];
        const actions = {
          planned,
          inProgress,
          implemented,
          cancelled,
          open,
          overdue,
          technicalPending,
          closed,
          effective,
          total: open + implemented + cancelled,
        };
        const risks = {
          total: classified + unclassified,
          classified,
          unclassified,
          levels,
          units: [
            { unitId: id, name: 'Unidade', count: classified + unclassified, unclassified, levels },
          ],
        };
        const result = {
          ...context,
          actions,
          risks,
          priorities: { total: overdue + technicalPending, items: [], pageSize: 5, page: 10000 },
        };
        expect(managementIndicatorsSchema.safeParse(result).success).toBe(true);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            actions: { ...actions, overdue: open + 1 },
            priorities: { ...result.priorities, total: open + 1 + technicalPending },
          }).success,
        ).toBe(false);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            actions: { ...actions, effective: implemented + 1 },
          }).success,
        ).toBe(false);
        expect(
          managementIndicatorsSchema.safeParse({
            ...result,
            risks: { ...risks, unclassified: unclassified + 1 },
          }).success,
        ).toBe(false);
      },
    ),
  );
});

it('accepts exactly 1–90 inclusive days and validates both boundaries', () => {
  fc.assert(
    fc.property(fc.integer({ min: -15, max: 120 }), (days) => {
      const from = '2026-01-15';
      const to = new Date(Date.parse(from) + days * 86_400_000).toISOString().slice(0, 10);
      expect(managementIndicatorHistoryQuerySchema.safeParse({ from, to }).success).toBe(
        days >= 0 && days < 90,
      );
    }),
  );
});

it('reconciles NR-01 pendencies summary counts, unique item ids and page size invariants', () => {
  const unitId = '20000000-0000-4000-8000-000000000001';
  const sectorId = '30000000-0000-4000-8000-000000000001';
  const riskId = '40000000-0000-4000-8000-000000000001';
  const actionId = '50000000-0000-4000-8000-000000000001';

  expect(nr01PendenciesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
  expect(nr01PendenciesQuerySchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
  expect(nr01PendenciesQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);

  const valid = {
    organizationId: id,
    organization: { id, name: 'Empresa sintética', isActive: true },
    generatedAt: '2026-10-17T12:00:00.000Z',
    referenceDate: '2026-10-17',
    timeZone: 'America/Sao_Paulo',
    ruleSet: {
      version: 'nr01-operational-v1' as const,
      validationStatus: 'OPERATIONAL_FIRST_CUT' as const,
      scopeNote:
        'Primeiro corte operacional baseado nos registros existentes. Regras normativas dependem de validação de SST.',
    },
    filters: {
      unitId: null,
      sectorId: null,
      status: null,
      rule: null,
      origin: null,
    },
    summary: {
      total: 2,
      openPendencies: 2,
      byStatus: {
        PENDING: 1,
        IN_PROGRESS: 0,
        AWAITING_VALIDATION: 1,
        NEEDS_REVIEW: 0,
        COMPLETED: 0,
      },
      byOrigin: { RISK: 1, ACTION: 1 },
      signals: {
        overdueActions: 1,
        missingEvidence: 1,
        risksWithoutAction: 0,
        awaitingEvaluationOrValidation: 1,
        needsReview: 0,
      },
    },
    page: 1,
    pageSize: 10,
    total: 2,
    items: [
      {
        id: `action:${actionId}`,
        origin: 'ACTION' as const,
        originId: actionId,
        riskId,
        actionId,
        title: 'Revisar pausas operacionais',
        contextLabel: 'Fator: Sobrecarga de jornada',
        unit: { id: unitId, name: 'Unidade Centro' },
        sector: { id: sectorId, name: 'Atendimento' },
        status: 'PENDING' as const,
        primaryRule: 'ACTION_OVERDUE' as const,
        rules: ['ACTION_OVERDUE' as const, 'ACTION_MISSING_EVIDENCE' as const],
        reasonSummary: 'Ação em aberto com prazo vencido em 10/10/2026 e sem evidência ativa.',
        missingInfo: ['Sem evidência ativa anexada para comprovar andamento da ação vencida.'],
        dueDate: '2026-10-10',
        isOverdue: true,
        responsible: { name: 'Coordenação local', kind: 'EXTERNAL' as const, isActive: true },
        evidence: { activeCount: 0, archivedCount: 0 },
        updatedAt: '2026-10-16T10:00:00.000Z',
      },
      {
        id: `risk:${riskId}`,
        origin: 'RISK' as const,
        originId: riskId,
        riskId,
        actionId: null,
        title: 'Sobrecarga de jornada',
        contextLabel: 'Risco registrado no inventário',
        unit: { id: unitId, name: 'Unidade Centro' },
        sector: { id: sectorId, name: 'Atendimento' },
        status: 'AWAITING_VALIDATION' as const,
        primaryRule: 'RISK_AWAITING_EVALUATION' as const,
        rules: ['RISK_AWAITING_EVALUATION' as const],
        reasonSummary: 'Risco registrado aguardando avaliação técnica vigente.',
        missingInfo: ['Sem avaliação técnica vigente para classificar nível e prioridade.'],
        dueDate: null,
        isOverdue: false,
        responsible: null,
        evidence: null,
        updatedAt: '2026-10-16T09:00:00.000Z',
      },
    ],
  };

  expect(nr01PendenciesSchema.safeParse(valid).success).toBe(true);
  expect(
    nr01PendenciesSchema.safeParse({
      ...valid,
      items: [valid.items[0], valid.items[0]],
    }).success,
  ).toBe(false);
  expect(
    nr01PendenciesSchema.safeParse({
      ...valid,
      summary: { ...valid.summary, openPendencies: 1 },
    }).success,
  ).toBe(false);
  expect(
    nr01PendenciesSchema.safeParse({
      ...valid,
      total: 3,
    }).success,
  ).toBe(false);

  fc.assert(
    fc.property(
      fc.record({
        pending: fc.nat(50),
        inProgress: fc.nat(50),
        awaiting: fc.nat(50),
        needsReview: fc.nat(50),
        completed: fc.nat(50),
        riskSplit: fc.nat(250),
      }),
      ({ pending, inProgress, awaiting, needsReview, completed, riskSplit }) => {
        const total = pending + inProgress + awaiting + needsReview + completed;
        const risks = total === 0 ? 0 : riskSplit % (total + 1);
        const actions = total - risks;
        const payload = {
          ...valid,
          summary: {
            total,
            openPendencies: total - completed,
            byStatus: {
              PENDING: pending,
              IN_PROGRESS: inProgress,
              AWAITING_VALIDATION: awaiting,
              NEEDS_REVIEW: needsReview,
              COMPLETED: completed,
            },
            byOrigin: { RISK: risks, ACTION: actions },
            signals: {
              overdueActions: Math.min(actions, pending),
              missingEvidence: Math.min(actions, pending),
              risksWithoutAction: risks,
              awaitingEvaluationOrValidation: awaiting,
              needsReview,
            },
          },
          page: 10000,
          total,
          items: [],
        };
        expect(nr01PendenciesSchema.safeParse(payload).success).toBe(true);
        expect(
          nr01PendenciesSchema.safeParse({
            ...payload,
            summary: {
              ...payload.summary,
              signals: { ...payload.summary.signals, overdueActions: actions + 1 },
            },
          }).success,
        ).toBe(false);
      },
    ),
  );
});
