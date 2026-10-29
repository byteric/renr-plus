import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { actionDetailSchema } from '@renr/contracts';
import { ActionEvidence } from './ActionEvidence';
import { operationalEfficacyContext } from './ActionEfficacy.fixtures';
import { operationalClosureContext } from './technical-closure.fixtures';
import { ActionDetail } from './ActionDetail';
import { ActionList } from './ActionList';

// Transport phases are exercised by evidence-upload.test.ts and browser E2E;
// these domain tests control API responses at the existing fetch boundary.
vi.mock('../../lib/evidence-upload', async () => {
  const { request } = await import('../../lib/api');
  return {
    sendEvidenceFile: (
      ...[path, schema, body, options]: Parameters<
        typeof import('../../lib/evidence-upload').sendEvidenceFile
      >
    ) =>
      request(path, schema, {
        method: 'POST',
        body,
        signal: options.signal,
        headers: { 'Idempotency-Key': options.key },
      }),
  };
});

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
const recoveredEvidence = {
  id: org,
  organizationId: org,
  actionId: id,
  description: 'Synthetic preserved description.',
  fileName: 'synthetic.pdf',
  mimeType: 'application/pdf',
  size: 8,
  sha256: 'a'.repeat(64),
  createdBy: person,
  createdAt: '2026-10-25T12:00:00.000Z',
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  actionVersion: 3,
};

async function prepareEvidenceDraft() {
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: recoveredEvidence.description },
  });
  await userEvent.upload(
    screen.getByLabelText('Arquivo da evidência'),
    new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' }),
  );
}

it('does not allow archiving A when only evidence B usage was consulted successfully', async () => {
  const second = { ...recoveredEvidence, id, fileName: 'second.pdf' };
  const patches = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') {
        patches();
        return json(recoveredEvidence);
      }
      if (String(url).includes(`/${org}/usage`)) return json({}, 503);
      if (String(url).includes(`/${id}/usage`))
        return json({
          evidenceId: id,
          opinionTotal: 0,
          closureTotal: 0,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        });
      return json({ ...emptyPage, items: [recoveredEvidence, second], total: 2 });
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  const archiveButtons = await screen.findAllByRole('button', {
    name: /^Arquivar evidência$/,
  });
  await userEvent.click(archiveButtons[0]!);
  await screen.findByText(
    'Não foi possível consultar os usos. Consulte novamente antes de arquivar.',
  );
  const confirm = screen.getByRole('button', { name: 'Confirmar arquivamento da evidência' });
  expect(confirm).toBeDisabled();
  const usageButtons = screen.getAllByRole('button', { name: 'Consultar usos da evidência' });
  await userEvent.click(usageButtons[1]!);
  await screen.findByText(/0 parecer.*0 encerramento/);
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo do arquivamento'), {
    target: { value: 'Synthetic archive reason for evidence A' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Arquivar evidência' }));
  expect(patches).not.toHaveBeenCalled();
});

it('restores an editable preserved draft when repeating a missing attempt gets a definitive validation rejection', async () => {
  const keys: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        return keys.length === 1 ? json({}, 503) : json({}, 400);
      }
      if (String(url).includes('/upload-attempts/')) return json({}, 404);
      if (String(url).endsWith(`/actions/${id}`)) return json(action);
      return json(emptyPage);
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  await prepareEvidenceDraft();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Repetir tentativa original' }));
  await screen.findByText('Confira os campos informados e tente novamente.');
  expect(screen.getByLabelText('Descrição da evidência')).toBeEnabled();
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    recoveredEvidence.description,
  );
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeEnabled();
  expect((screen.getByLabelText('Arquivo da evidência') as HTMLInputElement).files).toHaveLength(1);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

it.each([400, 413, 415])(
  'preserves an editable draft after a definitive upload validation error (%s)',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (_url, init) =>
          init?.method === 'POST' ? json({}, status) : json(emptyPage),
        ),
    );
    render(
      <ActionEvidence
        organizationId={org}
        action={action}
        canWrite
        onExpire={onExpire}
        onChanged={() => undefined}
      />,
    );
    await prepareEvidenceDraft();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeEnabled();
    expect(screen.getByLabelText('Descrição da evidência')).toBeEnabled();
    expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
      recoveredEvidence.description,
    );
    expect((screen.getByLabelText('Arquivo da evidência') as HTMLInputElement).files).toHaveLength(
      1,
    );
  },
);

