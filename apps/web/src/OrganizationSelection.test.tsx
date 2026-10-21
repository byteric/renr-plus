import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@renr/contracts';
import { Structure } from './components/Structure';

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherOrganizationId = '10000000-0000-4000-8000-000000000002';
const session: SessionResponse = {
  user: {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Equipe de teste',
    email: 'team@example.test',
  },
  memberships: [
    { organizationId, organizationName: 'Empresa atual', role: 'ADMIN' },
    {
      organizationId: otherOrganizationId,
      organizationName: 'Outra empresa',
      role: 'ADMIN',
    },
  ],
  activeOrganizationId: organizationId,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '/empresas';
});

it.each([
  [503, 'Serviço temporariamente indisponível'],
  [404, 'Este registro não está mais disponível'],
  [0, 'Sem conexão com o serviço'],
])(
  'informa falha %s ao trocar empresa no inventário sem mudar o contexto',
  async (status, message) => {
    window.location.hash = '/inventario';
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        const path = new URL(String(url), 'http://localhost').pathname;
        if (path.endsWith('/auth/session/organization') && init?.method === 'PUT') {
          if (status === 0) throw new TypeError('Network unavailable');
          return new Response('{}', { status: Number(status) });
        }
        return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
      }),
    );
    const onSession = vi.fn();
    render(<Structure session={session} onSession={onSession} onExpire={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Nenhum registro neste recorte' });

    await userEvent.selectOptions(screen.getByLabelText('Empresa ativa'), otherOrganizationId);

    expect(await screen.findByRole('alert')).toHaveTextContent(String(message));
    expect(screen.getByLabelText('Empresa ativa')).toHaveValue(organizationId);
    expect(screen.getByRole('heading', { name: 'Inventário', exact: true })).toBeVisible();
    expect(onSession).not.toHaveBeenCalled();
  },
);
