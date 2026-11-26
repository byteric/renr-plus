import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@renr/contracts';
import { Diagnostics } from './components/Diagnostics';
import { RiskWorkspace } from './components/risks/RiskWorkspace';
import { ActionsWorkspace } from './components/actions/ActionsWorkspace';
import { PlatformWorkspace } from './components/platform/PlatformWorkspace';
import { CompanyGroupsAdmin } from './components/platform/CompanyGroupsAdmin';
import { WorkforceWorkspace } from './components/workforce/WorkforceWorkspace';
import { PeopleWorkspace } from './components/people/PeopleWorkspace';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';

function openScreen(
  path: string,
  {
    role = 'ADMIN',
    capabilities = ['HR_ANALYTICS_READ'],
    platform = ['READ_OVERVIEW', 'MANAGE_CLIENTS'],
  }: { role?: 'ADMIN' | 'READER'; capabilities?: string[]; platform?: string[] } = {},
) {
  history.replaceState(null, '', path);
  const session: SessionResponse = {
    user: { id: userId, name: 'Pessoa fictícia', email: 'ajuda@example.test' },
    memberships: [{ organizationId, organizationName: 'Empresa fictícia A', role }],
    activeOrganizationId: organizationId,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const endpoint = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
      switch (endpoint) {
        case '/auth/session-capabilities':
          return Response.json({ organizationId, capabilities, canManageAccess: role === 'ADMIN' });
        case '/platform/capabilities':
          return Response.json({ capabilities: platform });
        default:
          return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
      }
    }),
  );
  const onExpire = vi.fn();
  const screens = {
    '#/diagnostico': <Diagnostics session={session} onExpire={onExpire} />,
    '#/inventario': <RiskWorkspace session={session} onExpire={onExpire} />,
    '#/acoes': <ActionsWorkspace session={session} onExpire={onExpire} />,
    '#/plataforma': <PlatformWorkspace onExpire={onExpire} />,
    '#/plataforma/grupos': <CompanyGroupsAdmin onExpire={onExpire} />,
    '#/colaboradores': (
      <WorkforceWorkspace kind="colaboradores" session={session} onExpire={onExpire} />
    ),
    '#/pessoas': <PeopleWorkspace organizationId={organizationId} onExpire={onExpire} />,
  };
  render(screens[path as keyof typeof screens]);
}

afterEach(() => {
  history.replaceState(null, '', '#/');
  vi.unstubAllGlobals();
});

it.each([
  ['#/diagnostico', 'Diagnóstico demonstrativo'],
  ['#/inventario', 'Inventário'],
  ['#/acoes', 'Ações'],
  ['#/plataforma', 'Catálogo de clientes'],
  ['#/plataforma/grupos', 'Grupos de empresas'],
  ['#/colaboradores', 'Colaboradores'],
  ['#/pessoas', 'Gestão de Pessoas'],
])('abre a ajuda contextual na rota %s', async (path, screenName) => {
  openScreen(path);
  const label = 'Ajuda sobre ' + screenName;
  await userEvent.click(await screen.findByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog', { name: label });
  expect(within(dialog).getByText('Próximo passo')).toBeVisible();
  expect(within(dialog).getByText('Pré-requisitos')).toBeVisible();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar ajuda' }));
  expect(screen.queryByRole('dialog', { name: label })).not.toBeInTheDocument();
});

it('abre e fecha pelo teclado restaurando o foco ao botão de ajuda', async () => {
  openScreen('#/diagnostico');
  const user = userEvent.setup();
  const trigger = await screen.findByRole('button', {
    name: 'Ajuda sobre Diagnóstico demonstrativo',
  });
  trigger.focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', {
    name: 'Ajuda sobre Diagnóstico demonstrativo',
  });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard('{Escape}');
  expect(dialog).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('mostra como consultar um ciclo para leitor sem apresentar uma ação de criação', async () => {
  openScreen('#/diagnostico', { role: 'READER', capabilities: [] });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Ajuda sobre Diagnóstico demonstrativo' }),
  );
  const help = screen.getByRole('dialog', { name: 'Ajuda sobre Diagnóstico demonstrativo' });
  expect(within(help).getByText(/abra um ciclo do seu recorte/i)).toBeVisible();
  expect(within(help).queryByText(/selecione novo ciclo/i)).not.toBeInTheDocument();
});

it('orienta o perfil global de leitura a buscar clientes e consultar os filtros do catálogo', async () => {
  openScreen('#/plataforma', { platform: ['READ_OVERVIEW'] });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Ajuda sobre Catálogo de clientes' }),
  );
  const help = screen.getByRole('dialog', { name: 'Ajuda sobre Catálogo de clientes' });
  expect(within(help).getByText(/use os filtros do catálogo/i)).toBeVisible();
  expect(within(help).queryByText(/selecione cadastrar empresa/i)).not.toBeInTheDocument();
});
