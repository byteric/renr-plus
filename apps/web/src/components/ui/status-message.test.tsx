import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button } from './button';
import { StatusMessage } from './status-message';

it('anuncia erros com recuperação operável por teclado', async () => {
  const retry = vi.fn();
  render(
    <StatusMessage tone="error" action={<Button onClick={retry}>Consultar novamente</Button>}>
      Consulta indisponível.
    </StatusMessage>,
  );
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Consulta indisponível.');
  within(alert).getByRole('button', { name: 'Consultar novamente' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(retry).toHaveBeenCalledOnce();
});

it.each(['loading', 'success'] as const)('anuncia %s como atualização de estado', (tone) => {
  render(<StatusMessage tone={tone}>Atualização da consulta</StatusMessage>);
  expect(screen.getByRole('status')).toHaveTextContent('Atualização da consulta');
});

it.each(['info', 'warning'] as const)('mantém %s legível sem anúncio automático', (tone) => {
  render(<StatusMessage tone={tone}>Contexto de cadastro</StatusMessage>);
  expect(screen.getByText('Contexto de cadastro')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
