import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { SessionResponse } from '@renr/contracts';
import { WorkspaceNavigation } from './WorkspaceNavigation';

const session: SessionResponse = {
  user: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Equipe de teste',
    email: 'team@example.test',
  },
  memberships: [
    {
      organizationId: '10000000-0000-4000-8000-000000000001',
      organizationName: 'Empresa fictícia',
      role: 'ADMIN',
    },
  ],
  activeOrganizationId: '10000000-0000-4000-8000-000000000001',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

it('oferece acesso direto ao inventário e identifica a etapa atual', () => {
  render(
    <WorkspaceNavigation
      session={session}
      route="inventario"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  const link = screen.getByRole('link', { name: 'Inventário' });
  expect(link).toHaveAttribute('href', '#/inventario');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Diagnóstico' })).toHaveAttribute(
    'href',
    '#/diagnostico',
  );
});

it('oferece ações como etapa operacional e identifica a rota atual', () => {
  render(
    <WorkspaceNavigation
      session={session}
      route="acoes"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  expect(screen.getByRole('link', { name: 'Ações' })).toHaveAttribute('href', '#/acoes');
  expect(screen.getByRole('link', { name: 'Ações' })).toHaveAttribute('aria-current', 'page');
});