it('repeats a missing attempt explicitly with its original key only after checking action access', async () => {
  const keys: string[] = [];
  const changed = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        return keys.length === 1 ? json({}, 503) : json(recoveredEvidence, 201);
      }
      if (String(url).includes('/upload-attempts/')) return json({}, 404);
      if (String(url).endsWith(`/actions/${id}`)) return json({ ...action, version: 6 });
      return json(emptyPage);
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={changed}
    />,
  );
  await prepareEvidenceDraft();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  const repeat = await screen.findByRole('button', { name: 'Repetir tentativa original' });
  expect(keys).toHaveLength(1);
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    recoveredEvidence.description,
  );
  expect((screen.getByLabelText('Arquivo da evidência') as HTMLInputElement).files).toHaveLength(1);
  await userEvent.click(repeat);
  await screen.findByText('Evidência adicionada ao histórico.');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it('allows explicit reconciliation while an upload lease is expired without retrying automatically', async () => {
  let key = '';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        key = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({}, 504);
      }
      return String(url).includes('/upload-attempts/')
        ? json({
            key,
            organizationId: org,
            actionId: id,
            state: 'UPLOADING',
            attemptVersion: 1,
            description: recoveredEvidence.description,
            fileName: 'synthetic.pdf',
            mimeType: 'application/pdf',
            size: 8,
            sha256: 'a'.repeat(64),
            createdAt: recoveredEvidence.createdAt,
            updatedAt: recoveredEvidence.createdAt,
            leaseExpiresAt: recoveredEvidence.createdAt,
            currentActionVersion: 2,
            retryAllowed: false,
            objectState: null,
            evidence: null,
          })
        : json(emptyPage);
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  await prepareEvidenceDraft();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  expect(
    await screen.findByRole('button', { name: 'Conciliar e finalizar tentativa' }),
  ).toBeEnabled();
});

it('does not announce upload success for an evidence from a different action', async () => {
  const changed = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        init?.method === 'POST'
          ? json({ ...recoveredEvidence, actionId: org }, 201)
          : json(emptyPage),
      ),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={changed}
    />,
  );
  await prepareEvidenceDraft();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/resultado incerto/i);
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByText('Evidência adicionada ao histórico.')).not.toBeInTheDocument();
});

it('consults an uncertain keyed upload after 503 and recovers completion without another upload', async () => {
  const changed = vi.fn();
  let key = '';
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        key = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({}, 503);
      }
      if (String(url).includes('/upload-attempts/'))
        return json({
          key,
          organizationId: org,
          actionId: id,
          state: 'COMPLETED',
          attemptVersion: 1,
          description: recoveredEvidence.description,
          fileName: 'synthetic.pdf',
          mimeType: 'application/pdf',
          size: 8,
          sha256: 'a'.repeat(64),
          createdAt: recoveredEvidence.createdAt,
          updatedAt: recoveredEvidence.createdAt,
          leaseExpiresAt: null,
          currentActionVersion: 3,
          retryAllowed: false,
          objectState: 'PRESENT',
          evidence: recoveredEvidence,
        });
      return json(emptyPage);
    }),
  );
  const props = { organizationId: org, action, canWrite: true, onExpire, onChanged: changed };
  const view = render(<ActionEvidence {...props} />);
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: recoveredEvidence.description },
  });
  const file = new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Arquivo da evidência'), file);
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeDisabled();
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  view.rerender(<ActionEvidence {...props} action={{ ...action, version: 3 }} />);
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    recoveredEvidence.description,
  );
  expect((screen.getByLabelText('Arquivo da evidência') as HTMLInputElement).files?.[0]).toBe(file);
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  await screen.findByText('Evidência recuperada; envio confirmado no histórico.');
  expect(posts).toBe(1);
  expect(changed).toHaveBeenCalledTimes(1);
});

