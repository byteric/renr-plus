import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManagementDashboard } from './ManagementDashboard';

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const overview = {
  organizationId,
  generatedAt: '2026-10-17T12:00:00.000Z',
  totals: { total: 8, draft: 2, registered: 6, withEvaluation: 3, withoutEvaluation: 5 },
  units: [
    {
      kind: 'UNIT',
      unitId: organizationId,
      name: 'Unidade Recife',
      isActive: true,
      total: 8,
      draft: 2,
      registered: 6,
    },
  ],
};
const structure = {
  organization: { id: organizationId, name: 'Horizonte', isActive: true },
  units: { total: 1, active: 1, inactive: 0 },
  sectors: { total: 2, active: 2, inactive: 0 },
  unitsWithoutSectors: 0,
  generatedAt: '2026-10-16T12:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
const onExpire = vi.fn();
const registrationPoints = Array.from({ length: 30 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 8, 18 + index)).toISOString().slice(0, 10),
  count: index === 29 ? 4 : 0,
}));
const registrations = {
  organizationId,
  generatedAt: overview.generatedAt,
  timeZone: 'America/Sao_Paulo',
  fromDate: '2026-09-18',
  toDate: '2026-10-17',
  days: 30,
  total: 4,
  points: registrationPoints,
};
let registrationHandler: (url: string) => Response;
let actionHandler: () => Response;
beforeEach(() => {
  actionHandler = () =>
    json({
      organizationId,
      generatedAt: overview.generatedAt,
      referenceDate: '2026-10-17',
      timeZone: 'America/Sao_Paulo',
      totals: {
        total: 0,
        planned: 0,
        inProgress: 0,
        implemented: 0,
        cancelled: 0,
        open: 0,
        overdue: 0,
      },
    });
  registrationHandler = (url) => {
    const days = Number(new URL(url, 'http://localhost').searchParams.get('days') ?? '30');
    const points = registrationPoints.slice(-days);
    return json({ ...registrations, days, fromDate: points[0]!.date, points });
  };
  fetchMock
    .mockReset()
    .mockImplementation(async (url) =>
      json(String(url).endsWith('/risk-overview') ? overview : structure),
    );
  onExpire.mockReset();
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    String(url).endsWith('/action-overview')
      ? Promise.resolve(actionHandler())
      : String(url).includes('/risk-registrations')
        ? Promise.resolve(registrationHandler(String(url)))
        : fetchMock(url, init),
  );
});
afterEach(() => vi.unstubAllGlobals());

it('apresenta medidas por estado e atraso real em links para o recorte correto', async () => {
  actionHandler = () =>
    json({
      organizationId,
      generatedAt: overview.generatedAt,
      referenceDate: '2026-10-17',
      timeZone: 'America/Sao_Paulo',
      totals: {
        total: 10,
        planned: 4,
        inProgress: 3,
        implemented: 2,
        cancelled: 1,
        open: 7,
        overdue: 2,
      },
    });
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  const metrics = await screen.findByRole('list', { name: 'Indicadores das ações' });
  expect(within(metrics).getByRole('link', { name: /Atrasadas.*2/ })).toHaveAttribute(
    'href',
    '#/acoes?page=1&overdue=true',
  );
  expect(within(metrics).getByRole('link', { name: /Em execução.*3/ })).toHaveAttribute(
    'href',
    '#/acoes?page=1&status=IN_PROGRESS',
  );
});

it('mostra série diária real, período e fuso, incluindo dias sem cadastros', async () => {
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(await screen.findByRole('heading', { name: 'Cadastros de riscos por dia' })).toBeVisible();
  expect(await screen.findByRole('img', { name: /4 cadastros.*America\/Sao_Paulo/ })).toBeVisible();
  await userEvent.click(screen.getByText('Ver cadastros por dia', { exact: true }));
  const table = screen.getByRole('table', { name: 'Cadastros diários de riscos' });
  expect(within(table).getAllByRole('row')).toHaveLength(31);
  expect(within(table).getAllByRole('cell', { name: '0' })).toHaveLength(29);
  await userEvent.selectOptions(screen.getByLabelText('Período de cadastros'), '7');
  await waitFor(() =>
    expect(
      within(screen.getByRole('table', { name: 'Cadastros diários de riscos' })).getAllByRole(
        'row',
      ),
    ).toHaveLength(8),
  );
  expect(screen.getByText(/inclui rascunhos, registrados e arquivados/i)).toBeVisible();
});

