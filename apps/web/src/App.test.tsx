import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const organizationId = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000001';
const timestamp = '2026-10-03T12:00:00.000Z';
const organization = {
  id: organizationId,
  name: 'Empresa Horizonte',
  fiscalIdentifier: null,
  timezone: 'America/Sao_Paulo',
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const unit = {
  id: unitId,
  organizationId,
  name: 'Unidade Recife',
  code: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const session = {
  user: {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Pessoa administradora',
    email: 'admin@example.test',
  },
  memberships: [{ organizationId, organizationName: organization.name, role: 'ADMIN' }],
  activeOrganizationId: organizationId,
  expiresAt: '2099-10-04T12:00:00.000Z',
};
const healthy = { status: 'ok', service: 'renr-api', timestamp };
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
let authenticated = false;
let role = 'ADMIN';
let healthFailure = false;
let failSave = false;
let expireList = false;
let units: (typeof unit)[] = [];
let organizations: (typeof organization)[] = [];
let sectors: {
  id: string;
  organizationId: string;
  unitId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}[] = [];
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.location.hash = '/empresas';
  authenticated = false;
  role = 'ADMIN';
  healthFailure = false;
  failSave = false;
  expireList = false;
  units = [];
  organizations = [organization];
  sectors = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    const path = String(input).replace('/api/v1', '').split('?')[0];
    const method = options?.method ?? 'GET';
    if (path === '/health') return healthFailure ? json({ status: 'invalid' }) : json(healthy);
    if (path === '/auth/session' && method === 'DELETE') {
      authenticated = false;
      return new Response(null, { status: 204 });
    }
    if (path === '/auth/sessions') {
      authenticated = true;
      return json({ ...session, memberships: [{ ...session.memberships[0], role }] }, 201);
    }
    if (path === '/auth/session')
      return authenticated
        ? json({ ...session, memberships: [{ ...session.memberships[0], role }] })
        : json({}, 401);
    if (path === '/auth/session/organization') return json(session);
    if (expireList) return json({}, 401);
    if (path === '/organizations' && method === 'GET') return json(list(organizations));
    if (method === 'POST' || method === 'PATCH') {
      if (failSave) return json({ internal: 'never display' }, 503);
      const body: unknown = JSON.parse(String(options?.body));
      const name =
        typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string'
          ? body.name
          : '';
      if (path?.includes('organizations') && !path.includes('units')) {
        const created = { ...organization, name };
        organizations = [created];
        return json(created, 201);
      }
      if (path?.includes('sectors')) {
        const sector = { ...unit, id: '40000000-0000-4000-8000-000000000001', unitId, name };
        sectors = [sector];
        return json(sector, 201);
      }
      const created = { ...unit, name };
      units = [created];
      return json(created, 201);
    }
    if (path?.includes('sectors')) return json(list(sectors));
    if (path?.includes('units')) return json(list(units));
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function enter() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), 'admin@example.test');
  await user.type(screen.getByLabelText('Senha'), 'password');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  await screen.findByRole('heading', { name: 'Empresas', level: 1 });
  return user;
}
describe('acesso e estrutura organizacional', () => {
  it('permite reativar uma empresa inativa depois de trabalhar em outra empresa', async () => {
    const companyA = { ...organization, name: 'Empresa A' };
    const companyB = {
      ...organization,
      id: '10000000-0000-4000-8000-000000000002',
      name: 'Empresa B',
    };
    let activeOrganizationId = companyB.id;
    let companyBActive = true;
    const defaultFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, options) => {
      const path = String(input).replace('/api/v1', '').split('?')[0];
      const memberships = [companyA, companyB].map((company) => ({
        organizationId: company.id,
        organizationName: company.name,
        role: 'ADMIN',
      }));
      if (path === '/auth/session') return json({ ...session, memberships, activeOrganizationId });
      if (path === '/auth/session/organization') {
        const body: unknown = JSON.parse(String(options?.body));
        if (
          typeof body === 'object' &&
          body !== null &&
          'organizationId' in body &&
          typeof body.organizationId === 'string'
        )
          activeOrganizationId = body.organizationId;
        return json({ ...session, memberships, activeOrganizationId });
      }
      if (path === `/organizations/${companyB.id}` && options?.method === 'PATCH') {
        const body: unknown = JSON.parse(String(options.body));
        if (
          typeof body === 'object' &&
          body !== null &&
          'isActive' in body &&
          typeof body.isActive === 'boolean'
        )
          companyBActive = body.isActive;
        return json({ ...companyB, isActive: companyBActive });
      }
      if (path === '/organizations')
        return json(list([companyA, { ...companyB, isActive: companyBActive }]));
      if (defaultFetch) return defaultFetch(input, options);
      return json({}, 404);
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar empresa Empresa B' }));
    await user.click(screen.getByLabelText('Cadastro ativo'));
    await user.click(screen.getByRole('button', { name: 'Salvar empresa' }));
    await waitFor(() => expect(companyBActive).toBe(false));
    await user.click(await screen.findByRole('button', { name: 'Selecionar empresa Empresa A' }));
    await screen.findByRole('heading', { name: 'Unidades', level: 1 });
    await user.click(screen.getByRole('link', { name: 'Empresas' }));
    const selectInactive = await screen.findByRole('button', {
      name: 'Selecionar empresa Empresa B',
    });
    expect(selectInactive).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Editar empresa Empresa B' }),
    ).not.toBeInTheDocument();
    await user.click(selectInactive);
    await screen.findByRole('heading', { name: 'Unidades', level: 1 });
    await user.click(screen.getByRole('link', { name: 'Empresas' }));
    await user.click(await screen.findByRole('button', { name: 'Editar empresa Empresa B' }));
    expect(screen.getByLabelText('Cadastro ativo')).not.toBeChecked();
    await user.click(screen.getByLabelText('Cadastro ativo'));
    await user.click(screen.getByRole('button', { name: 'Salvar empresa' }));
    await waitFor(() => expect(companyBActive).toBe(true));
    const row = (await screen.findByRole('heading', { name: 'Empresa B' })).closest('li');
    if (!row) throw new Error('Cadastro da empresa não encontrado.');
    await waitFor(() =>
      expect(within(row).getByText('Ativo', { exact: true })).toBeInTheDocument(),
    );
  });
  it('valida o fuso e salva uma empresa com os campos do contrato', async () => {
    authenticated = true;
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nova empresa' }));
    await user.type(screen.getByLabelText('Nome da empresa'), 'Empresa Nova');
    await user.clear(screen.getByLabelText('Fuso horário'));
    await user.type(screen.getByLabelText('Fuso horário'), 'invalid/zone');
    await user.click(screen.getByRole('button', { name: 'Salvar empresa' }));
    expect(
      screen.getByText('Informe um fuso horário IANA, como America/Sao_Paulo.'),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Fuso horário'));
    await user.type(screen.getByLabelText('Fuso horário'), 'America/Sao_Paulo');
    await user.click(screen.getByRole('button', { name: 'Salvar empresa' }));
    expect(await screen.findByRole('heading', { name: 'Empresa Nova' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Empresa Nova',
          fiscalIdentifier: null,
          timezone: 'America/Sao_Paulo',
        }),
      }),
    );
  });
  it('edita uma unidade existente com PATCH', async () => {
    authenticated = true;
    units = [unit];
    window.location.hash = '/unidades';
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar unidade Unidade Recife' }));
    await user.clear(screen.getByLabelText('Nome da unidade'));
    await user.type(screen.getByLabelText('Nome da unidade'), 'Unidade Olinda');
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }));
    expect(await screen.findByRole('heading', { name: 'Unidade Olinda' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/units/${unitId}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
  it('valida acesso, autentica com cookie e sai limpando o conteúdo privado', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('e-mail válido');
    await enter();
    expect(await screen.findByText(organization.name, { selector: 'h2' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/sessions',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    expect(localStorage.length).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByText(organization.name, { selector: 'h2' })).not.toBeInTheDocument();
  });
  it('seleciona empresa e cadastra unidade e setor, com retorno navegável', async () => {
    render(<App />);
    const user = await enter();
    await user.click(
      await screen.findByRole('button', { name: `Selecionar empresa ${organization.name}` }),
    );
    await screen.findByRole('heading', { name: 'Unidades', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Nova unidade' }));
    await user.type(screen.getByLabelText('Nome da unidade'), 'Unidade Recife');
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }));
    await user.click(await screen.findByRole('link', { name: 'Ver setores de Unidade Recife' }));
    await screen.findByRole('heading', { name: 'Setores', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Novo setor' }));
    await user.type(screen.getByLabelText('Nome do setor'), 'Operações');
    await user.click(screen.getByRole('button', { name: 'Salvar setor' }));
    expect(await screen.findByRole('heading', { name: 'Operações' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Estrutura organizacional' })).getByRole(
        'link',
        { name: 'Unidades' },
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Unidades', level: 1 })).toBeInTheDocument();
  });
  it('mantém o rascunho quando a API falha e permite salvar depois', async () => {
    authenticated = true;
    window.location.hash = '/unidades';
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nova unidade' }));
    await user.type(screen.getByLabelText('Nome da unidade'), 'Unidade nova');
    failSave = true;
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
    expect(screen.getByLabelText('Nome da unidade')).toHaveValue('Unidade nova');
    expect(screen.queryByText('never display')).not.toBeInTheDocument();
    failSave = false;
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }));
    expect(await screen.findByRole('heading', { name: 'Unidade nova' })).toBeInTheDocument();
  });
  it('oferece consulta sem ações de escrita ao perfil de leitura', async () => {
    authenticated = true;
    role = 'READER';
    units = [unit];
    window.location.hash = '/unidades';
    render(<App />);
    expect(await screen.findByRole('heading', { name: unit.name })).toBeInTheDocument();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova unidade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar unidade/ })).not.toBeInTheDocument();
  });
  it('remove o conteúdo privado em uma resposta de sessão expirada', async () => {
    authenticated = true;
    expireList = true;
    render(<App />);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByText(/Sua sessão terminou/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Empresas' })).not.toBeInTheDocument();
  });
  it('valida o contrato health e recupera a conexão', async () => {
    healthFailure = true;
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByText('API indisponível')).toBeInTheDocument();
    healthFailure = false;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('API conectada')).toBeInTheDocument();
  });
  it('persiste apenas a preferência de tema e restaura o modo escuro', async () => {
    const first = render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Modo escuro' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('renr-theme')).toBe('dark');
    first.unmount();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Modo claro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Modo claro' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  });
});
