import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionContext } from './ActionContext';
import { ActionTechnicalClosure } from './ActionTechnicalClosure';
import { ActionDetail } from './ActionDetail';
import {
  action,
  efficacy,
  closureContext,
  closure,
  org,
  id,
  nextId,
  json,
  page,
} from './TechnicalContinuity.fixtures';

afterEach(() => vi.unstubAllGlobals());
const onExpire = () => undefined;
function setup(
  options: {
    post?: () => Promise<Response>;
    context?: typeof closureContext;
    getContext?: () => Response;
    history?: (typeof closure)[];
    detail?: boolean;
  } = {},
) {
  const onUnavailable = vi.fn();
  const onChanged = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url).split('?')[0]!;
    if (init?.method === 'POST') return options.post ? options.post() : json(closure, 201);
    if (path.endsWith('/closure-context'))
      return options.getContext?.() ?? json(options.context ?? closureContext);
    if (path.endsWith('/technical-closures')) return json(page(options.history ?? []));
    if (path.includes('/technical-closures/')) return json(options.history?.[0] ?? closure);
    if (path.endsWith(`/action-workspaces/${id}`)) return json(action);
    if (path.endsWith('/efficacy')) return json(efficacy);
    return json(page([]));
  });
  vi.stubGlobal('fetch', fetcher);
  const props = {
    organizationId: org,
    action,
    refreshing: false,
    refreshKey: 0,
    onExpire,
    onUnavailable,
    onChanged,
    onContext: () => undefined,
  };
  const view = render(
    options.detail ? (
      <ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />
    ) : (
      <ActionTechnicalClosure {...props} />
    ),
  );
  return { ...view, fetcher, onUnavailable, onChanged, props };
}
async function prepareClosure() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Preparar encerramento técnico' }),
  );
  fireEvent.change(screen.getByLabelText('Justificativa do encerramento'), {
    target: { value: closure.rationale },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Revisar encerramento' }));
}

it('shows the actual current technical closure in the action context', () => {
  render(
    <ActionContext
      {...{ item: action, efficacy, closure: { ...closureContext, latest: closure } }}
    />,
  );
  expect(screen.getByText('Encerramento vigente')).toBeInTheDocument();
});

it('reviews without posting and confirms only a validated 201', async () => {
  let resume: ((value: Response) => void) | undefined;
  const { fetcher, onChanged } = setup({
    post: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  });
  await prepareClosure();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: 'Revise antes de confirmar' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }));
  expect(
    screen.queryByText('Encerramento técnico registrado e confirmado pelo serviço.'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrando decisão…' })).toBeDisabled();
  await act(async () => resume?.(json(closure, 201)));
  expect(
    await screen.findByText('Encerramento técnico registrado e confirmado pelo serviço.'),
  ).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledOnce();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    expectedVersion: 2,
    expectedRiskVersion: 1,
    expectedLatestClosureId: null,
    expectedLatestEvaluationId: nextId,
    reassessmentId: nextId,
    opinionId: efficacy.latest?.id,
    rationale: closure.rationale,
  });
});

it('explains blocked closure without offering confirmation', async () => {
  setup({
    context: {
      ...closureContext,
      latestReassessment: null,
      permissions: { hasTechnicalCapability: false, canClose: false, canCreateCorrective: false },
      blockingReasons: ['NO_TECHNICAL_CAPABILITY', 'NO_CURRENT_REASSESSMENT'],
    },
  });
  expect(
    await screen.findByText('Reavalie o risco com a avaliação mais recente.'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Preparar encerramento técnico' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Preparar nova ação corretiva' }),
  ).not.toBeInTheDocument();
});

it('preserves a draft on 503 and requires a new explicit review', async () => {
  setup({ post: async () => json({}, 503) });
  await prepareClosure();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }));
  expect(await screen.findByText(/Serviço temporariamente indisponível/)).toBeInTheDocument();
  expect(screen.getByLabelText('Justificativa do encerramento')).toHaveValue(closure.rationale);
  expect(
    screen.queryByRole('button', { name: 'Confirmar e registrar encerramento' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Revisar encerramento' })).toBeEnabled();
});

it.each([401, 403, 404])(
  'discards private preparation after publication denies access with %s',
  async (status) => {
    const { onUnavailable } = setup({ post: async () => json({}, status) });
    await prepareClosure();
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }),
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(status));
    expect(screen.queryByText(closure.rationale)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Justificativa do encerramento')).not.toBeInTheDocument();
  },
);

it('treats a network failure and malformed 201 as uncertain, never as success', async () => {
  let malformed = false;
  const { fetcher } = setup({
    post: async () => {
      if (!malformed) throw new TypeError('Synthetic network failure');
      return json({}, 201);
    },
  });
  await prepareClosure();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }));
  expect(await screen.findByText(/Resultado incerto ou contexto alterado/)).toBeInTheDocument();
  malformed = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Consultar encerramento e vínculos atuais' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Revisar rascunho com contexto consultado' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Revisar encerramento' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }));
  expect(await screen.findByText(/Resultado incerto ou contexto alterado/)).toBeInTheDocument();
  expect(
    screen.queryByText('Encerramento técnico registrado e confirmado pelo serviço.'),
  ).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});

