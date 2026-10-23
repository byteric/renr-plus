import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { actionDetailSchema, updateActionSchema, type SessionResponse } from '@renr/contracts';
import { Structure } from './components/Structure';

const org = '10000000-0000-4000-8000-000000000001';
const id = '40000000-0000-4000-8000-000000000001';
const author = { id: org, name: 'Equipe teste' };
const stamp = '2026-10-21T12:00:00.000Z';
const scope = { id: org, name: 'Atendimento', isActive: true };
const contextSnapshot = {
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
};
const action = {
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
  contextSnapshot,
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
};
const risk = {
  ...contextSnapshot,
  id,
  organizationId: org,
  version: 2,
  createdBy: author,
  updatedBy: author,
  createdAt: stamp,
  updatedAt: stamp,
  latestEvaluation: null,
};
const session: SessionResponse = {
  user: { ...author, email: 'test@example.test' },
  memberships: [{ organizationId: org, organizationName: 'Empresa fictícia', role: 'ADMIN' }],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function arrange(
  hash: string,
  role: 'ADMIN' | 'READER' = 'ADMIN',
  conflict = false,
  currentAction: unknown = action,
  currentRisk: unknown = risk,
) {
  window.location.hash = hash;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    if (path.endsWith('/evaluations') || path.endsWith('/evidence') || path.endsWith('/revisions'))
      return json(page([]));
    if (path.endsWith(`/risks/${id}`)) return json(currentRisk);
    if (path.endsWith('/actions') && init?.method === 'POST')
      return conflict ? json({}, 409) : json(action, 201);
    if (path.endsWith('/actions'))
      return json(
        page([
          {
            id,
            organizationId: org,
            riskId: id,
            title: action.title,
            risk: { id, factor: contextSnapshot.factor },
            responsibleName: action.responsibleName,
            dueDate: action.dueDate,
            status: action.status,
            version: 1,
            isOverdue: true,
            referenceDate: action.referenceDate,
            timeZone: action.timeZone,
          },
        ]),
      );
    if (path.endsWith(`/actions/${id}`))
      return init?.method === 'PATCH' && conflict ? json({}, 409) : json(currentAction);
    return json(page([]));
  });
  vi.stubGlobal('fetch', fetcher);
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

it('abre ações com filtros restauráveis, prazo civil e atraso informado pelo servidor', async () => {
  const fetcher = arrange('#/acoes?overdue=true&page=2');
  expect(await screen.findByRole('heading', { name: 'Ações' })).toBeVisible();
  expect(await screen.findByRole('link', { name: action.title }, { timeout: 5000 })).toBeVisible();
  expect(screen.getByText('20/10/2026')).toBeVisible();
  expect(screen.getByText('Atrasada')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Atualizar ações' })).toBeEnabled();
  expect(screen.getByText(/Referência de prazo: 21\/10\/2026.*America\/Sao_Paulo/)).toBeVisible();
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes('/actions?overdue=true&page=2')),
  ).toBe(true);
});

it('criação valida campos e foca o primeiro erro sem enviar POST', async () => {
  const fetcher = arrange(`#/acoes/nova?riskId=${id}`);
  await screen.findByRole('heading', { name: 'Nova ação' });
  await userEvent.click(screen.getByRole('button', { name: 'Criar ação' }));
  expect(screen.getByLabelText('Título da medida')).toHaveFocus();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});

it('leitor consulta detalhe e evidências sem controles de escrita', async () => {
  arrange(`#/acoes/${id}`, 'READER');
  expect(await screen.findByRole('heading', { name: action.title })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Evidências' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Editar ação' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Adicionar anotação' })).not.toBeInTheDocument();
});

it('conflito conserva texto e exige consultar versão atual antes de reaplicar', async () => {
  arrange(`#/acoes/${id}`, 'ADMIN', true);
  await screen.findByRole('heading', { name: action.title });
  await userEvent.click(screen.getByRole('button', { name: 'Editar ação' }));
  fireEvent.change(screen.getByLabelText('Título da medida'), {
    target: { value: 'Novo título preservado' },
  });
  fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
    target: { value: 'Ajuste de planejamento necessário' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/alterada.*preservado/i));
  expect(screen.getByLabelText('Título da medida')).toHaveValue('Novo título preservado');
  expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
});

it('valida evidência antes de enviar e comunica indisponibilidade sem perder descrição', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  expect(screen.getByLabelText('Arquivo da evidência')).toHaveFocus();
  await userEvent.upload(
    screen.getByLabelText('Arquivo da evidência'),
    new File(['%PDF-1.7'], 'medida.pdf', { type: 'application/pdf' }),
  );
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: 'Documento do acompanhamento' },
  });
  fetcher.mockImplementation(async (_url, init) =>
    init?.method === 'POST' ? json({}, 503) : json(page([])),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/armazenamento.*indisponível/i);
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    'Documento do acompanhamento',
  );
});

