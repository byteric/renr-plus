import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PreliminaryEvaluation, RiskDetail, SessionResponse } from '@renr/contracts';
import { Structure } from './components/Structure';

const org = '10000000-0000-4000-8000-000000000001';
const unitId = '20000000-0000-4000-8000-000000000001';
const sectorId = '30000000-0000-4000-8000-000000000001';
const id = '40000000-0000-4000-8000-000000000001';
const stamp = '2026-10-17T12:00:00.000Z';
const author = { id: org, name: 'Equipe de teste' };
const session: SessionResponse = {
  user: { ...author, email: 'team@example.test' },
  memberships: [{ organizationId: org, organizationName: 'Empresa fictícia', role: 'ADMIN' }],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const risk: RiskDetail = {
  id,
  organizationId: org,
  assessmentGroupId: org,
  sectorId,
  unit: { id: unitId, name: 'Unidade Recife', isActive: true },
  sector: { id: sectorId, name: 'Atendimento', isActive: true },
  factor: 'Organização das tarefas',
  description: null,
  exposureDescription: null,
  exposedGroupDescription: null,
  possibleHarms: null,
  existingControls: null,
  sourceKind: null,
  sourceNote: null,
  diagnosticCycleId: null,
  status: 'DRAFT',
  version: 1,
  createdBy: author,
  updatedBy: author,
  createdAt: stamp,
  updatedAt: stamp,
  latestEvaluation: null,
};
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });
function arrange(
  hash: string,
  options: {
    role?: 'ADMIN' | 'READER';
    saveFails?: boolean;
    patchConflicts?: boolean;
    currentRisk?: RiskDetail;
  } = {},
) {
  window.location.hash = hash;
  const currentRisk = options.currentRisk ?? risk;
  const evaluations: PreliminaryEvaluation[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    if (path.endsWith('/evaluations')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          methodReference: string;
          methodVersion: string;
          observation: string;
          rationale: string;
        };
        const evaluation: PreliminaryEvaluation = {
          methodReference: body.methodReference,
          methodVersion: body.methodVersion,
          observation: body.observation,
          rationale: body.rationale,
          id,
          organizationId: org,
          riskId: id,
          sequence: 1,
          riskVersion: currentRisk.version,
          label: 'PRELIMINARY',
          author,
          createdAt: stamp,
          contextSnapshot: {
            factor: currentRisk.factor,
            description: currentRisk.description,
            exposureDescription: currentRisk.exposureDescription,
            exposedGroupDescription: currentRisk.exposedGroupDescription,
            possibleHarms: currentRisk.possibleHarms,
            existingControls: currentRisk.existingControls,
            sourceKind: currentRisk.sourceKind,
            sourceNote: currentRisk.sourceNote,
            diagnosticCycleId: null,
            sectorId,
            assessmentGroupId: org,
            unit: currentRisk.unit,
            sector: currentRisk.sector,
            status: 'REGISTERED',
          },
        };
        evaluations.push(evaluation);
        return new Response(JSON.stringify(evaluation), { status: 201 });
      }
      return new Response(JSON.stringify(list(evaluations)));
    }
    if (path.endsWith('/risks') && method === 'POST') {
      if (options.saveFails) return new Response('{}', { status: 503 });
      const body = JSON.parse(String(init?.body)) as { factor: string };
      return new Response(JSON.stringify({ ...risk, factor: body.factor }), { status: 201 });
    }
    if (path.endsWith(`/risks/${id}`) && method === 'PATCH' && options.patchConflicts)
      return new Response('{}', { status: 409 });
    if (path.endsWith(`/risks/${id}`)) return new Response(JSON.stringify(currentRisk));
    if (path.endsWith('/risks')) return new Response(JSON.stringify(list([currentRisk])));
    if (path.endsWith('/units'))
      return new Response(
        JSON.stringify(
          list([
            {
              id: unitId,
              organizationId: org,
              name: 'Unidade Recife',
              code: null,
              isActive: true,
              createdAt: stamp,
              updatedAt: stamp,
            },
          ]),
        ),
      );
    if (path.endsWith('/sectors'))
      return new Response(
        JSON.stringify(
          list([
            {
              id: sectorId,
              organizationId: org,
              unitId,
              name: 'Atendimento',
              isActive: true,
              createdAt: stamp,
              updatedAt: stamp,
            },
          ]),
        ),
      );
    return new Response(JSON.stringify(list([])));
  });
  vi.stubGlobal('fetch', fetcher);
  const role = options.role ?? 'ADMIN';
  render(
    <Structure
      session={{ ...session, memberships: [{ ...session.memberships[0]!, role }] }}
      onSession={() => undefined}
      onExpire={() => undefined}
    />,
  );
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '/empresas';
});

