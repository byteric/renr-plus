import { render, screen, waitFor } from '@testing-library/react';
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

it('mantém códigos somente na tela, copia manualmente e limpa ao trocar empresa', async () => {
  const code = 'A'.repeat(43);
  const copied = vi.fn(async () => {});

  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, options) => {
      const url = String(input);
      if (options?.method === 'POST') {
        posts.push({ url, body: JSON.parse(options.body) });
        return json({
          cycleId: id,
          participationPath: '/#/responder',
          invites: [{ code, expiresAt: cycle.endsAt }],
        });
      }
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
  await user.click(await screen.findByRole('button', { name: 'Gerar convites' }));
  expect(await screen.findByText(code)).toBeVisible();
  expect(posts).toEqual([
    { url: `/api/v1/organizations/${org}/assessment-cycles/${id}/invites`, body: { count: 1 } },
  ]);
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
});
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
  expect(screen.queryByRole('button', { name: 'Gerar convites' })).not.toBeInTheDocument();
});
