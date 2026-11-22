import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagementDashboard } from './components/ManagementDashboard';
import { RiskDetail } from './components/risks/RiskDetail';

const orgId = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000001';
const sectorId = '30000000-0000-4000-8000-000000000001';
const riskId = '40000000-0000-4000-8000-000000000001';
const actionOverdueId = '50000000-0000-4000-8000-000000000001';
const actionReviewId = '50000000-0000-4000-8000-000000000002';
const actionProgressId = '50000000-0000-4000-8000-000000000003';
const actionDoneId = '50000000-0000-4000-8000-000000000004';

const baseIndicators = {
  organizationId: orgId,
  organization: { id: orgId, name: 'Empresa Sintética NR-01', isActive: true },
  generatedAt: '2026-11-24T12:00:00.000Z',
  referenceDate: '2026-11-24',
  timeZone: 'America/Sao_Paulo',
  filters: { unitId: null, sectorId: null },
  structure: {
    units: { total: 1, active: 1, inactive: 0 },
    sectors: { total: 1, active: 1, inactive: 0 },
    employees: { total: 12, active: 12, inactive: 0 },
  },
  options: {
    units: [{ id: unitId, name: 'Unidade Centro' }],
    sectors: [{ id: sectorId, name: 'Operações', unitId }],
  },
  risks: {
    total: 1,
    classified: 0,
    unclassified: 1,
    levels: [],
    units: [{ unitId, name: 'Unidade Centro', count: 1, unclassified: 1, levels: [] }],
  },
  actions: {
    total: 4,
    planned: 1,
    inProgress: 1,
    implemented: 2,
    cancelled: 0,
    open: 2,
    overdue: 1,
    technicalPending: 1,
    closed: 1,
    effective: 1,
  },
  priorities: {
    page: 1,
    pageSize: 5,
    total: 2,
    items: [
      {
        actionId: actionOverdueId,
        title: 'Rebalancear turnos noturnos',
        riskId,
        unitId,
        sectorId,
        dueDate: '2026-11-10',
        kind: 'OVERDUE',
      },
      {
        actionId: actionReviewId,
        title: 'Revisar pausas com parecer desatualizado',
        riskId,
        unitId,
        sectorId,
        dueDate: '2026-11-18',
        kind: 'TECHNICAL_PENDING',
      },
    ],
  },
};

const sampleItems = [
  {
    id: `action:${actionOverdueId}`,
    origin: 'ACTION' as const,
    originId: actionOverdueId,
    riskId,
    actionId: actionOverdueId,
    title: 'Rebalancear turnos noturnos',
    contextLabel: 'Fator: Sobrecarga de jornada',
    unit: { id: unitId, name: 'Unidade Centro' },
    sector: { id: sectorId, name: 'Operações' },
    status: 'PENDING' as const,
    primaryRule: 'ACTION_OVERDUE' as const,
    rules: ['ACTION_OVERDUE' as const, 'ACTION_MISSING_EVIDENCE' as const],
    reasonSummary: 'Ação em aberto com prazo vencido em 10/11/2026 e sem evidência ativa anexada.',
    missingInfo: ['Sem evidência ativa anexada para comprovar andamento da ação vencida.'],
    dueDate: '2026-11-10',
    isOverdue: true,
    responsible: { name: 'Coordenação Operacional', kind: 'EXTERNAL' as const, isActive: true },
    evidence: { activeCount: 0, archivedCount: 0 },
    updatedAt: '2026-11-20T10:00:00.000Z',
  },
  {
    id: `action:${actionReviewId}`,
    origin: 'ACTION' as const,
    originId: actionReviewId,
    riskId,
    actionId: actionReviewId,
    title: 'Revisar pausas com parecer desatualizado',
    contextLabel: 'Fator: Sobrecarga de jornada',
    unit: { id: unitId, name: 'Unidade Centro' },
    sector: { id: sectorId, name: 'Operações' },
    status: 'NEEDS_REVIEW' as const,
    primaryRule: 'ACTION_EFFICACY_REVIEW_REQUIRED' as const,
    rules: ['ACTION_EFFICACY_REVIEW_REQUIRED' as const],
    reasonSummary:
      'Parecer de eficácia exige revisão porque uma evidência selecionada foi arquivada.',
    missingInfo: [],
    dueDate: '2026-11-18',
    isOverdue: false,
    responsible: { name: 'Camila SST', kind: 'USER' as const, isActive: true },
    evidence: { activeCount: 0, archivedCount: 1 },
    updatedAt: '2026-11-21T10:00:00.000Z',
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
    sector: { id: sectorId, name: 'Operações' },
    status: 'AWAITING_VALIDATION' as const,
    primaryRule: 'RISK_AWAITING_EVALUATION' as const,
    rules: ['RISK_AWAITING_EVALUATION' as const],
    reasonSummary: 'Risco registrado aguardando avaliação técnica vigente.',
    missingInfo: ['Sem avaliação técnica vigente para classificar nível e prioridade.'],
    dueDate: null,
    isOverdue: false,
    responsible: null,
    evidence: null,
    updatedAt: '2026-11-19T10:00:00.000Z',
  },
  {
    id: `action:${actionProgressId}`,
    origin: 'ACTION' as const,
    originId: actionProgressId,
    riskId,
    actionId: actionProgressId,
    title: 'Estabelecer pausas assistidas',
    contextLabel: 'Fator: Sobrecarga de jornada',
    unit: { id: unitId, name: 'Unidade Centro' },
    sector: { id: sectorId, name: 'Operações' },
    status: 'IN_PROGRESS' as const,
    primaryRule: null,
    rules: [],
    reasonSummary: 'Medida em execução dentro do prazo registrado (15/12/2026).',
    missingInfo: [],
    dueDate: '2026-12-15',
    isOverdue: false,
    responsible: { name: 'João Gestor', kind: 'USER' as const, isActive: true },
    evidence: { activeCount: 1, archivedCount: 0 },
    updatedAt: '2026-11-22T10:00:00.000Z',
  },
  {
    id: `action:${actionDoneId}`,
    origin: 'ACTION' as const,
    originId: actionDoneId,
    riskId,
    actionId: actionDoneId,
    title: 'Ajustar comunicação de escalas',
    contextLabel: 'Fator: Sobrecarga de jornada',
    unit: { id: unitId, name: 'Unidade Centro' },
    sector: { id: sectorId, name: 'Operações' },
    status: 'COMPLETED' as const,
    primaryRule: null,
    rules: [],
    reasonSummary: 'Execução, parecer de eficácia e encerramento técnico vigentes.',
    missingInfo: [],
    dueDate: '2026-11-05',
    isOverdue: false,
    responsible: { name: 'Camila SST', kind: 'USER' as const, isActive: true },
    evidence: { activeCount: 1, archivedCount: 0 },
    updatedAt: '2026-11-23T10:00:00.000Z',
  },
];

