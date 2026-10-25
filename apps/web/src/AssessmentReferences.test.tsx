import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AssessmentReferenceFields } from './components/assessments/AssessmentReferenceFields';
const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const versionId = '30000000-0000-4000-8000-000000000001';
const policyId = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const instrument = {
  id,
  organizationId: org,
  name: 'Planejamento coletivo',
  isLegacy: false,
  createdAt: stamp,
};
const version = {
  id: versionId,
  organizationId: org,
  instrumentId: id,
  title: 'Versão publicada original',
  version: 3,
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
  version: 4,
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
const json = (body: unknown) => new Response(JSON.stringify(body));
const list = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });
const props = {
  organizationId: org,
  instrumentId: id,
  instrumentVersionId: versionId,
  policyVersionId: policyId,
  onInstrumentChange: vi.fn(),
  onPolicyChange: vi.fn(),
  disabled: false,
  onExpire: vi.fn(),
};
afterEach(() => vi.unstubAllGlobals());
it('hidrata seleções originais fora da primeira página sem descartá-las', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith(`/versions/${versionId}`))
        return json({ ...version, description: '', instructions: '', questions: [] });
      if (path.endsWith(`/instruments/${id}`)) return json(instrument);
      if (path.endsWith(`/consolidation-policies/${policyId}`)) return json(policy);
      return json(list([]));
    }),
  );
  render(<AssessmentReferenceFields {...props} />);
  expect(await screen.findByRole('option', { name: 'Planejamento coletivo' })).toBeVisible();
  expect(
    await screen.findByRole('option', { name: 'Versão publicada original · v3 · Demonstração' }),
  ).toBeVisible();
  expect(await screen.findByRole('option', { name: 'Política v4 · Demonstração' })).toBeVisible();
  expect(screen.getByLabelText('Versão publicada do instrumento')).toHaveValue(versionId);
  expect(props.onInstrumentChange).not.toHaveBeenCalled();
});
it('pagina resultados brutos mesmo quando a página não tem versões publicadas e limpa versão ao mudar identidade', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      urls.push(url.href);
      if (url.pathname.endsWith(`/instruments/${id}`)) return json(instrument);
      if (url.pathname.endsWith('/instruments')) return json(list([instrument]));
      if (url.pathname.endsWith('/versions'))
        return json(
          list(
            [{ ...version, status: url.searchParams.get('page') === '2' ? 'PUBLISHED' : 'DRAFT' }],
            21,
          ),
        );
      return json(list([]));
    }),
  );
  render(
    <AssessmentReferenceFields
      {...props}
      instrumentVersionId=""
      policyVersionId=""
      onInstrumentChange={change}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Próximas versões' })).toBeEnabled(),
  );
  expect(
    screen.queryByRole('option', { name: /Versão publicada original/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Próximas versões' }));
  expect(await screen.findByRole('option', { name: /Versão publicada original/ })).toBeVisible();
  expect(urls.some((url) => url.includes('page=2'))).toBe(true);
  await user.selectOptions(screen.getByLabelText('Instrumento da coleta'), '');
  expect(change).toHaveBeenLastCalledWith('', '');
  expect(urls.every((url) => !url.includes('status='))).toBe(true);
});
it('recusa recursos de outra empresa', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      return json(
        path.endsWith('/instruments')
          ? list([{ ...instrument, organizationId: policyId }])
          : list([]),
      );
    }),
  );
  render(
    <AssessmentReferenceFields
      {...props}
      instrumentId=""
      instrumentVersionId=""
      policyVersionId=""
    />,
  );
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByRole('option', { name: 'Planejamento coletivo' })).not.toBeInTheDocument();
});

