import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';
const org = '10000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());
it('abre políticas de consolidação pela rota de coletas', async () => {
  window.history.replaceState(null, '', '/#/coletas?view=policies');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }))),
  );
  render(
    <Structure
      session={{
        user: { id: org, name: 'Gestora', email: 'gestora@example.test' },
        memberships: [{ organizationId: org, organizationName: 'Empresa', role: 'ADMIN' }],
        activeOrganizationId: org,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }}
      onSession={vi.fn()}
      onExpire={vi.fn()}
    />,
  );
  expect(await screen.findByRole('heading', { name: 'Políticas de consolidação' })).toBeVisible();
});

import userEvent from '@testing-library/user-event';
import { waitFor, fireEvent } from '@testing-library/react';
import { ConsolidationPolicies } from './components/assessments/ConsolidationPolicies';
import type { ConsolidationPolicy } from '@renr/contracts';
const policyId = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const policy: ConsolidationPolicy = {
  id: policyId,
  organizationId: org,
  version: 1,
  revision: 1,
  status: 'DRAFT',
  usageMode: 'REAL',
  minimumResponses: null,
  algorithmVersion: 'CONSERVATIVE_V1',
  approvalReference: null,
  publishedById: null,
  publishedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
it('cria rascunho REAL sem limiar padrão e conserva campos após 503', async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        return json({}, 503);
      }
      return json({ items: [], total: 0, page: 1, pageSize: 20 });
    }),
  );
  render(
    <ConsolidationPolicies
      organizationId={org}
      canEdit
      canPublishReal={false}
      onExpire={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Criar política' }));
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toHaveValue(5);
  await user.selectOptions(screen.getByLabelText('Modo de uso'), 'REAL');
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toHaveValue(null);
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(bodies).toEqual([{ usageMode: 'REAL', minimumResponses: null }]);
  expect(screen.getByLabelText('Modo de uso')).toHaveValue('REAL');
});
it('preserva edição e revisão original após conflito e revalidação', async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  let serverRevision = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'PUT') {
        bodies.push(JSON.parse(String(options.body)));
        serverRevision = 9;
        return json({}, 409);
      }
      return json({
        items: [{ ...policy, revision: serverRevision }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    }),
  );
  render(
    <ConsolidationPolicies
      organizationId={org}
      canEdit
      canPublishReal={false}
      onExpire={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  await user.type(screen.getByLabelText('Limiar mínimo de respostas'), '8');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('rascunho foi preservado');
  fireEvent(document, new Event('visibilitychange'));
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(bodies).toEqual([
    { usageMode: 'REAL', minimumResponses: 8, expectedRevision: 1 },
    { usageMode: 'REAL', minimumResponses: 8, expectedRevision: 1 },
  ]);
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toHaveValue(8);
});
it('permite READER técnico publicar REAL sem editar e ADMIN sem capacidade não publica REAL', async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        return json({
          ...policy,
          minimumResponses: 8,
          status: 'PUBLISHED',
          revision: 2,
          publishedById: org,
          publishedAt: stamp,
          approvalReference: 'Decisão 42',
        });
      }
      return json({ items: [{ ...policy, minimumResponses: 8 }], total: 1, page: 1, pageSize: 20 });
    }),
  );
  const view = render(
    <ConsolidationPolicies
      organizationId={org}
      canEdit={false}
      canPublishReal
      onExpire={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Referência de aprovação'), 'Decisão 42');
  await user.click(screen.getByRole('button', { name: 'Publicar política' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Política publicada'));
  expect(bodies).toEqual([{ expectedRevision: 1, approvalReference: 'Decisão 42' }]);
  view.unmount();
  render(
    <ConsolidationPolicies
      organizationId={org}
      canEdit
      canPublishReal={false}
      onExpire={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  expect(screen.queryByRole('button', { name: 'Publicar política' })).not.toBeInTheDocument();
});
it('versão publicada é somente leitura e fork conserva revisão no pedido', async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'POST') {
        bodies.push(JSON.parse(String(options.body)));
        return json({ ...policy, id: '20000000-0000-4000-8000-000000000002', version: 2 });
      }
      return json({
        items: [
          {
            ...policy,
            status: 'PUBLISHED',
            minimumResponses: 8,
            approvalReference: 'Ref 42',
            publishedById: org,
            publishedAt: stamp,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    }),
  );
  render(<ConsolidationPolicies organizationId={org} canEdit canPublishReal onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  expect(screen.getByLabelText('Modo de uso')).toBeDisabled();
  expect(screen.getByLabelText('Referência de aprovação')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Criar nova versão' }));
  expect(await screen.findByRole('heading', { name: 'Política v2 · Rascunho' })).toBeVisible();
  expect(bodies).toEqual([{ expectedRevision: 1 }]);
  expect(screen.getByLabelText('Referência de aprovação')).toHaveValue('');
});

it('exige salvar alterações do limiar antes de publicar a revisão original', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({ items: [{ ...policy, minimumResponses: 8 }], total: 1, page: 1, pageSize: 20 }),
    ),
  );
  render(<ConsolidationPolicies organizationId={org} canEdit canPublishReal onExpire={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  await user.clear(screen.getByLabelText('Limiar mínimo de respostas'));
  await user.type(screen.getByLabelText('Limiar mínimo de respostas'), '9');
  await user.type(screen.getByLabelText('Referência de aprovação'), 'Decisão 42');
  expect(screen.getByRole('button', { name: 'Publicar política' })).toBeDisabled();
  expect(screen.getByText('Salve as alterações antes de publicar.')).toBeVisible();
});
it('cancelar após conflito atualiza a lista antes de abrir outra edição com a revisão atual', async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  let reads = 0;
  let finishRefresh: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input, options) => {
      if (options?.method === 'PUT') {
        bodies.push(JSON.parse(String(options.body)));
        return bodies.length === 1
          ? json({}, 409)
          : json({ ...policy, revision: 3, minimumResponses: 9 });
      }
      reads++;
      if (reads === 2)
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return json({ items: [policy], total: 1, page: 1, pageSize: 20 });
    }),
  );
  render(
    <ConsolidationPolicies
      organizationId={org}
      canEdit
      canPublishReal={false}
      onExpire={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole('button', { name: /Política v1/ }));
  await user.type(screen.getByLabelText('Limiar mínimo de respostas'), '8');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('rascunho foi preservado');
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toHaveValue(8);
  await user.click(screen.getByRole('button', { name: 'Cancelar e voltar à lista' }));
  expect(screen.getByRole('button', { name: /Política v1/ })).toBeDisabled();
  await waitFor(() => expect(reads).toBe(2));
  finishRefresh?.(
    json({
      items: [{ ...policy, revision: 2, minimumResponses: 7 }],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /Política v1/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /Política v1/ }));
  expect(screen.getByLabelText('Limiar mínimo de respostas')).toHaveValue(7);
  await user.clear(screen.getByLabelText('Limiar mínimo de respostas'));
  await user.type(screen.getByLabelText('Limiar mínimo de respostas'), '9');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies).toEqual([
    { usageMode: 'REAL', minimumResponses: 8, expectedRevision: 1 },
    { usageMode: 'REAL', minimumResponses: 9, expectedRevision: 2 },
  ]);
});
