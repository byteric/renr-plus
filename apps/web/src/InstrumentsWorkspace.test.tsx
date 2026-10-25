import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InstrumentVersion, UpdateInstrumentDraft } from '@renr/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Structure } from './components/Structure';

const org = '10000000-0000-4000-8000-000000000001';
const person = '20000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T12:00:00.000Z';
const versionId = '40000000-0000-4000-8000-000000000001';
const questionId = '50000000-0000-4000-8000-000000000001';
const optionId = '60000000-0000-4000-8000-000000000001';
const template: InstrumentVersion = {
  id: versionId,
  organizationId: org,
  instrumentId: id,
  title: 'Planejamento das atividades',
  version: 1,
  revision: 1,
  status: 'DRAFT',
  usageMode: 'DEMONSTRATION',
  questionCount: 1,
  approvalReference: null,
  publishedAt: null,
  publishedById: null,
  createdAt: stamp,
  updatedAt: stamp,
  cycleCount: 0,
  description: 'Contexto do instrumento',
  instructions: 'Considere somente o cenário fictício.',
  questions: [
    {
      id: questionId,
      label: 'As orientações são claras?',
      type: 'SINGLE_CHOICE',
      required: true,
      position: 1,
      options: [
        { id: optionId, label: 'Frequentemente', position: 1 },
        { id: '60000000-0000-4000-8000-000000000002', label: 'Raramente', position: 2 },
      ],
    },
  ],
};
let current: InstrumentVersion;
let failure = 0;
let technical = false;
let admin = true;
let mutations: { method: string; path: string; body: Record<string, unknown> }[] = [];
const session = {
  user: { id: person, name: 'Gestora', email: 'gestora@example.test' },
  memberships: [
    { organizationId: org, organizationName: 'Empresa de teste', role: 'ADMIN' as const },
  ],
  activeOrganizationId: org,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const instrument = {
  id,
  organizationId: org,
  name: 'Instrumento de planejamento',
  isLegacy: false,
  createdAt: stamp,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  window.history.replaceState(null, '', '/#/instrumentos');
  fetcher.mockReset();
  current = structuredClone(template);
  failure = 0;
  technical = false;
  admin = true;
  mutations = [];
  fetcher.mockImplementation(async (input, options) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const method = options?.method || 'GET';
    if (method !== 'GET') {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      mutations.push({ method, path, body });
      if (failure) return json({}, failure);
      if (method === 'POST' && path.endsWith('/instruments'))
        return json({ instrument: { ...instrument, name: body.name }, version: current }, 201);
      if (body.expectedRevision !== current.revision) return json({}, 409);
      if (method === 'PUT') {
        const { expectedRevision: _, ...draft } = body as UpdateInstrumentDraft;
        void _;
        current = {
          ...current,
          ...draft,
          revision: current.revision + 1,
          questionCount: draft.questions.length,
        };
      } else if (path.endsWith('/publish'))
        current = {
          ...current,
          status: 'PUBLISHED',
          revision: current.revision + 1,
          publishedAt: stamp,
          publishedById: person,
          approvalReference:
            typeof body.approvalReference === 'string' ? body.approvalReference : null,
        };
      else if (path.endsWith('/fork'))
        current = {
          ...structuredClone(template),
          id: '40000000-0000-4000-8000-000000000002',
          version: 2,
          revision: 1,
        };
      return json(current, method === 'POST' ? 201 : 200);
    }
    if (path.endsWith('/session-capabilities'))
      return json({
        organizationId: org,
        capabilities: technical ? ['TECHNICAL_DECISIONS'] : [],
        canManageAccess: admin,
      });
    if (path.endsWith('/instruments'))
      return json({ items: [instrument], total: 1, page: 1, pageSize: 20 });
    if (path.endsWith(`/instruments/${id}`)) return json(instrument);
    if (path.endsWith('/versions')) {
      const { questions: _, description: __, instructions: ___, ...summary } = current;
      void _;
      void __;
      void ___;
      return json({ items: [summary], total: 1, page: 1, pageSize: 20 });
    }
    if (path.includes('/versions/')) return json(current);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetcher);
});
const show = (edit = false, reader = false) => {
  if (edit)
    window.history.replaceState(null, '', `/#/instrumentos?instrument=${id}&version=${versionId}`);
  const value = reader
    ? { ...session, memberships: [{ ...session.memberships[0]!, role: 'READER' as const }] }
    : session;
  return render(<Structure session={value} onSession={vi.fn()} onExpire={vi.fn()} />);
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('abre catálogo real de instrumentos na navegação e permite iniciar um instrumento', async () => {
  render(<Structure session={session} onSession={vi.fn()} onExpire={vi.fn()} />);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Instrumentos' }),
  ).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: instrument.name })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Instrumentos' })).toHaveAttribute(
    'href',
    '#/instrumentos',
  );
  expect(screen.getByRole('button', { name: 'Novo instrumento' })).toBeEnabled();
  expect(
    screen.getByText('Crie instrumentos, confira a prévia e preserve cada versão publicada.'),
  ).toBeInTheDocument();
});

