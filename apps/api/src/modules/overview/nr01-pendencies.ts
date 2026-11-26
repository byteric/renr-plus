import {
  efficacyProofPackageSchema,
  riskContextSnapshotSchema,
  type Nr01Pendencies,
  type Nr01PendenciesQuery,
  type Nr01PendencyItem,
  type Nr01PendencyRule,
  type Nr01PendencyStatus,
} from '@renr/contracts';
import type { Prisma } from '../../generated/prisma/client';
import { actionInclude } from '../actions/actions.repository';
import { currentEfficacy } from '../action-efficacy/action-efficacy.service';
import { technicalClosureReviewReasons } from '../risk-continuity/risk-continuity.service';
import { toRisk } from '../risks/risks.repository';
import {
  evaluationState,
  technicalContextFingerprint,
  type WorkspaceRecord,
} from '../technical-evaluations/risk-workspaces.service';

export const NR01_RULE_SET = {
  version: 'nr01-operational-v1',
  validationStatus: 'OPERATIONAL_FIRST_CUT',
  scopeNote:
    'Primeiro corte operacional baseado nas datas, vínculos, evidências e estados já registrados. Regras normativas, prazos legais e classificação de conformidade NR-01 dependem de validação técnica por SST.',
} as const;

export const nr01ActionInclude = {
  ...actionInclude,
  assignedMembership: {
    select: {
      isActive: true,
      user: { select: { name: true } },
    },
  },
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

export type Nr01ActionRecord = Prisma.ActionGetPayload<{ include: typeof nr01ActionInclude }>;
export type Nr01EvidenceRecord = {
  id: string;
  actionId: string;
  archivedAt: Date | null;
  sha256: string;
};

const statusOrder: Record<Nr01PendencyStatus, number> = {
  NEEDS_REVIEW: 1,
  PENDING: 2,
  AWAITING_VALIDATION: 3,
  IN_PROGRESS: 4,
  COMPLETED: 5,
};

function formatBrDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function uniqueRules(rules: Nr01PendencyRule[]): Nr01PendencyRule[] {
  return [...new Set(rules)];
}

function originIsActive(record: {
  organization: { isActive: boolean };
  risk: {
    status: string;
    assessmentGroup: {
      isActive: boolean;
      sector: { isActive: boolean; unit: { isActive: boolean } };
    };
  };
}): boolean {
  const group = record.risk.assessmentGroup;
  return (
    record.organization.isActive &&
    record.risk.status === 'REGISTERED' &&
    group.isActive &&
    group.sector.isActive &&
    group.sector.unit.isActive
  );
}

function riskScopeIsActive(record: WorkspaceRecord): boolean {
  const sector = record.assessmentGroup.sector;
  return (
    record.assessmentGroup.isActive &&
    sector.isActive &&
    sector.unit.isActive &&
    sector.organization.isActive
  );
}

export function classifyActionPendency(
  record: Nr01ActionRecord,
  files: ReadonlyMap<string, Nr01EvidenceRecord>,
  today: string,
): Nr01PendencyItem {
  const sector = record.risk.assessmentGroup.sector;
  const unit = sector.unit;
  const dueDate = record.dueDate.toISOString().slice(0, 10);
  const open = record.status === 'PLANNED' || record.status === 'IN_PROGRESS';
  const isOverdue = open && dueDate < today;
  const activeOrigin = originIsActive(record);
  const currentRisk = toRisk(record.risk);
  const captured = riskContextSnapshotSchema.parse(record.contextSnapshot);
  const contextMatches =
    technicalContextFingerprint(currentRisk) ===
    technicalContextFingerprint({ ...currentRisk, ...captured });

  let activeEvidenceCount = 0;
  let archivedEvidenceCount = 0;
  for (const file of files.values()) {
    if (file.archivedAt) archivedEvidenceCount++;
    else activeEvidenceCount++;
  }

  const assignedMember = record.assignedMembership;
  const responsible: Nr01PendencyItem['responsible'] =
    record.assignedUserId && assignedMember
      ? {
          name: assignedMember.user.name || record.assignedName || record.responsibleName,
          kind: 'USER',
          isActive: assignedMember.isActive && record.organization.isActive,
        }
      : {
          name: record.responsibleName,
          kind: 'EXTERNAL',
          isActive: true,
        };
  const assigneeInactive = responsible.kind === 'USER' && !responsible.isActive;

  const rules: Nr01PendencyRule[] = [];
  const missingInfo: string[] = [];
  let status: Nr01PendencyStatus;
  let primaryRule: Nr01PendencyRule | null;
  let reasonSummary: string;

  if (record.status === 'IMPLEMENTED') {
    const opinion = record.efficacyOpinions[0];
    const closure = record.actionTechnicalClosures[0];
    const efficacy = opinion ? currentEfficacy(record, opinion, files, true) : null;

    if (opinion?.result === 'EFFECTIVE' && efficacy?.validity === 'CURRENT') {
      const closureReasons = closure
        ? technicalClosureReviewReasons(
            closure,
            closure.id,
            {
              ...efficacy,
              originInactive: !activeOrigin,
              latest: { id: opinion.id, reviewReasons: efficacy.reviewReasons },
            },
            record.risk.technicalEvaluations[0]?.id ?? null,
          )
        : [];

      if (closure && closureReasons.length === 0) {
        status = 'COMPLETED';
        primaryRule = null;
        reasonSummary = 'Execução, parecer de eficácia e encerramento técnico vigentes.';
      } else if (closure && closureReasons.length > 0) {
        status = 'NEEDS_REVIEW';
        rules.push('ACTION_CLOSURE_REVIEW_REQUIRED');
        if (!activeOrigin || !contextMatches) rules.push('ACTION_ORIGIN_CHANGED');
        if (!activeOrigin) rules.push('ORIGIN_INACTIVE');
        primaryRule = 'ACTION_CLOSURE_REVIEW_REQUIRED';
        reasonSummary =
          'Encerramento técnico requer revisão após alteração de contexto, parecer ou reavaliação.';
      } else if (!activeOrigin || !contextMatches) {
        status = 'NEEDS_REVIEW';
        rules.push('ACTION_ORIGIN_CHANGED');
        if (!activeOrigin) rules.push('ORIGIN_INACTIVE');
        rules.push('ACTION_AWAITING_CLOSURE');
        primaryRule = 'ACTION_ORIGIN_CHANGED';
        reasonSummary =
          'Origem ou contexto do risco mudou antes do encerramento técnico; revisar antes de concluir.';
      } else {
        status = 'AWAITING_VALIDATION';
        rules.push('ACTION_AWAITING_CLOSURE');
        primaryRule = 'ACTION_AWAITING_CLOSURE';
        reasonSummary =
          'Parecer de eficácia vigente; aguardando reavaliação do risco e encerramento técnico.';
      }
    } else if (opinion && efficacy) {
      status = 'NEEDS_REVIEW';
      const proof = efficacyProofPackageSchema.parse(opinion.proofPackage);
      if (efficacy.validity === 'REVIEW_REQUIRED') rules.push('ACTION_EFFICACY_REVIEW_REQUIRED');
      if (opinion.result !== 'EFFECTIVE') rules.push('ACTION_EFFICACY_FOLLOW_UP');
      if (activeEvidenceCount === 0 && proof.texts.length === 0) {
        rules.push('ACTION_MISSING_EVIDENCE');
        missingInfo.push(
          'Sem evidência ativa anexada e sem prova textual vigente para sustentar o parecer.',
        );
      }
      if (!activeOrigin || !contextMatches) rules.push('ACTION_ORIGIN_CHANGED');
      if (!activeOrigin) rules.push('ORIGIN_INACTIVE');
      primaryRule = rules[0] ?? 'ACTION_EFFICACY_REVIEW_REQUIRED';
      if (efficacy.reviewReasons.includes('SELECTED_EVIDENCE_ARCHIVED')) {
        reasonSummary =
          'Parecer de eficácia exige revisão porque uma evidência selecionada foi arquivada.';
      } else if (efficacy.validity === 'REVIEW_REQUIRED') {
        reasonSummary =
          'Parecer de eficácia exige revisão após alteração da ação, do risco ou das provas vinculadas.';
      } else if (opinion.result === 'INCONCLUSIVE') {
        reasonSummary =
          'Parecer técnico inconclusivo; registrar acompanhamento complementar e novo parecer.';
      } else {
        reasonSummary =
          'Parecer técnico registrou medida não eficaz; revisar encaminhamento ou criar nova medida.';
      }
    } else {
      if (activeEvidenceCount === 0) {
        rules.push('ACTION_MISSING_EVIDENCE');
        missingInfo.push(
          'Sem evidência ativa anexada; anexe comprovação ou registre prova textual justificada no parecer de eficácia.',
        );
      }
      rules.push('ACTION_AWAITING_EFFICACY');
      if (!activeOrigin || !contextMatches) {
        rules.push('ACTION_ORIGIN_CHANGED');
        if (!activeOrigin) rules.push('ORIGIN_INACTIVE');
        status = 'NEEDS_REVIEW';
        primaryRule = 'ACTION_ORIGIN_CHANGED';
        reasonSummary =
          'Execução informada, mas a origem ou o contexto do risco mudou; revisar antes do parecer de eficácia.';
      } else if (activeEvidenceCount === 0) {
        status = 'PENDING';
        primaryRule = 'ACTION_MISSING_EVIDENCE';
        reasonSummary =
          'Execução informada sem evidência ativa anexada; falta comprovação para subsidiar o parecer de eficácia.';
      } else {
        status = 'AWAITING_VALIDATION';
        primaryRule = 'ACTION_AWAITING_EFFICACY';
        reasonSummary =
          'Execução informada com evidência ativa; aguardando parecer técnico de eficácia.';
      }
    }
  } else {
    if (isOverdue) {
      rules.push('ACTION_OVERDUE');
      if (activeEvidenceCount === 0) {
        rules.push('ACTION_MISSING_EVIDENCE');
        missingInfo.push(
          'Sem evidência ativa anexada para comprovar andamento ou justificativa da ação vencida.',
        );
      }
    }
    if (assigneeInactive) rules.push('ACTION_ASSIGNEE_INACTIVE');
    if (!activeOrigin || !contextMatches) rules.push('ACTION_ORIGIN_CHANGED');
    if (!activeOrigin) rules.push('ORIGIN_INACTIVE');

    if (assigneeInactive || !activeOrigin || !contextMatches) {
      status = 'NEEDS_REVIEW';
      primaryRule = assigneeInactive ? 'ACTION_ASSIGNEE_INACTIVE' : 'ACTION_ORIGIN_CHANGED';
      const reviewCause = assigneeInactive
        ? 'responsável atribuído está inativo na empresa'
        : 'origem ou contexto do risco vinculado mudou';
      reasonSummary = isOverdue
        ? `Ação em aberto com prazo vencido em ${formatBrDate(dueDate)} e ${reviewCause}; revisar antes de prosseguir.`
        : assigneeInactive
          ? 'Responsável atribuído está inativo na empresa; revisar atribuição da medida.'
          : 'Origem ou contexto do risco vinculado mudou; revisar adequação da medida preventiva.';
    } else if (isOverdue) {
      status = 'PENDING';
      primaryRule = 'ACTION_OVERDUE';
      reasonSummary =
        activeEvidenceCount === 0
          ? `Ação em aberto com prazo vencido em ${formatBrDate(dueDate)} e sem evidência ativa anexada.`
          : `Ação em aberto com prazo registrado vencido em ${formatBrDate(dueDate)}.`;
    } else if (record.status === 'IN_PROGRESS') {
      status = 'IN_PROGRESS';
      primaryRule = null;
      reasonSummary = `Medida em execução dentro do prazo registrado (${formatBrDate(dueDate)}).`;
    } else {
      status = 'PENDING';
      rules.push('ACTION_PLANNED');
      primaryRule = 'ACTION_PLANNED';
      reasonSummary = `Medida planejada dentro do prazo (${formatBrDate(dueDate)}), aguardando início da execução.`;
    }
  }

  return {
    id: `action:${record.id}`,
    origin: 'ACTION',
    originId: record.id,
    riskId: record.riskId,
    actionId: record.id,
    title: record.title,
    contextLabel: `Fator: ${record.risk.factor}`,
    unit: { id: unit.id, name: unit.name },
    sector: { id: sector.id, name: sector.name },
    status,
    primaryRule,
    rules: uniqueRules(rules),
    reasonSummary,
    missingInfo,
    dueDate,
    isOverdue,
    responsible,
    evidence: { activeCount: activeEvidenceCount, archivedCount: archivedEvidenceCount },
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function classifyRiskPendency(
  record: WorkspaceRecord,
  linkedActions: readonly Nr01PendencyItem[],
  cancelledActionsCount: number,
): Nr01PendencyItem {
  const sector = record.assessmentGroup.sector;
  const unit = sector.unit;
  const evalState = evaluationState(record);
  const scopeActive = riskScopeIsActive(record);
  const hasActiveAction = linkedActions.length > 0;
  const allActionsCompleted =
    hasActiveAction && linkedActions.every((item) => item.status === 'COMPLETED');

  const rules: Nr01PendencyRule[] = [];
  const missingInfo: string[] = [];

  if (record.status === 'DRAFT') {
    rules.push('RISK_DRAFT');
    missingInfo.push('Cadastro em rascunho; finalize o registro para habilitar avaliação técnica.');
  }
  if (!scopeActive) rules.push('ORIGIN_INACTIVE');
  if (evalState === 'CONTEXT_CHANGED') rules.push('RISK_EVALUATION_REVIEW_REQUIRED');
  if (record.status === 'REGISTERED' && evalState === 'ABSENT') {
    rules.push('RISK_AWAITING_EVALUATION');
    missingInfo.push('Sem avaliação técnica vigente para classificar nível e prioridade.');
  }
  if (!hasActiveAction) {
    rules.push('RISK_WITHOUT_ACTION');
    missingInfo.push(
      cancelledActionsCount > 0
        ? 'Sem medida preventiva ativa vinculada (há apenas ações canceladas).'
        : 'Sem medida preventiva ativa vinculada a este risco.',
    );
  }

  let status: Nr01PendencyStatus;
  let primaryRule: Nr01PendencyRule | null;
  let reasonSummary: string;

  if (evalState === 'CONTEXT_CHANGED' || !scopeActive) {
    status = 'NEEDS_REVIEW';
    primaryRule =
      evalState === 'CONTEXT_CHANGED' ? 'RISK_EVALUATION_REVIEW_REQUIRED' : 'ORIGIN_INACTIVE';
    reasonSummary =
      evalState === 'CONTEXT_CHANGED'
        ? 'Avaliação técnica anterior exige revisão após alteração do contexto ou do escopo do risco.'
        : 'Escopo organizacional do risco (unidade, setor ou grupo) está inativo; revisar destino do registro.';
  } else if (record.status === 'DRAFT') {
    status = 'PENDING';
    primaryRule = 'RISK_DRAFT';
    reasonSummary =
      'Risco em rascunho; falta concluir o registro no inventário para avaliação e medidas.';
  } else if (evalState === 'ABSENT') {
    status = 'AWAITING_VALIDATION';
    primaryRule = 'RISK_AWAITING_EVALUATION';
    reasonSummary = hasActiveAction
      ? 'Risco registrado aguardando avaliação técnica vigente.'
      : 'Risco registrado aguardando avaliação técnica e sem medida preventiva ativa vinculada.';
  } else if (!hasActiveAction) {
    status = 'PENDING';
    primaryRule = 'RISK_WITHOUT_ACTION';
    reasonSummary =
      cancelledActionsCount > 0
        ? 'Risco avaliado sem medida preventiva ativa vinculada (ações anteriores canceladas).'
        : 'Risco cadastrado e avaliado sem medida preventiva ativa vinculada.';
  } else if (allActionsCompleted) {
    status = 'COMPLETED';
    primaryRule = null;
    reasonSummary =
      'Risco com avaliação técnica vigente e medidas preventivas ativas tecnicamente encerradas.';
  } else {
    status = 'IN_PROGRESS';
    primaryRule = null;
    reasonSummary = `Risco com avaliação técnica vigente e ${linkedActions.length} ${linkedActions.length === 1 ? 'medida ativa' : 'medidas ativas'} em acompanhamento.`;
  }

  return {
    id: `risk:${record.id}`,
    origin: 'RISK',
    originId: record.id,
    riskId: record.id,
    actionId: null,
    title: record.factor,
    contextLabel:
      record.status === 'DRAFT'
        ? 'Risco em rascunho no inventário'
        : 'Risco registrado no inventário',
    unit: { id: unit.id, name: unit.name },
    sector: { id: sector.id, name: sector.name },
    status,
    primaryRule,
    rules: uniqueRules(rules),
    reasonSummary,
    missingInfo,
    dueDate: null,
    isOverdue: false,
    responsible: null,
    evidence: null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function itemPriorityRank(item: Nr01PendencyItem): number {
  if (item.isOverdue) return 0;
  return statusOrder[item.status];
}

export function buildNr01PendenciesResult(input: {
  organizationId: string;
  organization: Nr01Pendencies['organization'];
  generatedAt: string;
  referenceDate: string;
  timeZone: string;
  filters: { unitId: string | null; sectorId: string | null };
  query: Nr01PendenciesQuery;
  allItems: Nr01PendencyItem[];
}): Nr01Pendencies {
  const byStatus: Nr01Pendencies['summary']['byStatus'] = {
    PENDING: 0,
    IN_PROGRESS: 0,
    AWAITING_VALIDATION: 0,
    NEEDS_REVIEW: 0,
    COMPLETED: 0,
  };
  const byOrigin: Nr01Pendencies['summary']['byOrigin'] = { RISK: 0, ACTION: 0 };
  const signals: Nr01Pendencies['summary']['signals'] = {
    overdueActions: 0,
    missingEvidence: 0,
    risksWithoutAction: 0,
    awaitingEvaluationOrValidation: 0,
    needsReview: 0,
  };

  for (const item of input.allItems) {
    byStatus[item.status]++;
    byOrigin[item.origin]++;
    if (item.origin === 'ACTION' && item.isOverdue) signals.overdueActions++;
    if (item.origin === 'ACTION' && item.rules.includes('ACTION_MISSING_EVIDENCE'))
      signals.missingEvidence++;
    if (item.origin === 'RISK' && item.rules.includes('RISK_WITHOUT_ACTION'))
      signals.risksWithoutAction++;
    if (item.status === 'AWAITING_VALIDATION') signals.awaitingEvaluationOrValidation++;
    if (item.status === 'NEEDS_REVIEW') signals.needsReview++;
  }

  const filtered = input.allItems
    .filter((item) => {
      if (input.query.status && item.status !== input.query.status) return false;
      if (input.query.origin && item.origin !== input.query.origin) return false;
      if (input.query.rule && !item.rules.includes(input.query.rule)) return false;
      return true;
    })
    .sort((a, b) => {
      const rank = itemPriorityRank(a) - itemPriorityRank(b);
      if (rank !== 0) return rank;
      const dueA = a.dueDate ?? '9999-12-31';
      const dueB = b.dueDate ?? '9999-12-31';
      if (dueA !== dueB) return dueA.localeCompare(dueB);
      if (a.origin !== b.origin) return a.origin === 'ACTION' ? -1 : 1;
      return a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id);
    });

  const offset = (input.query.page - 1) * input.query.pageSize;
  const pageItems = filtered.slice(offset, offset + input.query.pageSize);
  const total = input.allItems.length;

  return {
    organizationId: input.organizationId,
    organization: input.organization,
    generatedAt: input.generatedAt,
    referenceDate: input.referenceDate,
    timeZone: input.timeZone,
    ruleSet: NR01_RULE_SET,
    filters: {
      unitId: input.filters.unitId,
      sectorId: input.filters.sectorId,
      status: input.query.status ?? null,
      rule: input.query.rule ?? null,
      origin: input.query.origin ?? null,
    },
    summary: {
      total,
      openPendencies: total - byStatus.COMPLETED,
      byStatus,
      byOrigin,
      signals,
    },
    page: input.query.page,
    pageSize: input.query.pageSize,
    total: filtered.length,
    items: pageItems,
  };
}