it('shows evidence file identity and loads usage before offering archive confirmation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).includes('/usage')
        ? json({
            evidenceId: org,
            opinionTotal: 1,
            closureTotal: 1,
            items: [
              { kind: 'OPINION', id, sequence: 2, createdAt: recoveredEvidence.createdAt },
              {
                kind: 'TECHNICAL_CLOSURE',
                id: org,
                sequence: 1,
                createdAt: recoveredEvidence.createdAt,
              },
            ],
            total: 2,
            page: 1,
            pageSize: 20,
          })
        : json({ ...emptyPage, items: [recoveredEvidence], total: 1 }),
    ),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  expect(await screen.findByText('synthetic.pdf')).toBeVisible();
  expect(screen.getByText('ATIVA')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Arquivar evidência' }));
  expect(await screen.findByText(/1 parecer.*1 encerramento/)).toBeVisible();
  expect(
    within(screen.getByRole('form', { name: 'Arquivar evidência' })).getByText(
      /snapshots.*preservados/i,
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirmar arquivamento da evidência' })).toBeEnabled();
});

it('requires consultation after a reconcile conflict and retries only the original file using the consulted versions', async () => {
  let key = '';
  let queries = 0;
  let posts = 0;
  let retried: FormData | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        if (String(url).endsWith('/retry')) {
          retried = init.body as FormData;
          return json({}, 503);
        }
        if (String(url).endsWith('/reconcile')) return json({}, 409);
        key = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({}, 503);
      }
      if (String(url).includes('/upload-attempts/')) {
        queries += 1;
        return json({
          key,
          organizationId: org,
          actionId: id,
          state: 'RETRYABLE',
          attemptVersion: queries + 3,
          description: recoveredEvidence.description,
          fileName: 'synthetic.pdf',
          mimeType: 'application/pdf',
          size: 8,
          sha256: 'a'.repeat(64),
          createdAt: recoveredEvidence.createdAt,
          updatedAt: recoveredEvidence.createdAt,
          leaseExpiresAt: null,
          currentActionVersion: queries + 6,
          retryAllowed: true,
          objectState: 'ABSENT',
          evidence: null,
        });
      }
      return json(emptyPage);
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: recoveredEvidence.description },
  });
  const file = new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Arquivo da evidência'), file);
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  expect(posts).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  await screen.findByRole('button', { name: 'Reenviar o mesmo arquivo' });
  expect(posts).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: 'Conciliar e finalizar tentativa' }));
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('button', { name: 'Reenviar o mesmo arquivo' }),
  ).not.toBeInTheDocument();
  expect(posts).toBe(2);
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Reenviar o mesmo arquivo' }));
  await screen.findByRole('alert');
  expect(posts).toBe(3);
  expect(retried!.get('file')).toBe(file);
  expect(retried!.get('expectedVersion')).toBe('8');
  expect(retried!.get('attemptVersion')).toBe('5');
});

it.each([401, 403, 404])(
  'purges upload recovery and drafts after denied attempt consultation (%s)',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (init?.method === 'POST') return json({}, 503);
        return String(url).includes('/upload-attempts/') || String(url).endsWith(`/actions/${id}`)
          ? json({}, status)
          : json(emptyPage);
      }),
    );
    render(
      <ActionEvidence
        organizationId={org}
        action={action}
        canWrite
        onExpire={onExpire}
        onChanged={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
      target: { value: recoveredEvidence.description },
    });
    await userEvent.upload(
      screen.getByLabelText('Arquivo da evidência'),
      new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
    await screen.findByText(/Acesso não autorizado ou registro removido/);
    expect(screen.queryByLabelText('Descrição da evidência')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Consultar tentativa de envio' }),
    ).not.toBeInTheDocument();
  },
);