it('cria identidade e abre seu rascunho sem abrir um ciclo', async () => {
  show();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo instrumento' }));
  await user.type(screen.getByLabelText('Nome do instrumento'), 'Organização das equipes');
  await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));
  expect(await screen.findByLabelText('Título da versão')).toHaveValue(template.title);
  expect(mutations[0]!).toEqual({
    method: 'POST',
    path: `/api/v1/organizations/${org}/instruments`,
    body: { name: 'Organização das equipes' },
  });
  expect(mutations.some((mutation) => mutation.path.includes('cycles'))).toBe(false);
});

it('prévia mostra texto e opções ainda não salvos sem enviar respostas', async () => {
  show(true);
  const user = userEvent.setup();
  const title = await screen.findByLabelText('Título da versão');
  await user.clear(title);
  await user.type(title, 'Rascunho em revisão');
  const label = screen.getByLabelText('Enunciado da pergunta 1');
  await user.clear(label);
  await user.type(label, 'O que mudou nesta versão?');
  const option = screen.getByLabelText('Opção 1 da pergunta 1');
  await user.clear(option);
  await user.type(option, 'Opção editada localmente');
  const preview = screen.getByRole('region', { name: 'Prévia do participante' });
  expect(within(preview).getByRole('heading', { name: 'Rascunho em revisão' })).toBeInTheDocument();
  expect(
    within(preview).getByText('O que mudou nesta versão?', { exact: false }),
  ).toBeInTheDocument();
  await user.click(within(preview).getByRole('radio', { name: 'Opção editada localmente' }));
  expect(mutations).toEqual([]);
});

it('reordena perguntas e opções por botões mantendo foco, posição e obrigatoriedade', async () => {
  current.questions.push({
    ...structuredClone(template.questions[0]!),
    id: '50000000-0000-4000-8000-000000000002',
    label: 'Qual a frequência de alinhamento?',
    type: 'ORDINAL_CHOICE',
    required: false,
    position: 2,
    options: [
      { id: '60000000-0000-4000-8000-000000000003', label: 'Semanal', position: 1 },
      { id: '60000000-0000-4000-8000-000000000004', label: 'Quinzenal', position: 2 },
    ],
  });
  current.questionCount = 2;
  show(true);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Mover pergunta 2 para cima' }));
  const moved = screen.getByLabelText('Enunciado da pergunta 1');
  expect(moved).toHaveValue('Qual a frequência de alinhamento?');
  await waitFor(() => expect(moved).toHaveFocus());
  await user.click(screen.getByRole('button', { name: 'Mover opção 2 da pergunta 1 para cima' }));
  expect(screen.getByLabelText('Opção 1 da pergunta 1')).toHaveValue('Quinzenal');
  await user.click(screen.getByLabelText('Pergunta 1 obrigatória'));
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  const questions = mutations[0]!.body.questions as InstrumentVersion['questions'];
  expect(questions[0]!).toMatchObject({
    id: '50000000-0000-4000-8000-000000000002',
    position: 1,
    required: true,
    type: 'ORDINAL_CHOICE',
  });
  expect(questions[0]!.options[0]!).toMatchObject({ label: 'Quinzenal', position: 1 });
});

it('mantém o rascunho em falha recuperável e em revalidação de visibilidade', async () => {
  show(true);
  const user = userEvent.setup();
  const title = await screen.findByLabelText('Título da versão');
  await user.clear(title);
  await user.type(title, 'Alteração preservada');
  failure = 503;
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByText(/temporariamente indisponível/)).toBeInTheDocument();
  fireEvent(document, new Event('visibilitychange'));
  expect(title).toHaveValue('Alteração preservada');
  failure = 0;
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(current.title).toBe('Alteração preservada'));
});

