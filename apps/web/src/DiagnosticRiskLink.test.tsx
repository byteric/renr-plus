import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Diagnostics } from './components/Diagnostics';
import { RiskForm } from './components/risks/RiskForm';
import type { DiagnosticCycle, SessionResponse } from '@renr/contracts';
const id = '10000000-0000-4000-8000-000000000001';
const session: SessionResponse = {
  user: { id, name: 'Equipe', email: 'team@example.test' },
  memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' }],
  activeOrganizationId: id,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const cycle: DiagnosticCycle = {
  id,
  organizationId: id,
  name: 'Ciclo coletivo disponível',
  sectorId: id,
  sectorName: 'Setor exemplo',
  unitId: id,
  unitName: 'Unidade exemplo',
  instrumentVersionId: id,
  instrumentTitle: 'Instrumento demonstrativo',
  startsAt: '2026-10-16T12:00:00.000Z',
  endsAt: '2026-10-17T12:00:00.000Z',
  status: 'CLOSED',
  createdAt: '2026-10-16T12:00:00.000Z',
  closedAt: '2026-10-17T12:00:00.000Z',
};
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '/empresas';
});

it('restaura unidade, setor e ciclo de um link mesmo fora da primeira página das consultas', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url), 'http://localhost').pathname;
      const body = path.endsWith('/results')
        ? {
            cycleId: id,
            availability: 'AVAILABLE',
            responseCount: 5,
            minimumResponses: 5,
            questions: [],
          }
        : path.endsWith(`/diagnostic-cycles/${id}`)
          ? cycle
          : { items: [], total: 51, page: 1, pageSize: 50 };
      return new Response(JSON.stringify(body));
    }),
  );
  render(
    <RiskForm
      organizationId={id}
      initialQuery={`unitId=${id}&sectorId=${id}&diagnosticCycleId=${id}`}
      onExpire={() => undefined}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
  await screen.findByRole('option', { name: cycle.name });
  expect(screen.getByLabelText('Unidade', { exact: true })).toHaveValue(cycle.unitId);
  expect(screen.getByLabelText('Setor', { exact: true })).toHaveValue(cycle.sectorId);
  expect(screen.getByLabelText('Ciclo de origem', { exact: true })).toHaveValue(cycle.id);
});
it.each([true, false])(
  'abre a origem por URL e só oferece registro com consolidação disponível=%s',
  async (available) => {
    window.location.hash = `/diagnostico?cycleId=${id}`;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const path = new URL(String(url), 'http://localhost').pathname;
        const body = path.endsWith('/results')
          ? {
              cycleId: id,
              availability: available ? 'AVAILABLE' : 'INSUFFICIENT_RESPONSES',
              responseCount: available ? 5 : null,
              minimumResponses: 5,
              questions: [],
            }
          : path.endsWith(`/diagnostic-cycles/${id}`)
            ? cycle
            : { items: [cycle], total: 1, page: 1, pageSize: 50 };
        return new Response(JSON.stringify(body));
      }),
    );
    render(<Diagnostics session={session} onExpire={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Voltar aos ciclos' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: cycle.name, level: 2 })).toBeVisible();
    if (available) {
      const link = await screen.findByRole('link', {
        name: 'Criar registro de risco a partir deste ciclo',
      });
      expect(link).toHaveAttribute(
        'href',
        `#/inventario/novo?unitId=${id}&sectorId=${id}&diagnosticCycleId=${id}`,
      );
    } else
      expect(
        screen.queryByRole('link', { name: 'Criar registro de risco a partir deste ciclo' }),
      ).not.toBeInTheDocument();
  },
);

it('acompanha trocar o ciclo pela URL e voltar à lista sem manter o detalhe anterior', async () => {
  const second = {
    ...cycle,
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Segundo ciclo coletivo',
  };
  window.location.hash = `/diagnostico?cycleId=${id}`;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url), 'http://localhost').pathname;
      const current = path.includes(second.id) ? second : cycle;
      const body = path.endsWith('/results')
        ? {
            cycleId: current.id,
            availability: 'AVAILABLE',
            responseCount: 5,
            minimumResponses: 5,
            questions: [],
          }
        : /\/diagnostic-cycles\/[a-f\d-]+$/.test(path)
          ? current
          : { items: [cycle, second], total: 2, page: 1, pageSize: 50 };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<Diagnostics session={session} onExpire={() => undefined} />);
  await screen.findByRole('heading', { name: cycle.name, level: 2 });
  await act(async () => {
    window.location.hash = `/diagnostico?cycleId=${second.id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await screen.findByRole('heading', { name: second.name, level: 2 });
  expect(screen.queryByRole('heading', { name: cycle.name, level: 2 })).not.toBeInTheDocument();
  await act(async () => {
    window.location.hash = '/diagnostico';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(await screen.findByRole('button', { name: `Ver ciclo ${second.name}` })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Voltar aos ciclos' })).not.toBeInTheDocument();
});