it('risco registrado oferece criação e consulta de ações sem alterar contrato antigo', async () => {
  arrange(`#/inventario/${id}`);
  expect(await screen.findByRole('link', { name: 'Criar ação preventiva' })).toHaveAttribute(
    'href',
    `#/acoes/nova?riskId=${id}`,
  );
  expect(screen.getByRole('link', { name: 'Ver ações deste risco' })).toHaveAttribute(
    'href',
    `#/acoes?riskId=${id}&page=1`,
  );
});

it('atualização da ação mantém rascunho de evidência enquanto consulta os dados atuais', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
    target: { value: 'Rascunho de documento preservado' },
  });
  const original = fetcher.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation((url, init) =>
    String(url).endsWith(`/actions/${id}`)
      ? new Promise((done) => {
          resolve = done;
        })
      : original(url, init),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar ação' }));
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    'Rascunho de documento preservado',
  );
  await act(async () => resolve(json({ ...action, version: 2 })));
  expect(screen.getByLabelText('Descrição da evidência')).toHaveValue(
    'Rascunho de documento preservado',
  );
});

it('mantém notas e documentos disponíveis após execução informada sem oferecer edição ou transição', async () => {
  arrange(`#/acoes/${id}`, 'ADMIN', false, {
    ...action,
    status: 'IMPLEMENTED',
    implementationNote: 'Execução registrada com contexto suficiente',
    implementedAt: stamp,
    isOverdue: false,
  });
  await screen.findByRole('heading', { name: action.title });
  expect(screen.getByRole('button', { name: 'Adicionar anotação' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Enviar evidência' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Editar ação' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Iniciar execução' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancelar ação' })).not.toBeInTheDocument();
});

it('criação com resposta perdida conserva campos e bloqueia outro POST automático', async () => {
  const fetcher = arrange(`#/acoes/nova?riskId=${id}`);
  await screen.findByRole('heading', { name: 'Nova ação' });
  for (const [label, value] of [
    ['Título da medida', 'Reorganizar medidas'],
    ['Descrição da medida', 'Descrição suficiente da medida'],
    ['Responsável nominal', 'Pessoa fictícia'],
    ['Prazo', '2026-10-20'],
    ['Resultado esperado', 'Resultado esperado documentado'],
    ['Critério de aferição', 'Critério de aferição documentado'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'POST') throw new TypeError('Network failure');
    return original(url, init);
  });
  await userEvent.click(screen.getByRole('button', { name: 'Criar ação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/resultado incerto/i);
  expect(screen.getByRole('button', { name: 'Criar ação' })).toBeDisabled();
  expect(screen.getByLabelText('Título da medida')).toHaveValue('Reorganizar medidas');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('envia evidências com a versão atual depois do primeiro upload e baixa bytes privados liberando URL', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  let version = 1;
  const document = {
    id: org,
    organizationId: org,
    actionId: id,
    description: 'Documento de acompanhamento',
    fileName: 'evidencia.pdf',
    mimeType: 'application/pdf',
    size: 8,
    sha256: 'a'.repeat(64),
    createdBy: author,
    createdAt: stamp,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    actionVersion: 2,
  };
  const original = fetcher.getMockImplementation()!;
  const submitted: string[] = [];
  fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname;
    if (path.endsWith('/download')) return new Response('%PDF-1.7');
    if (path.endsWith('/evidence')) {
      if (init?.method === 'POST') {
        submitted.push(String((init.body as FormData).get('expectedVersion')));
        version += 1;
        return json({ ...document, actionVersion: version }, 201);
      }
      return json(page(version > 1 ? [document] : []));
    }
    if (path.endsWith(`/actions/${id}`)) return json({ ...action, version });
    return original(url, init);
  });
  for (let index = 0; index < 2; index += 1) {
    await userEvent.upload(
      screen.getByLabelText('Arquivo da evidência'),
      new File(['%PDF-1.7'], 'documento.pdf', { type: 'application/pdf' }),
    );
    fireEvent.change(screen.getByLabelText('Descrição da evidência'), {
      target: { value: 'Documento de acompanhamento' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Enviar evidência' }));
    await waitFor(() =>
      expect(screen.getByText(`MEDIDA PREVENTIVA · VERSÃO ${index + 2}`)).toBeVisible(),
    );
  }
  expect(submitted).toEqual(['1', '2']);
  const createObjectURL = vi.fn().mockReturnValue('blob:documento-privado');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await userEvent.click(await screen.findByRole('button', { name: 'Baixar documento' }));
  expect(
    fetcher.mock.calls.find(([url]) => String(url).endsWith('/download'))?.[1]?.credentials,
  ).toBe('include');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:documento-privado');
  click.mockRestore();
});

it('passa por execução antes da implementação e valida o relato antes de gravar', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  let current = actionDetailSchema.parse(action);
  const changes: unknown[] = [];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith(`/actions/${id}`)) {
      if (init?.method === 'PATCH') {
        const body = updateActionSchema.parse(JSON.parse(String(init.body)));
        changes.push(body);
        current = actionDetailSchema.parse({
          ...current,
          status: body.status ?? current.status,
          implementationNote: body.implementationNote ?? current.implementationNote,
          version: current.version + 1,
        });
      }
      return json(current);
    }
    return original(url, init);
  });
  expect(screen.queryByRole('button', { name: 'Informar implementação' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar execução' }));
  fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
    target: { value: 'Iniciar medida de acompanhamento' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar acompanhamento' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Informar implementação' }));
  fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
    target: { value: 'Implementação comunicada pela equipe' },
  });
  fireEvent.change(screen.getByLabelText('Relato de implementação'), {
    target: { value: 'Curto' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar acompanhamento' }));
  expect(screen.getByLabelText('Relato de implementação')).toHaveFocus();
  expect(changes).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Relato de implementação'), {
    target: { value: 'A equipe informou a execução da medida planejada.' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar acompanhamento' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Editar ação' })).not.toBeInTheDocument(),
  );
  expect(changes).toEqual([
    { expectedVersion: 1, changeReason: 'Iniciar medida de acompanhamento', status: 'IN_PROGRESS' },
    {
      expectedVersion: 2,
      changeReason: 'Implementação comunicada pela equipe',
      status: 'IMPLEMENTED',
      implementationNote: 'A equipe informou a execução da medida planejada.',
    },
  ]);
  expect(screen.getByRole('button', { name: 'Adicionar anotação' })).toBeEnabled();
});