it('salva alterações antes de publicar e usa a revisão retornada pelo servidor', async () => {
  show(true);
  const user = userEvent.setup();
  const title = await screen.findByLabelText('Título da versão');
  await user.clear(title);
  await user.type(title, 'Conteúdo pronto para demonstração');
  await user.click(screen.getByRole('button', { name: 'Publicar versão' }));
  await waitFor(() => expect(current.status).toBe('PUBLISHED'));
  expect(mutations.map(({ method, body }) => [method, body.expectedRevision])).toEqual([
    ['PUT', 1],
    ['POST', 2],
  ]);
  expect(screen.getByLabelText('Título da versão')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Criar nova versão' })).toBeEnabled();
});

it('aponta campos incompletos ao publicar sem consumir uma revisão nem perder dados', async () => {
  current.title = '';
  current.questions[0]!.label = '';
  current.questions[0]!.options[0]!.label = '';
  show(true);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Publicar versão' }));
  expect(screen.getByLabelText('Título da versão')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Enunciado da pergunta 1')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Opção 1 da pergunta 1')).toHaveAttribute('aria-invalid', 'true');
  expect(mutations).toEqual([]);
});

it('leitor consulta sem editar e técnico autorizado publica uso real com referência explícita', async () => {
  current.usageMode = 'REAL';
  technical = true;
  admin = false;
  show(true, true);
  const user = userEvent.setup();
  expect(await screen.findByLabelText('Título da versão')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText('Referência de aprovação'),
    'Ata técnica de validação 24/10',
  );
  await user.click(screen.getByRole('button', { name: 'Publicar versão' }));
  await waitFor(() => expect(current.status).toBe('PUBLISHED'));
  expect(mutations[0]!.body).toEqual({
    expectedRevision: 1,
    approvalReference: 'Ata técnica de validação 24/10',
  });
});

it('conflito mantém conteúdo e não troca a revisão original por uma leitura de fundo', async () => {
  show(true);
  const user = userEvent.setup();
  const title = await screen.findByLabelText('Título da versão');
  await user.clear(title);
  await user.type(title, 'Minha edição não confirmada');
  current.revision = 3;
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(
    await screen.findByText(/versão desatualizada|revisão desatualizada/i),
  ).toBeInTheDocument();
  fireEvent(document, new Event('visibilitychange'));
  expect(title).toHaveValue('Minha edição não confirmada');
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(mutations.map((item) => item.body.expectedRevision)).toEqual([1, 1]);
});

it('adiciona e remove opções de uma pergunta de múltipla escolha com posições consistentes', async () => {
  current.questions = [];
  current.questionCount = 0;
  show(true);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Adicionar pergunta' }));
  await user.type(
    screen.getByLabelText('Enunciado da pergunta 1'),
    'Quais canais ajudam a equipe?',
  );
  await user.selectOptions(screen.getByLabelText('Tipo da pergunta 1'), 'MULTIPLE_CHOICE');
  await user.type(screen.getByLabelText('Opção 1 da pergunta 1'), 'Reunião');
  await user.type(screen.getByLabelText('Opção 2 da pergunta 1'), 'Quadro');
  await user.click(screen.getByRole('button', { name: 'Adicionar opção à pergunta 1' }));
  await user.type(screen.getByLabelText('Opção 3 da pergunta 1'), 'Mensagem');
  await user.click(screen.getByRole('button', { name: 'Remover opção 2 da pergunta 1' }));
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  const questions = mutations[0]!.body.questions as InstrumentVersion['questions'];
  expect(questions).toHaveLength(1);
  expect(questions[0]!.type).toBe('MULTIPLE_CHOICE');
  expect(questions[0]!.options.map(({ label, position }) => ({ label, position }))).toEqual([
    { label: 'Reunião', position: 1 },
    { label: 'Mensagem', position: 2 },
  ]);
  const preview = screen.getByRole('region', { name: 'Prévia do participante' });
  expect(within(preview).getAllByRole('checkbox')).toHaveLength(2);
});

it('impede publicação real sem referência e sem permissão técnica', async () => {
  current.usageMode = 'REAL';
  technical = true;
  show(true);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Publicar versão' }));
  expect(screen.getByLabelText('Referência de aprovação')).toHaveAttribute('aria-invalid', 'true');
  await waitFor(() => expect(screen.getByLabelText('Referência de aprovação')).toHaveFocus());
  expect(mutations).toEqual([]);
});

it('abre nova versão de uma publicada sem desbloquear os campos da versão original', async () => {
  current = {
    ...current,
    status: 'PUBLISHED',
    revision: 5,
    publishedAt: stamp,
    publishedById: person,
    cycleCount: 2,
  };
  show(true);
  const user = userEvent.setup();
  expect(await screen.findByLabelText('Título da versão')).toBeDisabled();
  expect(screen.getByText(/2 ciclos.*versão|2 ciclos associados/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Criar nova versão' }));
  await waitFor(() => expect(screen.getByLabelText('Título da versão')).toBeEnabled());
  expect(location.hash).toContain('40000000-0000-4000-8000-000000000002');
  expect(mutations[0]!.body).toEqual({ expectedRevision: 5 });
});
