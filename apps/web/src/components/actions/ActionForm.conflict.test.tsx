import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { actionDetailSchema, type ActionDetail } from '@renr/contracts';
import { ActionForm } from './ActionForm';

const org = '10000000-0000-4000-8000-000000000001';
const id = '40000000-0000-4000-8000-000000000001';
const author = { id: org, name: 'Equipe teste' };
const stamp = '2026-10-21T12:00:00.000Z';
const scope = { id: org, name: 'Atendimento', isActive: true };
// Complete action fixture from ActionsWorkspace.test.tsx, validated by the real contract.
const action = actionDetailSchema.parse({
  id,
  organizationId: org,
  riskId: id,
  title: 'Reorganizar tarefas',
  description: 'Reorganizar tarefas coletivas',
  responsibleName: 'Pessoa fictícia',
  dueDate: '2026-10-20',
  expectedResult: 'Melhor distribuição das tarefas',
  verificationCriterion: 'Revisão coletiva documentada',
  status: 'PLANNED',
  implementationNote: null,
  implementedAt: null,
  version: 1,
  sourceRiskVersion: 2,
  evaluationId: null,
  contextSnapshot: {
    factor: 'Organização das tarefas',
    description: 'Descrição completa',
    exposureDescription: 'Exposição coletiva',
    exposedGroupDescription: 'Equipe fictícia',
    possibleHarms: 'Agravos descritos',
    existingControls: 'Controles atuais',
    sourceKind: 'TECHNICAL_RECORD',
    sourceNote: 'Registro contextual',
    diagnosticCycleId: null,
    sectorId: org,
    assessmentGroupId: org,
    unit: scope,
    sector: scope,
    status: 'REGISTERED',
  },
  currentOrigin: {
    riskStatus: 'REGISTERED',
    organizationActive: true,
    unitActive: true,
    sectorActive: true,
  },
  createdBy: author,
  updatedBy: author,
  createdAt: stamp,
  updatedAt: stamp,
  isOverdue: true,
  referenceDate: '2026-10-21',
  timeZone: 'America/Sao_Paulo',
});
const onExpire = () => undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const save = () => userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
const consult = () =>
  userEvent.click(screen.getByRole('button', { name: 'Consultar versão atual' }));
const review = () =>
  userEvent.click(screen.getByRole('button', { name: 'Revisar texto com a versão consultada' }));
function edit(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function arrange(current: ActionDetail, conflicts = 1) {
  const submitted: Record<string, unknown>[] = [];
  let resolveConsultation: ((response: Response) => void) | undefined;
  let deferConsultation = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (!String(url).endsWith(`/organizations/${org}/actions/${id}`))
      throw new Error(`Unexpected request: ${String(url)}`);
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      submitted.push(body);
      return submitted.length <= conflicts
        ? json({}, 409)
        : json({ ...current, ...body, changeReason: undefined, expectedVersion: undefined });
    }
    if (deferConsultation)
      return new Promise<Response>((resolve) => {
        resolveConsultation = resolve;
      });
    return json(current);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <ActionForm
      organizationId={org}
      riskId={id}
      item={action}
      onExpire={onExpire}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
  edit('Título da medida', 'Título deliberado do usuário B');
  edit('Motivo da alteração', 'Revisão deliberada do planejamento');
  return {
    submitted,
    defer: () => {
      deferConsultation = true;
    },
    resolve: (value: ActionDetail) => resolveConsultation!(json(value)),
  };
}
afterEach(() => vi.unstubAllGlobals());

it('reaplica somente após revisão explícita sem sobrescrever campos de outro usuário, inclusive no segundo conflito', async () => {
  const current = { ...action, version: 2, description: 'Descrição atualizada pelo usuário A' };
  const server = arrange(current, 2);
  await save();
  await screen.findByRole('button', { name: 'Consultar versão atual' });
  expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  await consult();
  await screen.findByText('Versão consultada: 2');
  expect(screen.getByLabelText('Descrição da medida')).toHaveValue(action.description);
  await review();
  expect(screen.getByLabelText('Descrição da medida')).toHaveValue(
    'Descrição atualizada pelo usuário A',
  );
  expect(screen.getByLabelText('Título da medida')).toHaveValue('Título deliberado do usuário B');
  expect(server.submitted).toHaveLength(1);
  await save();
  await screen.findByRole('button', { name: 'Consultar versão atual' });
  expect(server.submitted[1]).toMatchObject({
    expectedVersion: 2,
    title: 'Título deliberado do usuário B',
    description: 'Descrição atualizada pelo usuário A',
  });
  server.defer();
  await consult();
  expect(
    screen.queryByRole('button', { name: 'Revisar texto com a versão consultada' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  await act(async () =>
    server.resolve({ ...current, version: 3, description: 'Descrição mais recente do usuário A' }),
  );
  await screen.findByText('Versão consultada: 3');
  await review();
  expect(screen.getByLabelText('Descrição da medida')).toHaveValue(
    'Descrição mais recente do usuário A',
  );
  expect(server.submitted).toHaveLength(2);
  await save();
  await waitFor(() => expect(server.submitted).toHaveLength(3));
  expect(server.submitted[2]).toMatchObject({
    expectedVersion: 3,
    title: 'Título deliberado do usuário B',
    description: 'Descrição mais recente do usuário A',
  });
});

it('mostra os seis campos atuais e mantém uma alteração deliberada no mesmo campo', async () => {
  const current = {
    ...action,
    version: 2,
    title: 'Título do usuário A',
    description: 'Descrição do usuário A',
  };
  const server = arrange(current);
  edit('Descrição da medida', 'Descrição deliberada do usuário B');
  await save();
  await screen.findByRole('button', { name: 'Consultar versão atual' });
  await consult();
  const snapshot = await screen.findByRole('region', { name: 'Versão atual consultada' });
  for (const value of [
    current.title,
    current.description,
    current.responsibleName,
    current.dueDate,
    current.expectedResult,
    current.verificationCriterion,
  ])
    expect(within(snapshot).getByText(value)).toBeVisible();
  await review();
  expect(screen.getByLabelText('Descrição da medida')).toHaveValue(
    'Descrição deliberada do usuário B',
  );
  await save();
  await waitFor(() => expect(server.submitted).toHaveLength(2));
  expect(server.submitted[1]).toMatchObject({
    expectedVersion: 2,
    description: 'Descrição deliberada do usuário B',
  });
});

it.each(['IMPLEMENTED', 'CANCELLED'] as const)(
  'bloqueia edição e reenvio quando a versão consultada está %s',
  async (status) => {
    const server = arrange({ ...action, version: 2, status, isOverdue: false });
    await save();
    await screen.findByRole('button', { name: 'Consultar versão atual' });
    await consult();
    await screen.findByText('Versão consultada: 2');
    expect(screen.getByLabelText('Título da medida')).toBeDisabled();
    expect(screen.getByLabelText('Motivo da alteração')).toBeDisabled();
    const revise = screen.queryByRole('button', { name: 'Revisar texto com a versão consultada' });
    if (revise) expect(revise).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/estado terminal/i);
    fireEvent.submit(screen.getByRole('form', { name: 'Editar ação' }));
    expect(server.submitted).toHaveLength(1);
  },
);