it('requires a fresh status consultation after a nonterminal reconciliation', async () => {
  let key = '';
  const value = () => ({
    key,
    organizationId: org,
    actionId: id,
    state: 'UNCERTAIN',
    attemptVersion: 4,
    description: recoveredEvidence.description,
    fileName: 'synthetic.pdf',
    mimeType: 'application/pdf',
    size: 8,
    sha256: 'a'.repeat(64),
    createdAt: recoveredEvidence.createdAt,
    updatedAt: recoveredEvidence.createdAt,
    leaseExpiresAt: null,
    currentActionVersion: 7,
    retryAllowed: false,
    objectState: 'UNKNOWN',
    evidence: null,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/reconcile')) return json(value());
      if (init?.method === 'POST') {
        key = new Headers(init.headers).get('Idempotency-Key') ?? '';
        return json({}, 503);
      }
      return String(url).includes('/upload-attempts/') ? json(value()) : json(emptyPage);
    }),
  );
  render(
    <ActionEvidence
      organizationId={org}
      action={action}
      canWrite
      onExpire={onExpire}
      onChanged={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: recoveredEvidence.description },
  });
  await userEvent.upload(
    screen.getByLabelText('Arquivo da evidência'),
    new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Consultar tentativa de envio' }));
  await userEvent.click(
    await screen.findByRole('button', { name: 'Conciliar e finalizar tentativa' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Conciliar e finalizar tentativa' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Consultar tentativa de envio' })).toBeEnabled();
  expect(screen.queryByText(/envio confirmado/i)).not.toBeInTheDocument();
});

it('discards scoped drafts and aborts a late upload when changing organization', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const changed = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        signal = init.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return json(emptyPage);
    }),
  );
  const props = { organizationId: org, action, canWrite: true, onExpire, onChanged: changed };
  const view = render(<ActionEvidence {...props} />);
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: recoveredEvidence.description },
  });
  await userEvent.upload(
    screen.getByLabelText('Arquivo da evidência'),
    new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  view.rerender(
    <ActionEvidence {...props} organizationId={id} action={{ ...action, organizationId: id }} />,
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue('');
  expect((screen.getByLabelText('Arquivo da evidência') as HTMLInputElement).files).toHaveLength(0);
  await act(async () => finish(json(recoveredEvidence, 201)));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByText('Evidência adicionada ao histórico.')).not.toBeInTheDocument();
});
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

