import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';
afterEach(() => vi.unstubAllGlobals());
it('oferece consulta da família exata pela rota de consolidação', async () => {
  const org = '10000000-0000-4000-8000-000000000001';
  window.history.replaceState(null, '', '/#/coletas?view=consolidation');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }))),
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
  expect(await screen.findByRole('heading', { name: 'Consolidação de coletas' })).toBeVisible();
});

import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { AssessmentConsolidation } from './components/assessments/AssessmentConsolidation';
const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const versionId = '30000000-0000-4000-8000-000000000001';
const policyId = '40000000-0000-4000-8000-000000000001';
const unitId = '50000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const instrument = {
  id,
  organizationId: org,
  name: 'Instrumento coletivo',
  isLegacy: false,
  createdAt: stamp,
};
const version = {
  id: versionId,
  organizationId: org,
  instrumentId: id,
  title: 'Planejamento publicado',
  version: 2,
  revision: 1,
  status: 'PUBLISHED',
  usageMode: 'DEMONSTRATION',
  questionCount: 0,
  approvalReference: null,
  publishedAt: stamp,
  publishedById: org,
  createdAt: stamp,
  updatedAt: stamp,
  cycleCount: 0,
};
const policy = {
  id: policyId,
  organizationId: org,
  version: 3,
  revision: 1,
  status: 'PUBLISHED',
  usageMode: 'DEMONSTRATION',
  minimumResponses: 5,
  algorithmVersion: 'CONSERVATIVE_V1',
  approvalReference: null,
  publishedById: org,
  publishedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
};
const unit = {
  id: unitId,
  name: 'Unidade de teste',
  nodeType: 'UNIT',
  availability: 'SUPPRESSED',
  responseCount: null,
  questions: [],
  children: [],
};
const result = {
  organizationId: org,
  instrumentVersionId: versionId,
  policyVersionId: policyId,
  minimumResponses: 5,
  node: {
    id: org,
    name: 'Família protegida',
    nodeType: 'ORGANIZATION',
    availability: 'SUPPRESSED',
    responseCount: null,
    questions: [],
    children: [unit],
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
function mockReferences(respond: (url: URL) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path.endsWith('/assessment-consolidation')) return respond(url);
      if (path.endsWith('/instruments')) return json(list([instrument]));
      if (path.endsWith(`/instruments/${id}`)) return json(instrument);
      if (path.endsWith('/versions')) return json(list([version]));
      if (path.endsWith(`/versions/${versionId}`))
        return json({ ...version, description: '', instructions: '', questions: [] });
      if (path.endsWith(`/consolidation-policies/${policyId}`)) return json(policy);
      return json(list([policy]));
    }),
  );
}
async function selectFamily() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText('Instrumento da coleta')).toBeEnabled());
  await user.selectOptions(screen.getByLabelText('Instrumento da coleta'), id);
  await screen.findByRole('option', { name: 'Planejamento publicado · v2 · Demonstração' });
  await user.selectOptions(screen.getByLabelText('Versão publicada do instrumento'), versionId);
  await user.selectOptions(screen.getByLabelText('Política de consolidação'), policyId);
  return user;
}
it('consulta família exata e recorte no servidor sem filtros de ciclos ou totalizações locais', async () => {
  const queries: URLSearchParams[] = [];
  mockReferences((url) => {
    queries.push(url.searchParams);
    return json(url.searchParams.has('unitId') ? { ...result, node: unit } : result);
  });
  render(<AssessmentConsolidation organizationId={org} onExpire={vi.fn()} />);
  const user = await selectFamily();
  await user.click(screen.getByRole('button', { name: 'Consultar consolidação' }));
  expect(await screen.findByText('Família protegida')).toBeVisible();
  expect(queries[0]?.get('instrumentVersionId')).toBe(versionId);
  expect(queries[0]?.get('policyVersionId')).toBe(policyId);
  await user.selectOptions(screen.getByLabelText('Recorte da unidade'), unitId);
  expect(screen.queryByText('Família protegida')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Consultar consolidação' }));
  await waitFor(() => expect(queries).toHaveLength(2));
  expect([...queries[1]!.keys()].sort()).toEqual([
    'instrumentVersionId',
    'policyVersionId',
    'unitId',
  ]);
  expect(queries[1]?.get('unitId')).toBe(unitId);
});
it('recusa payload de outra família antes da renderização', async () => {
  mockReferences(() => json({ ...result, instrumentVersionId: unitId }));
  render(<AssessmentConsolidation organizationId={org} onExpire={vi.fn()} />);
  const user = await selectFamily();
  await user.click(screen.getByRole('button', { name: 'Consultar consolidação' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('Família protegida')).not.toBeInTheDocument();
});
it('conserva seleção após 503 e permite repetir a consulta', async () => {
  let calls = 0;
  mockReferences(() => (++calls === 1 ? json({}, 503) : json(result)));
  render(<AssessmentConsolidation organizationId={org} onExpire={vi.fn()} />);
  const user = await selectFamily();
  await user.click(screen.getByRole('button', { name: 'Consultar consolidação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(screen.getByLabelText('Versão publicada do instrumento')).toHaveValue(versionId);
  await user.click(screen.getByRole('button', { name: 'Consultar consolidação' }));
  expect(await screen.findByText('Família protegida')).toBeVisible();
});
