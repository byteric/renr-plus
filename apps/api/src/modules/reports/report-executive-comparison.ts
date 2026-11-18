import type {
  AssessmentComparison,
  AssessmentComparisonReason,
  AssessmentComparisonTrend,
  ReportSection,
} from '@renr/contracts';
import { referenceDate } from '../actions/actions.repository';

const incompatibility: Record<AssessmentComparisonReason, string> = {
  SAME_CYCLE: 'Selecione dois ciclos distintos.',
  OPEN_CYCLE: 'Os dois ciclos precisam estar encerrados.',
  SCOPE_MISMATCH: 'Unidade, setor e grupo precisam coincidir.',
  INSTRUMENT_VERSION: 'As versões do instrumento são diferentes.',
  POLICY_VERSION: 'As versões da política são diferentes.',
  PERIOD_ORDER: 'Os períodos se sobrepõem ou estão fora da ordem cronológica.',
};
const direction = { INCREASE: 'Aumento', DECREASE: 'Queda', STABLE: 'Estabilidade' };
const riskDirection = {
  IMPROVED: 'Melhora na classificação',
  WORSENED: 'Piora na classificação',
  STABLE: 'Classificação estável',
  NOT_COMPARABLE: 'Classificações não comparáveis',
};
const actionStatus = {
  PLANNED: 'Planejada',
  IN_PROGRESS: 'Em andamento',
  IMPLEMENTED: 'Implementada',
  CANCELLED: 'Cancelada',
};
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const date = (value: string, timeZone: string) =>
  referenceDate(timeZone, new Date(value)).split('-').reverse().join('/');

function trend(label: string, value: AssessmentComparisonTrend) {
  if (value.status === 'AVAILABLE')
    return [
      label,
      number.format(value.reference) + '%',
      number.format(value.current) + '%',
      `${direction[value.direction]} de ${number.format(Math.abs(value.difference))} p.p.`,
    ];
  const reason =
    value.status === 'PROTECTED'
      ? 'A política protege os pontos ou a diferença.'
      : value.status === 'UNKNOWN_BASE'
        ? 'A base de elegíveis de pelo menos um período é indisponível.'
        : 'Medida não comparável.';
  return [label, 'Indisponível', 'Indisponível', reason];
}

