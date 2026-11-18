import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@renr/contracts';
import { AssessmentWorkspace } from './components/assessments/AssessmentWorkspace';

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organizationId = uuid(1);
const reference = {
  id: uuid(2),
  name: 'Coleta de outubro',
  startsAt: '2026-10-01T12:00:00Z',
  endsAt: '2026-10-12T12:00:00Z',
  closedAt: '2026-10-11T12:00:00Z',
};
const current = {
  id: uuid(3),
  name: 'Coleta de novembro',
  startsAt: '2026-11-01T12:00:00Z',
  endsAt: '2026-11-12T12:00:00Z',
  closedAt: '2026-11-11T12:00:00Z',
};
const session: SessionResponse = {
  user: { id: uuid(4), name: 'Gestora fictícia', email: 'gestora@exemplo.test' },
  memberships: [{ organizationId, organizationName: 'Empresa fictícia', role: 'READER' }],
  activeOrganizationId: organizationId,
  expiresAt: '2099-12-01T12:00:00Z',
};
const scope = {
  unitId: uuid(5),
  unitName: 'Recife',
  sectorId: uuid(6),
  sectorName: 'Suporte',
  groupId: uuid(7),
  groupName: 'Equipe de suporte',
};
const measures = {
  implemented: 1,
  pending: 1,
  cancelled: 0,
  withoutSnapshot: 0,
  effective: 1,
  notEffective: 0,
  inconclusive: 0,
  withoutOpinion: 1,
  riskLevels: [],
  unclassifiedRisks: 0,
};
const json = (body: unknown) => new Response(JSON.stringify(body));
const request = vi.fn<typeof fetch>();
let comparison: object;
beforeEach(() => {
  window.history.replaceState(
    null,
    '',
    `/#/coletas?view=comparison&referenceCycleId=${reference.id}&currentCycleId=${current.id}&unitId=${scope.unitId}&sectorId=${scope.sectorId}`,
  );
  comparison = {
    organizationId,
    reference,
    current,
    scope,
    status: 'COMPARABLE',
    reasons: [],
    participation: {
      status: 'AVAILABLE',
      reference: 45,
      current: 60,
      difference: 15,
      direction: 'INCREASE',
    },
    factors: [
      {
        questionId: uuid(8),
        questionLabel: 'Pressão de tempo',
        optionId: uuid(9),
        optionLabel: 'Frequentemente',
        trend: { status: 'PROTECTED' },
      },
    ],
    operations: {
      source: 'GROUP_AT_PERIOD_CLOSE',
      reference: measures,
      current: measures,
      reassessmentTotal: 1,
      reassessments: [
        {
          id: uuid(10),
          riskId: uuid(11),
          riskLabel: 'Pressão de prazo',
          recordedAt: current.closedAt,
          referenceLevel: 'Alto',
          currentLevel: 'Médio',
          direction: 'IMPROVED',
          actionIds: [uuid(12)],
        },
      ],
      relatedActions: [
        {
          cycleId: current.id,
          riskId: uuid(11),
          riskLabel: 'Pressão de prazo',
          actionId: uuid(12),
          actionTitle: 'Revisar a fila de urgências',
          dueDate: '2026-11-25',
          status: 'PLANNED',
        },
      ],
    },
  };
  request.mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/assessment-comparison')) return json(comparison);
    if (path.endsWith('/auth/session-capabilities'))
      return json({ organizationId, canManageAccess: false, capabilities: [] });
    return json({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  vi.stubGlobal('fetch', request);
});

it('mantém o recorte da URL e mostra apenas a variação autorizada', async () => {
  render(<AssessmentWorkspace session={session} onExpire={vi.fn()} />);
  const panel = await screen.findByRole('region', { name: 'Comparativo gerencial' });
  expect(await within(panel).findByText('+15 p.p.')).toBeVisible();
  expect(within(panel).getByText('Variação protegida')).toBeVisible();
  expect(within(panel).getByText(/Melhora na classificação/)).toBeVisible();
  expect(within(panel).getByRole('link', { name: 'Revisar a fila de urgências' })).toHaveAttribute(
    'href',
    expect.stringContaining(`#/acoes/${uuid(12)}?`),
  );
  const action = within(panel).getByRole('link', { name: 'Abrir ação vinculada 1' });
  expect(new URLSearchParams(action.getAttribute('href')!.split('?')[1]).get('returnTo')).toBe(
    location.hash,
  );
  const summary = within(panel).getByRole('link', { name: 'Incluir no resumo executivo' });
  expect(summary).toHaveAttribute(
    'href',
    expect.stringContaining(`referenceCycleId=${reference.id}`),
  );
  expect(new URLSearchParams(summary.getAttribute('href')!.split('?')[1]).get('sectorId')).toBe(
    scope.sectorId,
  );
  expect(
    request.mock.calls.some(([input]) =>
      String(input).includes(
        `/assessment-comparison?referenceCycleId=${reference.id}&currentCycleId=${current.id}`,
      ),
    ),
  ).toBe(true);
});

it('explica incompatibilidade e omite as ações de emissão do comparativo', async () => {
  comparison = {
    ...comparison,
    status: 'INCOMPATIBLE',
    reasons: ['POLICY_VERSION'],
    scope: null,
    participation: { status: 'NOT_COMPARABLE' },
    factors: [],
    operations: null,
  };
  render(<AssessmentWorkspace session={session} onExpire={vi.fn()} />);
  const panel = await screen.findByRole('region', { name: 'Comparativo gerencial' });
  expect(await within(panel).findByText(/versões diferentes da política/i)).toBeVisible();
  expect(
    within(panel).queryByRole('link', { name: 'Incluir no resumo executivo' }),
  ).not.toBeInTheDocument();
  expect(within(panel).queryByText('+15 p.p.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Coletas da empresa' }));
  expect(location.hash).toContain(`sectorId=${scope.sectorId}`);
});
