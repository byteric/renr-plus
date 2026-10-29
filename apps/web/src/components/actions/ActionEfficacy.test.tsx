import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { actionDetailSchema, efficacyContextSchema, type EfficacyContext } from '@renr/contracts';
import { ActionEfficacy } from './ActionEfficacy';

import { ActionDetail } from './ActionDetail';

const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const person = { id: org, name: 'Synthetic author' };
const scope = { id: org, name: 'Synthetic scope', isActive: true };
const content = {
  factor: 'Synthetic collective risk',
  description: 'Synthetic collective description',
  exposureDescription: 'Synthetic exposure',
  exposedGroupDescription: 'Synthetic group',
  possibleHarms: 'Synthetic possible harms',
  existingControls: 'Synthetic controls',
  sourceKind: 'TECHNICAL_RECORD',
  sourceNote: 'Synthetic context',
  diagnosticCycleId: null,
  assessmentGroupId: org,
  sectorId: org,
  unit: scope,
  sector: scope,
  status: 'REGISTERED',
};
const action = actionDetailSchema.parse({
  id,
  organizationId: org,
  riskId: id,
  title: 'Synthetic measure',
  description: 'Synthetic preventive measure.',
  responsibleName: 'Synthetic nominal person',
  dueDate: '2026-12-20',
  expectedResult: 'Synthetic expected result.',
  verificationCriterion: 'Synthetic verification criterion.',
  status: 'IN_PROGRESS',
  version: 2,
  sourceRiskVersion: 1,
  evaluationId: null,
  contextSnapshot: content,
  currentOrigin: {
    riskStatus: 'REGISTERED',
    organizationActive: true,
    unitActive: true,
    sectorActive: true,
  },
  implementationNote: null,
  implementedAt: null,
  createdBy: person,
  updatedBy: person,
  createdAt: '2026-10-25T12:00:00.000Z',
  updatedAt: '2026-10-25T12:00:00.000Z',
  isOverdue: false,
  referenceDate: '2026-10-25',
  timeZone: 'America/Sao_Paulo',
});
const onExpire = () => undefined;
const workspace = {
  ...action,
  risk: { id, factor: content.factor },
  assignedUser: null,
  riskContext: {
    unit: scope,
    sector: scope,
    contextMatches: true,
    technicalEvaluationState: 'ABSENT',
    priority: null,
  },
  evidenceSummary: { active: 0, archived: 0 },
  pendingReasons: [],
  permissions: {
    canManage: true,
    canExecute: true,
    canNote: true,
    canUploadEvidence: true,
    canArchiveEvidence: true,
  },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const emptyPage = { items: [], total: 0, page: 1, pageSize: 50 };
afterEach(() => vi.unstubAllGlobals());

const snapshot = {
  title: action.title,
  description: action.description,
  responsibleName: action.responsibleName,
  dueDate: action.dueDate,
  expectedResult: action.expectedResult,
  verificationCriterion: action.verificationCriterion,
  status: 'IMPLEMENTED',
  implementationNote: 'Synthetic implementation successfully reported.',
  implementedAt: '2026-10-25T12:00:00.000Z',
};
const ctx = efficacyContextSchema.parse({
  organizationId: org,
  actionId: id,
  riskId: id,
  actionVersion: 2,
  actionRevisionId: org,
  actionSnapshot: snapshot,
  riskContextSnapshot: content,
  contextFingerprint: 'a'.repeat(64),
  actionFingerprint: 'b'.repeat(64),
  riskContextFingerprint: 'c'.repeat(64),
  referenceDate: '2026-10-25',
  timeZone: 'America/Sao_Paulo',
  state: 'ABSENT',
  latest: null,
  permissions: { hasTechnicalCapability: true, canRecord: true },
  blockingReasons: [],
});
const opinion = {
  id: org,
  organizationId: org,
  actionId: id,
  riskId: id,
  sequence: 1,
  supersedesId: null,
  actionVersion: 2,
  actionRevisionId: org,
  actionSnapshot: snapshot,
  riskContextSnapshot: content,
  actionFingerprint: ctx.actionFingerprint,
  riskContextFingerprint: ctx.riskContextFingerprint,
  contextFingerprint: ctx.contextFingerprint,
  criterionReference: snapshot.verificationCriterion,
  result: 'INCONCLUSIVE',
  verifiedOn: ctx.referenceDate,
  observation: 'Synthetic observation with sufficient detail.',
  rationale: 'Synthetic rationale with sufficient detail.',
  nextSteps: 'Continue monitoring the synthetic measure.',
  proofPackage: {
    files: [],
    texts: [
      {
        id,
        reference: 'Report 01',
        description: 'Synthetic identified proof description.',
        rationale: 'Supports verification.',
        sha256: 'd'.repeat(64),
      },
    ],
  },
  author: person,
  createdAt: '2026-10-25T12:00:00.000Z',
  validity: 'CURRENT',
  reviewReasons: [],
};
function setup(
  options: {
    context?: EfficacyContext;
    post?: () => Promise<Response>;
    getContext?: () => Response;
    getEvidence?: (url: string) => Response;
    getHistory?: () => Response;
    getOpinion?: () => Response;
    history?: unknown[];
  } = {},
) {
  const onUnavailable = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url).split('?')[0]!;
    if (init?.method === 'POST') return options.post ? options.post() : json(opinion, 201);
    if (path.endsWith('/efficacy'))
      return options.getContext ? options.getContext() : json(options.context ?? ctx);
    if (path.endsWith('/efficacy-opinions'))
      return options.getHistory
        ? options.getHistory()
        : json({
            ...emptyPage,
            items: options.history ?? [],
            total: options.history?.length ?? 0,
            pageSize: 20,
          });
    if (path.includes('/efficacy-opinions/'))
      return options.getOpinion ? options.getOpinion() : json(opinion);
    if (path.endsWith('/evidence') && options.getEvidence) return options.getEvidence(String(url));
    return json(emptyPage);
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <ActionEfficacy
      organizationId={org}
      action={workspace as never}
      refreshing={false}
      refreshKey={0}
      onExpire={onExpire}
      onUnavailable={onUnavailable}
      onContext={() => undefined}
    />,
  );
  return { fetcher, onUnavailable, ...view };
}
async function prepare() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Preparar análise de eficácia' }),
  );
  fireEvent.change(screen.getByLabelText('Observação técnica'), {
    target: { value: opinion.observation },
  });
  fireEvent.change(screen.getByLabelText('Justificativa do parecer'), {
    target: { value: opinion.rationale },
  });
  fireEvent.change(screen.getByLabelText('Próximos passos (obrigatório)'), {
    target: { value: opinion.nextSteps },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar prova textual' }));
  fireEvent.change(screen.getByLabelText('Referência identificada 1'), {
    target: { value: 'Report 01' },
  });
  fireEvent.change(screen.getByLabelText('Descrição da prova 1'), {
    target: { value: 'Synthetic identified proof description.' },
  });
  fireEvent.change(screen.getByLabelText('Justificativa da prova 1'), {
    target: { value: 'Supports verification.' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Revisar resumo do parecer' }));
}
it('offers local efficacy preparation for technical capability without publishing', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes('/action-workspaces/'))
      return json(String(url).includes('/history') ? emptyPage : workspace);
    if (String(url).endsWith('/efficacy')) return json(ctx);
    return json(emptyPage);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  expect(await screen.findByRole('button', { name: 'Preparar análise de eficácia' })).toBeEnabled();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('reviews readonly preparation and publishes only after explicit confirmation and a validated 201', async () => {
  let resume: ((response: Response) => void) | undefined;
  const { fetcher } = setup({
    post: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  });
  await prepare();
  expect(screen.getByLabelText('Observação técnica')).toBeDisabled();
  expect(screen.getByRole('heading', { name: 'Revise antes de confirmar' })).toHaveFocus();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
  expect(screen.queryByText(/Parecer de eficácia registrado/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrando parecer…' })).toBeDisabled();
  const body = JSON.parse(
    String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body),
  );
  expect(body).toMatchObject({
    expectedVersion: 2,
    expectedLatestOpinionId: null,
    expectedContextFingerprint: ctx.contextFingerprint,
    observation: opinion.observation,
  });
  expect(body).not.toHaveProperty('author');
  await act(async () => {
    resume?.(json(opinion, 201));
  });
  await screen.findByText(/Parecer de eficácia registrado/);
});
it('allows preparation before implementation but prevents publication', async () => {
  setup({
    context: {
      ...ctx,
      permissions: { hasTechnicalCapability: true, canRecord: false },
      blockingReasons: ['ACTION_NOT_IMPLEMENTED'],
    },
  });
  await prepare();
  expect(screen.getByRole('button', { name: 'Confirmar e registrar parecer' })).toBeDisabled();
  expect(screen.getByText(/informe primeiro a implementação/)).toBeInTheDocument();
});
it('keeps operational consultation without technical controls', async () => {
  setup({
    context: {
      ...ctx,
      permissions: { hasTechnicalCapability: false, canRecord: false },
      blockingReasons: ['NO_TECHNICAL_CAPABILITY'],
    },
  });
  await screen.findByText(/Consulta disponível/);
  expect(
    screen.queryByRole('button', { name: 'Preparar análise de eficácia' }),
  ).not.toBeInTheDocument();
});
it.each([409, 502, 0])(
  'preserves draft after uncertain %s and requires fresh consultation and review',
  async (status) => {
    const { fetcher } = setup({
      post: async () => {
        if (status === 0) throw new TypeError('offline');
        return json({}, status);
      },
    });
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
    await screen.findByText(/Resultado incerto ou contexto alterado/);
    expect(screen.getByLabelText('Observação técnica')).toHaveValue(opinion.observation);
    expect(screen.getByRole('button', { name: 'Revisar resumo do parecer' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Consultar contexto e histórico atuais' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Revisar rascunho com contexto consultado' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Revisar resumo do parecer' }));
    expect(screen.getByRole('button', { name: 'Confirmar e registrar parecer' })).toBeEnabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  },
);
it('preserves draft on 503', async () => {
  setup({ post: async () => json({}, 503) });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
  await screen.findByText(/Serviço temporariamente indisponível/);
  expect(screen.getByLabelText('Observação técnica')).toHaveValue(opinion.observation);
  expect(screen.getByRole('button', { name: 'Revisar resumo do parecer' })).toBeEnabled();
});
it('purges private draft on 403 from publication', async () => {
  const { onUnavailable } = setup({ post: async () => json({}, 403) });
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
  await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(403));
  expect(screen.queryByDisplayValue(opinion.observation)).not.toBeInTheDocument();
});
it('shows supersession and selected archived proof review without reactivating an old effective conclusion', async () => {
  const latest = {
    ...opinion,
    validity: 'REVIEW_REQUIRED' as const,
    reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED' as const],
  };
  setup({
    context: { ...ctx, state: 'REVIEW_REQUIRED', latest: latest as never },
    history: [{ ...opinion, id, result: 'EFFECTIVE', validity: 'SUPERSEDED' }, latest],
  });
  expect((await screen.findAllByText('Prova selecionada arquivada')).length).toBeGreaterThan(0);
  expect(screen.getByText('Substituído por parecer posterior')).toBeInTheDocument();
  expect(screen.getAllByText('Parecer 1 · Inconclusivo').length).toBeGreaterThan(0);
});
it('removes technical draft when capability is revoked on revalidation', async () => {
  let revoked = false;
  setup({
    getContext: () =>
      json(
        revoked
          ? {
              ...ctx,
              permissions: { hasTechnicalCapability: false, canRecord: false },
              blockingReasons: ['NO_TECHNICAL_CAPABILITY'],
            }
          : ctx,
      ),
  });
  await prepare();
  revoked = true;
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByText(/Consulta disponível/);
  expect(screen.queryByLabelText('Observação técnica')).not.toBeInTheDocument();
});
it('rejects a valid context belonging to another action', async () => {
  setup({ context: { ...ctx, actionId: org } });
  await waitFor(() =>
    expect(screen.queryByText('Consultando contexto de eficácia…')).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('button', { name: 'Preparar análise de eficácia' }),
  ).not.toBeInTheDocument();
});

it.each([200, 201])(
  'requires status 201 and a contract-valid response, refusing ambiguous %s',
  async (status) => {
    setup({ post: async () => json(status === 200 ? opinion : {}, status) });
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
    await screen.findByText(/Resultado incerto ou contexto alterado/);
    expect(screen.queryByText(/Parecer de eficácia registrado/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar resumo do parecer' })).toBeDisabled();
  },
);
it('discards parent private action and efficacy draft when context revalidation denies access', async () => {
  let denied = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/efficacy')) return denied ? json({}, 403) : json(ctx);
    if (String(url).endsWith(`/action-workspaces/${id}`)) return json(workspace);
    return json(emptyPage);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await prepare();
  denied = true;
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument(),
  );
  expect(screen.queryByDisplayValue(opinion.observation)).not.toBeInTheDocument();
  expect(screen.queryByText('Revise antes de confirmar')).not.toBeInTheDocument();
});
it.each(['archived', 'unavailable'])(
  'allows explicitly removing a selected %s proof after a conflict, independently of the current evidence page',
  async (state) => {
    const otherId = '30000000-0000-4000-8000-000000000001';
    let changed = false;
    let posts = 0;
    const file = {
      id: org,
      organizationId: org,
      actionId: id,
      fileName: 'Selected-proof.pdf',
      description: 'Synthetic selected proof description.',
      mimeType: 'application/pdf',
      size: 128,
      sha256: 'e'.repeat(64),
      createdBy: person,
      createdAt: opinion.createdAt,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      actionVersion: 2,
    };
    const other = { ...file, id: otherId, fileName: 'Preserved-proof.pdf' };
    const { fetcher } = setup({
      post: async () => {
        posts += 1;
        return posts === 1 ? json({}, 409) : json(opinion, 201);
      },
      getEvidence: (url) =>
        json({
          ...emptyPage,
          total: 51,
          page: new URL(url, 'http://localhost').searchParams.get('page') === '2' ? 2 : 1,
          items:
            new URL(url, 'http://localhost').searchParams.get('page') === '2'
              ? []
              : changed
                ? state === 'archived'
                  ? [
                      {
                        ...file,
                        archivedAt: opinion.createdAt,
                        archivedBy: person,
                        archiveReason: 'Archived in another session',
                      },
                      other,
                    ]
                  : [other]
                : [file, other],
        }),
    });
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à preparação' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Selected-proof.pdf/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Preserved-proof.pdf/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar resumo do parecer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
    await screen.findByText(/Resultado incerto ou contexto alterado/);
    changed = true;
    await userEvent.click(
      screen.getByRole('button', { name: 'Consultar contexto e histórico atuais' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Revisar rascunho com contexto consultado' }),
    );
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Paginação de provas' })).getByRole('button', {
        name: 'Próxima página',
      }),
    );
    await screen.findByText('Nenhum arquivo ativo nesta página.');
    expect(
      screen.getByText('Selecionados: Selected-proof.pdf, Preserved-proof.pdf'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remover seleção de Selected-proof.pdf' }),
    );
    expect(screen.getByLabelText('Observação técnica')).toHaveValue(opinion.observation);
    expect(screen.getByLabelText('Justificativa do parecer')).toHaveValue(opinion.rationale);
    expect(screen.getByLabelText('Referência identificada 1')).toHaveValue('Report 01');
    expect(screen.getByText('Selecionados: Preserved-proof.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar resumo do parecer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
    const bodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({
      evidenceIds: [otherId],
      observation: opinion.observation,
      rationale: opinion.rationale,
      textualEvidence: [
        {
          reference: 'Report 01',
          description: 'Synthetic identified proof description.',
          rationale: 'Supports verification.',
        },
      ],
    });
  },
);
it('discards an opened current opinion when a new inconclusive opinion supersedes it', async () => {
  const first = { ...opinion, result: 'EFFECTIVE', validity: 'CURRENT' };
  const second = { ...opinion, id, sequence: 2, supersedesId: org };
  let saved = false;
  const { fetcher } = setup({
    getContext: () => json({ ...ctx, state: 'CURRENT', latest: saved ? second : first }),
    getHistory: () =>
      json({
        ...emptyPage,
        pageSize: 20,
        items: saved ? [second, { ...first, validity: 'SUPERSEDED' }] : [first],
        total: saved ? 2 : 1,
      }),
    post: async () => {
      saved = true;
      return json(second, 201);
    },
  });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) =>
    String(url).endsWith(`/efficacy-opinions/${org}`) ? json(first) : original(url, init),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar parecer 1' }));
  await waitFor(() => expect(screen.getAllByText('Vigente')).toHaveLength(3));
  await prepare();
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar parecer' }));
  await screen.findByText(/Parecer de eficácia registrado/);
  await screen.findByText('Substituído por parecer posterior');
  expect(screen.getAllByText('Vigente')).toHaveLength(2);
  expect(screen.getAllByText('Parecer 1 · Eficaz')).toHaveLength(1);
});
it('invalidates an opened opinion when background consultation requires review', async () => {
  let changed = false;
  const reviewed = {
    ...opinion,
    validity: 'REVIEW_REQUIRED',
    reviewReasons: ['SELECTED_EVIDENCE_ARCHIVED'],
  };
  setup({
    getContext: () =>
      json({
        ...ctx,
        state: changed ? 'REVIEW_REQUIRED' : 'CURRENT',
        latest: changed ? reviewed : opinion,
      }),
    getHistory: () =>
      json({ ...emptyPage, pageSize: 20, items: [changed ? reviewed : opinion], total: 1 }),
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar parecer 1' }));
  await waitFor(() => expect(screen.getAllByText('Vigente')).toHaveLength(3));
  changed = true;
  fireEvent(document, new Event('visibilitychange'));
  await screen.findAllByText('Prova selecionada arquivada');
  expect(screen.queryByText('Vigente')).not.toBeInTheDocument();
  expect(screen.getAllByText('Revisão necessária')).toHaveLength(2);
});
it.each([401, 403, 404])(
  'purges parent action and private draft when opinion detail returns %s',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url) => {
        if (String(url).endsWith(`/action-workspaces/${id}`)) return json(workspace);
        if (String(url).endsWith('/efficacy')) return json(ctx);
        if (String(url).split('?')[0]!.endsWith('/efficacy-opinions'))
          return json({ ...emptyPage, pageSize: 20, items: [opinion], total: 1 });
        if (String(url).endsWith(`/efficacy-opinions/${org}`)) return json({}, status);
        return json(emptyPage);
      }),
    );
    render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Consultar parecer 1' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue(opinion.observation)).not.toBeInTheDocument();
    expect(screen.queryByText('Report 01')).not.toBeInTheDocument();
  },
);
it('keeps full current opinion and compact history until the chosen superseded version is consulted', async () => {
  const previous = {
    ...opinion,
    result: 'EFFECTIVE',
    validity: 'SUPERSEDED',
    observation: 'Previous observation preserved in the selected historical opinion.',
    rationale: 'Previous rationale preserved in the selected historical opinion.',
    criterionReference: 'Previous criterion preserved when the opinion was registered.',
  };
  const latest = { ...opinion, id, sequence: 2, supersedesId: org };
  setup({
    context: { ...ctx, state: 'CURRENT', latest: latest as never },
    history: [latest, previous],
    getOpinion: () => json(previous),
  });
  await screen.findByRole('button', { name: 'Consultar parecer 1' });
  const history = screen.getByRole('heading', { name: 'Histórico de pareceres' }).parentElement!;
  expect(within(history).queryByText(previous.observation)).not.toBeInTheDocument();
  expect(within(history).queryByText(previous.rationale)).not.toBeInTheDocument();
  expect(within(history).queryByText(previous.criterionReference)).not.toBeInTheDocument();
  expect(within(history).queryByText(latest.observation)).not.toBeInTheDocument();
  expect(screen.getAllByText(latest.observation)).toHaveLength(1);
  expect(within(history).getByText('Parecer 1 · Eficaz')).toBeInTheDocument();
  expect(within(history).getByText('Substituído por parecer posterior')).toBeInTheDocument();
  await userEvent.click(within(history).getByRole('button', { name: 'Consultar parecer 1' }));
  expect(await within(history).findByText(previous.observation)).toBeInTheDocument();
  expect(within(history).getByText(previous.rationale)).toBeInTheDocument();
  expect(within(history).getByText(previous.criterionReference)).toBeInTheDocument();
  expect(within(history).getAllByText('Substituído por parecer posterior')).toHaveLength(2);
  expect(within(history).getByText('Synthetic identified proof description.')).toBeInTheDocument();
  expect(within(history).getByText(`SHA-256 ${'d'.repeat(64)}`)).toBeInTheDocument();
  expect(screen.getAllByText(latest.observation)).toHaveLength(1);
});