it('repete os seis recursos após 503 ao atualizar a tentativa, preservando as seleções', async () => {
  const calls = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const count = (calls.get(path) ?? 0) + 1;
      calls.set(path, count);
      if (count === 1) return new Response('{}', { status: 503 });
      if (path.endsWith(`/versions/${versionId}`))
        return json({ ...version, description: '', instructions: '', questions: [] });
      if (path.endsWith(`/instruments/${id}`)) return json(instrument);
      if (path.endsWith(`/consolidation-policies/${policyId}`)) return json(policy);
      if (path.endsWith('/instruments')) return json(list([instrument]));
      if (path.endsWith('/versions')) return json(list([version]));
      return json(list([policy]));
    }),
  );
  const onInstrumentChange = vi.fn();
  const onPolicyChange = vi.fn();
  const retryProps = { ...props, onInstrumentChange, onPolicyChange, attempt: 0 };
  const view = render(<AssessmentReferenceFields {...retryProps} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  await waitFor(() => expect([...calls.values()]).toEqual([1, 1, 1, 1, 1, 1]));
  view.rerender(<AssessmentReferenceFields {...retryProps} {...{ attempt: 1 }} />);
  expect(await screen.findByRole('option', { name: 'Planejamento coletivo' })).toBeVisible();
  expect(
    await screen.findByRole('option', { name: 'Versão publicada original · v3 · Demonstração' }),
  ).toBeVisible();
  expect(await screen.findByRole('option', { name: 'Política v4 · Demonstração' })).toBeVisible();
  expect([...calls.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  expect(screen.getByLabelText('Instrumento da coleta')).toHaveValue(id);
  expect(screen.getByLabelText('Versão publicada do instrumento')).toHaveValue(versionId);
  expect(screen.getByLabelText('Política de consolidação')).toHaveValue(policyId);
  expect(onInstrumentChange).not.toHaveBeenCalled();
  expect(onPolicyChange).not.toHaveBeenCalled();
});

import { AssessmentCycleForm } from './components/assessments/AssessmentCycleForm';
import type { AssessmentCycle } from '@renr/contracts';
it('Atualizar referências recupera instrumento e política após 503 sem substituir campos ou revisão do ciclo', async () => {
  const user = userEvent.setup();
  const writes: unknown[] = [];
  const calls = new Map<string, number>();
  const initial: AssessmentCycle = {
    id,
    organizationId: org,
    name: 'Coleta original',
    assessmentGroupId: id,
    assessmentGroupName: 'Grupo',
    sectorId: id,
    sectorName: 'Setor',
    unitId: id,
    unitName: 'Unidade',
    instrumentId: id,
    instrumentTitle: version.title,
    instrumentVersionId: versionId,
    instrumentVersion: 3,
    usageMode: 'DEMONSTRATION',
    policyVersionId: policyId,
    policyVersion: 4,
    minimumResponses: 5,
    status: 'DRAFT',
    revision: 5,
    startsAt: stamp,
    endsAt: '2026-10-25T12:00:00.000Z',
    createdAt: stamp,
    updatedAt: stamp,
    closedAt: null,
  };
  const group = {
    id,
    organizationId: org,
    name: 'Grupo',
    unitId: id,
    sectorId: id,
    unitName: 'Unidade',
    sectorName: 'Setor',
    isActive: true,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, options) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (options?.method === 'PUT') {
        writes.push(JSON.parse(String(options.body)));
        return new Response('{}', { status: 503 });
      }
      if (path.endsWith('/assessment-groups')) return json(list([group]));
      if (path.endsWith(`/assessment-groups/${id}`)) return json(group);
      const count = (calls.get(path) ?? 0) + 1;
      calls.set(path, count);
      if (count === 1) return new Response('{}', { status: 503 });
      if (path.endsWith(`/versions/${versionId}`))
        return json({ ...version, description: '', instructions: '', questions: [] });
      if (path.endsWith(`/instruments/${id}`)) return json(instrument);
      if (path.endsWith(`/consolidation-policies/${policyId}`)) return json(policy);
      if (path.endsWith('/instruments')) return json(list([instrument]));
      if (path.endsWith('/versions')) return json(list([version]));
      return json(list([policy]));
    }),
  );
  const formProps = {
    organizationId: org,
    initial,
    onExpire: vi.fn(),
    onSaved: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(<AssessmentCycleForm {...formProps} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  await user.clear(screen.getByLabelText('Nome da coleta'));
  await user.type(screen.getByLabelText('Nome da coleta'), 'Rascunho recuperável');
  view.rerender(
    <AssessmentCycleForm
      {...formProps}
      initial={{ ...initial, name: 'Atualização externa', revision: 9 }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Atualizar referências' }));
  expect(await screen.findByRole('option', { name: 'Planejamento coletivo' })).toBeVisible();
  expect(await screen.findByRole('option', { name: 'Política v4 · Demonstração' })).toBeVisible();
  expect(screen.getByLabelText('Nome da coleta')).toHaveValue('Rascunho recuperável');
  expect(screen.getByLabelText('Versão publicada do instrumento')).toHaveValue(versionId);
  expect(screen.getByLabelText('Política de consolidação')).toHaveValue(policyId);
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual(
    expect.objectContaining({
      name: 'Rascunho recuperável',
      expectedRevision: 5,
      instrumentVersionId: versionId,
      policyVersionId: policyId,
    }),
  );
});
