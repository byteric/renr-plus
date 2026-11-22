import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { DiagnosticCycle } from '@renr/contracts';
const id = '10000000-0000-4000-8000-000000000001';
const cycle: DiagnosticCycle = {
  id,
  organizationId: id,
  name: 'Ciclo exemplo',
  sectorId: id,
  sectorName: 'Equipe',
  unitId: id,
  unitName: 'Recife',
  instrumentVersionId: id,
  instrumentTitle: 'Demo',
  startsAt: '2026-10-12T12:00:00.000Z',
  endsAt: '2099-10-12T12:00:00.000Z',
  status: 'CLOSED',
  createdAt: '2026-10-12T12:00:00.000Z',
  closedAt: '2026-10-12T13:00:00.000Z',
};
afterEach(() => vi.unstubAllGlobals());
it.each(['Mais unidades', 'Mais setores'])(
  'não envia seleção invisível ao paginar com %s',
  async (pagination) => {
    window.location.hash = '/diagnostico';
    const nextId = '10000000-0000-4000-8000-000000000002';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      const address = new URL(String(url), 'http://localhost');
      const path = address.pathname;
      const secondPage = address.searchParams.get('page') === '2';
      let body: unknown = { items: [], total: 0, page: 1, pageSize: 50 };
      if (path.endsWith('/health'))
        body = { status: 'ok', service: 'renr-api', timestamp: cycle.createdAt };
      else if (path.endsWith('/auth/session'))
        body = {
          user: { id, name: 'Admin', email: 'admin@example.test' },
          memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' }],
          activeOrganizationId: id,
          expiresAt: cycle.endsAt,
        };
      else if (path.endsWith('/diagnostic-instrument')) body = instrument;
      else if (path.endsWith('/units'))
        body = {
          items: [
            {
              id: secondPage ? nextId : id,
              organizationId: id,
              name: secondPage ? 'Unidade da página 2' : 'Recife',
              code: null,
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 51,
          page: secondPage ? 2 : 1,
          pageSize: 50,
        };
      else if (path.endsWith('/sectors'))
        body = {
          items: [
            {
              id: secondPage ? nextId : id,
              organizationId: id,
              unitId: id,
              name: secondPage ? 'Setor da página 2' : 'Equipe',
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 51,
          page: secondPage ? 2 : 1,
          pageSize: 50,
        };
      else if (path.endsWith('/diagnostic-cycles') && options?.method === 'POST')
        body = { ...cycle, status: 'DRAFT', closedAt: null };
      return new Response(JSON.stringify(body));
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
    await screen.findByRole('option', { name: 'Recife' });
    fireEvent.change(screen.getByLabelText('Nome do ciclo'), {
      target: { value: 'Ciclo paginado' },
    });
    fireEvent.change(screen.getByLabelText('Unidade', { exact: true }), { target: { value: id } });
    await screen.findByRole('option', { name: 'Equipe' });
    fireEvent.change(screen.getByLabelText('Setor', { exact: true }), { target: { value: id } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-10-12T10:00' } });
    fireEvent.change(screen.getByLabelText('Término'), { target: { value: '2099-10-12T10:00' } });
    await userEvent.click(screen.getByRole('button', { name: pagination }));
    await screen.findByRole('option', {
      name: pagination === 'Mais unidades' ? 'Unidade da página 2' : 'Setor da página 2',
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Criar ciclo' }));
    expect(
      fetcher.mock.calls.filter(
        ([url, options]) =>
          String(url).endsWith('/diagnostic-cycles') && options?.method === 'POST',
      ),
    ).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe nome, setor');
  },
);
it('explica conflito do ciclo sem sugerir cadastro duplicado', async () => {
  window.location.hash = '/diagnostico';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url).split('?')[0] ?? '';
      if (path.endsWith('/open'))
        return new Response(
          JSON.stringify({
            statusCode: 409,
            code: 'CONFLICT',
            message: 'internal',
            requestId: id,
            timestamp: cycle.createdAt,
          }),
          { status: 409 },
        );
      const body = path.endsWith('/health')
        ? { status: 'ok', service: 'renr-api', timestamp: cycle.createdAt }
        : path.endsWith('/auth/session')
          ? {
              user: { id, name: 'Admin', email: 'admin@example.test' },
              memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' }],
              activeOrganizationId: id,
              expiresAt: cycle.endsAt,
            }
          : path.endsWith('/results')
            ? {
                cycleId: id,
                availability: 'CYCLE_OPEN',
                responseCount: null,
                minimumResponses: 5,
                questions: [],
              }
            : path.endsWith(`/diagnostic-cycles/${id}`)
              ? { ...cycle, status: 'DRAFT', closedAt: null }
              : {
                  items: [{ ...cycle, status: 'DRAFT', closedAt: null }],
                  total: 1,
                  page: 1,
                  pageSize: 50,
                };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Ver ciclo Ciclo exemplo' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir ciclo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/estado atual do ciclo/i);
  expect(screen.getByRole('alert')).not.toHaveTextContent('cadastro');
});
const instrument = {
  id,
  organizationId: id,
  title: 'Instrumento fictício',
  version: 1,
  status: 'PUBLISHED',
  isDemo: true,
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    label: `Pergunta ${index + 1}`,
    type: index < 3 ? 'SINGLE_CHOICE' : 'MULTIPLE_CHOICE',
    required: true,
    position: index + 1,
    options: [
      { id: '30000000-0000-4000-8000-000000000001', label: 'Sim', position: 1 },
      { id: '30000000-0000-4000-8000-000000000002', label: 'Não', position: 2 },
    ],
  })),
};
it('preserva criação no erro, abre ciclo, emite códigos separados e encerra sem reabrir', async () => {
  window.location.hash = '/diagnostico';
  let saved: DiagnosticCycle | null = null;
  let fail = true;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url).split('?')[0] ?? '';
    let body: unknown = { items: [], total: 0, page: 1, pageSize: 50 };
    if (path.endsWith('/health'))
      body = { status: 'ok', service: 'renr-api', timestamp: '2026-10-12T12:00:00.000Z' };
    else if (path.endsWith('/auth/session'))
      body = {
        user: { id, name: 'Admin', email: 'admin@example.test' },
        memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' }],
        activeOrganizationId: id,
        expiresAt: '2099-10-12T12:00:00.000Z',
      };
    else if (path.endsWith('/diagnostic-instrument')) body = instrument;
    else if (path.endsWith('/units'))
      body = {
        items: [
          {
            id,
            organizationId: id,
            name: 'Recife',
            code: null,
            isActive: true,
            createdAt: cycle.createdAt,
            updatedAt: cycle.createdAt,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    else if (path.endsWith('/sectors'))
      body = {
        items: [
          {
            id,
            organizationId: id,
            unitId: id,
            name: 'Equipe',
            isActive: true,
            createdAt: cycle.createdAt,
            updatedAt: cycle.createdAt,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    else if (path.endsWith('/diagnostic-cycles') && options?.method === 'POST') {
      if (fail) return new Response('{}', { status: 503 });
      const submitted: unknown = JSON.parse(String(options.body));
      expect(submitted).toMatchObject({
        name: 'Ciclo novo',
        sectorId: id,
        instrumentVersionId: id,
      });
      expect(submitted).toHaveProperty('startsAt', expect.stringMatching(/Z$/));
      saved = { ...cycle, name: 'Ciclo novo', status: 'DRAFT', closedAt: null };
      body = saved;
    } else if (path.endsWith('/results'))
      body = {
        cycleId: id,
        availability: saved?.status === 'CLOSED' ? 'INSUFFICIENT_RESPONSES' : 'CYCLE_OPEN',
        responseCount: null,
        minimumResponses: 5,
        questions: [],
      };
    else if (path.endsWith('/open')) {
      saved = { ...cycle, name: 'Ciclo novo', status: 'OPEN', closedAt: null };
      body = saved;
    } else if (path.endsWith('/close')) {
      saved = { ...cycle, name: 'Ciclo novo' };
      body = saved;
    } else if (path.endsWith('/participation-invites')) {
      expect(JSON.parse(String(options?.body))).toEqual({ count: 1 });
      body = {
        cycleId: id,
        participationPath: '/#/participar',
        invites: [{ code: 'a'.repeat(43), expiresAt: cycle.endsAt }],
      };
    } else if (path.endsWith(`/diagnostic-cycles/${id}`)) body = saved;
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  await screen.findByText(/Instrumento fictício/);
  await user.type(screen.getByLabelText('Nome do ciclo'), 'Ciclo novo');
  await user.selectOptions(screen.getByLabelText('Unidade'), id);
  await waitFor(() => expect(screen.getByRole('option', { name: 'Equipe' })).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText('Setor'), id);
  fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-10-12T09:00' } });
  fireEvent.change(screen.getByLabelText('Término'), { target: { value: '2099-10-12T09:00' } });
  await user.click(screen.getByRole('button', { name: 'Criar ciclo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(screen.getByLabelText('Nome do ciclo')).toHaveValue('Ciclo novo');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Criar ciclo' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir ciclo' }));
  await user.click(await screen.findByRole('button', { name: 'Emitir convites' }));
  expect(await screen.findByLabelText('Código 1')).toHaveValue('a'.repeat(43));
  expect(screen.getByText(/http:.*\/#\/participar/)).not.toHaveTextContent('a'.repeat(43));
  await user.click(screen.getByRole('button', { name: 'Encerrar ciclo' }));
  expect(await screen.findByText(/Contagens não são exibidas/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Abrir ciclo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Emitir convites' })).not.toBeInTheDocument();
});
it('perfil leitor consulta ciclo e agregados sem controles administrativos', async () => {
  window.location.hash = '/diagnostico';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url).split('?')[0] ?? '';
      const body = path.endsWith('/health')
        ? { status: 'ok', service: 'renr-api', timestamp: '2026-10-12T12:00:00.000Z' }
        : path.endsWith('/auth/session')
          ? {
              user: { id, name: 'Leitor', email: 'reader@example.test' },
              memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'READER' }],
              activeOrganizationId: id,
              expiresAt: '2099-10-12T12:00:00.000Z',
            }
          : path.endsWith('/results')
            ? {
                cycleId: id,
                availability: 'AVAILABLE',
                responseCount: 5,
                minimumResponses: 5,
                questions: [
                  {
                    id,
                    label: 'Questão protegida',
                    type: 'MULTIPLE_CHOICE',
                    suppressed: true,
                    options: [],
                  },
                ],
              }
            : path.endsWith(`/diagnostic-cycles/${id}`)
              ? cycle
              : path.endsWith('/diagnostic-cycles')
                ? { items: [cycle], total: 1, page: 1, pageSize: 50 }
                : { items: [], total: 0, page: 1, pageSize: 50 };
      return new Response(JSON.stringify(body));
    }),
  );
  render(<App />);
  expect(
    await screen.findByRole('heading', { name: 'Diagnóstico demonstrativo', level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Novo ciclo' })).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Ver ciclo Ciclo exemplo' }));
  expect(await screen.findByText(/Distribuição suprimida/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Emitir convites' })).not.toBeInTheDocument();
});

it('carrega unidades e setores ativos mesmo quando diagnostic-instrument retorna 404 e impede envio sem instrumento', async () => {
  window.location.hash = '/diagnostico';
  const inactiveUnitId = '10000000-0000-4000-8000-000000000099';
  const inactiveSectorId = '10000000-0000-4000-8000-000000000098';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = String(url).split('?')[0] ?? '';
    if (path.endsWith('/health'))
      return new Response(
        JSON.stringify({ status: 'ok', service: 'renr-api', timestamp: cycle.createdAt }),
      );
    if (path.endsWith('/auth/session'))
      return new Response(
        JSON.stringify({
          user: { id, name: 'Admin', email: 'admin@example.test' },
          memberships: [{ organizationId: id, organizationName: 'Aurora', role: 'ADMIN' }],
          activeOrganizationId: id,
          expiresAt: cycle.endsAt,
        }),
      );
    if (path.endsWith('/diagnostic-instrument'))
      return new Response(JSON.stringify({ statusCode: 404, message: 'Not found' }), {
        status: 404,
      });
    if (path.endsWith('/units'))
      return new Response(
        JSON.stringify({
          items: [
            {
              id,
              organizationId: id,
              name: 'Unidade Recife',
              code: null,
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
            {
              id: inactiveUnitId,
              organizationId: id,
              name: 'Unidade Inativa',
              code: null,
              isActive: false,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        }),
      );
    if (path.endsWith('/sectors'))
      return new Response(
        JSON.stringify({
          items: [
            {
              id,
              organizationId: id,
              unitId: id,
              name: 'Setor Operacional',
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
            {
              id: inactiveSectorId,
              organizationId: id,
              unitId: id,
              name: 'Setor Inativo',
              isActive: false,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        }),
      );
    if (path.endsWith('/diagnostic-cycles') && options?.method === 'POST')
      return new Response(JSON.stringify(cycle));
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  expect(await screen.findByRole('option', { name: 'Unidade Recife' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Unidade Inativa' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Este registro não está mais disponível/i)).not.toBeInTheDocument();
  const missingNotice = screen.getByText(/não possui instrumento demonstrativo publicado/i);
  expect(missingNotice).toBeVisible();
  expect(missingNotice).toHaveTextContent(/Coletas/i);
  await user.selectOptions(screen.getByLabelText('Unidade'), id);
  expect(await screen.findByRole('option', { name: 'Setor Operacional' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Setor Inativo' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Setor'), id);
  fireEvent.change(screen.getByLabelText('Nome do ciclo'), {
    target: { value: 'Ciclo bloqueado' },
  });
  fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-10-12T10:00' } });
  fireEvent.change(screen.getByLabelText('Término'), { target: { value: '2099-10-12T10:00' } });
  expect(screen.getByRole('button', { name: 'Criar ciclo' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Criar ciclo' }));
  expect(
    fetcher.mock.calls.filter(
      ([url, options]) => String(url).endsWith('/diagnostic-cycles') && options?.method === 'POST',
    ),
  ).toHaveLength(0);
});

it('exibe orientação explícita quando não há unidades ativas ou setores ativos na unidade selecionada', async () => {
  window.location.hash = '/diagnostico';
  let hasUnits = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url).split('?')[0] ?? '';
    if (path.endsWith('/health'))
      return new Response(
        JSON.stringify({ status: 'ok', service: 'renr-api', timestamp: cycle.createdAt }),
      );
    if (path.endsWith('/auth/session'))
      return new Response(
        JSON.stringify({
          user: { id, name: 'Admin', email: 'admin@example.test' },
          memberships: [{ organizationId: id, organizationName: 'Aurora', role: 'ADMIN' }],
          activeOrganizationId: id,
          expiresAt: cycle.endsAt,
        }),
      );
    if (path.endsWith('/diagnostic-instrument')) return new Response(JSON.stringify(instrument));
    if (path.endsWith('/units'))
      return new Response(
        JSON.stringify({
          items: hasUnits
            ? [
                {
                  id,
                  organizationId: id,
                  name: 'Unidade sem setores',
                  code: null,
                  isActive: true,
                  createdAt: cycle.createdAt,
                  updatedAt: cycle.createdAt,
                },
              ]
            : [
                {
                  id,
                  organizationId: id,
                  name: 'Unidade inativa',
                  code: null,
                  isActive: false,
                  createdAt: cycle.createdAt,
                  updatedAt: cycle.createdAt,
                },
              ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      );
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  expect(await screen.findByText(/Nenhuma unidade ativa/i)).toBeVisible();
  expect(screen.getByText(/Estrutura/i)).toBeVisible();

  hasUnits = true;
  view.unmount();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  await user.selectOptions(await screen.findByLabelText('Unidade'), id);
  expect(await screen.findByText(/Nenhum setor ativo/i)).toBeVisible();
  expect(screen.getByText(/cadastre ou ative um setor/i)).toBeVisible();
});

it('descarta seleções anteriores e ignora respostas atrasadas ao trocar de empresa', async () => {
  window.location.hash = '/diagnostico';
  const orgA = '10000000-0000-4000-8000-000000000001';
  const orgB = '10000000-0000-4000-8000-000000000002';
  const unitA = '20000000-0000-4000-8000-000000000001';
  const unitB = '20000000-0000-4000-8000-000000000002';
  const sectorA = '30000000-0000-4000-8000-000000000001';
  let resolveSlowUnitsA!: (response: Response) => void;
  let unitsACallCount = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url).split('?')[0] ?? '';
    if (path.endsWith('/health'))
      return new Response(
        JSON.stringify({ status: 'ok', service: 'renr-api', timestamp: cycle.createdAt }),
      );
    if (path.includes(`/organizations/${orgA}/diagnostic-instrument`))
      return new Response(JSON.stringify({ ...instrument, organizationId: orgA, title: 'Inst A' }));
    if (path.includes(`/organizations/${orgB}/diagnostic-instrument`))
      return new Response(JSON.stringify({ ...instrument, organizationId: orgB, title: 'Inst B' }));
    if (path.includes(`/organizations/${orgA}/units`)) {
      unitsACallCount += 1;
      if (unitsACallCount === 1) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: unitA,
                organizationId: orgA,
                name: 'Unidade A',
                code: null,
                isActive: true,
                createdAt: cycle.createdAt,
                updatedAt: cycle.createdAt,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
          }),
        );
      }
      return new Promise<Response>((resolve) => {
        resolveSlowUnitsA = resolve;
      });
    }
    if (path.includes(`/organizations/${orgB}/units`))
      return new Response(
        JSON.stringify({
          items: [
            {
              id: unitB,
              organizationId: orgB,
              name: 'Unidade B',
              code: null,
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      );
    if (path.includes(`/units/${unitA}/sectors`))
      return new Response(
        JSON.stringify({
          items: [
            {
              id: sectorA,
              organizationId: orgA,
              unitId: unitA,
              name: 'Setor A',
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      );
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
  });
  vi.stubGlobal('fetch', fetcher);
  const { Diagnostics } = await import('./components/Diagnostics');
  const sessionA = {
    user: { id, name: 'Admin', email: 'admin@example.test' },
    memberships: [
      { organizationId: orgA, organizationName: 'Empresa A', role: 'ADMIN' as const },
      { organizationId: orgB, organizationName: 'Empresa B', role: 'ADMIN' as const },
    ],
    activeOrganizationId: orgA,
    expiresAt: cycle.endsAt,
  };
  const view = render(<Diagnostics session={sessionA} onExpire={() => undefined} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  await user.selectOptions(await screen.findByLabelText('Unidade'), unitA);
  await user.selectOptions(await screen.findByLabelText('Setor'), sectorA);
  expect(screen.getByLabelText('Unidade')).toHaveValue(unitA);
  expect(screen.getByLabelText('Setor')).toHaveValue(sectorA);

  // Trigger a slow page change in org A before switching to org B
  // Or simply switch directly while a slow request from org A is pending:
  view.rerender(
    <Diagnostics
      session={{ ...sessionA, activeOrganizationId: orgA }}
      onExpire={() => undefined}
    />,
  );
  // Switch to org B (also verify Diagnostics renders clean or CycleCreator resets directly)
  view.rerender(
    <Diagnostics
      session={{ ...sessionA, activeOrganizationId: orgB }}
      onExpire={() => undefined}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Novo ciclo' }));
  expect(await screen.findByRole('option', { name: 'Unidade B' })).toBeInTheDocument();
  expect(screen.getByLabelText('Unidade')).toHaveValue('');
  expect(screen.getByLabelText('Setor')).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Unidade A' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Setor A' })).not.toBeInTheDocument();
  expect(screen.getByText(/Instrumento: Inst B/)).toBeInTheDocument();
  if (resolveSlowUnitsA) {
    resolveSlowUnitsA(
      new Response(
        JSON.stringify({
          items: [
            {
              id: unitA,
              organizationId: orgA,
              name: 'Unidade A Tardia',
              code: null,
              isActive: true,
              createdAt: cycle.createdAt,
              updatedAt: cycle.createdAt,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
  }
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: 'Unidade A Tardia' })).not.toBeInTheDocument(),
  );
});

it('trata 404 na prévia de instrumento do detalhe sem mensagem genérica e bloqueia ADMIN com recorte restrito', async () => {
  window.location.hash = `#/diagnostico?cycleId=${id}`;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url).split('?')[0] ?? '';
      if (path.endsWith('/diagnostic-instrument'))
        return new Response(JSON.stringify({ statusCode: 404, message: 'Not found' }), {
          status: 404,
        });
      if (path.endsWith('/results'))
        return new Response(
          JSON.stringify({
            cycleId: id,
            availability: 'CYCLE_OPEN',
            responseCount: null,
            minimumResponses: 5,
            questions: [],
          }),
        );
      if (path.endsWith(`/diagnostic-cycles/${id}`)) return new Response(JSON.stringify(cycle));
      return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
    }),
  );
  const { Diagnostics } = await import('./components/Diagnostics');
  const restrictedSession = {
    user: { id, name: 'Admin Restrito', email: 'admin@example.test' },
    memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' as const }],
    activeOrganizationId: id,
    organizationScopes: { [id]: [{ unitId: id, sectorId: null }] },
    expiresAt: cycle.endsAt,
  };
  render(<Diagnostics session={restrictedSession} onExpire={() => undefined} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Visualizar instrumento' }));
  const alert = await screen.findByRole('alert');
  expect(alert).not.toHaveTextContent(/Este registro não está mais disponível/i);
  expect(alert).toHaveTextContent(/instrumento demonstrativo/i);
  expect(screen.queryByRole('button', { name: 'Novo ciclo' })).not.toBeInTheDocument();
});
