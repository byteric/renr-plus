import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { PeopleWorkspace } from './components/people/PeopleWorkspace';

const organizationId = '10000000-0000-4000-8000-000000000001';
const employeeId = '20000000-0000-4000-8000-000000000001';
const unitId = '30000000-0000-4000-8000-000000000001';
const sectorId = '40000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-04T12:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
let grants: string[] = [];
let conflict = false;
const settlement = {
  policyVersion: 'synthetic-v1',
  scenario: 'SYNTHETIC',
  referenceDate: '2026-11-04',
  status: 'partial',
  noticeDays: 30,
  projectedTerminationDate: '2026-12-04',
  items: [
    { code: 'KNOWN', label: 'Parcela conhecida sintética', amountCents: '10000' },
    { code: 'MISSING', label: 'Parcela pendente sintética', amountCents: null },
  ],
  subtotalCents: '10000',
  grossTotalCents: null,
  fgtsPenaltyCents: null,
  missingInputs: ['Histórico não confirmado'],
  reasons: ['Estimativa sintética parcial'],
};
const employee = {
  id: employeeId,
  organizationId,
  unitId,
  sectorId,
  name: 'Pessoa Sintética',
  internalIdentifier: 'SYN-01',
  linkedUserId: null,
  unitName: 'Unidade Sintética',
  sectorName: 'Setor Sintético',
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const profile = {
  organizationId,
  employeeId,
  version: 0,
  birthDate: null,
  gender: null,
  genderDescription: null,
  vacationHistoryKnown: false,
  complexLeaveHistoryKnown: false,
  hasComplexLeaves: false,
  followUp: false,
  source: null,
  updatedAt: null,
};
const metric = (state: string, value: string | null) => ({
  state,
  value,
  known: null,
  missing: null,
  explanation: `Indicador ${state}`,
});
const overview = {
  registration: {
    organizationId,
    name: 'Empresa Sintética',
    fiscalIdentifier: null,
    normalizedFiscalIdentifier: null,
    fiscalState: 'MISSING',
    clientClassification: 'UNCLASSIFIED',
    isActive: true,
    version: 1,
  },
  generatedAt: timestamp,
  referenceDate: '2026-11-04',
  timeZone: 'America/Sao_Paulo',
  competence: '2026-11',
  privacyPolicy: 'HR_MIN5_COMPLEMENT_V1',
  filters: { unitId: null, sectorId: null, isActive: null },
  population: { total: 12, active: 10, inactive: 2, unit: 'EMPLOYEE_RECORDS' },
  metrics: {
    averageAge: metric('KNOWN', '35'),
    averageTenureMonths: metric('INSUFFICIENT_DATA', null),
    genderCoveragePercent: metric('KNOWN', '75'),
    salaryMassCents: metric('FORBIDDEN', null),
    averageSalaryCents: metric('SUPPRESSED', null),
    terminationGrossCents: metric('UNCONFIGURED', null),
    vacationOverdue: metric('KNOWN', '2'),
    vacationUnknown: metric('KNOWN', '3'),
    vacationDueSoon: metric('KNOWN', '1'),
  },
  distributions: [
    {
      key: 'gender',
      label: 'Distribuição de gênero',
      state: 'KNOWN',
      items: [
        { key: 'a', label: 'Categoria A', count: 7 },
        { key: 'unknown', label: 'Sem informação', count: null },
      ],
    },
  ],
  settlementPolicy: {
    version: 'test-v1',
    scenario: 'SYNTHETIC',
    limitations: ['Estimativa sintética para teste.'],
  },
};

beforeEach(() => {
  grants = [];
  conflict = false;
  localStorage.clear();
  window.location.hash = '/pessoas';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/session-capabilities')
      return json({ organizationId, capabilities: grants, canManageAccess: true });
    if (path.endsWith('/people-overview')) return json(overview);
    if (path.endsWith('/people/employees'))
      return json({
        items: [employee],
        total: 26,
        page: Number(url.searchParams.get('page') ?? 1),
        pageSize: 25,
      });
    if (path.endsWith('/units'))
      return json({
        items: [
          {
            id: unitId,
            organizationId,
            name: 'Unidade Sintética',
            code: null,
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    if (path.endsWith('/sectors'))
      return json({
        items: [
          {
            id: sectorId,
            organizationId,
            unitId,
            name: 'Setor Sintético',
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    if (path.endsWith('/hr-profile')) {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        delete body.expectedVersion;
        delete body.reason;
        return conflict
          ? json({}, 409)
          : json({
              ...profile,
              ...body,
              version: 1,
              source: 'Declaração sintética',
              updatedAt: timestamp,
            });
      }
      return json(profile);
    }
    if (path.endsWith('/settlement-preview')) return json(settlement);
    if (
      ['employment-periods', 'remunerations', 'vacation-periods'].some((name) =>
        path.endsWith('/' + name),
      )
    )
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

it('filtra por referências legíveis e recupera somente filtros não sensíveis na URL', async () => {
  grants = ['HR_ANALYTICS_READ'];
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await screen.findByRole('option', { name: 'Unidade Sintética' });
  await user.selectOptions(screen.getByLabelText('Unidade'), unitId);
  await screen.findByRole('option', { name: 'Setor Sintético' });
  await user.selectOptions(screen.getByLabelText('Setor'), sectorId);
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(window.location.hash).toContain(`unitId=${unitId}`);
  expect(window.location.hash).toContain(`sectorId=${sectorId}`);
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([path]) =>
        String(path).includes(`/people-overview?unitId=${unitId}&sectorId=${sectorId}`),
      ),
    ).toBe(true),
  );
});

it('simula usando dados persistidos e retira o resultado anterior quando as entradas mudam', async () => {
  grants = ['HR_PROFILE_READ', 'HR_COMPENSATION_READ'];
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
  await user.click(await screen.findByRole('button', { name: 'Simulação' }));
  expect(screen.queryByLabelText('Salário em centavos')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Início do vínculo')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Data do desligamento'), '2026-11-04');
  await user.click(screen.getByRole('button', { name: 'Simular com registros persistidos' }));
  expect(await screen.findByText('Estimativa parcial')).toBeVisible();
  expect(screen.getByText('Indisponível: há dados pendentes')).toBeVisible();
  const posted = fetchMock.mock.calls.find(
    ([path, options]) => String(path).endsWith('/settlement-preview') && options?.method === 'POST',
  );
  expect(JSON.parse(String(posted?.[1]?.body))).toEqual({
    terminationDate: '2026-11-04',
    thirteenthHistoryKnown: false,
    currentAcquisitionHistoryKnown: false,
  });
  await user.type(screen.getByLabelText('Adiantamento do 13º em centavos'), '1000');
  expect(screen.queryByRole('region', { name: 'Resultado da simulação' })).not.toBeInTheDocument();
});

it('limpa o cadastro e o rascunho quando a capacidade é revogada ao retomar a janela', async () => {
  grants = ['HR_PROFILE_MANAGE'];
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
  await user.click(await screen.findByRole('button', { name: 'Editar perfil' }));
  await user.type(screen.getByLabelText('Fonte'), 'Fonte privada sintética');
  grants = [];
  window.dispatchEvent(new Event('focus'));
  expect(await screen.findByText(/acesso a pessoas requer uma permissão de RH/i)).toBeVisible();
  expect(screen.queryByLabelText('Fonte')).not.toBeInTheDocument();
  expect(screen.queryByText('Pessoa Sintética')).not.toBeInTheDocument();
});

it('remove dados da empresa anterior imediatamente na troca de contexto', async () => {
  grants = ['HR_PROFILE_READ'];
  const user = userEvent.setup();
  const { rerender } = render(
    <PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />,
  );
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  expect(await screen.findByText('Pessoa Sintética')).toBeVisible();
  rerender(
    <PeopleWorkspace organizationId="10000000-0000-4000-8000-000000000002" onExpire={vi.fn()} />,
  );
  expect(screen.queryByText('Pessoa Sintética')).not.toBeInTheDocument();
  await screen.findByRole('alert');
  expect(screen.queryByText('Pessoa Sintética')).not.toBeInTheDocument();
});

it('rejeita um perfil retornado para outro colaborador no mesmo tenant', async () => {
  grants = ['HR_PROFILE_READ'];
  const previous = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, options) =>
    String(input).endsWith('/hr-profile')
      ? Promise.resolve(
          json({
            ...profile,
            employeeId: '20000000-0000-4000-8000-000000000002',
            birthDate: '1991-05-05',
          }),
        )
      : previous(input, options),
  );
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('05/05/1991')).not.toBeInTheDocument();
});

it('bloqueia dados privados sem grant de RH mesmo quando pode gerenciar acessos', async () => {
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  expect(await screen.findByText(/acesso a pessoas requer uma permissão de RH/i)).toBeVisible();
  expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual([
    '/api/v1/auth/session-capabilities',
  ]);
});

it.each(['unitId=invalido', `unitId=${unitId}&unitId=${sectorId}`, 'competence=2026-99'])(
  'não amplia consulta ao receber filtros inválidos ou duplicados: %s',
  async (query) => {
    grants = ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'];
    window.history.replaceState(null, '', `#/pessoas?${query}`);
    render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
    expect(await screen.findByText(/filtros da URL inválidos/i)).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([path]) =>
          String(path).includes('/people-overview') || String(path).includes('/people/employees'),
      ),
    ).toBe(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('heading', { name: 'Visão de pessoas' })).toBeVisible();
  },
);

it('distingue indicador desconhecido, suprimido e proibido e oferece tabela dos gráficos', async () => {
  grants = ['HR_ANALYTICS_READ'];
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Visão de pessoas' })).toBeVisible();
  expect(await screen.findByText('Dados insuficientes')).toBeVisible();
  expect(screen.getAllByText('Suprimido por privacidade').length).toBeGreaterThan(0);
  expect(screen.getByText('Sem permissão')).toBeVisible();
  const table = screen.getByRole('table', { name: 'Distribuição de gênero' });
  expect(within(table).getByText('7')).toBeVisible();
  expect(within(table).getByText('Não divulgado')).toBeVisible();
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/people/employees'))).toBe(
    false,
  );
});

