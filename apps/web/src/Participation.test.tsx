import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instrument = {
  id: uuid(1),
  organizationId: uuid(2),
  title: 'Demonstração',
  version: 1,
  status: 'PUBLISHED',
  isDemo: true,
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: uuid(index + 3),
    label: `Questão ${index + 1}`,
    type: index < 3 ? 'SINGLE_CHOICE' : 'MULTIPLE_CHOICE',
    required: true,
    position: index + 1,
    options: [
      { id: uuid(index + 20), label: `Opção A ${index + 1}`, position: 1 },
      { id: uuid(index + 30), label: `Opção B ${index + 1}`, position: 2 },
    ],
  })),
};
afterEach(() => vi.unstubAllGlobals());
it('mantém o código estável enquanto verifica o convite', async () => {
  window.location.hash = '/participar';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/health'))
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'renr-api',
            timestamp: '2026-10-12T12:00:00.000Z',
          }),
        );
      return new Promise<Response>(() => {});
    }),
  );
  const view = render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Código do convite'), 'a'.repeat(43));
  await user.click(screen.getByRole('button', { name: 'Acessar questionário' }));
  expect(screen.getByLabelText('Código do convite')).toBeDisabled();
  view.unmount();
});
it('abre participação sem consultar a sessão ou pedir login administrativo', async () => {
  window.location.hash = '/participar';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: 'ok',
        service: 'renr-api',
        timestamp: '2026-10-12T12:00:00.000Z',
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  expect(await screen.findByLabelText('Código do convite')).toBeInTheDocument();
  expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/auth/'))).toBe(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Acessar questionário' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/código/i);
});
it('valida questões, mantém respostas no erro e impede envio duplo', async () => {
  window.location.hash = '/participar';
  let submissions = 0;
  let finish: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/health'))
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'renr-api',
            timestamp: '2026-10-12T12:00:00.000Z',
          }),
        );
      expect(options?.credentials).toBe('omit');
      if (String(url).endsWith('/instrument'))
        return new Response(
          JSON.stringify({
            cycleName: 'Ciclo fictício',
            endsAt: '2099-10-12T12:00:00.000Z',
            instrument,
          }),
        );
      submissions++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Código do convite'), 'a'.repeat(43));
  await user.click(screen.getByRole('button', { name: 'Acessar questionário' }));
  await screen.findByText('Questão 1', { exact: false });
  await user.click(screen.getByRole('button', { name: 'Enviar respostas' }));
  expect(screen.getByRole('alert')).toHaveTextContent('todas as questões');
  expect(submissions).toBe(0);
  for (let index = 1; index <= 5; index++)
    await user.click(screen.getByLabelText(`Opção A ${index}`));
  await user.click(screen.getByLabelText('Opção B 1'));
  expect(screen.getByLabelText('Opção A 1')).not.toBeChecked();
  await user.click(screen.getByLabelText('Opção B 4'));
  expect(screen.getByLabelText('Opção A 4')).toBeChecked();
  await user.dblClick(screen.getByRole('button', { name: 'Enviar respostas' }));
  expect(submissions).toBe(1);
  finish?.(new Response('{}', { status: 503 }));
  expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
  expect(screen.getByLabelText('Opção B 1')).toBeChecked();
  expect(screen.getByLabelText('Opção A 4')).toBeChecked();
  expect(sessionStorage.length).toBe(0);
  expect(window.location.hash).toBe('#/participar');
});
