import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

const groupId = '10000000-0000-4000-8000-000000000001';
const firstId = '10000000-0000-4000-8000-000000000002';
const secondId = '10000000-0000-4000-8000-000000000003';
const user = {
  id: '10000000-0000-4000-8000-000000000004',
  name: 'Diretoria de teste',
  email: 'diretoria@example.test',
};
const group = { id: groupId, name: 'Grupo Horizonte' };
const metrics = (employees: number) => ({
  employees,
  openRisks: 2,
  actions: { pending: 3, inProgress: 1, done: 2, cancelled: 0 },
  participation: { status: 'PROTECTED' },
  evolution: { status: 'UNAVAILABLE' },
});
const companies = [
  { id: firstId, name: 'Horizonte Recife', fiscalIdentifier: null, metrics: metrics(8) },
  { id: secondId, name: 'Horizonte Olinda', fiscalIdentifier: null, metrics: metrics(4) },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '#/');
});

it('abre a visão do grupo sem vínculo de empresa, filtra o CNPJ e remove os dados após revogação', async () => {
  history.replaceState(null, '', '#/');
  let granted = true;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/session')
      return Response.json({
        user,
        memberships: [],
        activeOrganizationId: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
        ...(granted ? { hasCompanyGroups: true } : {}),
      });
    if (path === '/platform/capabilities') return Response.json({ capabilities: [] });
    if (path === '/auth/session-capabilities')
      return Response.json({ organizationId: null, capabilities: [], canManageAccess: false });
    if (path === '/company-groups') return Response.json({ items: granted ? [group] : [] });
    if (path === `/company-groups/${groupId}` && granted) {
      if (url.searchParams.get('organizationId') === secondId)
        return Response.json({ group, totals: metrics(4), companies: [companies[1]] });
      return Response.json({ group, totals: metrics(12), companies });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Consolidado de empresas' })).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Horizonte Recife' })).toBeVisible();
  expect(screen.queryByLabelText('Empresa ativa')).not.toBeInTheDocument();
  expect(screen.getAllByText('Dados protegidos').length).toBeGreaterThan(0);

  await userEvent.selectOptions(screen.getByLabelText('Empresa no consolidado'), secondId);
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Horizonte Recife' })).not.toBeInTheDocument(),
  );
  expect(await screen.findByRole('heading', { name: 'Horizonte Olinda' })).toBeVisible();
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes(`organizationId=${secondId}`)),
  ).toBe(true);

  granted = false;
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(screen.queryByText('Horizonte Olinda')).not.toBeInTheDocument());
  expect(screen.queryByRole('link', { name: 'Consolidado de empresas' })).not.toBeInTheDocument();
});

it('limpa o contexto operacional de um gestor após a revogação na sessão aberta', async () => {
  history.replaceState(null, '', '#/unidades');
  let revoked = false;
  const unitId = '10000000-0000-4000-8000-000000000005';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
      if (path === '/auth/session')
        return Response.json({
          user,
          memberships: [
            { organizationId: firstId, organizationName: 'Horizonte Recife', role: 'READER' },
          ],
          activeOrganizationId: firstId,
          organizationScopes: { [firstId]: revoked ? [] : [{ unitId, sectorId: null }] },
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
      if (path === `/organizations/${firstId}/units` && !revoked)
        return Response.json({
          items: [
            {
              id: unitId,
              organizationId: firstId,
              name: 'Unidade permitida',
              isActive: true,
              code: null,
              createdAt: '2026-11-16T00:00:00Z',
              updatedAt: '2026-11-16T00:00:00Z',
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
        });
      if (path === '/platform/capabilities') return Response.json({ capabilities: [] });
      if (path === '/auth/session-capabilities')
        return Response.json({ organizationId: firstId, capabilities: [], canManageAccess: false });
      return new Response('{}', { status: 404 });
    }),
  );
  render(<App />);

  expect(await screen.findByText('Unidade permitida')).toBeVisible();
  expect(screen.getByText('Acesso por unidade ou setor')).toBeVisible();
  revoked = true;
  window.dispatchEvent(new Event('focus'));
  expect(
    await screen.findByText('Seu vínculo está sem unidades ou setores autorizados.'),
  ).toBeVisible();
  expect(screen.queryByText('Unidade permitida')).not.toBeInTheDocument();
});