it.each([401, 403, 404])(
  'discards action and assignment drafts when conflict consultation returns %s',
  async (status) => {
    let denied = false;
    let resume: ((response: Response) => void) | undefined;
    let retrying = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/closure-context')) return json(operationalClosureContext(action));
      if (String(url).endsWith('/efficacy')) return json(operationalEfficacyContext(action));
      if (String(url).endsWith('/assignment')) return json({}, 409);
      if (String(url).endsWith(`/action-workspaces/${id}`)) {
        if (retrying)
          return new Promise<Response>((resolve) => {
            resume = resolve;
          });
        return denied ? json({}, status) : json(workspace);
      }
      return json(emptyPage);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
    await screen.findByRole('heading', { name: action.title });
    fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
      target: { value: 'Private evidence draft' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir membro' }));
    fireEvent.change(screen.getByLabelText('Justificativa da atribuição'), {
      target: { value: 'Private assignment draft for confirmation' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar atribuição' }));
    await screen.findByRole('button', { name: 'Consultar atribuição atual' });
    denied = true;
    await userEvent.click(screen.getByRole('button', { name: 'Consultar atribuição atual' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Justificativa da atribuição')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Descrição da evidência')).not.toBeInTheDocument();
    retrying = true;
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
    await act(async () => {
      resume?.(json(workspace));
    });
    await screen.findByRole('heading', { name: action.title });
    expect(screen.getByLabelText('Descrição da evidência')).toHaveValue('');
  },
);

it('retains assignment and evidence drafts when conflict consultation returns 503', async () => {
  let unavailable = false;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/closure-context')) return json(operationalClosureContext(action));
      if (String(url).endsWith('/efficacy')) return json(operationalEfficacyContext(action));
      if (String(url).endsWith('/assignment')) return json({}, 409);
      if (String(url).endsWith(`/action-workspaces/${id}`))
        return unavailable ? json({}, 503) : json(workspace);
      return json(emptyPage);
    }),
  );
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await screen.findByRole('heading', { name: action.title });
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: 'Recoverable evidence draft' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Atribuir membro' }));
  fireEvent.change(screen.getByLabelText('Justificativa da atribuição'), {
    target: { value: 'Recoverable assignment draft' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar atribuição' }));
  unavailable = true;
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar atribuição atual' }));
  await screen.findByText('Não foi possível consultar a ação atual. Rascunho preservado.');
  expect(screen.getByRole('heading', { name: action.title })).toBeVisible();
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue('Recoverable evidence draft');
  expect(screen.getByLabelText('Justificativa da atribuição')).toHaveValue(
    'Recoverable assignment draft',
  );
});

it('does not accept a parent refresh completed before a late assignment denial as restored access', async () => {
  let consultations = 0;
  let resolveConsult!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/closure-context')) return json(operationalClosureContext(action));
      if (String(url).endsWith('/efficacy')) return json(operationalEfficacyContext(action));
      if (String(url).endsWith('/assignment')) return json({}, 409);
      if (String(url).endsWith(`/action-workspaces/${id}`)) {
        consultations += 1;
        if (consultations === 2)
          return new Promise<Response>((resolve) => {
            resolveConsult = resolve;
          });
        return json({ ...workspace, version: consultations === 1 ? 2 : 3 });
      }
      return json(emptyPage);
    }),
  );
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await screen.findByRole('heading', { name: action.title });
  await userEvent.click(screen.getByRole('button', { name: 'Atribuir membro' }));
  fireEvent.change(screen.getByLabelText('Justificativa da atribuição'), {
    target: { value: 'Private assignment draft for conflict' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar atribuição' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar atribuição atual' }));
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
  await screen.findByText('MEDIDA PREVENTIVA · VERSÃO 3');
  await act(async () => resolveConsult(json({}, 403)));
  expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
});

it('associates every action list header with the corresponding cell content', async () => {
  const item = {
    id,
    organizationId: org,
    riskId: id,
    title: action.title,
    risk: workspace.risk,
    responsibleName: action.responsibleName,
    dueDate: action.dueDate,
    status: action.status,
    version: action.version,
    isOverdue: false,
    referenceDate: action.referenceDate,
    timeZone: action.timeZone,
    assignedUser: workspace.assignedUser,
    riskContext: workspace.riskContext,
    evidenceSummary: workspace.evidenceSummary,
    pendingReasons: [],
    permissions: workspace.permissions,
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        json(
          String(url).includes('/action-workspaces?')
            ? { ...emptyPage, items: [item], total: 1 }
            : emptyPage,
        ),
      ),
  );
  render(<ActionList organizationId={org} query="" onExpire={onExpire} />);
  await screen.findByRole('link', { name: action.title });
  const headers = screen.getAllByRole('columnheader');
  const cells = screen.getAllByRole('cell');
  for (const [index, header] of headers.entries())
    expect(cells[index]).toHaveAttribute('data-label', header.textContent);
  const statusCell = cells[headers.findIndex((header) => header.textContent === 'Estado')]!;
  expect(within(statusCell).getByText('Em execução')).toBeVisible();
});

it('preserves the upload draft but waits for the authoritative action version during refresh', async () => {
  const changed = vi.fn();
  const posted: FormData[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') {
      posted.push(init.body as FormData);
      return new Response(
        JSON.stringify({
          id: org,
          organizationId: org,
          actionId: id,
          description: 'Synthetic preserved description.',
          fileName: 'synthetic.pdf',
          mimeType: 'application/pdf',
          size: 8,
          sha256: 'a'.repeat(64),
          createdBy: person,
          createdAt: '2026-10-25T12:00:00.000Z',
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          actionVersion: 4,
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }));
  });
  vi.stubGlobal('fetch', fetcher);
  const props = { organizationId: org, action, canWrite: true, onExpire, onChanged: changed };
  const view = render(<ActionEvidence {...props} />);
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: 'Synthetic preserved description.' },
  });
  await userEvent.upload(
    screen.getByLabelText('Arquivo da evidência'),
    new File(['%PDF-1.7'], 'synthetic.pdf', { type: 'application/pdf' }),
  );
  view.rerender(<ActionEvidence {...props} refreshing />);
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeDisabled();
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    'Synthetic preserved description.',
  );
  fireEvent.submit(screen.getByRole('form', { name: 'Adicionar evidência' }));
  expect(posted).toHaveLength(0);
  view.rerender(
    <ActionEvidence {...props} action={{ ...action, version: 3 }} refreshing={false} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  expect(
    await screen.findByText('Evidência adicionada ao histórico.', { exact: true }),
  ).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]?.get('expectedVersion')).toBe('3');
  expect(changed).toHaveBeenCalledTimes(1);
});