function buildPendenciesPayload(params: URLSearchParams) {
  const status = params.get('status');
  const rule = params.get('rule');
  const origin = params.get('origin');
  const filtered = sampleItems.filter((item) => {
    if (status && item.status !== status) return false;
    if (origin && item.origin !== origin) return false;
    if (rule && !item.rules.includes(rule as never)) return false;
    return true;
  });
  return {
    organizationId: orgId,
    organization: baseIndicators.organization,
    generatedAt: baseIndicators.generatedAt,
    referenceDate: baseIndicators.referenceDate,
    timeZone: baseIndicators.timeZone,
    ruleSet: {
      version: 'nr01-operational-v1',
      validationStatus: 'OPERATIONAL_FIRST_CUT',
      scopeNote:
        'Primeiro corte operacional baseado nas datas, vínculos, evidências e estados já registrados. Regras normativas, prazos legais e classificação de conformidade NR-01 dependem de validação técnica por SST.',
    },
    filters: {
      unitId: params.get('unitId'),
      sectorId: params.get('sectorId'),
      status,
      rule,
      origin,
    },
    summary: {
      total: 5,
      openPendencies: 4,
      byStatus: {
        PENDING: 1,
        IN_PROGRESS: 1,
        AWAITING_VALIDATION: 1,
        NEEDS_REVIEW: 1,
        COMPLETED: 1,
      },
      byOrigin: { RISK: 1, ACTION: 4 },
      signals: {
        overdueActions: 1,
        missingEvidence: 1,
        risksWithoutAction: 0,
        awaitingEvaluationOrValidation: 1,
        needsReview: 1,
      },
    },
    page: 1,
    pageSize: 10,
    total: filtered.length,
    items: filtered,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '#/';
});

