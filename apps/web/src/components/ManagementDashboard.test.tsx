import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ManagementIndicators } from '@renr/contracts';
import { ManagementDashboard } from './ManagementDashboard';

const organizationId = '10000000-0000-4000-8000-000000000001';
const unitId = '10000000-0000-4000-8000-000000000002';
const sectorId = '10000000-0000-4000-8000-000000000003';
const actionId = '10000000-0000-4000-8000-000000000004';
const methodVersionId = '10000000-0000-4000-8000-000000000005';
const otherId = '10000000-0000-4000-8000-000000000006';
const level = {
  methodVersionId,
  methodName: 'Matriz',
  methodVersion: 1,
  key: 'HIGH',
  label: 'Alto',
  count: 1,
};
const snapshot: ManagementIndicators = {
  organizationId,
  organization: { id: organizationId, name: 'Horizonte', isActive: true },
  generatedAt: '2026-10-17T12:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
  referenceDate: '2026-10-17',
  filters: { unitId: null, sectorId: null },
  structure: {
    units: { total: 1, active: 1, inactive: 0 },
    sectors: { total: 1, active: 1, inactive: 0 },
    employees: { total: 2, active: 2, inactive: 0 },
  },
  options: {
    units: [{ id: unitId, name: 'Recife' }],
    sectors: [{ id: sectorId, unitId, name: 'Desenvolvimento' }],
  },
  risks: {
    total: 3,
    classified: 1,
    unclassified: 2,
    levels: [level],
    units: [{ unitId, name: 'Recife', count: 3, unclassified: 2, levels: [level] }],
  },
  actions: {
    total: 3,
    planned: 1,
    inProgress: 1,
    implemented: 1,
    cancelled: 0,
    open: 2,
    overdue: 1,
    technicalPending: 0,
    closed: 1,
    effective: 1,
  },
  priorities: {
    page: 1,
    pageSize: 5,
    total: 1,
    items: [
      {
        actionId,
        unitId,
        sectorId,
        riskId: organizationId,
        title: 'Revisar plantões',
        dueDate: '2026-10-16',
        kind: 'OVERDUE',
      },
    ],
  },
};
const history = {
  organizationId,
  generatedAt: snapshot.generatedAt,
  timeZone: snapshot.timeZone,
  filters: snapshot.filters,
  from: '2026-10-11',
  to: '2026-10-17',
  points: Array.from({ length: 7 }, (_, index) => ({
    date: '2026-10-' + (11 + index),
    evaluations: index === 6 ? 1 : 0,
    implementations: 0,
    closures: 0,
  })),
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const onExpire = vi.fn();
function mount(hash = '#/painel', canReadEmployees = false) {
  window.history.replaceState(null, '', hash);
  return render(
    <ManagementDashboard
      organizationId={organizationId}
      onExpire={onExpire}
      canReadEmployees={canReadEmployees}
    />,
  );
}
const nav = () => screen.getByRole('navigation', { name: 'Áreas do painel' });
beforeEach(() => {
  onExpire.mockReset();
  fetchMock.mockReset().mockImplementation(async (url) => {
    const parsed = new URL(String(url), 'http://localhost');
    return parsed.pathname.endsWith('/history')
      ? json(history)
      : json({
          ...snapshot,
          filters: {
            unitId: parsed.searchParams.get('unitId'),
            sectorId: parsed.searchParams.get('sectorId'),
          },
        });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it('abre apenas a Visão geral e navega por áreas mantendo o recorte na URL', async () => {
  mount('#/painel?unitId=' + unitId + '&area=invalida', true);
  expect(within(nav()).getByRole('link', { name: 'Visão geral' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await screen.findByRole('list', { name: 'Indicadores principais' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Estrutura cadastrada' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Evolução no período' })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/history'))).toBe(false);
  await userEvent.click(within(nav()).getByRole('link', { name: 'Estrutura' }));
  await waitFor(() => expect(window.location.hash).toContain('area=estrutura'));
  expect(window.location.hash).toContain('unitId=' + unitId);
  expect(within(nav()).getByRole('link', { name: 'Estrutura' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await screen.findByRole('link', { name: 'Colaboradores' })).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Indicadores principais' })).not.toBeInTheDocument();
});

it('envia o setor com a unidade e abre a lista de atrasos no mesmo recorte', async () => {
  mount();
  await userEvent.selectOptions(await screen.findByLabelText('Setor'), sectorId);
  await waitFor(() => expect(window.location.hash).toContain('unitId=' + unitId));
  expect(await screen.findByRole('link', { name: /Ações atrasadas.*1/ })).toHaveAttribute(
    'href',
    '#/acoes?unitId=' + unitId + '&sectorId=' + sectorId + '&page=1&overdue=true',
  );
  const link = screen.getByRole('link', { name: 'Revisar plantões' });
  expect(new URLSearchParams(link.getAttribute('href')?.split('?')[1]).get('returnTo')).toBe(
    window.location.hash,
  );
});

it('mantém o gráfico, a tabela e os links de nível ligados ao mesmo DTO', async () => {
  mount('#/painel?area=riscos&dias=7');
  const chart = await screen.findByRole('region', { name: 'Distribuição por nível' });
  const link = within(chart).getByRole('link', { name: 'Alto · Matriz v1 1' });
  expect(link).toHaveAttribute(
    'href',
    '#/inventario?page=1&methodVersionId=' + methodVersionId + '&levelKey=HIGH',
  );
  await userEvent.click(within(chart).getByText('Ver valores em tabela'));
  expect(within(chart).getByRole('row', { name: 'Alto · Matriz v1 1' })).toBeVisible();
  expect(
    await screen.findByRole('img', { name: 'Avaliações técnicas registradas: 1' }),
  ).toBeVisible();
  await userEvent.click(screen.getByText('Ver eventos por dia'));
  expect(screen.getByRole('row', { name: '17/10/2026 1' })).toBeVisible();
});

it('retém o retrato atual quando o histórico falha e permite reconsultar só a série', async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).includes('/history') ? json({}, 503) : json(snapshot),
  );
  mount('#/painel?area=acoes');
  expect(await screen.findByRole('alert')).toHaveTextContent('Histórico indisponível');
  expect(screen.getByRole('heading', { name: 'Ações preventivas' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Revisar plantões' })).toBeVisible();
  fetchMock.mockImplementation(async () => json({ ...history, points: [] }));
  await userEvent.click(screen.getByRole('button', { name: 'Tentar carregar histórico' }));
  expect(await screen.findByText(/Nenhum evento registrado/)).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('trata erro do retrato sem mostrar totais e informa expiração da sessão', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 401));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Serviço temporariamente indisponível',
  );
  expect(screen.queryByRole('list', { name: 'Indicadores principais' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(onExpire).toHaveBeenCalledOnce());
});

it('ignora resultados atrasados após a troca da empresa', async () => {
  let resolve!: (value: Response) => void;
  fetchMock
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(json({}, 403));
  const view = mount();
  view.rerender(<ManagementDashboard organizationId={otherId} onExpire={onExpire} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
  await act(async () => resolve(json(snapshot)));
  expect(screen.queryByRole('heading', { name: 'Horizonte' })).not.toBeInTheDocument();
});

it('omite controles e números do cadastro de colaboradores para leitores', async () => {
  fetchMock.mockImplementation(async () =>
    json({
      ...snapshot,
      structure: { ...snapshot.structure, employees: null },
    }),
  );
  mount('#/painel?area=estrutura');
  expect(await screen.findByRole('heading', { name: 'Estrutura cadastrada' })).toBeVisible();
  expect(screen.queryByText('Colaboradores')).not.toBeInTheDocument();
});

it('preserva filtros inválidos para validação e oferece recuperação sem mostrar totais globais', async () => {
  fetchMock.mockImplementation(async (url) => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    return query.get('unitId') === 'invalida' ? json({}, 400) : json(snapshot);
  });
  mount('#/painel?unitId=invalida');
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira os campos informados');
  expect(screen.queryByRole('list', { name: 'Indicadores principais' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Limpar filtros' })).toHaveAttribute('href', '#/painel');
});