it('mantém a seção predominante quando o observador entrega somente mudanças parciais', async () => {
  let notify: IntersectionObserverCallback | undefined;
  const observer: IntersectionObserver = {
    root: null,
    rootMargin: '',
    thresholds: [],
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    takeRecords: () => [],
  };
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn(function (callback: IntersectionObserverCallback) {
      notify = callback;
      return observer;
    }),
  );
  arrange(`/inventario/${id}`);
  await screen.findByRole('heading', { name: 'Organização das tarefas' });
  await waitFor(() => expect(notify).toBeTypeOf('function'));
  const entry = (section: string, ratio: number): IntersectionObserverEntry => {
    const target = document.getElementById(`risk-${section}`)!;
    const bounds = target.getBoundingClientRect();
    return {
      target,
      time: 0,
      rootBounds: null,
      boundingClientRect: bounds,
      intersectionRect: bounds,
      intersectionRatio: ratio,
      isIntersecting: ratio > 0,
    };
  };
  act(() => notify!([entry('origem', 0.7)], observer));
  expect(screen.getByRole('link', { name: 'Origem' })).toHaveAttribute('aria-current', 'location');
  act(() => notify!([entry('exposicao', 0.08), entry('fichas', 0)], observer));
  expect(screen.getByRole('link', { name: 'Origem' })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('link', { name: 'Exposição' })).not.toHaveAttribute('aria-current');
  act(() => notify!([entry('origem', 0), entry('exposicao', 0.7)], observer));
  expect(screen.getByRole('link', { name: 'Exposição' })).toHaveAttribute(
    'aria-current',
    'location',
  );
});

it('abre o inventário real e conserva filtros explícitos da URL', async () => {
  const fetcher = arrange('/inventario?evaluationPresence=WITHOUT&q=tarefas');
  expect(await screen.findByRole('heading', { name: 'Inventário', level: 1 })).toBeVisible();
  expect(await screen.findByRole('link', { name: 'Organização das tarefas' })).toHaveAttribute(
    'href',
    expect.stringContaining(id),
  );
  expect(screen.getByLabelText('Buscar no inventário')).toHaveValue('tarefas');
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes('evaluationPresence=WITHOUT')),
  ).toBe(true);
});

