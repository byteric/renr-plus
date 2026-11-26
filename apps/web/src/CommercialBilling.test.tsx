import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { parseBrlToCents } from './components/platform/commercial/commercial-ui';

const commercialBase = '/api/v1/platform/commercial';
const billingBase = `${commercialBase}/billing`;
const orgA = '20000000-0000-4000-8000-000000000001';
const orgB = '20000000-0000-4000-8000-000000000002';
const planId = '20000000-0000-4000-8000-000000000003';
const planVersionId = '20000000-0000-4000-8000-000000000004';
const contractA = '20000000-0000-4000-8000-000000000005';
const contractRevA = '20000000-0000-4000-8000-000000000006';
const chargeOpenId = '20000000-0000-4000-8000-000000000007';
const chargeOverdueId = '20000000-0000-4000-8000-000000000008';
const chargeCreatedId = '20000000-0000-4000-8000-000000000009';
const rev1Id = '20000000-0000-4000-8000-000000000010';
const rev2Id = '20000000-0000-4000-8000-000000000011';
const rev3Id = '20000000-0000-4000-8000-000000000012';
const actorId = '20000000-0000-4000-8000-000000000013';
const timestamp = '2026-11-24T12:00:00.000Z';

const planVersion = {
  id: planVersionId,
  ordinal: 1,
  effectiveOn: '2026-10-01',
  priceCents: 1290,
  pricingUnit: 'EMPLOYEE_MONTH',
  priceMode: 'FIXED',
};

const contractRefA = {
  organizationId: orgA,
  organizationName: 'ReNR Financeira Alpha',
  isActive: true,
  clientClassification: 'DEMONSTRATION',
  fiscalState: 'MISSING',
  contract: {
    id: contractA,
    situation: 'ACTIVE',
    revisions: [
      {
        id: contractRevA,
        ordinal: 1,
        kind: 'INITIAL',
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        plan: { id: planId, name: 'Bronze' },
        planVersion,
      },
    ],
  },
};

