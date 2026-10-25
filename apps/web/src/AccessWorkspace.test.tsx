import { render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const org = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const memberId = '20000000-0000-4000-8000-000000000002';
const stamp = '2026-10-23T12:00:00.000Z';
const token = 'a'.repeat(43);
const session = {
  user: { id: userId, name: 'Gestora de teste', email: 'gestora@example.test' },
  memberships: [{ organizationId: org, organizationName: 'Empresa de teste', role: 'ADMIN' }],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const member = {
  organizationId: org,
  userId: memberId,
  name: 'Pessoa leitora',
  email: 'leitora@example.test',
  role: 'READER',
  isActive: true,
  version: 1,
  capabilities: [],
  updatedAt: stamp,
};
const invite = {
  id: '30000000-0000-4000-8000-000000000001',
  organizationId: org,
  name: 'Nova pessoa',
  email: 'nova@example.test',
  role: 'READER',
  capabilities: [],
  status: 'PENDING',
  version: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: stamp,
  createdBy: { id: userId, name: 'Gestora de teste' },
  revokedAt: null,
  consumedAt: null,
};
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
let admin = true;
let signedIn = true;
let conflict = false;
let acceptedStatus = 201;
let signalsAtWrite: boolean[] = [];

beforeEach(() => {
  window.location.hash = '/acessos';
  localStorage.clear();
  sessionStorage.clear();
  admin = true;
  signedIn = true;
  conflict = false;
  acceptedStatus = 201;
  signalsAtWrite = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, options) => {
    const path = String(url).replace('/api/v1', '').split('?')[0];
    const method = options?.method ?? 'GET';
    if (method !== 'GET') signalsAtWrite.push(options?.signal?.aborted ?? false);
    if (path === '/health') return json({ status: 'ok', service: 'renr-api', timestamp: stamp });
    if (path === '/auth/session')
      return signedIn
        ? json({
            ...session,
            memberships: [{ ...session.memberships[0], role: admin ? 'ADMIN' : 'READER' }],
          })
        : json({}, 401);
    if (path === '/auth/session-capabilities')
      return json({ organizationId: org, capabilities: [], canManageAccess: admin });
    if (path === `/organizations/${org}/access-memberships`) return json(list([member]));
    if (path === `/organizations/${org}/access-memberships/${memberId}/capabilities`)
      return conflict
        ? json({}, 409)
        : json({ ...member, version: 2, capabilities: ['TECHNICAL_DECISIONS'] });
    if (path === `/organizations/${org}/access-memberships/${memberId}`)
      return json({ ...member, isActive: false, version: 2 });
    if (path === `/organizations/${org}/access-invites`)
      return method === 'POST' ? json({ invite, token }, 201) : json(list([invite]));
    if (path === `/organizations/${org}/access-history`)
      return json(
        list([
          {
            id: invite.id,
            organizationId: org,
            userId: memberId,
            actor: { id: userId, name: 'Gestora de teste' },
            action: 'ACCESS_CAPABILITY_GRANTED:TECHNICAL_DECISIONS',
            reason: 'Qualificação confirmada',
            createdAt: stamp,
          },
        ]),
      );
    if (path === '/access-invites/accept')
      return acceptedStatus === 201
        ? json({ organizationId: org, userId: memberId }, 201)
        : json(
            {
              statusCode: acceptedStatus,
              code: 'ACCESS_INVITE_UNAVAILABLE',
              message: 'Invitation unavailable',
              requestId: '40000000-0000-4000-8000-000000000001',
              timestamp: stamp,
            },
            acceptedStatus,
          );
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('abre membros, diferencia capacidades e registra concessão explícita com justificativa', async () => {
  render(<App />);
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Acessos', level: 1 })).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Gerenciar Pessoa leitora' }));
  expect(screen.getByLabelText('Decisões técnicas')).not.toBeChecked();
  await user.click(screen.getByLabelText('Decisões técnicas'));
  await user.type(screen.getByLabelText('Justificativa da alteração'), 'Qualificação confirmada');
  await user.click(screen.getByRole('button', { name: 'Salvar capacidades' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/organizations/${org}/access-memberships/${memberId}/capabilities`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: 1,
          reason: 'Qualificação confirmada',
          capabilities: ['TECHNICAL_DECISIONS'],
        }),
      }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Histórico de acessos' }));
  expect(await screen.findByText('Qualificação confirmada')).toBeInTheDocument();
  expect(screen.getByText('Decisões técnicas concedidas')).toBeInTheDocument();
  expect(screen.getAllByText('Gestora de teste').length).toBeGreaterThan(0);
});

it('nega rota direta para leitor sem consultar dados administrativos', async () => {
  admin = false;
  render(<App />);
  expect(
    await screen.findByText('Somente administradores da empresa podem gerenciar acessos.'),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/access-memberships'))).toBe(
    false,
  );
  expect(screen.queryByRole('link', { name: 'Acessos' })).not.toBeInTheDocument();
});

it('preserva rascunho em conflito e exige recarregar antes de reenviar', async () => {
  conflict = true;
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Gerenciar Pessoa leitora' }));
  await user.click(screen.getByLabelText('Decisões técnicas'));
  await user.type(screen.getByLabelText('Justificativa da alteração'), 'Permissão revisada');
  await user.click(screen.getByRole('button', { name: 'Salvar capacidades' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('O registro mudou');
  expect(screen.getByLabelText('Justificativa da alteração')).toHaveValue('Permissão revisada');
  expect(screen.getByRole('button', { name: 'Salvar capacidades' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Recarregar registro' }));
  expect(await screen.findByRole('button', { name: 'Salvar capacidades' })).toBeEnabled();
});

it('exige confirmação explícita antes de desativar vínculo', async () => {
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Gerenciar Pessoa leitora' }));
  await user.click(screen.getByLabelText('Vínculo ativo'));
  await user.type(screen.getByLabelText('Justificativa da alteração'), 'Saída da empresa');
  await user.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Confirme a desativação');
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  await user.click(screen.getByLabelText('Confirmo a desativação deste vínculo'));
  await user.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
  );
});

it('emite convite sem capacidade automática e descarta segredo ao fechar', async () => {
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Convites de acesso' }));
  await user.click(screen.getByRole('button', { name: 'Novo convite' }));
  const form = screen.getByRole('form', { name: 'Convidar pessoa' });
  await user.type(within(form).getByLabelText('Nome da pessoa'), 'Nova pessoa');
  await user.type(within(form).getByLabelText('E-mail da pessoa'), 'nova@example.test');
  await user.type(within(form).getByLabelText('Justificativa do convite'), 'Entrada autorizada');
  await user.click(within(form).getByRole('button', { name: 'Emitir convite' }));
  const link = await screen.findByLabelText('Link de ativação — exibição única');
  expect((link as HTMLInputElement).value).toContain(`#/ativar/${token}`);
  expect(
    Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index)!),
    ).join(''),
  ).not.toContain(token);
  expect(sessionStorage.length).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Fechar link secreto' }));
  expect(screen.queryByLabelText('Link de ativação — exibição única')).not.toBeInTheDocument();
});

it.each(['#/ativar/', '#ativar/'])(
  'remove token da URL (%s) antes de ativar nova conta e não o persiste',
  async (prefix) => {
    signedIn = false;
    window.location.hash = `${prefix}${token}`;
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Criar meu acesso' }));
    expect(window.location.hash).toBe('#/ativar');
    await user.type(screen.getByLabelText('Seu nome'), 'Nova pessoa');
    await user.type(screen.getByLabelText('Nova senha'), 'SyntheticPass123!');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'SyntheticPass123!');
    await user.click(screen.getByRole('button', { name: 'Ativar acesso' }));
    expect(
      await screen.findByText('Acesso ativado. Entre com sua conta para continuar.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/access-invites/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token, name: 'Nova pessoa', password: 'SyntheticPass123!' }),
      }),
    );
    expect(sessionStorage.length).toBe(0);
  },
);

