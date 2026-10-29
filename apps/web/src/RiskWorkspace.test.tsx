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
const methodId = '50000000-0000-4000-8000-000000000001';
const methodVersion = {
  id: methodId,
  organizationId: org,
  method: { id: methodId, name: 'Método de teste isolado' },
  version: 2,
  revision: 1,
  status: 'PUBLISHED',
  title: 'Versão demonstrativa de teste',
  description: 'Somente fixture de teste',
  definition: {
    probability: [
      {
        key: 'p1',
        label: 'Probabilidade observada',
        description: 'Critério de teste P',
        position: 1,
      },
    ],
    severity: [
      { key: 's1', label: 'Severidade observada', description: 'Critério de teste S', position: 1 },
    ],
    levels: [{ key: 'l1', label: 'Nível do método' }],
    priorities: [{ key: 'r1', label: 'Prioridade do método', rank: 1 }],
    matrix: [{ probabilityKey: 'p1', severityKey: 's1', levelKey: 'l1', priorityKey: 'r1' }],
  },
  approvalReference: 'Referência fictícia exclusiva do teste',
  publishedBy: author,
  publishedAt: stamp,
  createdBy: author,
  createdAt: stamp,
  updatedAt: stamp,
};
function arrange(
  hash: string,
  options: {
    role?: 'ADMIN' | 'READER';
    saveFails?: boolean;
    patchConflicts?: boolean;
    currentRisk?: RiskDetail;
    technical?: boolean;
    publishedMethod?: boolean;
    technicalConflict?: boolean;
    technicalSuccess?: boolean;
  } = {},
) {
  window.location.hash = hash;
  const currentRisk = options.currentRisk ?? risk;
  const evaluations: PreliminaryEvaluation[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    if (path.endsWith('/reassessment-context'))
      return new Response(
        JSON.stringify({
          organizationId: org,
          riskId: id,
          riskVersion: currentRisk.version,
          latestEvaluation: null,
          latestReassessment: null,
          permissions: { hasTechnicalCapability: options.technical ?? false, canReassess: false },
          blockingReasons: ['NO_BASELINE'],
        }),
      );
    if (path.endsWith('/session-capabilities'))
      return new Response(
        JSON.stringify({
          organizationId: org,
          capabilities: options.technical ? ['TECHNICAL_DECISIONS'] : [],
          canManageAccess: true,
        }),
      );
    if (path.endsWith('/evaluation-method-versions'))
      return new Response(JSON.stringify(list(options.publishedMethod ? [methodVersion] : [])));
    if (path.endsWith('/source-options'))
      return new Response(
        JSON.stringify(
          list([
            {
              kind: 'RISK_RECORD',
              id,
              label: 'Registro contextual elegível',
              reference: 'Registro coletivo de teste',
              isDemonstration: false,
              eligible: true,
              unavailableReason: null,
            },
          ]),
        ),
      );
    if (path.endsWith('/technical-evaluations')) {
      if (method === 'POST' && options.technicalSuccess) {
        const body = JSON.parse(String(init?.body)) as { rationale: string; context: string };
        return new Response(
          JSON.stringify({
            id,
            organizationId: org,
            riskId: id,
            sequence: 1,
            riskVersion: currentRisk.version,
            label: 'TECHNICAL',
            method: {
              id: methodId,
              name: methodVersion.method.name,
              versionId: methodId,
              version: 2,
              approvalReference: methodVersion.approvalReference,
            },
            probability: { key: 'p1', label: 'Probabilidade observada' },
            severity: { key: 's1', label: 'Severidade observada' },
            level: { key: 'l1', label: 'Nível do método' },
            priority: { key: 'r1', label: 'Prioridade do método', rank: 1 },
            author,
            createdAt: stamp,
            rationale: body.rationale,
            context: body.context,
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
            sources: [
              {
                kind: 'RISK_RECORD',
                id,
                title: 'Registro contextual',
                reference: 'Registro coletivo',
                isDemonstration: false,
                capturedAt: stamp,
              },
            ],
          }),
          { status: 201 },
        );
      }
      if (method === 'POST')
        return new Response('{}', { status: options.technicalConflict ? 409 : 503 });
      return new Response(JSON.stringify(list([])));
    }
    if (path.endsWith('/risk-workspaces/matrix'))
      return new Response(
        JSON.stringify({
          methodVersion,
          cells: [{ ...methodVersion.definition.matrix[0], count: 4 }],
          totalMatched: 10,
          classifiedTotal: 4,
          excluded: {
            unclassified: 2,
            contextChanged: 1,
            incompatible: 1,
            inactiveScope: 1,
            notRegistered: 1,
          },
        }),
      );
    const workspace = {
      ...currentRisk,
      sourceLabel: 'Registro técnico contextual',
      technicalEvaluationState: 'ABSENT',
      latestTechnicalEvaluation: null,
      actionSummary: { total: 2, open: 1, overdue: 1 },
      pendingReasons: ['NO_TECHNICAL_EVALUATION'],
    };
    if (path.endsWith(`/risk-workspaces/${id}`)) return new Response(JSON.stringify(workspace));
    if (path.endsWith('/risk-workspaces')) return new Response(JSON.stringify(list([workspace])));
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

it('mostra fonte, ausência de avaliação técnica e ações sem presumir classificação', async () => {
  arrange('/inventario');
  await screen.findByRole('link', { name: risk.factor });
  expect(screen.getByRole('columnheader', { name: 'Fonte' })).toBeVisible();
  expect(screen.getByText('Registro técnico contextual')).toBeVisible();
  expect(screen.getByText('Sem avaliação técnica')).toBeVisible();
  expect(screen.getByText(/1 aberta.*1 atrasada/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Matriz' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Mapa' })).not.toBeInTheDocument();
});

it('ADMIN sem capacidade técnica não recebe controles de avaliação técnica', async () => {
  arrange(`/inventario/${id}`, { currentRisk: { ...risk, status: 'REGISTERED' } });
  await screen.findByRole('heading', { name: risk.factor, level: 2 });
  expect(
    screen.queryByRole('button', { name: 'Registrar avaliação técnica' }),
  ).not.toBeInTheDocument();
});

it('explica catálogo vazio ao responsável técnico sem criar método presumido', async () => {
  arrange(`/inventario/${id}`, { technical: true, currentRisk: { ...risk, status: 'REGISTERED' } });
  await userEvent.click(await screen.findByRole('button', { name: 'Registrar avaliação técnica' }));
  expect(
    await screen.findByText(/Solicite um método validado ao responsável técnico/),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirmar avaliação técnica' })).toBeDisabled();
});

it.each([false, true])(
  'confirma sucesso somente após resposta válida ou preserva rascunho no conflito (sucesso=%s)',
  async (technicalSuccess) => {
    const fetcher = arrange(`/inventario/${id}`, {
      technical: true,
      publishedMethod: true,
      technicalConflict: true,
      technicalSuccess,
      currentRisk: { ...risk, status: 'REGISTERED', version: 3 },
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Registrar avaliação técnica' }),
    );
    await screen.findByRole('option', { name: /Método de teste isolado/ });
    fireEvent.change(screen.getByLabelText('Método publicado'), { target: { value: methodId } });
    fireEvent.change(screen.getByLabelText('Probabilidade'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Severidade'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Justificativa técnica'), {
      target: { value: 'Fundamentação técnica preservada durante conflito.' },
    });
    fireEvent.change(screen.getByLabelText('Contexto da avaliação'), {
      target: { value: 'Contexto coletivo de trabalho observado nesta avaliação.' },
    });
    await userEvent.click(await screen.findByLabelText('Registro contextual elegível'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar avaliação técnica' }));
    if (technicalSuccess) {
      expect(
        await screen.findByText('Avaliação técnica registrada e confirmada pelo serviço.'),
      ).toBeVisible();
      expect(
        screen.queryByRole('form', { name: 'Nova avaliação técnica' }),
      ).not.toBeInTheDocument();
      return;
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(/rascunho foi preservado/);
    expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
      'Fundamentação técnica preservada durante conflito.',
    );
    expect(screen.getByRole('button', { name: 'Confirmar avaliação técnica' })).toBeDisabled();
    expect(
      fetcher.mock.calls.filter(
        ([url, init]) => String(url).includes('technical-evaluations') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(screen.queryByText(/registrada e confirmada pelo serviço/)).not.toBeInTheDocument();
  },
);

it('consulta matriz de versão exata sobre todo o filtro com exclusões explícitas', async () => {
  const fetcher = arrange(`/inventario?view=matrix&methodVersionId=${methodId}&q=tarefas&page=2`, {
    publishedMethod: true,
  });
  expect(await screen.findByText('4 classificados de 10 registros no recorte.')).toBeVisible();
  expect(screen.getByRole('table', { name: /Probabilidade × severidade/ })).toBeVisible();
  expect(screen.getByText('Método ou versão incompatível')).toBeVisible();
  const request = fetcher.mock.calls.find(([url]) =>
    String(url).includes('/risk-workspaces/matrix?'),
  );
  expect(String(request?.[0])).toContain(`methodVersionId=${methodId}`);
  expect(String(request?.[0])).toContain('q=tarefas');
  expect(String(request?.[0])).not.toContain('page=');
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
    ([url, init]) => String(url).endsWith(`/risk-workspaces/${id}`) && !init?.method,
  ).length;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar registro' }));
  await screen.findByRole('button', { name: 'Arquivar risco' });
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => String(url).endsWith(`/risk-workspaces/${id}`) && !init?.method,
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
