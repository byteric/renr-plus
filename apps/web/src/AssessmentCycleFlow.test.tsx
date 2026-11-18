import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AssessmentCycleForm as Form } from './components/assessments/AssessmentCycleForm';
import { AssessmentCycleDetail as Detail } from './components/assessments/AssessmentCycleDetail';
import type { AssessmentCycle } from '@renr/contracts';
const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const cycle: AssessmentCycle = {
  id,
  organizationId: org,
  name: 'Coleta coletiva',
  assessmentGroupId: id,
  assessmentGroupName: 'Grupo coletivo',
  sectorId: id,
  sectorName: 'Setor',
  unitId: id,
  unitName: 'Unidade',
  instrumentId: id,
  instrumentTitle: 'Instrumento',
  instrumentVersionId: id,
  instrumentVersion: 1,
  usageMode: 'DEMONSTRATION',
  policyVersionId: id,
  policyVersion: 1,
  minimumResponses: 5,
  status: 'DRAFT',
  revision: 3,
  startsAt: stamp,
  endsAt: '2026-10-25T12:00:00.000Z',
  createdAt: stamp,
  updatedAt: stamp,
  closedAt: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
it('preserva o rascunho e a revisão original após conflito e revalidação', async () => {
  const writes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'PUT') {
        writes.push(JSON.parse(options.body));
        return json({}, 409);
      }
      return json({ items: [], total: 0, page: 1, pageSize: 20 });
    }),
  );
  const props = {
    organizationId: org,
    initial: cycle,
    onExpire: vi.fn(),
    onSaved: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(<Form {...props} />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Nome da coleta'));
  await user.type(screen.getByLabelText('Nome da coleta'), 'Rascunho preservado');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByText(/Seu rascunho foi preservado/)).toBeVisible();
  const current = screen.getByRole('link', { name: 'Consultar versão atual em outra aba' });
  expect(current).toHaveAttribute('href', `#/coletas?cycle=${id}`);
  expect(current).toHaveAttribute('target', '_blank');
  view.rerender(<Form {...props} initial={{ ...cycle, revision: 9, name: 'Revalidação' }} />);
  expect(screen.getByLabelText('Nome da coleta')).toHaveValue('Rascunho preservado');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([
    expect.objectContaining({ expectedRevision: 3, name: 'Rascunho preservado' }),
    expect.objectContaining({ expectedRevision: 3 }),
  ]);
});
it('exige confirmação textual e envia revisão ao abrir; não mostra resultados de outro ciclo', async () => {
  const writes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, options) => {
      const url = String(input);
      if (options?.method === 'POST') {
        writes.push(JSON.parse(options.body));
        return json({ ...cycle, status: 'OPEN', revision: 4 });
      }
      if (url.includes('/sources')) return json({ items: [], total: 0, page: 1, pageSize: 20 });
      if (url.endsWith('/results'))
        return json({
          organizationId: org,
          instrumentVersionId: id,
          policyVersionId: id,
          minimumResponses: 5,
          node: {
            id: org,
            name: 'Dados indevidos',
            nodeType: 'CYCLE',
            availability: 'NO_RESPONSES',
            responseCount: null,
            questions: [],
            children: [],
          },
        });
      return json(cycle);
    }),
  );
  render(
    <Detail
      organizationId={org}
      cycleId={id}
      canEdit
      onExpire={vi.fn()}
      onEdit={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Abrir coleta' }));
  expect(screen.getByText(/ficarão fixados/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirmar abertura' })).toBeDisabled();
  await user.type(screen.getByLabelText('Confirmação da abertura'), 'ABRIR');
  await user.click(screen.getByRole('button', { name: 'Confirmar abertura' }));
  await waitFor(() => expect(writes).toEqual([{ expectedRevision: 3 }]));
  expect(screen.queryByText('Dados indevidos')).not.toBeInTheDocument();
});

it.each([false, true])(
  'mantém códigos somente na tela e recupera confirmação incerta (%s)',
  async (loseReply) => {
    const code = 'A'.repeat(43);
    const copied = vi.fn(async () => {});
    const operation = {
      id,
      channel: 'MANUAL_CODE',
      count: 1,
      status: 'PENDING_CONFIRMATION',
      expiresAt: cycle.endsAt,
      issuedAt: null,
    };

    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => {
        const url = String(input);
        if (options?.method === 'POST' && url.includes('/invite-deliveries')) {
          posts.push({ url, body: JSON.parse(options.body) });
          if (url.endsWith('/preview')) return json(operation, 201);
          if (loseReply) throw new TypeError('Resposta indisponível');
          return json({
            operation: { ...operation, status: 'ISSUED', issuedAt: stamp },
            participationPath: '/#/responder',
            invites: [{ code, expiresAt: cycle.endsAt }],
            requiresReview: false,
          });
        }
        if (url.endsWith('/invite-deliveries')) return json({ items: [] });
        if (url.endsWith(`/invite-deliveries/${id}`))
          return json({ ...operation, status: 'ISSUED', issuedAt: stamp });
        if (url.includes('/sources')) return json({ items: [], total: 0, page: 1, pageSize: 20 });
        if (url.endsWith('/results'))
          return json({
            organizationId: org,
            instrumentVersionId: id,
            policyVersionId: id,
            minimumResponses: 5,
            node: {
              id,
              name: cycle.name,
              nodeType: 'CYCLE',
              availability: 'COLLECTING',
              responseCount: null,
              questions: [],
              children: [],
            },
          });
        return json({ ...cycle, status: 'OPEN' });
      }),
    );
    const props = {
      organizationId: org,
      cycleId: id,
      canEdit: true,
      onExpire: vi.fn(),
      onEdit: vi.fn(),
      onBack: vi.fn(),
    };
    const view = render(<Detail {...props} />);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copied },
    });
    const deliveries = `/api/v1/organizations/${org}/assessment-cycles/${id}/invite-deliveries`;
    await user.click(await screen.findByRole('button', { name: 'Preparar convites' }));
    expect(await screen.findByRole('heading', { name: 'Prévia da entrega manual' })).toBeVisible();
    expect(screen.queryByText(code)).not.toBeInTheDocument();
    expect(posts).toEqual([
      {
        url: `${deliveries}/preview`,
        body: { channel: 'MANUAL_CODE', count: 1, idempotencyKey: expect.any(String) },
      },
    ]);
    await user.click(screen.getByRole('button', { name: 'Gerar convites' }));
    if (loseReply) {
      await user.click(await screen.findByRole('button', { name: 'Consultar operação' }));
      expect(await screen.findByText(/Confira o repasse dos convites/)).toBeVisible();
      expect(screen.queryByText(code)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Gerar convites' })).not.toBeInTheDocument();
      expect(posts).toHaveLength(2);
      return;
    }
    expect(await screen.findByText(code)).toBeVisible();
    expect(posts.slice(1)).toEqual([{ url: `${deliveries}/${id}/confirm`, body: {} }]);
    expect(screen.getByRole('link', { name: 'Responder coleta' })).toHaveAttribute(
      'href',
      '/#/responder',
    );
    await user.click(screen.getByRole('button', { name: 'Copiar código 1' }));
    expect(copied).toHaveBeenCalledWith(code);
    expect(location.href).not.toContain(code);
    expect(JSON.stringify(localStorage)).not.toContain(code);
    expect(JSON.stringify(sessionStorage)).not.toContain(code);
    view.rerender(<Detail {...props} organizationId="30000000-0000-4000-8000-000000000001" />);
    expect(screen.queryByText(code)).not.toBeInTheDocument();
  },
);
it('leitor não recebe ações de edição, transição ou emissão de convites', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/sources')) return json({ items: [], total: 0, page: 1, pageSize: 20 });
      if (url.endsWith('/results'))
        return json({
          organizationId: org,
          instrumentVersionId: id,
          policyVersionId: id,
          minimumResponses: 5,
          node: {
            id,
            name: cycle.name,
            nodeType: 'CYCLE',
            availability: 'COLLECTING',
            responseCount: null,
            questions: [],
            children: [],
          },
        });
      return json({ ...cycle, status: 'OPEN' });
    }),
  );
  render(
    <Detail
      organizationId={org}
      cycleId={id}
      canEdit={false}
      onExpire={vi.fn()}
      onEdit={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  await screen.findByRole('heading', { name: cycle.name });
  expect(screen.queryByRole('button', { name: 'Editar rascunho' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Encerrar coleta' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preparar convites' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Gerar convites' })).not.toBeInTheDocument();
});

it.each([
  ['AVAILABLE', '75%', { eligible: 20, issued: 22, responses: 15, percentage: 75 }],
  ['PROTECTED', 'Adesão protegida', {}],
  ['UNKNOWN_BASE', 'Base de elegíveis indisponível', {}],
] as const)('mostra somente a adesão autorizada (%s)', async (status, text, values) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/sources')) return json({ items: [], total: 0, page: 1, pageSize: 20 });
      if (url.endsWith('/results'))
        return json({
          organizationId: org,
          instrumentVersionId: id,
          policyVersionId: id,
          minimumResponses: 5,
          node: {
            id,
            name: cycle.name,
            nodeType: 'CYCLE',
            questions: [],
            children: [],
            availability: status === 'AVAILABLE' ? 'AVAILABLE' : 'SUPPRESSED',
            responseCount: status === 'AVAILABLE' ? 15 : null,
          },
          participation: { status, ...values },
        });
      return json({ ...cycle, status: 'CLOSED', closedAt: cycle.endsAt });
    }),
  );
  render(
    <Detail
      organizationId={org}
      cycleId={id}
      canEdit={false}
      onExpire={vi.fn()}
      onEdit={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const panel = await screen.findByRole('region', { name: 'Adesão à coleta' });
  expect(within(panel).getByText(text)).toBeVisible();
  if (status === 'AVAILABLE') {
    expect(within(panel).getByText('20', { exact: true })).toBeVisible();
    expect(within(panel).getByText('22', { exact: true })).toBeVisible();
    expect(within(panel).getByText('15', { exact: true })).toBeVisible();
  } else {
    expect(
      within(panel).queryByText(/participantes elegíveis|convites emitidos|respostas válidas/i),
    ).not.toBeInTheDocument();
  }
});