it('pagina a lista nominal em 25 e não grava nomes ou rascunhos na URL ou armazenamento', async () => {
  grants = ['HR_PROFILE_READ'];
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  expect(await screen.findByText('Pessoa Sintética')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Próxima página' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([path]) => /page=2/.test(String(path)) && /pageSize=25/.test(String(path)),
      ),
    ).toBe(true),
  );
  expect(window.location.hash).toContain('page=2');
  expect(window.location.hash).not.toContain('Sint');
  expect(localStorage.length).toBe(0);
});

it('preserva o perfil em conflito e exige revisão antes de nova escrita', async () => {
  grants = ['HR_PROFILE_MANAGE'];
  conflict = true;
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
  await user.click(await screen.findByRole('button', { name: 'Editar perfil' }));
  await user.type(screen.getByLabelText('Fonte'), 'Declaração sintética');
  await user.type(screen.getByLabelText('Motivo'), 'Primeiro cadastro sintético');
  await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
  expect(await screen.findByText(/registro mudou.*rascunho foi preservado/i)).toBeVisible();
  expect(screen.getByLabelText('Fonte')).toHaveValue('Declaração sintética');
  expect(screen.getByRole('button', { name: 'Salvar perfil' })).toBeDisabled();
  const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
    expectedVersion: 0,
    source: 'Declaração sintética',
  });
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/remunerations'))).toBe(
    false,
  );
});

