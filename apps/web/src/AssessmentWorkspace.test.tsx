import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';
import type { AssessmentCycle } from '@renr/contracts';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const session = {
  user: { id: userId, name: 'Gestora sintética', email: 'assessment@example.test' },
  memberships: [{ organizationId, organizationName: 'Empresa sintética', role: 'ADMIN' as const }],
  activeOrganizationId: organizationId,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetcher = vi.fn<typeof fetch>();
const cycle: AssessmentCycle = {
  id: '30000000-0000-4000-8000-000000000001',
  organizationId,
  name: 'Coleta coletiva encerrada',
  assessmentGroupId: '40000000-0000-4000-8000-000000000001',
  assessmentGroupName: 'Grupo de atendimento',
  sectorId: '50000000-0000-4000-8000-000000000001',
  sectorName: 'Atendimento',
  unitId: '60000000-0000-4000-8000-000000000001',
  unitName: 'Unidade Recife',
  instrumentId: '70000000-0000-4000-8000-000000000001',
  instrumentTitle: 'Organização das atividades',
  instrumentVersionId: '80000000-0000-4000-8000-000000000001',
  instrumentVersion: 2,
  usageMode: 'DEMONSTRATION',
  policyVersionId: '90000000-0000-4000-8000-000000000001',
  policyVersion: 1,
  minimumResponses: 5,
  status: 'CLOSED',
  revision: 3,
  startsAt: '2026-10-20T12:00:00.000Z',
  endsAt: '2026-10-24T12:00:00.000Z',
  createdAt: '2026-10-19T12:00:00.000Z',
  updatedAt: '2026-10-24T12:00:00.000Z',
  closedAt: '2026-10-24T12:00:00.000Z',
};
beforeEach(() => {
  window.history.replaceState(null, '', '/#/coletas');
  fetcher.mockReset();
  fetcher.mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/session-capabilities'))
      return response({ organizationId, canManageAccess: true, capabilities: [] });
    return response({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('abre as coletas versionadas e distingue ausência de ciclos de ausência de risco', async () => {
  render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Coletas' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Coletas' })).toHaveAttribute('href', '#/coletas');
  expect(await screen.findByText('Nenhuma coleta cadastrada nesta empresa.')).toBeInTheDocument();
  expect(screen.queryByText(/zero risco/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nova coleta' })).toBeEnabled();
});

it('mostra supressão e a versão fixa do ciclo sem transformar dados protegidos em zero', async () => {
  window.history.replaceState(null, '', `/#/coletas?cycle=${cycle.id}`);
  fetcher.mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/session-capabilities'))
      return response({ organizationId, canManageAccess: true, capabilities: [] });
    if (path.endsWith('/results'))
      return response({
        organizationId,
        instrumentVersionId: cycle.instrumentVersionId,
        policyVersionId: cycle.policyVersionId,
        minimumResponses: 5,
        node: {
          id: cycle.id,
          name: cycle.name,
          nodeType: 'CYCLE',
          availability: 'SUPPRESSED',
          responseCount: null,
          questions: [],
          children: [],
        },
      });
    if (path.endsWith(`/${cycle.id}`)) return response(cycle);
    return response({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Resultado suprimido' })).toBeInTheDocument();
  expect(screen.getByText(/Organização das atividades.*v2/)).toBeInTheDocument();
  expect(screen.queryByText(/Envios consolidados:/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Editar coleta|Editar rascunho/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/zero risco/i)).not.toBeInTheDocument();
});