it('exibe os cinco estados NR-01, faltas de informação, filtros, links de origem e descarta dados após revogação', async () => {
  window.location.hash = '#/painel?area=pendencias';
  let revoked = false;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (revoked) {
      return Response.json(
        {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Acesso revogado ou empresa indisponível.',
          requestId: orgId,
          timestamp: '2026-11-24T12:05:00.000Z',
        },
        { status: 404 },
      );
    }
    if (path === `/organizations/${orgId}/management-indicators`) {
      return Response.json(baseIndicators);
    }
    if (path === `/organizations/${orgId}/management-indicators/nr01-pendencies`) {
      return Response.json(buildPendenciesPayload(url.searchParams));
    }
    if (path === `/organizations/${orgId}/journey`) {
      return Response.json({
        organizationId: orgId,
        demo: false,
        structure: 'READY',
        preparation: { employees: true, groups: true },
        instruments: 'READY',
        collection: 'CLOSED',
        result: 'READY',
        actions: 'READY',
      });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);

  const user = userEvent.setup();
  render(<ManagementDashboard organizationId={orgId} onExpire={vi.fn()} canReadEmployees />);

  const areaNav = screen.getByRole('navigation', { name: 'Áreas do painel' });
  expect(within(areaNav).getByRole('link', { name: 'Pendências NR-01' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await expect(
    screen.findByRole('heading', { name: 'Pendências da NR-01' }),
  ).resolves.toBeVisible();
  expect(
    screen.getByText(/Regras normativas, prazos legais e classificação de conformidade NR-01/i),
  ).toBeVisible();

  const table = screen.getByRole('table', { name: /Pendências da NR-01/i });
  // Os 5 estados textuais visíveis na tabela e nos botões de resumo
  for (const label of [
    'Pendente',
    'Em andamento',
    'Aguardando validação',
    'Necessita revisão',
    'Concluído',
  ]) {
    expect(within(table).getByText(label)).toBeVisible();
  }

  // Indicação explícita de falta de informação para avaliar
  expect(
    within(table).getByText(
      /Sem evidência ativa anexada para comprovar andamento da ação vencida/i,
    ),
  ).toBeVisible();
  expect(
    within(table).getByText(/Sem avaliação técnica vigente para classificar nível e prioridade/i),
  ).toBeVisible();

  // Links de origem preservam returnTo para o painel de pendências
  const actionLink = within(table).getByRole('link', { name: 'Rebalancear turnos noturnos' });
  expect(actionLink).toHaveAttribute(
    'href',
    expect.stringContaining(`#/acoes/${actionOverdueId}?returnTo=`),
  );
  const riskLink = within(table).getByRole('link', { name: 'Sobrecarga de jornada' });
  expect(riskLink).toHaveAttribute(
    'href',
    expect.stringContaining(`#/inventario/${riskId}?returnTo=`),
  );

  // Filtro por regra (Falta de evidência) reduz a tabela mantendo o foco no select e o resumo total
  const ruleSelect = screen.getByLabelText('Regra operacional');
  ruleSelect.focus();
  await user.selectOptions(ruleSelect, 'ACTION_MISSING_EVIDENCE');
  await waitFor(() => {
    expect(
      within(screen.getByRole('table', { name: /Pendências da NR-01/i })).getAllByRole('row'),
    ).toHaveLength(2);
  });
  expect(document.activeElement).toBe(screen.getByLabelText('Regra operacional'));

  // Simular revogação durante a sessão interagindo DENTRO do painel NR-01 -> dados e escopo do pai desaparecem
  revoked = true;
  await user.selectOptions(screen.getByLabelText('Origem'), 'RISK');
  await waitFor(() => {
    expect(screen.queryByRole('table', { name: /Pendências da NR-01/i })).toBeNull();
  });
  expect(screen.queryByText('EMPRESA EM FOCO')).toBeNull();
  expect(screen.queryByLabelText('Unidade')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
});

it('permite filtrar por botões de estado com aria-pressed e devolve retorno ao painel a partir do detalhe de risco', async () => {
  window.location.hash = '#/painel?area=pendencias';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace('/api/v1', '');
      if (path === `/organizations/${orgId}/management-indicators`) {
        return Response.json(baseIndicators);
      }
      if (path === `/organizations/${orgId}/management-indicators/nr01-pendencies`) {
        return Response.json(buildPendenciesPayload(url.searchParams));
      }
      return Response.json({}, { status: 404 });
    }),
  );

  const user = userEvent.setup();
  render(<ManagementDashboard organizationId={orgId} onExpire={vi.fn()} />);

  await expect(
    screen.findByRole('heading', { name: 'Pendências da NR-01' }),
  ).resolves.toBeVisible();
  const statusGroup = screen.getByRole('group', { name: 'Filtrar por situação NR-01' });
  const needsReviewBtn = within(statusGroup).getByRole('button', { name: /Necessita revisão/ });
  expect(needsReviewBtn).toHaveAttribute('aria-pressed', 'false');

  await user.click(needsReviewBtn);
  await waitFor(() => {
    expect(needsReviewBtn).toHaveAttribute('aria-pressed', 'true');
  });
  expect(window.location.hash).toContain('nrStatus=NEEDS_REVIEW');

  await user.click(screen.getByRole('button', { name: 'Limpar filtros da fila' }));
  await waitFor(() => {
    expect(needsReviewBtn).toHaveAttribute('aria-pressed', 'false');
  });
  cleanup();

  // Verificar retorno ao painel no RiskDetail quando aberto a partir das pendências NR-01
  const returnHref = '#/painel?area=pendencias&nrOrigin=RISK';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'Registro indisponível',
          requestId: orgId,
          timestamp: '2026-11-24T12:00:00.000Z',
        },
        { status: 404 },
      ),
    ),
  );
  render(
    <RiskDetail
      organizationId={orgId}
      id={riskId}
      canWrite={false}
      canEvaluate={false}
      query={`returnTo=${encodeURIComponent(returnHref)}`}
      onExpire={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  const backLink = await screen.findByRole('link', { name: 'Voltar ao painel' });
  expect(backLink).toHaveAttribute('href', returnHref);
});