it('salva complementos explícitos da simulação para o painel somente com gestão de remuneração', async () => {
  grants = ['HR_PROFILE_READ', 'HR_COMPENSATION_MANAGE'];
  const previous = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, options) => {
    const path = String(input);
    if (path.includes('/settlement-parameters')) {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        return json({
          organizationId,
          employeeId,
          referenceDate: body.parameters.terminationDate,
          parameters: body.parameters,
          version: 1,
          source: body.source,
          updatedAt: timestamp,
        });
      }
      return json(null);
    }
    return previous(input, options);
  });
  const user = userEvent.setup();
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
  await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
  await user.click(await screen.findByRole('button', { name: 'Simulação' }));
  await user.type(screen.getByLabelText('Data do desligamento'), '2026-11-04');
  await user.type(await screen.findByLabelText('Fonte dos parâmetros'), 'Conferência sintética');
  await user.type(screen.getByLabelText('Motivo dos parâmetros'), 'Cadastro para painel sintético');
  await user.click(screen.getByRole('button', { name: 'Salvar parâmetros para o painel' }));
  expect(await screen.findByText('Parâmetros salvos para o painel.')).toBeVisible();
  const put = fetchMock.mock.calls.find(
    ([path, options]) =>
      String(path).endsWith('/settlement-parameters') && options?.method === 'PUT',
  );
  expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
    expectedVersion: 0,
    parameters: {
      terminationDate: '2026-11-04',
      thirteenthHistoryKnown: false,
      currentAcquisitionHistoryKnown: false,
    },
  });
});

