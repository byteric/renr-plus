import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { TechnicalEvaluationPanel } from './TechnicalEvaluationPanel';
import { RiskReassessment } from './RiskReassessment';
import { RiskDetail } from './RiskDetail';
import {
  risk,
  evaluation,
  org,
  id,
  nextId,
  json,
  page,
  publishedMethod,
  efficacy,
  action,
  reassessment,
  reassessmentSummary,
} from '../actions/TechnicalContinuity.fixtures';

afterEach(() => vi.unstubAllGlobals());
const context = {
  organizationId: org,
  riskId: id,
  riskVersion: 1,
  latestEvaluation: evaluation,
  latestReassessment: null,
  permissions: { hasTechnicalCapability: true, canReassess: true },
  blockingReasons: [],
};
const actionListItem = {
  id,
  organizationId: org,
  riskId: id,
  title: action.title,
  risk: action.risk,
  responsibleName: action.responsibleName,
  dueDate: action.dueDate,
  status: action.status,
  version: action.version,
  isOverdue: false,
  referenceDate: action.referenceDate,
  timeZone: action.timeZone,
};
function setup(
  options: {
    parent?: boolean;
    post?: () => Promise<Response>;
    changedMethod?: boolean;
    history?: boolean;
    getContext?: () => Response;
    getActions?: (url: string) => Response;
    getEfficacy?: () => Response;
    getRisk?: () => Response | Promise<Response>;
  } = {},
) {
  const onSaved = vi.fn();
  const onUnavailable = vi.fn();
  const onExpired = vi.fn();
  const method = options.changedMethod
    ? { ...publishedMethod, id: nextId, version: 2 }
    : publishedMethod;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url).split('?')[0]!;
    if (init?.method === 'POST') return options.post ? options.post() : json(reassessment, 201);
    if (path.endsWith('/reassessment-context')) return options.getContext?.() ?? json(context);
    if (path.endsWith(`/risk-workspaces/${id}`)) return options.getRisk?.() ?? json(risk);
    if (path.endsWith('/reassessments'))
      return json(page(options.history ? [reassessmentSummary] : []));
    if (path.includes('/reassessments/')) return json(reassessment);
    if (path.endsWith('/actions'))
      return options.getActions?.(String(url)) ?? json(page([actionListItem]));
    if (path.endsWith('/efficacy')) return options.getEfficacy?.() ?? json(efficacy);
    if (path.endsWith('/evaluation-method-versions')) return json(page([method], 50));
    if (path.endsWith('/source-options'))
      return json(
        page(
          [
            {
              kind: 'RISK_RECORD',
              id,
              label: 'Registro contextual elegível',
              reference: 'Registro coletivo',
              isDemonstration: true,
              eligible: true,
              unavailableReason: null,
            },
          ],
          50,
        ),
      );
    return json(page([]));
  });
  vi.stubGlobal('fetch', fetcher);
  const props = { risk, onExpire: onExpired, onSaved, onUnavailable, refreshKey: 0 };
  const view = render(
    options.parent ? (
      <RiskDetail
        organizationId={org}
        id={id}
        canWrite
        canEvaluate
        query=""
        onExpire={onExpired}
        onChanged={() => undefined}
      />
    ) : (
      <RiskReassessment {...props} />
    ),
  );
  return { ...view, fetcher, onSaved, onUnavailable, onExpired, props, method };
}
async function prepare(methodId = org) {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Preparar reavaliação do risco' }),
  );
  const checkbox = await screen.findByRole('checkbox', { name: action.title });
  await waitFor(() => expect(checkbox).toBeEnabled());
  await userEvent.click(checkbox);
  fireEvent.change(await screen.findByLabelText(`Consideração de ${action.title}`), {
    target: { value: 'A medida e o parecer foram considerados na reavaliação coletiva.' },
  });
  await waitFor(() => expect(screen.getByLabelText('Método publicado')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Método publicado'), { target: { value: methodId } });
  fireEvent.change(screen.getByLabelText('Probabilidade'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('Severidade'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('Justificativa técnica'), {
    target: { value: reassessment.evaluation.rationale },
  });
  fireEvent.change(screen.getByLabelText('Contexto da avaliação'), {
    target: { value: reassessment.evaluation.context },
  });
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Registro contextual elegível · Demonstrativa' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Revisar avaliação e medidas' }));
}
it('offers a dedicated reassessment with the current evaluation as predecessor', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).includes('/reassessment-context')
        ? json({
            organizationId: org,
            riskId: id,
            riskVersion: 1,
            latestEvaluation: evaluation,
            latestReassessment: null,
            permissions: { hasTechnicalCapability: true, canReassess: true },
            blockingReasons: [],
          })
        : json(page([])),
    ),
  );
  render(
    <TechnicalEvaluationPanel
      risk={risk}
      canEvaluate
      onExpire={() => undefined}
      onSaved={() => undefined}
    />,
  );
  expect(
    await screen.findByRole('button', { name: 'Preparar reavaliação do risco' }),
  ).toBeEnabled();
});

