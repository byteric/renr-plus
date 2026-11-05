import {
  DEMO_MINIMUM_RESPONSES,
  type CreateTenantReport,
  type ReportSection,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import { ReportScopeTooLargeException } from './report-errors';

const text = (v: unknown): string =>
  v === null || v === undefined
    ? 'Não informado'
    : v instanceof Date
      ? v.toISOString()
      : typeof v === 'string'
        ? v
        : JSON.stringify(v);
const section = (
  key: string,
  title: string,
  columns: string[],
  rows: string[][],
  notes: string[] = [],
): ReportSection => ({ key, title, columns, rows, notes });
const unsafe = (n: number, min: number) => n > 0 && n < min;
export async function captureSst(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: CreateTenantReport,
): Promise<ReportSection[]> {
  const group = {
    sector: {
      ...(input.unitId ? { unitId: input.unitId } : {}),
      ...(input.sectorId ? { id: input.sectorId } : {}),
    },
  };
  const where: Prisma.RiskWhereInput = { organizationId, assessmentGroup: group };
  const [riskCount, actionCount] = await Promise.all([
    tx.risk.count({ where }),
    tx.action.count({ where: { organizationId, risk: where } }),
  ]);
  if (riskCount > 300 || actionCount > 1000) throw new ReportScopeTooLargeException();
  const risks = await tx.risk.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 301,
    include: { assessmentGroup: { include: { sector: { include: { unit: true } } } } },
  });
  const riskIds = risks.map((r) => r.id);
  const actions = await tx.action.findMany({
    where: { organizationId, riskId: { in: riskIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1001,
  });
  const actionIds = actions.map((a) => a.id);
  const [evaluations, preliminary, evidence, efficacy, reassessments, closures, history] =
    await Promise.all([
      tx.technicalRiskEvaluation.findMany({
        where: { organizationId, riskId: { in: riskIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2001,
        select: {
          id: true,
          riskId: true,
          sequence: true,
          result: true,
          context: true,
          rationale: true,
          sources: true,
          createdAt: true,
          author: { select: { name: true } },
          methodVersion: { select: { title: true, version: true } },
        },
      }),
      tx.riskEvaluation.findMany({
        where: { organizationId, riskId: { in: riskIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2001,
        include: { author: { select: { name: true } } },
      }),
      tx.actionEvidence.findMany({
        where: { organizationId, actionId: { in: actionIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20001,
        select: {
          id: true,
          actionId: true,
          fileName: true,
          description: true,
          mimeType: true,
          size: true,
          sha256: true,
          createdAt: true,
          archivedAt: true,
        },
      }),
      tx.actionEfficacyOpinion.findMany({
        where: { organizationId, actionId: { in: actionIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2001,
        include: { author: { select: { name: true } } },
      }),
      tx.riskReassessment.findMany({
        where: { organizationId, riskId: { in: riskIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2001,
        include: { author: { select: { name: true } }, measures: true },
      }),
      tx.actionTechnicalClosure.findMany({
        where: { organizationId, actionId: { in: actionIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2001,
        include: { author: { select: { name: true } } },
      }),
      tx.auditEvent.findMany({
        where: { organizationId, resourceId: { in: [...riskIds, ...actionIds] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5001,
        select: {
          id: true,
          action: true,
          resourceId: true,
          createdAt: true,
          referenceId: true,
          referenceType: true,
        },
      }),
    ]);
  if (
    evaluations.length > 2000 ||
    preliminary.length > 2000 ||
    evidence.length > 20000 ||
    efficacy.length > 2000 ||
    reassessments.length > 2000 ||
    closures.length > 2000 ||
    history.length > 5000
  )
    throw new ReportScopeTooLargeException();
  const riskNames = new Map(risks.map((risk) => [risk.id, risk.factor]));
  const actionNames = new Map(actions.map((action) => [action.id, action.title]));
  const riskName = (id: string) => riskNames.get(id) ?? id;
  const actionName = (id: string) => actionNames.get(id) ?? id;
  const sections: ReportSection[] = [
    section(
      'inventory',
      'Inventário de riscos',
      ['Risco e situação', 'Unidade / setor', 'Caracterização', 'Origem'],
      risks.map((r) => [
        r.factor + '\n' + r.status + ' · versão ' + r.version + '\n' + r.id,
        r.assessmentGroup.sector.unit.name + ' / ' + r.assessmentGroup.sector.name,
        [
          'Descrição: ' + text(r.description),
          'Exposição: ' + text(r.exposureDescription),
          'Grupo: ' + text(r.exposedGroupDescription),
          'Danos: ' + text(r.possibleHarms),
          'Controles: ' + text(r.existingControls),
        ].join('\n'),
        text(r.sourceKind) + '\n' + text(r.sourceNote) + '\n' + text(r.diagnosticCycleId),
      ]),
    ),
    section(
      'technical-evaluations',
      'Avaliações técnicas',
      ['Risco / avaliação', 'Método e resultado', 'Fundamentação', 'Autoria e data'],
      evaluations.map((r) => [
        riskName(r.riskId) + '\n' + r.id + ' · sequência ' + r.sequence,
        r.methodVersion.title + ' · versão ' + r.methodVersion.version + '\n' + text(r.result),
        'Contexto: ' + r.context + '\n' + r.rationale + '\nFontes: ' + text(r.sources),
        r.author.name + '\n' + text(r.createdAt),
      ]),
    ),
    section(
      'preliminary',
      'Avaliações preliminares',
      ['Risco / sequência', 'Método', 'Observação / justificativa', 'Autoria e data'],
      preliminary.map((r) => [
        riskName(r.riskId) + ' · ' + r.sequence,
        r.methodReference + ' / ' + r.methodVersion,
        r.observation + '\n' + r.rationale,
        r.author.name + '\n' + text(r.createdAt),
      ]),
      ['Avaliação preliminar não substitui uma avaliação técnica.'],
    ),
    section(
      'actions',
      'Plano de ação',
      ['Ação / risco', 'Situação e prazo', 'Responsável', 'Objetivo e verificação'],
      actions.map((a) => [
        a.title + '\n' + riskName(a.riskId) + '\n' + a.description,
        a.status + ' · ' + a.dueDate.toISOString().slice(0, 10) + '\nVersão ' + a.version,
        a.responsibleName,
        'Resultado esperado: ' +
          a.expectedResult +
          '\nCritério: ' +
          a.verificationCriterion +
          '\nImplementação: ' +
          text(a.implementationNote),
      ]),
      ['Execução informada, eficácia e encerramento técnico são decisões distintas.'],
    ),
    section(
      'evidence',
      'Evidências referenciadas',
      ['Ação / referência', 'Arquivo', 'Descrição / integridade', 'Registro'],
      evidence.map((e) => [
        actionName(e.actionId) + '\n' + e.id,
        e.fileName + '\n' + e.mimeType + ' · ' + e.size + ' bytes',
        e.description + '\nSHA-256: ' + e.sha256,
        text(e.createdAt) +
          '\n' +
          (e.archivedAt ? 'Arquivada em ' + text(e.archivedAt) : 'Ativa na emissão'),
      ]),
      [
        'Os arquivos permanecem privados. O relatório não contém chaves do armazenamento ou links públicos.',
      ],
    ),
    section(
      'efficacy',
      'Pareceres de eficácia',
      ['Ação / sequência', 'Resultado', 'Verificação', 'Autoria'],
      efficacy.map((e) => [
        actionName(e.actionId) + ' · ' + e.sequence,
        e.result + '\nCritério: ' + e.criterionReference,
        e.observation + '\n' + e.rationale + '\nPróximos passos: ' + text(e.nextSteps),
        e.author.name + '\n' + text(e.verifiedOn),
      ]),
      [
        'Pareceres são preservados historicamente; uma alteração posterior pode exigir nova conferência.',
      ],
    ),
    section(
      'reassessments',
      'Reavaliações e medidas consideradas',
      ['Risco', 'Avaliações vinculadas', 'Medidas consideradas', 'Autoria e data'],
      reassessments.map((r) => [
        riskName(r.riskId),
        r.previousEvaluationId + ' → ' + r.evaluationId,
        r.measures.map((m) => actionName(m.actionId) + ': ' + m.consideration).join('\n') ||
          'Sem medidas registradas',
        r.author.name + '\n' + text(r.createdAt),
      ]),
    ),
    section(
      'closures',
      'Encerramentos técnicos',
      ['Ação', 'Avaliação / parecer', 'Justificativa', 'Autoria e data'],
      closures.map((c) => [
        actionName(c.actionId),
        c.reassessmentId + '\n' + c.opinionId,
        c.rationale,
        c.author.name + '\n' + text(c.createdAt),
      ]),
    ),
    section(
      'history',
      'Histórico dos registros incluídos',
      ['Operação', 'Recurso', 'Referência preservada', 'Data'],
      history.map((e) => [
        e.action,
        text(e.resourceId),
        text(e.referenceType) + ' / ' + text(e.referenceId),
        text(e.createdAt),
      ]),
      ['Não inclui registros de acesso, remuneração ou respostas individuais.'],
    ),
  ];
  sections.push(...(await captureAssessmentAggregates(tx, organizationId, group)));
  const demos = await tx.diagnosticCycle.findMany({
    where: {
      organizationId,
      ...(input.unitId || input.sectorId
        ? { groups: { some: { assessmentGroup: group }, every: { assessmentGroup: group } } }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 101,
    select: { name: true, status: true, _count: { select: { responses: true } } },
  });
  if (demos.length > 100) throw new ReportScopeTooLargeException();
  sections.push(
    section(
      'demonstration-cycles',
      'Ciclos demonstrativos',
      ['Ciclo', 'Situação', 'Respostas disponíveis'],
      demos.map((cycle) => [
        cycle.name,
        cycle.status,
        cycle.status === 'CLOSED' && cycle._count.responses >= DEMO_MINIMUM_RESPONSES
          ? String(cycle._count.responses)
          : 'Indisponível / protegido',
      ]),
      [
        'A contagem abrange ciclos totalmente contidos no recorte e respeita o mínimo de respostas.',
      ],
    ),
  );
  return sections;
}

async function captureAssessmentAggregates(
  tx: Prisma.TransactionClient,
  organizationId: string,
  group: Prisma.AssessmentGroupWhereInput,
): Promise<ReportSection[]> {
  const cycles = await tx.assessmentCycle.findMany({
    where: { organizationId, assessmentGroup: group },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 101,
    include: {
      policyVersion: { select: { minimumResponses: true } },
      instrumentVersion: {
        include: {
          questions: {
            orderBy: { position: 'asc' },
            include: { options: { orderBy: { position: 'asc' } } },
          },
        },
      },
    },
  });
  if (
    cycles.length > 100 ||
    cycles.reduce(
      (n, c) => n + c.instrumentVersion.questions.reduce((s, q) => s + q.options.length, 0),
      0,
    ) > 10000
  )
    throw new ReportScopeTooLargeException();
  const ids = cycles.map((c) => c.id);
  if (!ids.length)
    return [
      section(
        'diagnostics',
        'Diagnóstico agregado',
        ['Coleta', 'Situação', 'Respostas disponíveis'],
        [],
        ['Nenhuma coleta organizacional no recorte.'],
      ),
      section(
        'diagnostic-questions',
        'Distribuições coletivas',
        ['Coleta', 'Pergunta', 'Distribuição disponível'],
        [],
      ),
      section(
        'assessment-sources',
        'Fontes documentadas',
        ['Coleta / tipo', 'Contexto', 'Síntese', 'Data da fonte'],
        [],
      ),
    ];
  const [counts, answers, options, sources] = await Promise.all([
    tx.assessmentResponse.groupBy({
      by: ['cycleId'],
      where: { organizationId, cycleId: { in: ids } },
      _count: { _all: true },
    }),
    tx.$queryRaw<{ cycleId: string; questionId: string; count: number }[]>(Prisma.sql`
      SELECT r.cycle_id::text "cycleId",a.question_id::text "questionId",count(DISTINCT r.id)::int count
      FROM assessment_responses r JOIN assessment_answers a ON a.response_id=r.id
      WHERE r.organization_id=${organizationId}::uuid AND r.cycle_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND jsonb_array_length(a.option_ids)>0 GROUP BY r.cycle_id,a.question_id`),
    tx.$queryRaw<
      { cycleId: string; questionId: string; optionId: string; count: number }[]
    >(Prisma.sql`
      SELECT r.cycle_id::text "cycleId",a.question_id::text "questionId",o::text "optionId",count(DISTINCT r.id)::int count
      FROM assessment_responses r JOIN assessment_answers a ON a.response_id=r.id CROSS JOIN LATERAL jsonb_array_elements_text(a.option_ids) o
      WHERE r.organization_id=${organizationId}::uuid AND r.cycle_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) GROUP BY r.cycle_id,a.question_id,o`),
    tx.assessmentSource.findMany({
      where: { organizationId, cycleId: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 1001,
    }),
  ]);
  if (sources.length > 1000) throw new ReportScopeTooLargeException();
  const questions: string[][] = [];
  const summaries = cycles.map((c) => {
    const count = counts.find((r) => r.cycleId === c.id)?._count._all ?? 0;
    const minimum = c.policyVersion.minimumResponses;
    const available = c.status === 'CLOSED' && minimum !== null && count >= minimum;
    for (const question of c.instrumentVersion.questions) {
      const answered =
        answers.find((r) => r.cycleId === c.id && r.questionId === question.id)?.count ?? 0;
      const values = question.options.map((o) => ({
        label: o.label,
        count:
          options.find(
            (r) => r.cycleId === c.id && r.questionId === question.id && r.optionId === o.id,
          )?.count ?? 0,
      }));
      const hidden =
        !available ||
        unsafe(answered, minimum!) ||
        unsafe(count - answered, minimum!) ||
        values.some((o) => unsafe(o.count, minimum!) || unsafe(answered - o.count, minimum!));
      questions.push([
        c.name,
        question.label,
        hidden
          ? 'Indisponível / protegido'
          : answered === 0
            ? 'Sem respostas'
            : values.map((v) => v.label + ': ' + v.count).join('\n'),
      ]);
    }
    return [c.name, c.status, available ? String(count) : 'Indisponível / protegido'];
  });
  return [
    section(
      'diagnostics',
      'Diagnóstico agregado',
      ['Coleta', 'Situação', 'Respostas disponíveis'],
      summaries,
      [
        'Supressão primária e complementar conforme a política publicada de cada coleta; nenhum registro individual é exportado.',
      ],
    ),
    section(
      'diagnostic-questions',
      'Distribuições coletivas',
      ['Coleta', 'Pergunta', 'Distribuição disponível'],
      questions,
    ),
    section(
      'assessment-sources',
      'Fontes documentadas',
      ['Coleta / tipo', 'Contexto', 'Síntese', 'Data da fonte'],
      sources.map((s) => [
        (cycles.find((c) => c.id === s.cycleId)?.name ?? s.cycleId) + ' / ' + s.kind,
        s.context,
        s.summary,
        s.occurredOn.toISOString().slice(0, 10),
      ]),
    ),
  ];
}