it('conta autenticada aceita convite sem enviar senha nem trocar credenciais', async () => {
  window.location.hash = `/ativar/${token}`;
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Aceitar vínculo' }));
  expect(
    await screen.findByText('Vínculo ativado. Acesse a empresa pelo espaço de trabalho.'),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/access-invites/accept',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ token }) }),
  );
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
});

it('convite expirado orienta solicitar reemissão sem repetir automaticamente', async () => {
  acceptedStatus = 409;
  window.location.hash = `/ativar/${token}`;
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Aceitar vínculo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Solicite a reemissão ao administrador',
  );
  expect(screen.queryByRole('button', { name: 'Aceitar vínculo' })).not.toBeInTheDocument();
});

it('permite colar o código manual completo após recarregar a página', async () => {
  signedIn = false;
  window.location.hash = '/ativar';
  render(<App />);
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Código do convite de acesso');
  await user.type(input, token);
  expect(screen.getByLabelText('Código do convite de acesso')).toHaveValue(token);
});

it('salva capacidades em StrictMode com sinal de cancelamento ainda válido', async () => {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Gerenciar Pessoa leitora' }));
  await user.type(screen.getByLabelText('Justificativa da alteração'), 'Permissão confirmada');
  await user.click(screen.getByRole('button', { name: 'Salvar capacidades' }));
  expect(signalsAtWrite).toEqual([false]);
});
