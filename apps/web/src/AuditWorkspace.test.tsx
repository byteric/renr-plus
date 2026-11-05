import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const org = '10000000-0000-4000-8000-000000000001';
const actor = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Pessoa responsável pela avaliação',
};
const action = '30000000-0000-4000-8000-000000000001';
const revision = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-29T01:30:00.000Z';
const event = {
  id: `revision:${revision}`,
  operation: 'ACTION_UPDATED',
  label: 'Ação atualizada',
  actor,
  createdAt: stamp,
  reason: 'Revisão de escopo pactuada pela equipe.',
  resource: { type: 'action', id: action, label: 'Reorganizar capacidade da sprint' },
  target: { kind: 'action-revision', id: revision, parentId: action, revision: 3 },
};
const session = {
  user: { ...actor, email: 'admin@example.test' },
  memberships: [{ organizationId: org, organizationName: 'Empresa fictícia', role: 'ADMIN' }],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn<typeof fetch>();
let role = 'ADMIN';
let denied = false;
let deniedRecord = false;
let total = 1;
beforeEach(() => {
  localStorage.clear();
  window.location.hash = '/auditoria';
  role = 'ADMIN';
  denied = false;
  deniedRecord = false;
  total = 1;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/health') return json({ status: 'ok', service: 'renr-api', timestamp: stamp });
    if (path === '/auth/session')
      return json({ ...session, memberships: [{ ...session.memberships[0], role }] });
    if (path === `/organizations/${org}/audit-events`)
      return denied
        ? json({}, 403)
        : json({
            items: [event],
            total,
            page: Number(url.searchParams.get('page') || 1),
            pageSize: 20,
            timeZone: 'America/Sao_Paulo',
          });
    if (path === `/organizations/${org}/history-records/action-revision/${revision}`)
      return deniedRecord
        ? json({}, 403)
        : json({
            event,
            timeZone: 'America/Sao_Paulo',
            details: [
              { label: 'Descrição preservada', value: 'Conteúdo específico da revisão três.' },
            ],
          });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('consulta auditoria em fuso organizacional e abre a revisão exata preservando os filtros e o foco', async () => {
  render(<App />);
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Auditoria', level: 1 })).toBeInTheDocument();
  expect(await screen.findByText(event.reason)).toBeInTheDocument();
  expect(screen.getByText('28/10/2026, 22:30')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Operação'), 'ACTION_UPDATED');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(window.location.hash).toContain('operation=ACTION_UPDATED'));
  const open = await screen.findByRole('button', { name: /Abrir registro.*Ação atualizada/ });
  await user.click(open);
  const dialog = await screen.findByRole('dialog');
  expect(
    await within(dialog).findByText('Conteúdo específico da revisão três.'),
  ).toBeInTheDocument();
  expect(window.location.hash).toContain(`recordId=${revision}`);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(window.location.hash).toContain('operation=ACTION_UPDATED');
  expect(window.location.hash).not.toContain('recordId=');
  await waitFor(() => expect(open).toHaveFocus());
});

it('bloqueia acesso administrativo do leitor mesmo em endereço direto sem consultar dados', async () => {
  role = 'READER';
  render(<App />);
  expect(
    await screen.findByText(
      'A auditoria administrativa está disponível apenas para administradores.',
    ),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/audit-events'))).toBe(false);
  expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
});

it('pagina pela URL e remove os dados anteriores quando o acesso é revogado', async () => {
  total = 21;
  render(<App />);
  const user = userEvent.setup();
  expect(await screen.findByText(event.reason)).toBeInTheDocument();
  denied = true;
  await user.click(screen.getByRole('button', { name: 'Próxima página' }));
  await waitFor(() => expect(window.location.hash).toContain('page=2'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
  expect(screen.queryByText(event.reason)).not.toBeInTheDocument();
});

it('rejeita período invertido sem descartar os valores do formulário', async () => {
  render(<App />);
  const user = userEvent.setup();
  await screen.findByText(event.reason);
  await user.type(screen.getByLabelText('De'), '2026-10-29');
  await user.type(screen.getByLabelText('Até'), '2026-10-01');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira o período');
  expect(screen.getByLabelText('De')).toHaveValue('2026-10-29');
  expect(window.location.hash).not.toContain('from=');
});

it('remove também a lista quando a consulta do registro informa perda de acesso', async () => {
  render(<App />);
  await screen.findByText(event.reason);
  deniedRecord = true;
  await userEvent.click(screen.getByRole('button', { name: /Abrir registro.*Ação atualizada/ }));
  await waitFor(() => expect(screen.queryByText(event.reason)).not.toBeInTheDocument());
  expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
});

it('preserva o filtro quando o registro é aberto antes do evento hashchange do filtro', async () => {
  render(<App />);
  await screen.findByText(event.reason);
  fireEvent.change(screen.getByLabelText('Operação'), { target: { value: 'ACTION_UPDATED' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Filtros da auditoria' }));
  fireEvent.click(screen.getByRole('button', { name: /Abrir registro.*Ação atualizada/ }));
  expect(window.location.hash).toContain('operation=ACTION_UPDATED');
  expect(window.location.hash).toContain(`recordId=${revision}`);
});