const overdueCharge = {
  id: chargeOverdueId,
  organizationId: orgA,
  organizationName: 'ReNR Financeira Alpha',
  contractId: contractA,
  contractRevisionId: contractRevA,
  contractRevisionOrdinal: 1,
  plan: { id: planId, name: 'Bronze' },
  planVersion,
  competence: '2026-10',
  amountCents: 129000,
  dueOn: '2026-11-10',
  paidOn: null,
  receiptReference: null,
  status: 'OVERDUE',
  version: 1,
  revisionCount: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const openCharge = {
  ...overdueCharge,
  id: chargeOpenId,
  competence: '2026-11',
  amountCents: 159000,
  dueOn: '2026-11-28',
  status: 'OPEN',
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetchMock = vi.fn<typeof fetch>();
let capabilities: string[];
let denyBilling: boolean;
let currentOverdueDetail: Record<string, unknown>;
let currentItems: (typeof overdueCharge)[];

beforeEach(() => {
  window.history.replaceState(null, '', '#/plataforma/comercial');
  capabilities = ['MANAGE_BILLING'];
  denyBilling = false;
  currentItems = [openCharge, overdueCharge];
  currentOverdueDetail = {
    ...overdueCharge,
    revisions: [
      {
        id: rev1Id,
        ordinal: 1,
        kind: 'CREATED',
        contractRevisionId: contractRevA,
        contractRevisionOrdinal: 1,
        plan: { id: planId, name: 'Bronze' },
        planVersion,
        competence: '2026-10',
        amountCents: 129000,
        dueOn: '2026-11-10',
        paidOn: null,
        receiptReference: null,
        reason: 'Lançamento inicial de outubro.',
        actor: { id: actorId, name: 'Operadora Financeira' },
        createdAt: timestamp,
      },
    ],
  };

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    const method = options?.method ?? 'GET';
    if (path.endsWith('/auth/session')) {
      return json({
        user: { id: actorId, name: 'Operadora Financeira', email: 'fin@example.test' },
        activeOrganizationId: null,
        memberships: [],
        expiresAt: '2099-11-24T12:00:00.000Z',
      });
    }
    if (path.endsWith('/auth/session-capabilities')) {
      return json({ organizationId: null, capabilities: [] });
    }
    if (path.endsWith('/platform/capabilities')) return json({ capabilities });
    if (path.startsWith(billingBase) && denyBilling) return json({}, 403);
    if (path === `${billingBase}/contracts` && method === 'GET') {
      return json({ items: [contractRefA], total: 1, page: 1, pageSize: 100 });
    }
    if (path === `${billingBase}/charges` && method === 'GET') {
      const status = url.searchParams.get('status');
      const org = url.searchParams.get('organizationId');
      const scoped = org
        ? currentItems.filter((item) => item.organizationId === org)
        : currentItems;
      const open = scoped.filter((item) => item.status === 'OPEN');
      const overdue = scoped.filter((item) => item.status === 'OVERDUE');
      const paid = scoped.filter((item) => item.status === 'PAID');
      const openCents = open.reduce((sum, item) => sum + item.amountCents, 0);
      const overdueCents = overdue.reduce((sum, item) => sum + item.amountCents, 0);
      const receivedCents = paid.reduce((sum, item) => sum + item.amountCents, 0);
      const items = status ? scoped.filter((item) => item.status === status) : scoped;
      return json({
        summary: {
          timeZone: 'America/Sao_Paulo',
          referenceDate: '2026-11-24',
          billedCents: openCents + overdueCents + receivedCents,
          openCents,
          overdueCents,
          receivedCents,
          counts: {
            total: scoped.length,
            open: open.length,
            overdue: overdue.length,
            paid: paid.length,
          },
        },
        items,
        total: items.length,
        page: 1,
        pageSize: 25,
      });
    }
    if (path === `${billingBase}/clients/${orgA}/charges/${chargeOverdueId}` && method === 'GET') {
      return json(currentOverdueDetail);
    }
    if (
      path === `${billingBase}/clients/${orgA}/contracts/${contractA}/charges` &&
      method === 'POST'
    ) {
      const body = JSON.parse(String(options?.body));
      const created = {
        ...overdueCharge,
        id: chargeCreatedId,
        competence: body.competence,
        amountCents: body.amountCents,
        dueOn: body.dueOn,
        paidOn: body.paidOn,
        receiptReference: body.receiptReference,
        status: body.paidOn ? 'PAID' : 'OPEN',
        version: 1,
        revisionCount: 1,
      };
      currentItems = [created, ...currentItems];
      return json(
        {
          ...created,
          revisions: [
            {
              id: rev1Id,
              ordinal: 1,
              kind: 'CREATED',
              contractRevisionId: body.contractRevisionId,
              contractRevisionOrdinal: 1,
              plan: { id: planId, name: 'Bronze' },
              planVersion,
              competence: body.competence,
              amountCents: body.amountCents,
              dueOn: body.dueOn,
              paidOn: body.paidOn,
              receiptReference: body.receiptReference,
              reason: body.reason,
              actor: { id: actorId, name: 'Operadora Financeira' },
              createdAt: timestamp,
            },
          ],
        },
        201,
      );
    }
    if (
      path === `${billingBase}/clients/${orgA}/charges/${chargeOverdueId}/payment` &&
      method === 'POST'
    ) {
      const body = JSON.parse(String(options?.body));
      const updated = {
        ...overdueCharge,
        paidOn: body.paidOn,
        receiptReference: body.receiptReference,
        status: 'PAID',
        version: 2,
        revisionCount: 2,
      };
      currentItems = currentItems.map((item) => (item.id === chargeOverdueId ? updated : item));
      currentOverdueDetail = {
        ...updated,
        revisions: [
          ...(currentOverdueDetail.revisions as unknown[]),
          {
            id: rev2Id,
            ordinal: 2,
            kind: 'PAYMENT_CONFIRMED',
            contractRevisionId: contractRevA,
            contractRevisionOrdinal: 1,
            plan: { id: planId, name: 'Bronze' },
            planVersion,
            competence: '2026-10',
            amountCents: 129000,
            dueOn: '2026-11-10',
            paidOn: body.paidOn,
            receiptReference: body.receiptReference,
            reason: body.reason,
            actor: { id: actorId, name: 'Operadora Financeira' },
            createdAt: timestamp,
          },
        ],
      };
      return json(currentOverdueDetail, 201);
    }
    if (
      path === `${billingBase}/clients/${orgA}/charges/${chargeOverdueId}/corrections` &&
      method === 'POST'
    ) {
      const body = JSON.parse(String(options?.body));
      const updated = {
        ...overdueCharge,
        competence: body.competence,
        amountCents: body.amountCents,
        dueOn: body.dueOn,
        paidOn: body.paidOn,
        receiptReference: body.receiptReference,
        status: body.paidOn ? 'PAID' : 'OVERDUE',
        version: 3,
        revisionCount: 3,
      };
      currentItems = currentItems.map((item) => (item.id === chargeOverdueId ? updated : item));
      currentOverdueDetail = {
        ...updated,
        revisions: [
          ...(currentOverdueDetail.revisions as unknown[]),
          {
            id: rev3Id,
            ordinal: 3,
            kind: 'CORRECTION',
            contractRevisionId: body.contractRevisionId,
            contractRevisionOrdinal: 1,
            plan: { id: planId, name: 'Bronze' },
            planVersion,
            competence: body.competence,
            amountCents: body.amountCents,
            dueOn: body.dueOn,
            paidOn: body.paidOn,
            receiptReference: body.receiptReference,
            reason: body.reason,
            actor: { id: actorId, name: 'Operadora Financeira' },
            createdAt: timestamp,
          },
        ],
      };
      return json(currentOverdueDetail, 201);
    }
    if (path === `${commercialBase}/plans`) return json({ items: [] });
    if (path === `${commercialBase}/clients`)
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    return json({ orgB }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('não expõe nem busca cobranças para quem tem apenas permissão comercial sem concessão financeira', async () => {
  capabilities = ['READ_COMMERCIAL', 'MANAGE_COMMERCIAL'];
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Planos e serviços' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cobranças e pagamentos' })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes(billingBase))).toBe(false);
});

it('abre direto em cobranças para o leitor financeiro sem buscar planos e oculta dados após revogação', async () => {
  window.history.replaceState(null, '', '#/');
  capabilities = ['READ_BILLING'];
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Cobranças e pagamentos' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Planos e serviços' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Registrar cobrança' })).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes(`${commercialBase}/plans`)),
  ).toBe(false);
  const table = await screen.findByRole('table', { name: /Cobranças registradas/i });
  expect(within(table).getAllByText('ReNR Financeira Alpha')).toHaveLength(2);

  denyBilling = true;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar área comercial' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/permissão/i);
  expect(screen.queryByRole('table', { name: /Cobranças registradas/i })).not.toBeInTheDocument();
});