it('reviews selected measures and posts a chain with the current predecessor only after confirmation', async () => {
  const { fetcher, onSaved } = setup();
  await prepare();
  const review = screen.getByRole('region', { name: 'Revisão da reavaliação' });
  expect(within(review).getByText('Comparável: mesma versão de método')).toBeInTheDocument();
  expect(
    within(review).getByRole('heading', { name: 'Revise a reavaliação antes de confirmar' }),
  ).toHaveFocus();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }));
  expect(
    await screen.findByText('Reavaliação registrada e confirmada pelo serviço.'),
  ).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledOnce();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    expectedPreviousEvaluationId: evaluation.id,
    evaluation: { expectedVersion: 1, methodVersionId: org },
    measures: [
      {
        actionId: id,
        expectedVersion: 2,
        opinionId: efficacy.latest?.id,
        expectedContextFingerprint: efficacy.contextFingerprint,
      },
    ],
  });
});

it('explains a method-version change without inventing reduction percentages', async () => {
  setup({ changedMethod: true });
  await prepare(nextId);
  expect(
    screen.getByText('Método ou versão alterados: classificações não comparáveis'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
});

it('compares the preserved before/after evaluations and considers their measures', async () => {
  setup({ history: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar reavaliação 2' }));
  const reading = await screen.findByRole('article', { name: 'Reavaliação consultada 2' });
  expect(
    within(reading).getByRole('heading', { name: 'Anterior · avaliação 1' }),
  ).toBeInTheDocument();
  expect(within(reading).getByRole('heading', { name: 'Atual · avaliação 2' })).toBeInTheDocument();
  expect(within(reading).getByText(reassessment.measures[0]!.consideration)).toBeInTheDocument();
  expect(within(reading).getAllByText(/Registro sintético da origem/)).toHaveLength(2);
});

it('preserves selections between pages and permits any current opinion result', async () => {
  const { fetcher } = setup({
    getActions: (url) =>
      json({
        ...page(url.includes('page=2') ? [] : [actionListItem]),
        total: 21,
        page: url.includes('page=2') ? 2 : 1,
      }),
    getEfficacy: () =>
      json({
        ...efficacy,
        latest: {
          ...efficacy.latest,
          result: 'INCONCLUSIVE',
          nextSteps: 'Continuar o acompanhamento coletivo.',
        },
      }),
  });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Voltar à preparação da reavaliação' }));
  const pagination = screen.getByRole('navigation', { name: 'Paginação de medidas implementadas' });
  await userEvent.click(within(pagination).getByRole('button', { name: 'Próxima página' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url]) => String(url).includes('/actions?') && String(url).includes('page=2'),
      ),
    ).toBe(true),
  );
  expect(screen.getByLabelText(`Consideração de ${action.title}`)).toHaveValue(
    'A medida e o parecer foram considerados na reavaliação coletiva.',
  );
});

it.each([409, 502, 200])('requires a new consultation and review on status %s', async (status) => {
  setup({ post: async () => json(status === 200 ? reassessment : {}, status) });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }));
  expect(await screen.findByText(/Resultado incerto ou contexto alterado/)).toBeInTheDocument();
  expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Consultar reavaliações e contexto atuais' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Revisar rascunho com contexto consultado' }),
  );
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Confirmar e registrar reavaliação' }),
  ).not.toBeInTheDocument();
});

it('retains recoverable drafts on 503 and does not accept an invalid created response', async () => {
  const { fetcher } = setup({ post: async () => json({}, 503) });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }));
  expect(await screen.findByText(/Serviço temporariamente indisponível/)).toBeInTheDocument();
  expect(screen.getByLabelText(`Consideração de ${action.title}`)).toHaveValue(
    'A medida e o parecer foram considerados na reavaliação coletiva.',
  );
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it.each([401, 403, 404])(
  'discards private reassessment preparation when publication returns %s',
  async (status) => {
    const { onUnavailable } = setup({ post: async () => json({}, status) });
    await prepare();
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }),
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(status));
    expect(screen.queryByRole('region', { name: 'Reavaliação do risco' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Justificativa técnica')).not.toBeInTheDocument();
  },
);

it('rejects a malformed created response and preserves the reassessment draft for consultation', async () => {
  setup({ post: async () => json({}, 201) });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }));
  expect(await screen.findByText(/Resultado incerto ou contexto alterado/)).toBeInTheDocument();
  expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(
    screen.queryByText('Reavaliação registrada e confirmada pelo serviço.'),
  ).not.toBeInTheDocument();
});

