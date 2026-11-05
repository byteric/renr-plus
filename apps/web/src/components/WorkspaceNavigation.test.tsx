import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { SessionResponse } from '@renr/contracts';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import type { Capability, PlatformCapability } from '@renr/contracts';

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

it('shows People and platform navigation only for their explicit grants', () => {
  const props = {
    session,
    route: 'pessoas',
    unitId: null,
    pending: false,
    onSelect: () => undefined,
  };
  const access = {
    capabilities: ['HR_ANALYTICS_READ'] as Capability[],
    platformCapabilities: ['READ_OVERVIEW'] as PlatformCapability[],
  };
  const view = render(<WorkspaceNavigation {...props} {...access} />);
  expect(screen.getByRole('link', { name: 'Gestão de Pessoas' })).toHaveAttribute(
    'href',
    '#/pessoas',
  );
  expect(screen.getByRole('link', { name: 'Administração da plataforma' })).toHaveAttribute(
    'href',
    '#/plataforma',
  );
  view.rerender(<WorkspaceNavigation {...props} />);
  expect(screen.queryByRole('link', { name: 'Gestão de Pessoas' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Administração da plataforma' }),
  ).not.toBeInTheDocument();
});

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

it('oferece gestão de acessos ao administrador da empresa ativa', () => {
  render(
    <WorkspaceNavigation
      session={session}
      route="acessos"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  expect(screen.getByRole('link', { name: 'Acessos' })).toHaveAttribute('href', '#/acessos');
  expect(screen.getByRole('link', { name: 'Acessos' })).toHaveAttribute('aria-current', 'page');
});

it('não oferece administração de acessos ao leitor', () => {
  render(
    <WorkspaceNavigation
      session={{
        ...session,
        memberships: session.memberships.map((item) => ({ ...item, role: 'READER' })),
      }}
      route="acessos"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  expect(screen.queryByRole('link', { name: 'Acessos' })).not.toBeInTheDocument();
});

it('oferece auditoria administrativa somente ao administrador e identifica a rota', () => {
  const view = render(
    <WorkspaceNavigation
      session={session}
      route="auditoria"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  expect(screen.getByRole('link', { name: 'Auditoria' })).toHaveAttribute('href', '#/auditoria');
  expect(screen.getByRole('link', { name: 'Auditoria' })).toHaveAttribute('aria-current', 'page');
  view.rerender(
    <WorkspaceNavigation
      session={{
        ...session,
        memberships: session.memberships.map((member) => ({ ...member, role: 'READER' })),
      }}
      route="auditoria"
      unitId={null}
      pending={false}
      onSelect={() => undefined}
    />,
  );
  expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
});
it('distingue a navegação global de relatórios da empresa e indica a rota atual', () => {
  const props = {
    session,
    route: 'platform-reports',
    unitId: null,
    pending: false,
    onSelect: () => undefined,
  };
  const view = render(<WorkspaceNavigation {...props} platformCapabilities={['READ_OVERVIEW']} />);
  expect(screen.getByRole('link', { name: 'Relatórios da plataforma' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Relatórios' })).not.toHaveAttribute('aria-current');
  expect(screen.queryByLabelText('Empresa ativa')).not.toBeInTheDocument();
  view.rerender(<WorkspaceNavigation {...props} platformCapabilities={['MANAGE_GRANTS']} />);
  expect(screen.queryByRole('link', { name: 'Relatórios da plataforma' })).not.toBeInTheDocument();
});
