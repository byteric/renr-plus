import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RiskContribution, RiskWorkspace } from '@renr/contracts';
import { RiskCollaborationPanel } from './components/risks/RiskCollaborationPanel';

const org = '10000000-0000-4000-8000-000000000001';
const riskId = '20000000-0000-4000-8000-000000000001';
const contribId = '30000000-0000-4000-8000-000000000001';
const revId = '40000000-0000-4000-8000-000000000001';
const userId = '50000000-0000-4000-8000-000000000001';
const now = '2026-11-24T12:00:00.000Z';

const baseRisk = {
  id: riskId,
  organizationId: org,
  assessmentGroupId: org,
  sectorId: org,
  unit: { id: org, name: 'Unidade Norte', isActive: true },
  sector: { id: org, name: 'Atendimento', isActive: true },
  factor: 'Sobrecarga cognitiva',
  description: 'Descrição coletiva.',
  exposureDescription: 'Contínua.',
  exposedGroupDescription: 'Equipe.',
  possibleHarms: 'Fadiga.',
  existingControls: 'Pausas.',
  sourceKind: 'TECHNICAL_RECORD' as const,
  sourceNote: 'Nota técnica.',
  diagnosticCycleId: null,
  status: 'REGISTERED' as const,
  version: 2,
  createdBy: { id: userId, name: 'Admin' },
  updatedBy: { id: userId, name: 'Admin' },
  createdAt: now,
  updatedAt: now,
  latestEvaluation: null,
  sourceLabel: 'Registro técnico',
  technicalEvaluationState: 'ABSENT' as const,
  latestTechnicalEvaluation: null,
  actionSummary: { total: 0, open: 0, overdue: 0 },
  pendingReasons: [] as RiskWorkspace['pendingReasons'],
};

const sampleContribution: RiskContribution = {
  id: contribId,
  organizationId: org,
  riskId,
  specialty: 'PSYCHOLOGY_ORGANIZATIONAL' as const,
  kind: 'PSYCHOSOCIAL_ANALYSIS' as const,
  status: 'ACTIVE' as const,
  visibility: 'RESTRICTED' as const,
  title: 'Análise psicossocial do turno',
  workFactors: 'Ritmo acelerado e metas cumulativas sem pausas previsíveis.',
  preventiveRecommendations: 'Reorganizar escala coletiva com pausas programadas.',
  nextStep: 'Alinhar recomendações com SST.',
  sourceRiskVersion: 2,
  version: 1,
  author: { id: userId, name: 'Beatriz Psicologia' },
  sharedAt: null,
  sharedBy: null,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  createdAt: now,
  updatedAt: now,
  attachments: [],
  revisions: [
    {
      id: revId,
      organizationId: org,
      riskId,
      contributionId: contribId,
      version: 1,
      event: 'CREATED' as const,
      visibility: 'RESTRICTED' as const,
      snapshot: {
        kind: 'PSYCHOSOCIAL_ANALYSIS' as const,
        title: 'Análise psicossocial do turno',
        workFactors: 'Ritmo acelerado e metas cumulativas sem pausas previsíveis.',
        preventiveRecommendations: 'Reorganizar escala coletiva com pausas programadas.',
        nextStep: 'Alinhar recomendações com SST.',
        status: 'ACTIVE' as const,
        visibility: 'RESTRICTED' as const,
      },
      changeReason: null,
      author: { id: userId, name: 'Beatriz Psicologia' },
      createdAt: now,
    },
  ],
  permissions: {
    canEdit: true,
    canShare: true,
    canArchive: true,
    canAttach: true,
    unavailableReason: null,
  },
};

afterEach(() => vi.restoreAllMocks());

it('exibe trava de homologação quando writesEnabled=false e oculta controles de gravação', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          writesEnabled: false,
          viewerSpecialties: ['PSYCHOLOGY_ORGANIZATIONAL'],
          items: [],
          total: 0,
          page: 1,
          pageSize: 50,
        }),
      ),
    ),
  );

  render(
    <RiskCollaborationPanel
      organizationId={org}
      risk={baseRisk}
      disabled={false}
      refreshKey={0}
      onExpire={() => undefined}
      onUnavailable={() => undefined}
    />,
  );

  expect(
    await screen.findByText(/Gravação de contribuições desabilitada neste ambiente/i),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Nova contribuição técnica' }),
  ).not.toBeInTheDocument();
});

it('permite criar e compartilhar contribuição quando writesEnabled=true, exibindo autoria, especialidade, versão e histórico', async () => {
  let items: RiskContribution[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    if (path.endsWith('/technical-contributions') && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({
          writesEnabled: true,
          viewerSpecialties: ['PSYCHOLOGY_ORGANIZATIONAL'],
          items,
          total: items.length,
          page: 1,
          pageSize: 50,
        }),
      );
    }
    if (path.endsWith('/technical-contributions') && init?.method === 'POST') {
      items = [sampleContribution];
      return new Response(JSON.stringify(sampleContribution), { status: 201 });
    }
    if (path.endsWith(`/technical-contributions/${contribId}/share`) && init?.method === 'POST') {
      const shared = {
        ...sampleContribution,
        visibility: 'SHARED' as const,
        version: 2,
        sharedAt: now,
        sharedBy: { id: userId, name: 'Beatriz Psicologia' },
        permissions: { ...sampleContribution.permissions, canShare: false },
      };
      items = [shared];
      return new Response(JSON.stringify(shared), { status: 201 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);

  const user = userEvent.setup();
  render(
    <RiskCollaborationPanel
      organizationId={org}
      risk={baseRisk}
      disabled={false}
      refreshKey={0}
      onExpire={() => undefined}
      onUnavailable={() => undefined}
    />,
  );

  await user.click(await screen.findByRole('button', { name: 'Nova contribuição técnica' }));
  fireEvent.change(screen.getByLabelText('Título da contribuição'), {
    target: { value: 'Análise psicossocial do turno' },
  });
  fireEvent.change(screen.getByLabelText('Fatores psicossociais do trabalho'), {
    target: { value: 'Ritmo acelerado e metas cumulativas sem pausas previsíveis.' },
  });
  fireEvent.change(screen.getByLabelText('Recomendações preventivas coletivas'), {
    target: { value: 'Reorganizar escala coletiva com pausas programadas.' },
  });
  await user.click(screen.getByRole('button', { name: 'Salvar contribuição' }));

  expect(await screen.findByText('Análise psicossocial do turno')).toBeVisible();
  expect(screen.getByText(/^Psicologia Organizacional$/)).toBeVisible();
  expect(screen.getByText(/Autoria: Beatriz Psicologia/)).toBeVisible();
  expect(screen.getByText('Reservado à especialidade')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Compartilhar com equipe técnica' }));
  fireEvent.change(screen.getByLabelText('Justificativa do compartilhamento'), {
    target: { value: 'Síntese coletiva pronta para alinhamento com SST.' },
  });
  await user.click(screen.getByRole('button', { name: 'Confirmar compartilhamento' }));

  await waitFor(() => expect(screen.getByText('Compartilhado')).toBeVisible());
});