export function executiveComparison(
  comparison: AssessmentComparison,
  timeZone: string,
): ReportSection {
  const { reference, current, scope } = comparison;
  const period = (cycle: typeof reference) => {
    const effectiveEnd =
      cycle.closedAt && cycle.closedAt < cycle.endsAt ? cycle.closedAt : cycle.endsAt;
    return date(cycle.startsAt, timeZone) + ' a ' + date(effectiveEnd, timeZone);
  };
  const location = scope ? { unitId: scope.unitId, sectorId: scope.sectorId } : {};
  const section: ReportSection = {
    key: 'executive-comparison',
    title: 'Evolução entre coletas',
    columns: ['Medida ou registro', 'Referência', 'Período atual', 'Leitura'],
    rows: [
      [
        'Ciclo de referência',
        `${reference.name}\n${period(reference)}\nID: ${reference.id}`,
        '—',
        'Período de referência selecionado.',
      ],
      [
        'Ciclo atual',
        '—',
        `${current.name}\n${period(current)}\nID: ${current.id}`,
        'Período atual selecionado.',
      ],
    ],
    references: [
      { row: 0, kind: 'CYCLE', id: reference.id, ...location },
      { row: 1, kind: 'CYCLE', id: current.id, ...location },
    ],
    notes: [
      'Percentuais de participação e alternativas descrevem respostas coletivas. Medidas, pareceres técnicos e classificações têm fontes próprias.',
      'Atribuições entre coletas e mudanças no inventário dependem dos vínculos documentados na origem.',
    ],
  };
  if (comparison.status === 'INCOMPATIBLE') {
    section.rows.push([
      'Comparação indisponível',
      '—',
      '—',
      comparison.reasons.map((reason) => incompatibility[reason]).join('\n'),
    ]);
    return section;
  }
  section.rows.push([
    'Recorte comparado',
    `${comparison.scope.unitName} / ${comparison.scope.sectorName}`,
    'Mesmo recorte',
    comparison.scope.groupName,
  ]);
  section.rows.push(trend('Adesão', comparison.participation));
  const available = comparison.factors.flatMap((factor) =>
    factor.trend.status === 'AVAILABLE' ? [{ ...factor, trend: factor.trend }] : [],
  );
  available.sort((a, b) => Math.abs(b.trend.difference) - Math.abs(a.trend.difference));
  section.rows.push(
    ...available
      .slice(0, 8)
      .map((factor) => trend(`${factor.questionLabel} · ${factor.optionLabel}`, factor.trend)),
  );
  if (comparison.factors.length > available.length)
    section.notes.push(
      'As distribuições protegidas ou sem base permanecem no estado correspondente da comparação, sem valores publicados aqui.',
    );
  if (!available.length)
    section.rows.push([
      'Distribuições coletivas',
      '—',
      '—',
      'Não há alternativas com variação divulgável.',
    ]);
  else if (available.length > 8)
    section.notes.push(
      'A síntese apresenta até oito alternativas, ordenadas pela maior diferença absoluta entre os períodos. Consulte a comparação na aplicação para ver todas as disponíveis.',
    );

  const { operations } = comparison;
  const periodMetrics = (value: typeof operations.reference) =>
    `${value.implemented} implementadas · ${value.pending} pendentes · ${value.cancelled} canceladas · ${value.withoutSnapshot} sem estado preservado.`;
  const efficacy = (value: typeof operations.reference) =>
    `${value.effective} eficaz(es) · ${value.notEffective} não eficaz(es) · ${value.inconclusive} inconclusivo(s) · ${value.withoutOpinion} sem parecer.`;
  section.rows.push(
    [
      'Medidas do grupo',
      periodMetrics(operations.reference),
      periodMetrics(operations.current),
      'Estados reconstruídos somente de revisões preservadas até o fim de cada período.',
    ],
    [
      'Pareceres registrados no grupo',
      efficacy(operations.reference),
      efficacy(operations.current),
      'Conclusões registradas até o fim de cada período. Consulte o panorama da emissão para a situação vigente.',
    ],
  );
  const levels = (value: typeof operations.reference) =>
    [
      ...value.riskLevels
        .slice(0, 8)
        .map(({ level, methodName, total }) => `${methodName} · ${level}: ${total}`),
      `${value.unclassifiedRisks} risco(s) sem classificação válida no período`,
    ].join('\n');
  section.rows.push([
    'Classificação técnica no grupo',
    levels(operations.reference),
    levels(operations.current),
    'Níveis apresentados por método conforme registros preservados até cada período.',
  ]);
  for (const item of operations.reassessments.slice(0, 8)) {
    section.references!.push({
      row: section.rows.length,
      kind: 'RISK',
      id: item.riskId,
      ...location,
    });
    section.rows.push([
      `${item.riskLabel}\nID do risco: ${item.riskId}`,
      item.referenceLevel ?? 'Indisponível',
      item.currentLevel ?? 'Indisponível',
      `${riskDirection[item.direction]} · ${date(item.recordedAt, timeZone)}.`,
    ]);
  }
  if (operations.reassessmentTotal > 8)
    section.notes.push(
      `A síntese apresenta até oito das ${operations.reassessmentTotal} reavaliações registradas entre os períodos.`,
    );
  for (const item of operations.relatedActions.slice(0, 8)) {
    section.references!.push({
      row: section.rows.length,
      kind: 'ACTION',
      id: item.actionId,
      riskId: item.riskId,
      ...location,
    });
    section.rows.push([
      `${item.actionTitle}\nFator: ${item.riskLabel}\nID da ação: ${item.actionId}`,
      item.cycleId === reference.id ? reference.name : '—',
      item.cycleId === current.id ? current.name : '—',
      `${actionStatus[item.status]} · prazo ${item.dueDate.split('-').reverse().join('/')}. Vínculo registrado na fonte técnica. Situação da medida na data de emissão.`,
    ]);
  }
  return section;
}