it('cria um rascunho com fator e setor e navega para o registro persistido', async () => {
  const fetcher = arrange('/inventario/novo');
  fireEvent.change(await screen.findByLabelText('Fator de risco'), {
    target: { value: 'Distribuição de tarefas' },
  });
  await screen.findByRole('option', { name: 'Unidade Recife' });
  fireEvent.change(screen.getByLabelText('Unidade', { exact: true }), {
    target: { value: unitId },
  });
  await screen.findByRole('option', { name: 'Atendimento' });
  fireEvent.change(screen.getByLabelText('Setor', { exact: true }), {
    target: { value: sectorId },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(window.location.hash).toContain(id));
  const created = fetcher.mock.calls.find(
    ([url, init]) => String(url).includes('/risks') && init?.method === 'POST',
  );
  expect(JSON.parse(String(created?.[1]?.body))).toMatchObject({
    factor: 'Distribuição de tarefas',
    sectorId,
    status: 'DRAFT',
  });
});

it('preserva o rascunho quando o serviço recusa a gravação', async () => {
  arrange('/inventario/novo', { saveFails: true });
  fireEvent.change(await screen.findByLabelText('Fator de risco'), {
    target: { value: 'Distribuição de tarefas' },
  });
  await screen.findByRole('option', { name: 'Unidade Recife' });
  fireEvent.change(screen.getByLabelText('Unidade', { exact: true }), {
    target: { value: unitId },
  });
  await screen.findByRole('option', { name: 'Atendimento' });
  fireEvent.change(screen.getByLabelText('Setor', { exact: true }), {
    target: { value: sectorId },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('indisponível');
  expect(screen.getByLabelText('Fator de risco')).toHaveValue('Distribuição de tarefas');
});

it('oferece leitura do inventário sem controles de criação para READER', async () => {
  arrange('/inventario', { role: 'READER' });
  expect(await screen.findByRole('link', { name: 'Organização das tarefas' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Novo risco' })).not.toBeInTheDocument();
});

it('detalha origem, autoria e histórico sem apresentar score técnico', async () => {
  arrange(`/inventario/${id}`);
  expect(await screen.findByRole('heading', { name: risk.factor, level: 2 })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Exposição' })).toHaveAttribute(
    'href',
    expect.stringContaining('section=exposicao'),
  );
  expect(screen.getByRole('heading', { name: 'Histórico' })).toBeVisible();
  expect(screen.getAllByText('Equipe de teste').length).toBeGreaterThan(0);
  expect(screen.getByText(/não substitui.*avaliação técnica/i)).toBeVisible();
});

it('mantém o texto local quando edição concorrente devolve 409', async () => {
  arrange(`/inventario/${id}`, { patchConflicts: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Editar registro' }));
  fireEvent.change(screen.getByLabelText('Fator de risco'), {
    target: { value: 'Versão local preservada' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/alterado|conflito/i);
  expect(screen.getByLabelText('Fator de risco')).toHaveValue('Versão local preservada');
});

it('não registra dados incompletos e direciona a correção ao formulário', async () => {
  const fetcher = arrange('/inventario/novo');
  fireEvent.change(await screen.findByLabelText('Fator de risco'), {
    target: { value: 'Organização de teste' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar risco' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/campos|setor|preencha/i);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('não oferece edição ou ficha em um risco arquivado', async () => {
  arrange(`/inventario/${id}`, { currentRisk: { ...risk, status: 'ARCHIVED' } });
  expect(await screen.findByRole('heading', { name: risk.factor, level: 2 })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Editar registro' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Adicionar ficha preliminar' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/arquivado.*somente leitura/i)).toBeVisible();
});

it('acrescenta ficha preliminar com versão e mantém o contexto no histórico', async () => {
  const fetcher = arrange(`/inventario/${id}`, {
    currentRisk: { ...risk, status: 'REGISTERED', version: 3 },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Adicionar ficha preliminar' }));
  fireEvent.change(screen.getByLabelText('Referência do método'), {
    target: { value: 'Observação demonstrativa' },
  });
  fireEvent.change(screen.getByLabelText('Versão do método'), { target: { value: '1.0' } });
  fireEvent.change(screen.getByLabelText('Observação preliminar'), {
    target: { value: 'Registro fictício sem classificação normativa.' },
  });
  fireEvent.change(screen.getByLabelText('Justificativa'), {
    target: { value: 'Verificação do fluxo e do histórico de versões.' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar ficha preliminar' }));
  expect(await screen.findByText('Observação demonstrativa')).toBeVisible();
  const saved = fetcher.mock.calls.find(
    ([url, init]) => String(url).endsWith('/evaluations') && init?.method === 'POST',
  );
  expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({
    expectedVersion: 3,
    methodVersion: '1.0',
  });
});

it('recupera foco e seção do registro ao abrir um endereço compartilhado', async () => {
  arrange(`/inventario/${id}?section=origem`);
  await screen.findByRole('heading', { name: risk.factor, level: 2 });
  await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'risk-origem'));
  expect(screen.getByRole('link', { name: 'Origem' })).toHaveAttribute('aria-current', 'location');
});

it('restaura o filtro de setor após consulta assíncrona e o limpa ao trocar a unidade', async () => {
  arrange(`/inventario?unitId=${unitId}&sectorId=${sectorId}`);
  await screen.findByRole('option', { name: 'Atendimento' });
  expect(screen.getByLabelText('Setor', { exact: true })).toHaveValue(sectorId);
  fireEvent.change(screen.getByLabelText('Unidade', { exact: true }), { target: { value: '' } });
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(window.location.hash).not.toContain('sectorId='));
});

it('exige releitura antes de repetir arquivamento após conflito de versão', async () => {
  const fetcher = arrange(`/inventario/${id}`, { patchConflicts: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Arquivar risco' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar arquivamento' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Atualize os dados');
  expect(screen.queryByRole('button', { name: 'Confirmar arquivamento' })).not.toBeInTheDocument();
  const before = fetcher.mock.calls.filter(
    ([url, init]) => String(url).endsWith(`/risks/${id}`) && !init?.method,
  ).length;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar registro' }));
  await screen.findByRole('button', { name: 'Arquivar risco' });
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => String(url).endsWith(`/risks/${id}`) && !init?.method,
    ).length,
  ).toBeGreaterThan(before);
});

it('retorna do detalhe com o recorte e a posição da lista preservados', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.stubGlobal('scrollY', 360);
  arrange('/inventario?q=tarefas');
  await userEvent.click(await screen.findByRole('link', { name: risk.factor }));
  await screen.findByRole('heading', { name: risk.factor, level: 2 });
  await userEvent.click(screen.getByRole('link', { name: /Voltar ao inventário/ }));
  await screen.findByRole('link', { name: risk.factor });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 360, behavior: 'instant' }));
  expect(window.location.hash).toBe('#/inventario?q=tarefas');
  scroll.mockRestore();
});

it('preserva um filtro válido só por setor ao reaplicar o recorte', async () => {
  arrange(`/inventario?sectorId=${sectorId}`);
  await screen.findByRole('link', { name: risk.factor });
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(window.location.hash).toContain(`sectorId=${sectorId}`));
});

it('recusa uma URL com filtros repetidos em vez de mostrar recortes contraditórios', async () => {
  const fetcher = arrange('/inventario?status=DRAFT&status=ARCHIVED');
  expect(await screen.findByRole('alert')).toHaveTextContent('filtros desta URL são inválidos');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/risks?'))).toBe(false);
});

it('oferece atalhos explícitos de rascunho, sem ficha e arquivo com página reiniciada', async () => {
  arrange('/inventario');
  await screen.findByRole('link', { name: risk.factor });
  const shortcuts = screen.getByRole('navigation', { name: 'Recortes rápidos do inventário' });
  expect(shortcuts).toBeVisible();
  expect(screen.getByRole('link', { name: 'Rascunhos' })).toHaveAttribute(
    'href',
    '#/inventario?page=1&status=DRAFT',
  );
  expect(screen.getByRole('link', { name: 'Sem ficha preliminar' })).toHaveAttribute(
    'href',
    '#/inventario?page=1&evaluationPresence=WITHOUT',
  );
  expect(screen.getByRole('link', { name: 'Arquivados' })).toHaveAttribute(
    'href',
    '#/inventario?page=1&status=ARCHIVED',
  );
});