it('keeps the archive draft and refuses archival while action refresh is pending', async () => {
  const evidence = {
    id: org,
    organizationId: org,
    actionId: id,
    description: 'Synthetic evidence description',
    fileName: 'synthetic.pdf',
    mimeType: 'application/pdf',
    size: 8,
    sha256: 'a'.repeat(64),
    createdBy: person,
    createdAt: '2026-10-25T12:00:00.000Z',
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    actionVersion: 2,
  };
  const patched: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('/usage'))
        return json({
          evidenceId: org,
          opinionTotal: 0,
          closureTotal: 0,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        });
      if (init?.method === 'PATCH') {
        patched.push(JSON.parse(String(init.body)));
        return json({
          ...evidence,
          archivedAt: '2026-10-25T13:00:00.000Z',
          archivedBy: person,
          archiveReason: 'Synthetic retained archive reason',
          actionVersion: 4,
        });
      }
      return json({ ...emptyPage, items: [evidence], total: 1 });
    }),
  );
  const props = {
    organizationId: org,
    action,
    canWrite: true,
    onExpire,
    onChanged: () => undefined,
  };
  const view = render(<ActionEvidence {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Arquivar evidência' }));
  fireEvent.change(screen.getByLabelText('Motivo do arquivamento'), {
    target: { value: 'Synthetic retained archive reason' },
  });
  view.rerender(<ActionEvidence {...props} refreshing />);
  expect(
    screen.getByRole('button', { name: 'Confirmar arquivamento da evidência' }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Motivo do arquivamento')).toHaveValue(
    'Synthetic retained archive reason',
  );
  fireEvent.submit(screen.getByRole('form', { name: 'Arquivar evidência' }));
  expect(patched).toEqual([]);
  view.rerender(<ActionEvidence {...props} action={{ ...action, version: 3 }} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirmar arquivamento da evidência' }),
  );
  await screen.findByText('Evidência arquivada; arquivo e histórico preservados.');
  expect(patched).toEqual([
    { expectedVersion: 3, changeReason: 'Synthetic retained archive reason' },
  ]);
});

it.each([401, 403, 404])(
  'removes retained action and sensitive drafts after a %s revalidation response',
  async (status) => {
    let responseStatus = 200;
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          String(url).endsWith('/closure-context')
            ? json(operationalClosureContext(action))
            : String(url).endsWith('/efficacy')
              ? json(operationalEfficacyContext(action))
              : String(url).endsWith(`/action-workspaces/${id}`)
                ? json(workspace, responseStatus)
                : json(emptyPage),
        ),
    );
    render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
    await screen.findByRole('heading', { name: action.title });
    fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
      target: { value: 'Sensitive private draft' },
    });
    responseStatus = status;
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Descrição da evidência')).not.toBeInTheDocument();
    // Retrying must not resurrect the last authorized record while revalidation is pending.
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
  },
);

it('preserves drafts but blocks upload when action revalidation fails recoverably', async () => {
  let responseStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/closure-context')
          ? json(operationalClosureContext(action))
          : String(url).endsWith('/efficacy')
            ? json(operationalEfficacyContext(action))
            : String(url).endsWith(`/action-workspaces/${id}`)
              ? json(workspace, responseStatus)
              : json(emptyPage),
      ),
  );
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await screen.findByRole('heading', { name: action.title });
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: 'Recoverable private draft' },
  });
  responseStatus = 503;
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: action.title })).toBeVisible();
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue('Recoverable private draft');
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeDisabled();
});

it('blocks evidence while a note mutation is pending before action revalidation', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/closure-context')) return json(operationalClosureContext(action));
    if (String(url).endsWith('/efficacy')) return json(operationalEfficacyContext(action));
    if (init?.method === 'POST') return new Promise<Response>(() => undefined);
    return String(url).endsWith('/efficacy')
      ? json(operationalEfficacyContext(action))
      : String(url).endsWith(`/action-workspaces/${id}`)
        ? json(workspace)
        : json(emptyPage);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ActionDetail organizationId={org} id={id} query="" onExpire={onExpire} />);
  await screen.findByRole('heading', { name: action.title });
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar anotação' }));
  fireEvent.change(screen.getByLabelText('Texto da anotação'), {
    target: { value: 'Synthetic note waiting for confirmation' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar acompanhamento' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeDisabled();
});