it('não representa a série de outra empresa como dados válidos e permite nova leitura', async () => {
  registrationHandler = () => json({ ...registrations, organizationId: otherId });
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(await screen.findByRole('button', { name: 'Atualizar série de cadastros' })).toBeVisible();
  expect(screen.queryByRole('img', { name: /cadastros entre/ })).not.toBeInTheDocument();
  registrationHandler = () => json(registrations);
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar série de cadastros' }));
  expect(await screen.findByRole('img', { name: /4 cadastros/ })).toBeVisible();
});

it('apresenta KPIs reais, gráficos reconciliados e filtros sem herdar estado anterior', async () => {
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(screen.getByText('Carregando indicadores do inventário…')).toBeVisible();
  const metrics = await screen.findByRole('list', { name: 'Indicadores do inventário' });
  expect(within(metrics).getByRole('link', { name: /Registros ativos.*8/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1',
  );
  expect(within(metrics).getByRole('link', { name: /Rascunhos.*2/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&status=DRAFT',
  );
  expect(within(metrics).getByRole('link', { name: /Registrados.*6/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&status=REGISTERED',
  );
  expect(within(metrics).getByRole('link', { name: /Sem ficha.*5/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&evaluationPresence=WITHOUT',
  );
  expect(screen.getByRole('img', { name: /3 de 8/ })).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Horizonte' })).toBeVisible();
  expect(screen.getByText(/Snapshot do inventário/)).toBeVisible();
});

it('orienta seleção sem consultar dados quando não há empresa', () => {
  render(<ManagementDashboard organizationId={null} onExpire={onExpire} />);
  expect(screen.getByRole('link', { name: /Selecionar empresa/ })).toHaveAttribute(
    'href',
    '#/empresas',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it('mostra vazio real sem fabricar conclusão no anel', async () => {
  fetchMock.mockImplementation(async (url) =>
    json(
      String(url).endsWith('/risk-overview')
        ? {
            ...overview,
            totals: { total: 0, draft: 0, registered: 0, withEvaluation: 0, withoutEvaluation: 0 },
            units: [],
          }
        : structure,
    ),
  );
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(await screen.findByText('Sem registros')).toBeVisible();
  expect(screen.getByText('Seu inventário começa pelo primeiro registro')).toBeVisible();
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
});

it.each([
  ['inválido', {}],
  ['inconsistente', { ...overview, totals: { ...overview.totals, total: 99 } }],
  ['de outra empresa', { ...overview, organizationId: otherId }],
])('rejeita payload %s e não mostra KPIs', async (_name, body) => {
  fetchMock.mockImplementation(async (url) =>
    json(String(url).endsWith('/risk-overview') ? body : structure),
  );
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível/);
  expect(screen.queryByRole('list', { name: 'Indicadores do inventário' })).not.toBeInTheDocument();
});

it('oferece recuperação manual após falha do inventário', async () => {
  let failed = true;
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith('/risk-overview')
      ? failed
        ? json({}, 503)
        : json(overview)
      : json(structure),
  );
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/temporariamente indisponível/);
  failed = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('list', { name: 'Indicadores do inventário' })).toBeVisible();
});

it('expira sessão quando a API do inventário responde 401', async () => {
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith('/risk-overview') ? json({}, 401) : json(structure),
  );
  render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  await waitFor(() => expect(onExpire).toHaveBeenCalledOnce());
  expect(screen.queryByRole('list', { name: 'Indicadores do inventário' })).not.toBeInTheDocument();
});

it('limpa dados e aborta a consulta antiga imediatamente ao trocar de empresa', async () => {
  const view = render(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  await screen.findByRole('list', { name: 'Indicadores do inventário' });
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation((url) =>
    String(url).endsWith('/risk-overview')
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve(
          json({ ...structure, organization: { ...structure.organization, id: otherId } }),
        ),
  );
  view.rerender(<ManagementDashboard organizationId={otherId} onExpire={onExpire} />);
  expect(screen.queryByRole('list', { name: 'Indicadores do inventário' })).not.toBeInTheDocument();
  expect(screen.getByText('Carregando indicadores do inventário…')).toBeVisible();
  const call = fetchMock.mock.calls.find(
    ([url]) => String(url).includes(otherId) && String(url).endsWith('/risk-overview'),
  )!;
  const signal = call[1]?.signal;
  const resolvePrevious = resolve;
  view.rerender(<ManagementDashboard organizationId={organizationId} onExpire={onExpire} />);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolvePrevious(json({ ...overview, organizationId: otherId })));
  expect(screen.queryByRole('list', { name: 'Indicadores do inventário' })).not.toBeInTheDocument();
  view.unmount();
});
