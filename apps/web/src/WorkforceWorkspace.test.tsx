import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';

const org = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000001';
const secondUnit = '20000000-0000-4000-8000-000000000002';
const sectorId = '30000000-0000-4000-8000-000000000001';
const personId = '40000000-0000-4000-8000-000000000001';
const groupId = '50000000-0000-4000-8000-000000000001';
const userId = '60000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T12:00:00.000Z';
const session = {
  user: { id: userId, name: 'Gestora', email: 'gestora@example.test' },
  memberships: [
    { organizationId: org, organizationName: 'Empresa de teste', role: 'ADMIN' as const },
  ],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const units = [unitId, secondUnit].map((id, i) => ({
  id,
  organizationId: org,
  name: i ? 'Unidade Olinda' : 'Unidade Recife',
  code: null,
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp,
}));
const sector = {
  id: sectorId,
  organizationId: org,
  unitId,
  name: 'Atendimento',
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp,
};
const employee = {
  id: personId,
  organizationId: org,
  name: 'Colaboradora de teste',
  internalIdentifier: 'MAT-001',
  unitId,
  sectorId,
  unitName: 'Unidade Recife',
  sectorName: 'Atendimento',
  linkedUserId: null,
  isActive: true,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const group = {
  id: groupId,
  organizationId: org,
  name: 'Grupo de atendimento',
  unitId,
  sectorId,
  unitName: 'Unidade Recife',
  sectorName: 'Atendimento',
  isActive: true,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const list = (items: unknown[], pageSize = 20) => ({
  items,
  total: items.length,
  page: 1,
  pageSize,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
let failSave = false;
let failList = false;
let savedBody: Record<string, unknown> | null = null;
beforeEach(() => {
  window.location.hash = '/colaboradores';
  failSave = false;
  failList = false;
  savedBody = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    const method = options?.method ?? 'GET';
    if (path === '/auth/session-capabilities')
      return json({ organizationId: org, capabilities: [], canManageAccess: true });
    if (path === `/organizations/${org}/units`) return json(list(units, 50));
    if (path === `/units/${unitId}/sectors`) return json(list([sector], 50));
    if (path === `/units/${secondUnit}/sectors`) return json(list([], 50));
    if (path === `/organizations/${org}/access-memberships`)
      return json(
        list([
          {
            organizationId: org,
            userId,
            name: 'Gestora',
            email: 'gestora@example.test',
            role: 'ADMIN',
            isActive: true,
            version: 1,
            capabilities: [],
            updatedAt: stamp,
          },
        ]),
      );
    if (path.includes('/employees') || path.includes('/assessment-groups')) {
      const item = path.includes('/employees') ? employee : group;
      if (method === 'POST' || method === 'PATCH') {
        if (failSave) return json({}, 503);
        savedBody = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return json(
          { ...item, ...savedBody, version: method === 'PATCH' ? 2 : 1 },
          method === 'POST' ? 201 : 200,
        );
      }
      if (failList) return json({}, 503);
      return path.endsWith(item.id) ? json(item) : json(list([item]));
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const show = () => render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);

it('lista colaboradores e abre cadastro mínimo sem dados clínicos', async () => {
  show();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Colaboradores' }),
  ).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: employee.name })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Novo colaborador' }));
  expect(await screen.findByRole('form', { name: 'Cadastrar colaborador' })).toBeInTheDocument();
  expect(screen.getByLabelText('Identificação interna (opcional)')).toBeInTheDocument();
  expect(screen.queryByLabelText(/CPF|dados clínicos|salário/i)).not.toBeInTheDocument();
});

it('salva por teclado, preserva rascunho em falha e limpa setor ao trocar de unidade', async () => {
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
  const name = await screen.findByLabelText('Nome do colaborador');
  await user.type(name, 'Nova pessoa');
  await user.selectOptions(screen.getByLabelText('Unidade do cadastro'), unitId);
  await user.selectOptions(await screen.findByLabelText('Setor do cadastro'), sectorId);
  await user.selectOptions(screen.getByLabelText('Unidade do cadastro'), secondUnit);
  await waitFor(() => expect(screen.getByLabelText('Setor do cadastro')).toHaveValue(''));
  expect(screen.queryByRole('option', { name: 'Atendimento' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Unidade do cadastro'), unitId);
  await user.selectOptions(await screen.findByLabelText('Setor do cadastro'), sectorId);
  failSave = true;
  screen.getByRole('button', { name: 'Salvar colaborador' }).focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(name).toHaveValue('Nova pessoa');
  failSave = false;
  await user.click(screen.getByRole('button', { name: 'Salvar colaborador' }));
  expect(await screen.findByText('Colaborador salvo com sucesso.')).toBeInTheDocument();
  expect(savedBody).toEqual({
    name: 'Nova pessoa',
    internalIdentifier: null,
    unitId,
    sectorId,
    linkedUserId: null,
  });
});

it('não consulta dados nominais ao acessar rota direta como leitor', async () => {
  render(
    <Structure
      session={{ ...session, memberships: [{ ...session.memberships[0]!, role: 'READER' }] }}
      onSession={vi.fn()}
      onExpire={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(/Somente administradores podem gerenciar colaboradores/),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/employees'))).toBe(false);
});

it('desativa com confirmação e explica que o usuário e os históricos não são apagados', async () => {
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `Desativar colaborador ${employee.name}` }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Desativar colaborador' });
  expect(within(dialog).getByText(/não revoga o acesso do usuário/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar desativação' }));
  await waitFor(() => expect(savedBody).toEqual({ version: 1, isActive: false }));
});

it('retorna da edição aos filtros e página originais, inclusive após navegação do navegador', async () => {
  window.location.hash = '/colaboradores?search=Ana&isActive=false&page=2';
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `Editar colaborador ${employee.name}` }),
  );
  expect(await screen.findByLabelText('Nome do colaborador')).toHaveValue(employee.name);
  await user.click(screen.getByRole('button', { name: 'Cancelar edição' }));
  expect(screen.getByLabelText('Buscar colaboradores')).toHaveValue('Ana');
  expect(window.location.hash).toContain('page=2');
  window.location.hash = '/colaboradores?search=Recife&page=3';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await waitFor(() => expect(screen.getByLabelText('Buscar colaboradores')).toHaveValue('Recife'));
});

it('edita grupo existente sem permitir alterar o setor e preserva o vínculo coletivo', async () => {
  window.location.hash = '/grupos';
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Editar grupo ${group.name}` }));
  const form = await screen.findByRole('form', { name: 'Editar grupo de avaliação' });
  expect(
    within(form).queryByRole('combobox', { name: 'Setor do cadastro' }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Nome do grupo'));
  await user.type(screen.getByLabelText('Nome do grupo'), 'Novo nome coletivo');
  await user.click(screen.getByRole('button', { name: 'Salvar grupo' }));
  await waitFor(() => expect(savedBody).toEqual({ version: 1, name: 'Novo nome coletivo' }));
});

it('permite vincular explicitamente um usuário existente sem inferir participação em diagnóstico', async () => {
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
  await user.type(await screen.findByLabelText('Nome do colaborador'), 'Pessoa com acesso');
  await user.selectOptions(screen.getByLabelText('Unidade do cadastro'), unitId);
  await user.selectOptions(await screen.findByLabelText('Setor do cadastro'), sectorId);
  await user.click(screen.getByLabelText('Vincular a um usuário existente'));
  await user.selectOptions(await screen.findByLabelText('Usuário vinculado'), userId);
  await user.click(screen.getByRole('button', { name: 'Salvar colaborador' }));
  await waitFor(() => expect(savedBody?.linkedUserId).toBe(userId));
  expect(savedBody).not.toHaveProperty('responseId');
});

it('trata falha na lista sem mostrar dados antigos e oferece tentar novamente', async () => {
  failList = true;
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(screen.queryByText(employee.name)).not.toBeInTheDocument();
  failList = false;
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('heading', { name: employee.name })).toBeInTheDocument();
});

it('mantém o rascunho e a versão original ao voltar à aba durante edição', async () => {
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `Editar colaborador ${employee.name}` }),
  );
  const name = await screen.findByLabelText('Nome do colaborador');
  await user.clear(name);
  await user.type(name, 'Rascunho que não pode sumir');
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) => {
    const response = await original(url, options);
    if (String(url).endsWith(`/employees/${personId}`) && !options?.method) {
      return json({ ...employee, name: 'Editado por outra pessoa', version: 2 });
    }
    return response;
  });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByLabelText('Nome do colaborador')).toHaveValue('Rascunho que não pode sumir');
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/employees/${personId}`)).length,
    ).toBeGreaterThan(1),
  );
  await user.click(screen.getByRole('button', { name: 'Salvar colaborador' }));
  await waitFor(() => expect(savedBody?.version).toBe(1));
  expect(savedBody?.name).toBe('Rascunho que não pode sumir');
});

it('preserva cadastro novo quando a revalidação da aba falha temporariamente', async () => {
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
  await user.type(await screen.findByLabelText('Nome do colaborador'), 'Rascunho sem conexão');
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) =>
    String(url).endsWith('/auth/session-capabilities') ? json({}, 503) : original(url, options),
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByText(/Serviço temporariamente indisponível/)).toBeInTheDocument();
  expect(screen.getByLabelText('Nome do colaborador')).toHaveValue('Rascunho sem conexão');
});

it('reabre um cadastro com versão atual depois de cancelar um conflito', async () => {
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `Editar colaborador ${employee.name}` }),
  );
  await user.type(await screen.findByLabelText('Nome do colaborador'), ' rascunho');
  const original = fetchMock.getMockImplementation()!;
  let rejected = false;
  fetchMock.mockImplementation(async (url, options) => {
    if (String(url).endsWith(`/employees/${personId}`)) {
      if (options?.method === 'PATCH' && !rejected) {
        rejected = true;
        return json({}, 409);
      }
      if (!options?.method) return json({ ...employee, name: 'Alteração externa', version: 2 });
    }
    return original(url, options);
  });
  await user.click(screen.getByRole('button', { name: 'Salvar colaborador' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('versão desatualizada');
  await user.click(screen.getByRole('button', { name: 'Cancelar edição' }));
  await user.click(
    await screen.findByRole('button', { name: `Editar colaborador ${employee.name}` }),
  );
  expect(await screen.findByLabelText('Nome do colaborador')).toHaveValue('Alteração externa');
  await user.click(screen.getByRole('button', { name: 'Salvar colaborador' }));
  await waitFor(() => expect(savedBody?.version).toBe(2));
});
