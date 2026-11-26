import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { CompanyGroupsAdmin } from './components/platform/CompanyGroupsAdmin';

const commercialBase = '/api/v1/platform/commercial';
const orgId = '51000000-0000-4000-8000-000000000001';
const contractId = '51000000-0000-4000-8000-000000000002';
const chargeId = '51000000-0000-4000-8000-000000000003';
const accessId = '51000000-0000-4000-8000-000000000004';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetchMock = vi.fn<typeof fetch>();
let capabilities: string[] = [];
let dashboardResponse: Record<string, unknown>;

function buildDashboard(overrides: Record<string, unknown> = {}) {
  const canReadBilling =
    capabilities.includes('READ_BILLING') || capabilities.includes('MANAGE_BILLING');
  const canManageBilling = capabilities.includes('MANAGE_BILLING');
  const canReadCatalog =
    capabilities.includes('READ_COMMERCIAL') || capabilities.includes('MANAGE_COMMERCIAL');
  const canManageCatalog = capabilities.includes('MANAGE_COMMERCIAL');
  const canReadAccess =
    capabilities.includes('READ_CONTRACT_ACCESS') ||
    capabilities.includes('MANAGE_CONTRACT_ACCESS');
  const canManageAccess = capabilities.includes('MANAGE_CONTRACT_ACCESS');
  const canManageClients = capabilities.includes('MANAGE_CLIENTS');
  const canReadOverview = capabilities.includes('READ_OVERVIEW');
  const canReadSupport =
    capabilities.includes('READ_SUPPORT') || capabilities.includes('MANAGE_SUPPORT');

  return {
    generatedAt: '2026-11-25T12:00:00.000Z',
    timeZone: 'America/Sao_Paulo',
    referenceDate: '2026-11-25',
    period: { competenceFrom: null, competenceTo: null, renewalWindowDays: 30 },
    organizationId: null,
    scope: {
      canReadOverview,
      canManageClients,
      canReadCatalog,
      canManageCatalog,
      canReadBilling,
      canManageBilling,
      canReadContractAccess: canReadAccess,
      canManageContractAccess: canManageAccess,
      canReadSupport,
    },
    catalog:
      canReadOverview || canManageClients || canReadCatalog
        ? {
            totalOrganizations: 2,
            activeClients: 2,
            inactiveClients: 0,
            demonstrations: 0,
            unclassified: 0,
            pendingFiscal: 0,
          }
        : null,
    contracts: canReadCatalog
      ? {
          total: 2,
          active: 1,
          scheduled: 0,
          expiringSoon: 1,
          expired: 1,
          cancelled: 0,
          withoutContractActiveClients: 0,
          pendingDocumentCount: 0,
        }
      : null,
    billing: canReadBilling
      ? {
          timeZone: 'America/Sao_Paulo',
          referenceDate: '2026-11-25',
          billedCents: 345000,
          openCents: 75000,
          overdueCents: 150000,
          receivedCents: 120000,
          counts: { total: 4, open: 1, overdue: 2, paid: 1 },
        }
      : null,
    contractAccess: canReadAccess
      ? { totalClients: 2, active: 1, suspended: 1, unrecorded: 0 }
      : null,
    supportTickets: canReadSupport ? { pending: 0, dueSoon: 0, overdue: 0 } : null,
    alerts: [
      ...(canReadCatalog
        ? [
            {
              id: `CONTRACT_EXPIRED:${orgId}:${contractId}`,
              kind: 'CONTRACT_EXPIRED',
              severity: 'high',
              domain: 'contracts',
              organizationId: orgId,
              organizationName: 'Cliente Painel Alpha',
              sourceType: 'contract',
              sourceId: contractId,
              referenceDate: '2026-11-10',
              title: 'Contrato vencido aguardando renovação ou encerramento',
              description: 'A vigência de Cliente Painel Alpha encerrou em 10/11/2026.',
              amountCents: null,
              itemCount: null,
              actionTarget: 'commercial-clients',
              billingStatusFilter: null,
              clientClassification: null,
            },
          ]
        : []),
      ...(canReadBilling
        ? [
            {
              id: `BILLING_OVERDUE:${orgId}`,
              kind: 'BILLING_OVERDUE',
              severity: 'high',
              domain: 'billing',
              organizationId: orgId,
              organizationName: 'Cliente Painel Alpha',
              sourceType: 'billing_charge',
              sourceId: chargeId,
              referenceDate: '2026-11-05',
              title: '2 cobranças vencidas em aberto',
              description: 'Cliente Painel Alpha soma R$ 1.500,00 vencidos desde 05/11/2026.',
              amountCents: 150000,
              itemCount: 2,
              actionTarget: 'commercial-billing',
              billingStatusFilter: 'OVERDUE',
              clientClassification: null,
            },
          ]
        : []),
      ...(canReadAccess
        ? [
            {
              id: `CONTRACT_ACCESS_SUSPENDED:${orgId}:${accessId}`,
              kind: 'CONTRACT_ACCESS_SUSPENDED',
              severity: 'high',
              domain: 'access',
              organizationId: orgId,
              organizationName: 'Cliente Painel Alpha',
              sourceType: 'contract_access',
              sourceId: accessId,
              referenceDate: '2026-11-20',
              title: 'Acesso contratual suspenso',
              description: 'Cliente Painel Alpha está com acesso contratual suspenso.',
              amountCents: null,
              itemCount: null,
              actionTarget: 'commercial-access',
              billingStatusFilter: null,
              clientClassification: null,
            },
          ]
        : []),
    ],
    reconciliation: {
      source: 'COMMERCIAL_LIVE_RECORDS',
      referenceDate: '2026-11-25',
      timeZone: 'America/Sao_Paulo',
      checkedAt: '2026-11-25T12:00:00.000Z',
      counts: {
        organizations: canReadCatalog || canReadOverview ? 2 : null,
        contracts: canReadCatalog ? 2 : null,
        charges: canReadBilling ? 4 : null,
        accessRecords: canReadAccess ? 2 : null,
        alerts: (canReadCatalog ? 1 : 0) + (canReadBilling ? 1 : 0) + (canReadAccess ? 1 : 0),
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/plataforma/comercial?secao=painel');
  capabilities = ['READ_COMMERCIAL'];
  dashboardResponse = buildDashboard();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    if (path.endsWith('/auth/session'))
      return json({
        user: { id: orgId, name: 'Operadora ID51', email: 'op@renr.example' },
        activeOrganizationId: null,
        memberships: [],
        expiresAt: '2099-11-25T12:00:00.000Z',
      });
    if (path.endsWith('/auth/session-capabilities'))
      return json({ organizationId: null, capabilities: [] });
    if (path.endsWith('/platform/capabilities')) return json({ capabilities });
    if (path === `${commercialBase}/plans`) return json({ items: [] });
    if (path === `${commercialBase}/dashboard`) return json(dashboardResponse);
    if (path === `${commercialBase}/billing/contracts`)
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (path === `${commercialBase}/billing/charges`)
      return json({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        summary: {
          timeZone: 'America/Sao_Paulo',
          referenceDate: '2026-11-25',
          billedCents: 0,
          openCents: 0,
          overdueCents: 0,
          receivedCents: 0,
          counts: { total: 0, open: 0, overdue: 0, paid: 0 },
        },
      });
    if (path === '/api/v1/platform/company-groups')
      return json({ items: [], total: 0, page: 1, pageSize: 15 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('restringe indicadores financeiros e atalhos não concedidos no painel comercial para perfil somente contratos', async () => {
  capabilities = ['READ_COMMERCIAL'];
  dashboardResponse = buildDashboard();
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Painel comercial' })).toBeVisible();
  expect(await screen.findByText(/Restrito aos perfis financeiros concedidos/i)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Cadastrar empresa (CNPJ)' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Registrar cobrança/i })).not.toBeInTheDocument();
  expect(screen.getByText(/Contrato vencido aguardando renovação/i)).toBeVisible();
  expect(screen.queryByText(/cobranças vencidas/i)).not.toBeInTheDocument();
  expect(screen.queryAllByText(/Fila de chamados|Aguardando ID 50/)).toHaveLength(0);
});

it('abre a fila no chamado indicado pelo alerta do painel', async () => {
  capabilities = ['READ_SUPPORT'];
  dashboardResponse = buildDashboard({
    supportTickets: { pending: 1, dueSoon: 0, overdue: 1 },
    alerts: [
      {
        id: `SUPPORT_OVERDUE:${contractId}`,
        kind: 'SUPPORT_OVERDUE',
        severity: 'high',
        domain: 'support',
        organizationId: orgId,
        organizationName: 'Cliente Painel Alpha',
        sourceType: 'support_ticket',
        sourceId: contractId,
        referenceDate: '2026-11-20',
        title: 'Chamado com prazo vencido',
        description: 'Prazo registrado para o atendimento.',
        amountCents: null,
        itemCount: null,
        actionTarget: 'platform-support',
        billingStatusFilter: null,
      },
    ],
  });
  render(<App />);

  expect(
    await screen.findByRole('link', { name: /Abrir chamado de Cliente Painel Alpha/i }),
  ).toHaveAttribute('href', `#/plataforma/chamados/${contractId}`);
});

it('exibe totais reconciliados, valida período, aciona atalhos de alerta e mostra estado vazio', async () => {
  capabilities = [
    'READ_OVERVIEW',
    'MANAGE_CLIENTS',
    'MANAGE_COMMERCIAL',
    'MANAGE_BILLING',
    'MANAGE_CONTRACT_ACCESS',
  ];
  dashboardResponse = buildDashboard();
  const user = userEvent.setup();
  render(<App />);

  expect(await screen.findByRole('link', { name: 'Cadastrar empresa (CNPJ)' })).toHaveAttribute(
    'href',
    '#/plataforma?action=new-client',
  );
  expect(screen.getByText(/2 cobranças vencidas em aberto/)).toBeVisible();
  const table = screen.getByRole('table', { name: /Resumo consolidado e reconciliação/i });
  expect(within(table).getByText(/4 cobranças/)).toBeVisible();

  // Clicar no alerta de cobranças vencidas abre Cobranças e pagamentos filtrado por status OVERDUE e organização
  await user.click(screen.getByRole('button', { name: 'Abrir cobranças de Cliente Painel Alpha' }));
  expect(await screen.findByRole('heading', { name: 'Cobranças e pagamentos' })).toBeVisible();
  expect(
    fetchMock.mock.calls.some(
      ([url]) =>
        String(url).includes('/platform/commercial/billing/charges') &&
        String(url).includes(`organizationId=${orgId}`) &&
        String(url).includes('status=OVERDUE'),
    ),
  ).toBe(true);
});

it('orienta o administrador em Grupos de empresas sobre o cadastro prévio por CNPJ no catálogo', async () => {
  capabilities = ['MANAGE_CLIENTS'];
  render(<CompanyGroupsAdmin onExpire={vi.fn()} />);

  expect(
    await screen.findByText(/Grupos reúnem apenas empresas já cadastradas no catálogo/i),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Cadastrar empresa no catálogo (CNPJ)' }),
  ).toHaveAttribute('href', '#/plataforma?action=new-client');
});