it('purges preparation when access is denied and ignores late inspection results', async () => {
  let resolveInspection: ((value: Response) => void) | undefined;
  let denied = false;
  const { rerender, props, onUnavailable } = setup({
    getContext: () => (denied ? json({}, 403) : json(context)),
    history: true,
  });
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) =>
      String(url).includes(`/reassessments/${nextId}`)
        ? new Promise((resolve) => {
            resolveInspection = resolve;
          })
        : original(url, init),
    ),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar reavaliação 2' }));
  denied = true;
  rerender(<RiskReassessment {...props} refreshKey={1} />);
  await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(403));
  await act(async () => resolveInspection?.(json(reassessment)));
  expect(screen.queryByRole('region', { name: 'Reavaliação do risco' })).not.toBeInTheDocument();
  expect(screen.queryByText(reassessment.evaluation.rationale)).not.toBeInTheDocument();
});

it('preserves the private draft and requires another review after refreshing the parent risk', async () => {
  const { fetcher } = setup({ parent: true });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Voltar à preparação da reavaliação' }));
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar risco' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/risk-workspaces/${id}`)).length,
    ).toBeGreaterThan(1),
  );
  expect(await screen.findByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(screen.getByLabelText(`Consideração de ${action.title}`)).toHaveValue(
    'A medida e o parecer foram considerados na reavaliação coletiva.',
  );
  expect(
    screen.queryByRole('button', { name: 'Confirmar e registrar reavaliação' }),
  ).not.toBeInTheDocument();
});

it('reconciles a confirmed reassessment after its context refreshes during publication', async () => {
  let resume: ((value: Response) => void) | undefined;
  const { rerender, props, fetcher, onSaved } = setup({
    post: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' }));
  rerender(<RiskReassessment {...props} refreshKey={1} />);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/reassessment-context')),
    ).toHaveLength(2),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeDisabled(),
  );
  await act(async () => resume?.(json(reassessment, 201)));
  expect(
    await screen.findByText('Reavaliação registrada e confirmada pelo serviço.'),
  ).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Justificativa técnica')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/reassessment-context')),
    ).toHaveLength(3),
  );
});

it('preserves a draft while external disabling prevents preparation and confirmation', async () => {
  const { rerender, props, fetcher } = setup();
  await prepare();
  rerender(<RiskReassessment {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Confirmar e registrar reavaliação' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Voltar à preparação da reavaliação' }));
  expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeDisabled();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  rerender(<RiskReassessment {...props} />);
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeEnabled();
});

it('retains the parent draft with review disabled during refresh and after a 503', async () => {
  let refreshing = false;
  let resume: ((value: Response) => void) | undefined;
  setup({
    parent: true,
    getRisk: () =>
      refreshing
        ? new Promise((resolve) => {
            resume = resolve;
          })
        : json(risk),
  });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Voltar à preparação da reavaliação' }));
  refreshing = true;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar risco' }));
  await waitFor(() => expect(resume).toBeDefined());
  expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeDisabled();
  await act(async () => resume?.(json({}, 503)));
  expect(await screen.findByText(/Serviço temporariamente indisponível/)).toBeInTheDocument();
  expect(screen.getByLabelText('Justificativa técnica')).toHaveValue(
    reassessment.evaluation.rationale,
  );
  expect(screen.getByRole('button', { name: 'Revisar avaliação e medidas' })).toBeDisabled();
});

it.each([401, 403, 404])(
  'removes the parent detail and private draft when refresh denies access with %s',
  async (status) => {
    let denied = false;
    const { onExpired } = setup({
      parent: true,
      getRisk: () => (denied ? json({}, status) : json(risk)),
    });
    await prepare();
    await userEvent.click(
      screen.getByRole('button', { name: 'Voltar à preparação da reavaliação' }),
    );
    denied = true;
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar risco' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Justificativa técnica')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Reavaliação do risco' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: risk.factor })).not.toBeInTheDocument();
    expect(onExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