it.each([
  {
    tab: 'Vínculos',
    resource: 'employment-periods',
    singular: 'vínculo',
    save: 'Salvar vínculo',
    values: { startsOn: '2024-01-01', endsOn: null },
    inputs: [['Início do vínculo', '2024-01-01']],
  },
  {
    tab: 'Salários',
    resource: 'remunerations',
    singular: 'salário',
    save: 'Salvar salário',
    values: { competence: '2026-11', salaryCents: '345678', remunerationType: 'FIXED' },
    inputs: [
      ['Competência salarial', '2026-11'],
      ['Salário em centavos', '345678'],
    ],
  },
  {
    tab: 'Férias',
    resource: 'vacation-periods',
    singular: 'período de férias',
    save: 'Salvar férias',
    values: {
      acquisitionStart: '2024-01-01',
      acquisitionEnd: '2024-12-31',
      concessionDeadline: '2025-12-31',
      entitlementDays: 30,
      balanceDays: 20,
      unjustifiedAbsences: 0,
      historyKnown: false,
      uses: [],
    },
    inputs: [
      ['Início aquisitivo', '2024-01-01'],
      ['Fim aquisitivo', '2024-12-31'],
      ['Limite concessivo', '2025-12-31'],
      ['Dias de direito', '30'],
      ['Dias de saldo', '20'],
      ['Faltas injustificadas', '0'],
    ],
  },
])(
  'cria e edita $tab com versões explícitas e sem exclusão de histórico',
  async ({ tab, resource, singular, save, values, inputs }) => {
    grants = ['HR_PROFILE_MANAGE', 'HR_COMPENSATION_MANAGE'];
    const previous = fetchMock.getMockImplementation()!;
    const id = '50000000-0000-4000-8000-000000000001';
    let record: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input).split('?')[0]!;
      if (path.endsWith(`/${resource}`) || path.endsWith(`/${resource}/${id}`)) {
        if (options?.method === 'POST' || options?.method === 'PATCH') {
          const body = JSON.parse(String(options.body));
          record = {
            id,
            organizationId,
            employeeId,
            version: body.expectedVersion + 1,
            source: body.source,
            updatedAt: timestamp,
            ...values,
          };
          return json(record);
        }
        return json({
          items: record ? [record] : [],
          page: 1,
          pageSize: 25,
          total: record ? 1 : 0,
        });
      }
      return previous(input, options);
    });
    const user = userEvent.setup();
    render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Colaboradores' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir Pessoa Sintética' }));
    await user.click(await screen.findByRole('button', { name: tab }));
    await user.click(await screen.findByRole('button', { name: `Adicionar ${singular}` }));
    if (resource === 'vacation-periods') {
      expect(screen.getByLabelText('Dias de direito')).toHaveAccessibleDescription(
        /0, 12, 18, 24 ou 30 dias/i,
      );
    }
    for (const [label, value] of inputs) await user.type(screen.getByLabelText(label!), value!);
    await user.type(screen.getByLabelText('Fonte'), 'Documento sintético');
    await user.type(screen.getByLabelText('Motivo'), 'Cadastro sintético');
    await user.click(screen.getByRole('button', { name: save }));
    expect(await screen.findByText('Registro salvo com histórico.')).toBeVisible();
    await user.click(await screen.findByRole('button', { name: `Editar ${singular}` }));
    await user.type(screen.getByLabelText('Motivo'), 'Revisão sintética');
    await user.click(screen.getByRole('button', { name: save }));
    await screen.findByText('Registro salvo com histórico.');
    const mutations = fetchMock.mock.calls.filter(
      ([path, options]) =>
        String(path).includes(`/${resource}`) && ['POST', 'PATCH'].includes(options?.method ?? ''),
    );
    expect(mutations).toHaveLength(2);
    expect(JSON.parse(String(mutations[0]?.[1]?.body))).toMatchObject({
      expectedVersion: 0,
      ...values,
    });
    expect(JSON.parse(String(mutations[1]?.[1]?.body))).toMatchObject({ expectedVersion: 1 });
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  },
);
it('identifica o CNPJ e o estado fiscal no mapeamento nominal', async () => {
  grants = ['HR_PROFILE_READ'];
  window.history.replaceState(null, '', '#/pessoas?area=employees');
  const fallback = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, options) =>
    String(input).endsWith('/client-registration')
      ? json({
          ...overview.registration,
          fiscalState: 'VALID',
          fiscalIdentifier: '12ABC34501DE35',
          normalizedFiscalIdentifier: '12ABC34501DE35',
        })
      : fallback(input, options),
  );
  render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
  expect(await screen.findByText(/CNPJ 12ABC34501DE35 · Válido/i)).toBeVisible();
});
it.each([true, false])(
  'permite aprofundar por setor conforme a leitura nominal (%s)',
  async (authorized) => {
    grants = authorized ? ['HR_ANALYTICS_READ', 'HR_PROFILE_READ'] : ['HR_ANALYTICS_READ'];
    window.history.replaceState(null, '', `#/pessoas?unitId=${unitId}&isActive=true`);
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, options) =>
      String(input).includes('/people-overview')
        ? json({
            ...overview,
            distributions: [
              {
                key: 'sector',
                label: 'Setor',
                state: 'KNOWN',
                items: [{ key: sectorId, label: 'Setor Sintético', count: 7 }],
              },
              {
                key: 'unit',
                label: 'Unidade',
                state: 'SUPPRESSED',
                items: [{ key: unitId, label: 'Unidade Protegida', count: null }],
              },
            ],
          })
        : fallback(input, options),
    );
    const user = userEvent.setup();
    render(<PeopleWorkspace organizationId={organizationId} onExpire={vi.fn()} />);
    await screen.findByRole('table', { name: 'Setor' });
    if (!authorized) {
      expect(
        screen.queryByRole('button', { name: 'Ver colaboradores de Setor Sintético' }),
      ).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/people/employees'))).toBe(
        false,
      );
      return;
    }
    const drill = await screen.findByRole('button', {
      name: 'Ver colaboradores de Setor Sintético',
    });
    expect(screen.queryByRole('button', { name: /Unidade Protegida/ })).not.toBeInTheDocument();
    await user.click(drill);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const parsed = new URL(String(url), 'http://localhost');
          return (
            parsed.pathname.endsWith('/people/employees') &&
            parsed.searchParams.get('unitId') === unitId &&
            parsed.searchParams.get('sectorId') === sectorId &&
            parsed.searchParams.get('isActive') === 'true'
          );
        }),
      ).toBe(true),
    );
  },
);
