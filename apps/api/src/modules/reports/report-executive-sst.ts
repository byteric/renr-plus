import type { CreateTenantReport, ReportSection } from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { actionInclude, referenceDate } from '../actions/actions.repository';
import { currentEfficacy } from '../action-efficacy/action-efficacy.service';
import { participationProtected } from '../assessments/assessment-eligibility';
import { technicalClosureReviewReasons } from '../risk-continuity/risk-continuity.service';
import {
  evaluationState,
  riskWorkspaceInclude,
  toTechnicalEvaluation,
} from '../technical-evaluations/risk-workspaces.service';
import { ReportScopeTooLargeException } from './report-errors';

const actionDetails = {
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
      verifiedOn: true,
      nextSteps: true,
      proofPackage: true,
      actionFingerprint: true,
      riskContextFingerprint: true,
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

const actionStatus = {
  PLANNED: 'Planejada',
  IN_PROGRESS: 'Em andamento',
  IMPLEMENTED: 'Implementada',
  CANCELLED: 'Cancelada',
};
const efficacyStatus = {
  EFFECTIVE: 'Eficaz',
  NOT_EFFECTIVE: 'Não eficaz',
  INCONCLUSIVE: 'Inconclusivo',
};
const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const date = (value: string) => value.split('-').reverse().join('/');
type Reference = NonNullable<ReportSection['references']>[number];
type Evidence = { id: string; actionId: string; archivedAt: Date | null; sha256: string };
type Priority = { cells: string[]; source: Omit<Reference, 'row'> };

function assessMeasure(
  record: Prisma.ActionGetPayload<{ include: typeof actionDetails }>,
  files: ReadonlyMap<string, Evidence>,
) {
  const opinion = record.efficacyOpinions[0];
  const closure = record.actionTechnicalClosures[0];
  const validity = opinion ? currentEfficacy(record, opinion, files, true) : null;
  const effective = validity?.validity === 'CURRENT' && opinion?.result === 'EFFECTIVE';
  const closed =
    effective &&
    validity &&
    closure &&
    !technicalClosureReviewReasons(
      closure,
      closure.id,
      {
        ...validity,
        originInactive: false,
        latest: opinion ? { id: opinion.id, reviewReasons: validity.reviewReasons } : null,
      },
      record.risk.technicalEvaluations[0]?.id ?? null,
    ).length;
  const active = [...files.values()].filter((file) => !file.archivedAt);
  const proof = active.length
    ? `${active.length} evidência(s) ativa(s) no registro da ação.`
    : 'Sem evidência ativa no registro da ação.';
  const finding = opinion
    ? `${efficacyStatus[opinion.result as keyof typeof efficacyStatus] ?? 'Resultado indisponível'} (${date(opinion.verifiedOn.toISOString().slice(0, 10))})${validity?.validity !== 'CURRENT' ? ' · registro histórico, requer revisão' : ''}.`
    : 'Sem parecer de eficácia registrado.';
  const next =
    opinion?.nextSteps && validity?.validity === 'CURRENT'
      ? `Encaminhamento técnico registrado: ${opinion.nextSteps}`
      : 'Sem encaminhamento técnico vigente registrado.';
  return { effective: Boolean(effective), closed: Boolean(closed), proof, finding, next };
}

export async function captureExecutiveSst(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: CreateTenantReport,
  scope: { unit: string; sector: string; today: string; timeZone: string },
  withheldCycles: ReadonlySet<string>,
): Promise<ReportSection[]> {
  const group = {
    sector: { unitId: input.unitId, id: input.sectorId },
  } satisfies Prisma.AssessmentGroupWhereInput;
  const riskWhere = { organizationId, assessmentGroup: group } satisfies Prisma.RiskWhereInput;
  const [groups, risks, actions, openCollections] = await Promise.all([
    tx.assessmentGroup.findMany({
      where: { organizationId, ...group },
      orderBy: [{ sector: { name: 'asc' } }, { id: 'asc' }],
      take: 301,
      select: {
        sector: {
          select: { id: true, name: true, unitId: true, unit: { select: { name: true } } },
        },
        assessmentCycles: {
          where: { organizationId, status: 'CLOSED' },
          orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            name: true,
            startsAt: true,
            endsAt: true,
            closedAt: true,
            eligibleCount: true,
            instrumentVersion: { select: { title: true, version: true, usageMode: true } },
            policyVersion: { select: { minimumResponses: true, version: true } },
            _count: { select: { responses: true, invites: true, sources: true } },
          },
        },
      },
    }),
    tx.risk.findMany({
      where: { ...riskWhere, status: 'REGISTERED' },
      include: riskWorkspaceInclude,
      orderBy: [{ factor: 'asc' }, { id: 'asc' }],
      take: 301,
    }),
    tx.action.findMany({
      where: { organizationId, risk: riskWhere, status: { not: 'CANCELLED' } },
      include: actionDetails,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 1001,
    }),
    tx.assessmentCycle.count({ where: { organizationId, assessmentGroup: group, status: 'OPEN' } }),
  ]);
  if (groups.length > 300 || risks.length > 300 || actions.length > 1000)
    throw new ReportScopeTooLargeException();
  const evidence = await tx.actionEvidence.findMany({
    where: { organizationId, actionId: { in: actions.map(({ id }) => id) } },
    select: { id: true, actionId: true, archivedAt: true, sha256: true },
    take: 20_001,
  });
  if (evidence.length > 20_000) throw new ReportScopeTooLargeException();
  const files = new Map<string, Map<string, Evidence>>();
  for (const item of evidence) {
    const entries = files.get(item.actionId) ?? new Map<string, Evidence>();
    entries.set(item.id, item);
    files.set(item.actionId, entries);
  }
  const priorities: Priority[] = [];
  const append = (
    record: (typeof actions)[number],
    reason: string,
    review: ReturnType<typeof assessMeasure>,
  ) => {
    if (priorities.length === 8) return;
    const sector = record.risk.assessmentGroup.sector;
    priorities.push({
      cells: [
        `${record.title}\nFator: ${record.risk.factor}`,
        `${reason} · ${actionStatus[record.status]}`,
        `${record.responsibleName}\nPrazo: ${date(record.dueDate.toISOString().slice(0, 10))}`,
        `Critério: ${record.verificationCriterion}\n${review.finding}\n${review.proof}\n${review.next}\nID da ação: ${record.id}`,
      ],
      source: {
        kind: 'ACTION',
        id: record.id,
        riskId: record.riskId,
        unitId: sector.unitId,
        sectorId: sector.id,
      },
    });
  };
  let implemented = 0;
  let overdue = 0;
  let effective = 0;
  let pendingVerification = 0;
  const verifiedGuidance: Array<{
    record: (typeof actions)[number];
    review: ReturnType<typeof assessMeasure>;
  }> = [];
  for (const record of actions) {
    if (record.status === 'PLANNED' || record.status === 'IN_PROGRESS') {
      if (record.dueDate.toISOString().slice(0, 10) < scope.today) {
        overdue++;
        append(record, 'Prazo vencido', assessMeasure(record, files.get(record.id) ?? new Map()));
      }
    }
  }
  for (const record of actions) {
    if (record.status !== 'IMPLEMENTED') continue;
    implemented++;
    const review = assessMeasure(record, files.get(record.id) ?? new Map());
    if (review.effective) effective++;
    if (!review.closed) {
      pendingVerification++;
      append(record, 'Verificação técnica pendente', review);
    } else if (record.efficacyOpinions[0]?.nextSteps && verifiedGuidance.length < 8)
      verifiedGuidance.push({ record, review });
  }
  for (const { record, review } of verifiedGuidance)
    append(record, 'Encaminhamento técnico registrado', review);

  let evaluated = 0;
  const technicalFactors: Array<Priority & { method: string; rank: number }> = [];
  for (const risk of risks) {
    const evaluation =
      evaluationState(risk) === 'CURRENT'
        ? toTechnicalEvaluation(risk.technicalEvaluations[0]!)
        : null;
    if (evaluation) evaluated++;
    const sector = risk.assessmentGroup.sector;
    technicalFactors.push({
      method: evaluation?.method.versionId ?? '',
      rank: evaluation?.priority.rank ?? 0,
      cells: [
        risk.factor,
        evaluation
          ? `${evaluation.level.label} · ${evaluation.priority.label}`
          : 'Sem avaliação técnica vigente',
        'No registro de origem',
        evaluation
          ? `${evaluation.method.name} · versão ${evaluation.method.version} · ${evaluation.sources.length} fonte(s) registrada(s).\nID do risco: ${risk.id}`
          : `Consultar o inventário e conferir a documentação da avaliação.\nID do risco: ${risk.id}`,
      ],
      source: { kind: 'RISK', id: risk.id, unitId: sector.unitId, sectorId: sector.id },
    });
  }
  technicalFactors.sort(
    (a, b) =>
      Number(!a.method) - Number(!b.method) || a.method.localeCompare(b.method) || a.rank - b.rank,
  );
  const visiblePriorities = [...priorities, ...technicalFactors.slice(0, 8)];
  const collections: ReportSection = {
    key: 'executive-collections',
    title: 'Coletas por setor e adesão',
    columns: ['Unidade / setor', 'Última coleta encerrada', 'Adesão', 'Política e fontes'],
    rows: [],
    references: [],
    notes: ['A taxa refere-se somente à coleta indicada. Não há soma entre setores ou ciclos.'],
  };
  if (!groups.length)
    collections.rows.push([
      `${scope.unit} / ${scope.sector}`,
      'Sem grupo de avaliação no recorte',
      'Indisponível',
      'Consulte a estrutura e o cadastro de grupos antes de preparar uma coleta.',
    ]);
  for (const {
    sector,
    assessmentCycles: [cycle],
  } of groups) {
    const groupName = `${sector.unit.name} / ${sector.name}`;
    if (!cycle) {
      collections.rows.push([
        groupName,
        'Sem coleta encerrada',
        'Indisponível',
        'Sem base para verificação.',
      ]);
      continue;
    }
    const minimum = cycle.policyVersion.minimumResponses;
    const base = cycle.eligibleCount;
    const effectiveEnd =
      cycle.closedAt && cycle.closedAt < cycle.endsAt ? cycle.closedAt : cycle.endsAt;
    const { responses, invites, sources } = cycle._count;
    const adhesion = withheldCycles.has(cycle.id)
      ? 'Adesão protegida na comparação'
      : !base
        ? 'Base de elegíveis indisponível'
        : minimum === null || participationProtected(base, responses, minimum, invites)
          ? 'Adesão protegida'
          : `${percentage.format((responses * 100) / base)}%\n${base} elegíveis · ${invites} códigos · ${responses} respostas válidas`;
    collections.references!.push({
      row: collections.rows.length,
      kind: 'CYCLE',
      id: cycle.id,
      unitId: sector.unitId,
      sectorId: sector.id,
    });
    collections.rows.push([
      groupName,
      `${cycle.name}\n${date(referenceDate(scope.timeZone, cycle.startsAt))} a ${date(referenceDate(scope.timeZone, effectiveEnd))}\nID da coleta: ${cycle.id}`,
      adhesion,
      `${cycle.instrumentVersion.title} · versão ${cycle.instrumentVersion.version}\nPolítica v${cycle.policyVersion.version}\n${cycle.instrumentVersion.usageMode === 'DEMONSTRATION' ? 'Demonstração · ' : ''}${sources} fonte(s) documentada(s)`,
    ]);
  }
  return [
    {
      key: 'executive-summary',
      title: 'Resumo executivo SST',
      columns: ['Panorama', 'Situação na emissão', 'Verificação'],
      rows: [
        [
          'Recorte do relatório',
          `${scope.unit} / ${scope.sector}`,
          `Data de referência: ${date(scope.today)}. Consulte os períodos na seção de coletas.`,
        ],
        [
          'Fatores do inventário',
          `${risks.length} riscos registrados · ${evaluated} com avaliação técnica vigente`,
          'Os níveis e as prioridades vêm do método usado no registro de origem.',
        ],
        [
          'Medidas preventivas',
          `${implemented} implementadas · ${actions.length - implemented} pendentes de implementação · ${overdue} com prazo vencido`,
          'O registro da ação informa o responsável, o prazo e o critério de verificação.',
        ],
        [
          'Verificação técnica',
          `${effective} medidas com parecer eficaz vigente · ${pendingVerification} medidas implementadas com verificação pendente`,
          'Implementação, eficácia e encerramento são estados distintos.',
        ],
        [
          'Coletas',
          `${openCollections} em andamento`,
          'A adesão só é divulgada após o encerramento e conforme a política da coleta.',
        ],
      ],
      notes: [
        'Síntese de apoio ao GRO/PGR. As decisões e recomendações técnicas exigem conferência por profissional autorizado.',
        'O panorama reflete o estado dos registros na emissão. Consulte os vínculos do inventário para identificar a origem de cada fator.',
      ],
    },
    collections,
    {
      key: 'executive-priorities',
      title: 'Prioridades, responsáveis e verificação',
      columns: ['Registro', 'Situação', 'Responsável / prazo', 'Evidências e encaminhamento'],
      rows: visiblePriorities.map(({ cells }) => cells),
      references: visiblePriorities.map(({ source }, row) => ({ ...source, row })),
      notes: [
        `${overdue + pendingVerification} ações com prazo vencido ou verificação pendente e ${technicalFactors.length} fatores registrados no recorte. A síntese apresenta até oito medidas e oito fatores. Consulte o relatório técnico e os registros de origem para ver a relação completa.`,
        'A ordem de prioridade é aplicada dentro de cada versão de método. As evidências permanecem nos registros privados de origem.',
      ],
    },
  ];
}