it('origem arquivada mantém link para ações existentes e impede criação no risco', async () => {
  arrange(`#/inventario/${id}`, 'ADMIN', false, action, { ...risk, status: 'ARCHIVED' });
  expect(await screen.findByRole('link', { name: 'Ver ações deste risco' })).toHaveAttribute(
    'href',
    `#/acoes?riskId=${id}&page=1`,
  );
  expect(screen.queryByRole('link', { name: 'Criar ação preventiva' })).not.toBeInTheDocument();
});

it('criação em conflito exige uma nova consulta da origem antes de revisar o texto', async () => {
  const fetcher = arrange(`#/acoes/nova?riskId=${id}`, 'ADMIN', true);
  await screen.findByRole('heading', { name: 'Nova ação' });
  for (const [label, value] of [
    ['Título da medida', 'Reorganizar medidas'],
    ['Descrição da medida', 'Descrição suficiente da medida'],
    ['Responsável nominal', 'Pessoa fictícia'],
    ['Prazo', '2026-10-20'],
    ['Resultado esperado', 'Resultado esperado documentado'],
    ['Critério de aferição', 'Critério de aferição documentado'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: 'Criar ação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/alterada.*preservado/i);
  expect(
    screen.queryByRole('button', { name: 'Revisar texto com a versão consultada' }),
  ).not.toBeInTheDocument();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) =>
    String(url).includes(`/risks/${id}`) && !String(url).includes('/evaluations')
      ? json({ ...risk, version: 3 })
      : original(url, init),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Consultar versão atual' }));
  expect(await screen.findByText('Versão consultada: 3')).toBeVisible();
});

it('não permite repetir anotação em conflito antes de concluir a consulta atual', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) =>
    String(url).endsWith('/notes') ? json({}, 409) : original(url, init),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar anotação' }));
  fireEvent.change(screen.getByLabelText('Texto da anotação'), {
    target: { value: 'Anotação de acompanhamento preservada' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Registrar acompanhamento' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/alterada.*preservado/i);
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation((url, init) =>
    String(url).endsWith(`/actions/${id}`)
      ? new Promise((done) => {
          resolve = done;
        })
      : original(url, init),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Consultar ação e histórico atuais' }));
  expect(screen.getByRole('button', { name: 'Registrar acompanhamento' })).toBeDisabled();
  expect(screen.getByLabelText('Texto da anotação')).toHaveValue(
    'Anotação de acompanhamento preservada',
  );
  await act(async () => resolve(json({ ...action, version: 2 })));
});

it('foca o campo recusado pelo servidor e preserva os dados preenchidos', async () => {
  const fetcher = arrange(`#/acoes/${id}`);
  await screen.findByRole('heading', { name: action.title });
  await userEvent.click(screen.getByRole('button', { name: 'Editar ação' }));
  fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
    target: { value: 'Revisão do prazo operacional' },
  });
  fetcher.mockResolvedValue(
    json(
      {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid fields',
        requestId: org,
        timestamp: stamp,
        details: [{ field: 'dueDate', message: 'Confira a data informada.' }],
      },
      400,
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await waitFor(() => expect(screen.getByLabelText('Prazo')).toHaveFocus());
  expect(screen.getByLabelText('Prazo')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Motivo da alteração')).toHaveValue('Revisão do prazo operacional');
});
