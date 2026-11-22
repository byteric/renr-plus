import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const base = '/api/v1/platform/commercial';
const organizationId = '10000000-0000-4000-8000-000000000001';
const planId = '10000000-0000-4000-8000-000000000002';
const oldVersion = '10000000-0000-4000-8000-000000000003';
const newVersion = '10000000-0000-4000-8000-000000000004';
const contractId = '10000000-0000-4000-8000-000000000005';
const firstRevisionId = '10000000-0000-4000-8000-000000000006';
const secondRevisionId = '10000000-0000-4000-8000-000000000007';
const documentId = '10000000-0000-4000-8000-000000000008';
const timestamp = '2026-11-23T12:00:00.000Z';
const name = 'ReNR Demo Alpha';
const clientPath = `${base}/clients/${organizationId}`;
const contractPath = `${clientPath}/contract`;
const revisionPath = `${contractPath}/${contractId}/revisions`;
const documentPath = `${revisionPath}/${firstRevisionId}/document`;
const plan = {
  id: planId,
  name: 'Bronze',
  kind: 'PLAN',
  version: 2,
  versions: [
    {
      id: oldVersion,
      ordinal: 1,
      effectiveOn: '2026-11-01',
      priceCents: 1290,
      pricingUnit: 'EMPLOYEE_MONTH',
      priceMode: 'FIXED',
      conditions: 'Condições originais da edição Bronze.',
      limits: 'Até 10 páginas no resumo.',
      includedFeatures: ['Painel por departamento'],
      plannedFeatures: [],
    },
    {
      id: newVersion,
      ordinal: 2,
      effectiveOn: '2026-12-01',
      priceCents: 1590,
      pricingUnit: 'EMPLOYEE_MONTH',
      priceMode: 'FIXED',
      conditions: 'Condições novas para dezembro.',
      limits: 'Até 10 páginas no resumo.',
      includedFeatures: ['Painel por departamento'],
      plannedFeatures: [],
    },
  ],
};
const firstRevision = {
  id: firstRevisionId,
  ordinal: 1,
  kind: 'INITIAL',
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  terms: 'Condições vigentes no termo inicial.',
  reason: 'Cadastro do documento contratual.',
  plan: { id: planId, name: 'Bronze' },
  planVersion: plan.versions[0],
  createdAt: timestamp,
  document: null,
  documentPending: false,
  withdrawal: null,
};
const contract = {
  id: contractId,
  organizationId,
  version: 1,
  situation: 'ACTIVE',
  currentRevisionId: firstRevisionId,
  revisions: [firstRevision],
};
const client = {
  organizationId,
  name,
  isActive: true,
  clientClassification: 'DEMONSTRATION',
  fiscalIdentifier: null,
  fiscalState: 'MISSING',
  contactName: 'Pessoa comercial',
  contactEmail: 'contato@example.test',
  adoptedOn: '2026-11-01',
  version: 1,
  activePlan: { id: planId, name: 'Bronze', versionId: oldVersion, ordinal: 1 },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetchMock = vi.fn<typeof fetch>();
let capabilities: string[];
let denyCommercial: boolean;

beforeEach(() => {
  window.history.replaceState(null, '', '#/plataforma/comercial');
  capabilities = ['READ_OVERVIEW', 'MANAGE_COMMERCIAL'];
  denyCommercial = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    const method = options?.method ?? 'GET';
    if (path.endsWith('/auth/session'))
      return json({
        user: { id: organizationId, name: 'Pessoa administradora', email: 'admin@example.test' },
        activeOrganizationId: null,
        memberships: [],
        expiresAt: '2099-11-23T12:00:00.000Z',
      });
    if (path.endsWith('/auth/session-capabilities'))
      return json({ organizationId: null, capabilities: [] });
    if (path.endsWith('/platform/capabilities')) return json({ capabilities });
    if (path.endsWith('/platform/overview')) return json({}, 503);
    if (path === '/api/v1/platform/clients')
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (path.startsWith(base) && denyCommercial) return json({}, 403);
    if (path === `${base}/plans` && method === 'GET') return json({ items: [plan] });
    if (path === `${base}/plans` && method === 'POST') {
      const body = JSON.parse(String(options?.body));
      return json(
        {
          ...plan,
          name: body.name,
          kind: body.kind,
          version: 1,
          versions: [{ ...body.version, id: oldVersion, ordinal: 1 }],
        },
        201,
      );
    }
    if (path === `${base}/clients`)
      return json({ items: [client], total: 1, page: 1, pageSize: 25 });
    if (path === contractPath) return json({ contract });
    if (path === revisionPath && method === 'POST') {
      const body = JSON.parse(String(options?.body));
      return json(
        {
          ...contract,
          version: 2,
          revisions: [
            ...contract.revisions,
            {
              ...firstRevision,
              id: secondRevisionId,
              ordinal: 2,
              kind: body.kind,
              startsOn: body.startsOn,
              endsOn: body.endsOn,
              terms: body.terms,
              reason: body.reason,
              planVersion: plan.versions[1],
            },
          ],
        },
        201,
      );
    }
    if (path === documentPath && method === 'POST')
      return json(
        {
          id: documentId,
          fileName: 'contrato-assinado.pdf',
          size: 8,
          sha256: 'a'.repeat(64),
          createdAt: timestamp,
        },
        201,
      );
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('preserva o catálogo fiscal e não busca dados comerciais para o leitor global', async () => {
  capabilities = ['READ_OVERVIEW'];
  render(<App />);

  expect(await screen.findByText(/área comercial exige uma concessão/i)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Comercial' })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes(base))).toBe(false);
});

it('mostra catálogo sem oferecer edição ao leitor comercial e oculta dados após a recusa', async () => {
  window.history.replaceState(null, '', '#/');
  capabilities = ['READ_COMMERCIAL'];
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Bronze' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Comercial' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Nova oferta' })).not.toBeInTheDocument();
  denyCommercial = true;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar área comercial' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/permissão comercial/i);
  expect(screen.queryByRole('heading', { name: 'Bronze' })).not.toBeInTheDocument();
});

it('usa os valores e limites do exemplo sem salvar e envia preço inteiro ao confirmar', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Nova oferta' }));
  await user.selectOptions(screen.getByLabelText('Exemplo de referência'), 'CAPACITACAO');
  expect(screen.getByLabelText('Preço em reais')).toHaveValue('990,00');
  expect(screen.getByLabelText('Limites')).toHaveValue('Até 25 colaboradores por turma.');
  expect(
    fetchMock.mock.calls.some(
      ([url, options]) => url === `${base}/plans` && options?.method === 'POST',
    ),
  ).toBe(false);
  await user.type(screen.getByLabelText('Motivo do registro'), 'Preço comercial de referência.');
  await user.click(screen.getByRole('button', { name: 'Salvar oferta' }));
  const sent = fetchMock.mock.calls.find(
    ([url, options]) => url === `${base}/plans` && options?.method === 'POST',
  );
  expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
    kind: 'SERVICE',
    version: { priceCents: 99000, pricingUnit: 'TRAINING_CLASS', priceMode: 'FIXED' },
  });
});

it('filtra empresas de demonstração, preserva o termo anterior ao renovar e vincula o PDF a ele', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Clientes e contratos' }));
  await user.selectOptions(screen.getByLabelText('Classificação'), 'DEMONSTRATION');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(
    fetchMock.mock.calls.some(
      ([url]) =>
        String(url).startsWith(`${base}/clients?`) &&
        String(url).includes('classification=DEMONSTRATION'),
    ),
  ).toBe(true);
  await user.click(
    await screen.findByRole('button', { name: `Abrir cadastro comercial de ${name}` }),
  );
  expect(await screen.findByText('Condições vigentes no termo inicial.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Registrar renovação' }));
  await user.type(screen.getByLabelText('Início da vigência'), '2026-12-01');
  await user.type(screen.getByLabelText('Fim da vigência'), '2026-12-31');
  await user.selectOptions(screen.getByLabelText('Plano'), planId);
  await user.type(
    screen.getByLabelText('Condições do contrato'),
    'Renovação de dezembro registrada.',
  );
  await user.type(
    screen.getByLabelText('Motivo do registro'),
    'Renovação informada pela operação.',
  );
  await user.click(screen.getByRole('button', { name: 'Salvar revisão' }));
  const sent = fetchMock.mock.calls.find(
    ([url, options]) => url === revisionPath && options?.method === 'POST',
  );
  expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
    expectedVersion: 1,
    planVersionId: newVersion,
    kind: 'RENEWAL',
  });
  const first = await screen.findByRole('group', { name: 'Revisão 1 · Registro inicial' });
  expect(within(first).getByText('Condições vigentes no termo inicial.')).toBeVisible();
  await user.upload(
    within(first).getByLabelText('PDF assinado'),
    new File(['%PDF-1.7'], 'contrato-assinado.pdf', { type: 'application/pdf' }),
  );
  await user.click(within(first).getByRole('button', { name: 'Anexar PDF assinado' }));
  expect(
    await within(first).findByRole('button', { name: 'Baixar contrato-assinado.pdf' }),
  ).toBeVisible();
  expect(
    fetchMock.mock.calls.some(
      ([url, options]) => url === documentPath && options?.body instanceof FormData,
    ),
  ).toBe(true);
});