it('permite registrar cobrança manual, confirmar recebimento e registrar correção preservando o histórico', async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Cobranças e pagamentos' })).toBeVisible();
  expect(await screen.findByRole('table', { name: /Cobranças registradas/i })).toBeVisible();

  // 1) Registrar nova cobrança manual
  await user.click(screen.getByRole('button', { name: 'Registrar cobrança' }));
  await user.selectOptions(screen.getByLabelText('Empresa e contrato'), orgA);
  const compInput = screen.getByLabelText('Competência (AAAA-MM)');
  await user.clear(compInput);
  await user.type(compInput, '2026-12');
  await user.type(screen.getByLabelText('Valor em reais'), '1.990,50');
  await user.type(screen.getByLabelText('Vencimento'), '2026-12-20');
  await user.type(screen.getByLabelText('Motivo do registro'), 'Mensalidade de dezembro.');
  await user.click(screen.getByRole('button', { name: 'Salvar cobrança' }));

  const createCall = fetchMock.mock.calls.find(
    ([url, opts]) =>
      String(url) === `${billingBase}/clients/${orgA}/contracts/${contractA}/charges` &&
      opts?.method === 'POST',
  );
  expect(createCall).toBeDefined();
  const createPayload = JSON.parse(String(createCall?.[1]?.body));
  expect(createPayload).toMatchObject({
    contractRevisionId: contractRevA,
    competence: '2026-12',
    amountCents: 199050,
    dueOn: '2026-12-20',
    paidOn: null,
    receiptReference: null,
  });
  expect(typeof createPayload.idempotencyKey).toBe('string');

  // 2) Abrir detalhe da cobrança vencida e confirmar recebimento com comprovante opcional
  await user.click(
    await screen.findByRole('button', {
      name: /Detalhes da cobrança 2026-10 de ReNR Financeira Alpha/i,
    }),
  );
  expect(await screen.findByText(/Lançamento inicial de outubro\./)).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Confirmar recebimento' }));
  const paidOnInput = screen.getByLabelText('Data de recebimento');
  await user.clear(paidOnInput);
  await user.type(paidOnInput, '2026-11-24');
  await user.type(
    screen.getByLabelText('Referência do comprovante (opcional)'),
    'PIX-COMPROVANTE-77',
  );
  await user.type(screen.getByLabelText('Motivo da confirmação'), 'Confirmado no extrato manual.');
  await user.click(screen.getByRole('button', { name: 'Salvar recebimento' }));

  expect((await screen.findAllByText(/PIX-COMPROVANTE-77/)).length).toBeGreaterThanOrEqual(1);

  // 3) Registrar correção preservando histórico anterior
  await user.click(screen.getByRole('button', { name: 'Registrar correção' }));
  const amountInput = screen.getByLabelText('Valor em reais');
  await user.clear(amountInput);
  await user.type(amountInput, '1.350,00');
  await user.type(screen.getByLabelText('Motivo da correção'), 'Ajuste manual após conferência.');
  await user.click(screen.getByRole('button', { name: 'Salvar correção' }));

  const history = await screen.findByRole('list', { name: 'Histórico da cobrança' });
  expect(within(history).getByText(/Lançamento inicial de outubro\./)).toBeVisible();
  expect(within(history).getByText(/Confirmado no extrato manual\./)).toBeVisible();
  expect(within(history).getByText(/Ajuste manual após conferência\./)).toBeVisible();
});

it('normaliza valores monetários em reais com espaços e bloqueia correção sem alteração', async () => {
  expect(parseBrlToCents(' R$ 1.290,50 ')).toBe(129050);
  expect(parseBrlToCents('1.000')).toBe(100000);
  expect(parseBrlToCents('10.00')).toBe(1000);
  expect(parseBrlToCents('0')).toBeNull();
  expect(parseBrlToCents('-10,00')).toBeNull();

  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole('button', {
      name: /Detalhes da cobrança 2026-10 de ReNR Financeira Alpha/i,
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Registrar correção' }));
  await user.type(screen.getByLabelText('Motivo da correção'), 'Tentativa sem alterar valores.');
  await user.click(screen.getByRole('button', { name: 'Salvar correção' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /Informe ao menos uma alteração para registrar a correção\./i,
  );
  expect(
    fetchMock.mock.calls.some(
      ([url, opts]) => String(url).endsWith('/corrections') && opts?.method === 'POST',
    ),
  ).toBe(false);
});
