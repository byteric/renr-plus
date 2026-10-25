import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';

const org = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T12:00:00.000Z';
const session = {
  user: {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Gestora',
    email: 'gestora@example.test',
  },
  memberships: [
    { organizationId: org, organizationName: 'Empresa de teste', role: 'ADMIN' as const },
  ],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const unit = {
  id: unitId,
  organizationId: org,
  name: 'Unidade Recife',
  code: null,
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp,
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  window.location.hash = '/unidades';
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ items: [unit], total: 1, page: 1, pageSize: 50 })),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('oferece colaboradores e grupos apenas a administradores na navegação', async () => {
  const view = render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  expect(await screen.findByRole('link', { name: 'Colaboradores' })).toHaveAttribute(
    'href',
    '#/colaboradores',
  );
  expect(screen.getByRole('link', { name: 'Grupos de avaliação' })).toHaveAttribute(
    'href',
    '#/grupos',
  );
  view.rerender(
    <Structure
      session={{ ...session, memberships: [{ ...session.memberships[0]!, role: 'READER' }] }}
      onSession={vi.fn()}
      onExpire={vi.fn()}
    />,
  );
  expect(screen.queryByRole('link', { name: 'Colaboradores' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Grupos de avaliação' })).not.toBeInTheDocument();
});

it('restaura busca, situação e página pela URL sem modificar os registros', async () => {
  window.location.hash = '/unidades?search=Recife&isActive=false&page=2';
  render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  expect(await screen.findByLabelText('Buscar cadastros')).toHaveValue('Recife');
  expect(screen.getByLabelText('Situação dos cadastros')).toHaveValue('false');
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([path]) => {
        const query = new URL(String(path), 'http://localhost').searchParams;
        return (
          query.get('search') === 'Recife' &&
          query.get('isActive') === 'false' &&
          query.get('page') === '2'
        );
      }),
    ).toBe(true),
  );
});

it('aplica uma nova busca, reinicia a página e explica o impacto da desativação', async () => {
  render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Buscar cadastros'), 'Recife');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(window.location.hash).toContain('search=Recife'));
  await user.click(await screen.findByRole('button', { name: 'Editar unidade Unidade Recife' }));
  await user.click(screen.getByLabelText('Cadastro ativo'));
  expect(
    screen.getByText(/Os registros vinculados e seus históricos serão preservados/),
  ).toBeInTheDocument();
});