it.each([409, 502, 200])(
  'requires consultation and another review after status %s',
  async (status) => {
    setup({ post: async () => json(status === 200 ? closure : {}, status) });
    await prepareClosure();
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }),
    );
    expect(await screen.findByText(/Resultado incerto ou contexto alterado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar encerramento' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Consultar encerramento e vínculos atuais' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Revisar rascunho com contexto consultado' }),
    );
    expect(screen.getByRole('button', { name: 'Revisar encerramento' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Confirmar e registrar encerramento' }),
    ).not.toBeInTheDocument();
  },
);

it('purges the parent after access loss and ignores a late inspection response', async () => {
  let resolveInspection: ((response: Response) => void) | undefined;
  let denied = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url).split('?')[0]!;
    if (path.endsWith(`/action-workspaces/${id}`)) return json(action);
    if (path.endsWith('/closure-context')) return denied ? json({}, 403) : json(closureContext);
    if (path.endsWith('/efficacy')) return json(efficacy);
    if (path.endsWith('/technical-closures')) return json(page([closure]));
    if (path.includes('/technical-closures/'))
      return new Promise((resolve) => {
        resolveInspection = resolve;
      });
    return json(page([]));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar encerramento 1' }));
  denied = true;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument(),
  );
  await act(async () => resolveInspection?.(json(closure)));
  expect(screen.queryByText(closure.rationale)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
});

it('consults historical decisions and explicitly explains review requirements', async () => {
  const historical = {
    ...closure,
    validity: 'REVIEW_REQUIRED' as const,
    reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED' as const],
  };
  setup({ history: [historical] });
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar encerramento 1' }));
  const reading = await screen.findByRole('article', { name: 'Decisão de encerramento 1' });
  expect(within(reading).getByText('Prova selecionada arquivada')).toBeInTheDocument();
  expect(within(reading).getByText(closure.rationale)).toBeInTheDocument();
});

it.each([false, true])(
  'creates a linked corrective action after review, with refresh during POST: %s',
  async (refreshDuringPost) => {
    const created = {
      ...action,
      id: nextId,
      status: 'PLANNED',
      implementedAt: null,
      implementationNote: null,
      version: 1,
    };
    const createdDetail = Object.fromEntries(
      Object.entries(created).filter(
        ([key]) =>
          ![
            'risk',
            'assignedUser',
            'riskContext',
            'evidenceSummary',
            'pendingReasons',
            'permissions',
          ].includes(key),
      ),
    );
    const link = {
      id: nextId,
      organizationId: org,
      riskId: id,
      previousActionId: id,
      newActionId: nextId,
      opinionId: efficacy.latest!.id,
      reason: 'Acompanhar a medida com uma nova intervenção coletiva.',
      author: closure.author,
      createdAt: closure.createdAt,
    };
    let resume: ((value: Response) => void) | undefined;
    const { fetcher, rerender, props, onChanged } = setup({
      post: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Preparar nova ação corretiva' }),
    );
    fireEvent.change(screen.getByLabelText('Motivo da ação corretiva'), {
      target: { value: link.reason },
    });
    for (const [label, value] of [
      ['Título da medida', action.title],
      ['Descrição da medida', action.description],
      ['Responsável nominal', action.responsibleName],
      ['Prazo', action.dueDate],
      ['Resultado esperado', action.expectedResult],
      ['Critério de aferição', action.verificationCriterion],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    await userEvent.click(screen.getByRole('button', { name: 'Revisar nova ação corretiva' }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e criar ação corretiva' }));
    if (refreshDuringPost) {
      rerender(<ActionTechnicalClosure {...props} refreshKey={1} />);
      await waitFor(() =>
        expect(
          fetcher.mock.calls.filter(([url]) => String(url).endsWith('/closure-context')),
        ).toHaveLength(2),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Revisar nova ação corretiva' })).toBeDisabled(),
      );
    }
    await act(async () => resume?.(json({ link, action: createdDetail }, 201)));
    expect(await screen.findByText(/Nova ação corretiva criada e vinculada/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Motivo da ação corretiva')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith('/closure-context')),
      ).toHaveLength(refreshDuringPost ? 3 : 2),
    );
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(String(post?.[0])).toContain(`/actions/${id}/corrective-actions`);
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      expectedVersion: 2,
      action: { expectedRiskVersion: 1, title: action.title },
      reason: link.reason,
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  },
);

it('reconciles a confirmed closure after its context refreshes during publication', async () => {
  let resume: ((value: Response) => void) | undefined;
  const { rerender, props, fetcher, onChanged } = setup({
    post: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  });
  await prepareClosure();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar encerramento' }));
  rerender(<ActionTechnicalClosure {...props} refreshKey={1} />);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/closure-context')),
    ).toHaveLength(2),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar encerramento' })).toBeDisabled(),
  );
  await act(async () => resume?.(json(closure, 201)));
  expect(
    await screen.findByText('Encerramento técnico registrado e confirmado pelo serviço.'),
  ).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Justificativa do encerramento')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/closure-context')),
    ).toHaveLength(3),
  );
});
