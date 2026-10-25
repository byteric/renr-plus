import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssessmentParticipation, SubmitAssessmentResponse } from '@renr/contracts';
import { App } from './App';

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const access: AssessmentParticipation = {
  cycleName: 'Coleta sintética de organização do trabalho',
  endsAt: '2099-10-24T12:00:00.000Z',
  usageMode: 'DEMONSTRATION',
  instrument: {
    id: uuid(1),
    title: 'Condições de trabalho',
    version: 2,
    description: 'Cenário fictício para validação.',
    instructions: 'Considere o período apresentado.',
    questions: [
      {
        id: uuid(2),
        label: 'As orientações são claras?',
        type: 'SINGLE_CHOICE',
        required: true,
        position: 1,
        options: [
          { id: uuid(3), label: 'Orientações claras', position: 1 },
          { id: uuid(4), label: 'Orientações incompletas', position: 2 },
        ],
      },
      {
        id: uuid(5),
        label: 'Quais recursos ajudam?',
        type: 'MULTIPLE_CHOICE',
        required: false,
        position: 2,
        options: [
          { id: uuid(6), label: 'Quadro de atividades', position: 1 },
          { id: uuid(7), label: 'Reuniões', position: 2 },
        ],
      },
      {
        id: uuid(8),
        label: 'Com que frequência há apoio?',
        type: 'ORDINAL_CHOICE',
        required: true,
        position: 3,
        options: [
          { id: uuid(9), label: 'Raramente', position: 1 },
          { id: uuid(10), label: 'Frequentemente', position: 2 },
        ],
      },
    ],
  },
};
const code = 'a'.repeat(43);
let failure = 0;
let publicFixture = access;
let sent: SubmitAssessmentResponse[] = [];
const fetcher = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  window.history.replaceState(null, '', '/#/responder');
  failure = 0;
  publicFixture = access;
  sent = [];
  fetcher.mockReset();
  fetcher.mockImplementation(async (input, options) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path.endsWith('/health'))
      return json({ status: 'ok', service: 'renr-api', timestamp: '2026-10-24T12:00:00.000Z' });
    if (path.endsWith('/auth/session')) return json({}, 401);
    expect(options?.credentials).toBe('omit');
    if (path.endsWith('/assessment-participation/access')) return json(publicFixture);
    if (path.endsWith('/assessment-participation/submissions')) {
      sent.push(JSON.parse(String(options?.body)) as SubmitAssessmentResponse);
      if (failure === -1) throw new TypeError('Network failure');
      if (failure) return json({}, failure);
      return json({ status: 'accepted' }, 201);
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function enter() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Código do convite'), code);
  await user.click(screen.getByRole('button', { name: 'Acessar coleta' }));
  await screen.findByText('Considere o período apresentado.');
  return user;
}
async function requiredAnswers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Orientações claras' }));
  await user.click(screen.getByRole('radio', { name: '2. Frequentemente' }));
}

it('abre a coleta pública sem consultar sessão nem solicitar identificação do participante', async () => {
  render(<App />);
  expect(await screen.findByLabelText('Código do convite')).toBeInTheDocument();
  expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/nome|e-mail/i)).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/auth/'))).toBe(false);
  expect(location.hash).toBe('#/responder');
});

it('valida obrigatórias, permite corrigir a revisão e envia os três tipos sem exigir a opcional', async () => {
  render(<App />);
  const user = await enter();
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/obrigatórias/i);
  expect(screen.getByRole('radio', { name: 'Orientações claras' })).toHaveFocus();
  expect(sent).toEqual([]);
  await requiredAnswers(user);
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  expect(
    await screen.findByRole('heading', { name: 'Confira antes de enviar' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Não respondida (opcional)')).toBeInTheDocument();
  expect(sent).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Corrigir respostas' }));
  await user.click(screen.getByRole('checkbox', { name: 'Quadro de atividades' }));
  await user.click(screen.getByRole('checkbox', { name: 'Reuniões' }));
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar envio' }));
  expect(
    await screen.findByRole('heading', { name: 'Participação concluída' }),
  ).toBeInTheDocument();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.instrumentVersionId).toBe(access.instrument.id);
  expect(sent[0]?.answers).toEqual([
    { questionId: uuid(2), optionIds: [uuid(3)] },
    { questionId: uuid(5), optionIds: [uuid(6), uuid(7)] },
    { questionId: uuid(8), optionIds: [uuid(10)] },
  ]);
  expect(sent[0]?.submissionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(screen.queryByLabelText('Código do convite')).not.toBeInTheDocument();
  expect(location.hash).not.toContain(code);
  expect(Object.values(localStorage)).not.toContain(code);
});

it.each([503, -1])(
  'mantém o payload e segredo em RAM para repetir exatamente após falha %s',
  async (status) => {
    failure = status;
    render(<App />);
    const user = await enter();
    await requiredAnswers(user);
    await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar envio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirmar|confirmação/i);
    expect(screen.queryByRole('button', { name: 'Corrigir respostas' })).not.toBeInTheDocument();
    expect(sent).toHaveLength(1);
    failure = 0;
    await user.click(screen.getByRole('button', { name: 'Reenviar a mesma resposta' }));
    await screen.findByRole('heading', { name: 'Participação concluída' });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(JSON.stringify(Object.values(localStorage))).not.toContain(sent[0]!.submissionSecret);
  },
);

it('erro de validação permite corrigir e trocar de convite apaga as respostas anteriores', async () => {
  failure = 400;
  render(<App />);
  const user = await enter();
  await requiredAnswers(user);
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar envio' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Corrigir respostas' }));
  expect(screen.getByRole('radio', { name: 'Orientações claras' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Usar outro convite' }));
  await waitFor(() => expect(screen.getByLabelText('Código do convite')).toHaveValue(''));
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

it.each(['SINGLE_CHOICE', 'ORDINAL_CHOICE'] as const)(
  'permite retirar uma resposta opcional de tipo %s ao corrigir a revisão',
  async (type) => {
    publicFixture = structuredClone(access);
    publicFixture.instrument.questions[2] = {
      ...publicFixture.instrument.questions[2]!,
      type,
      required: false,
    };
    render(<App />);
    const user = await enter();
    await user.click(screen.getByRole('radio', { name: 'Orientações claras' }));
    await user.click(
      screen.getByRole('radio', {
        name: type === 'ORDINAL_CHOICE' ? '2. Frequentemente' : 'Frequentemente',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
    await user.click(screen.getByRole('button', { name: 'Corrigir respostas' }));
    await user.click(screen.getByRole('button', { name: 'Limpar resposta da pergunta 3' }));
    expect(
      screen.getByRole('radio', {
        name: type === 'ORDINAL_CHOICE' ? '2. Frequentemente' : 'Frequentemente',
      }),
    ).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Orientações claras' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar envio' }));
    await screen.findByRole('heading', { name: 'Participação concluída' });
    expect(sent[0]?.answers).toEqual([{ questionId: uuid(2), optionIds: [uuid(3)] }]);
  },
);
