import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

it('calcula a última página com o tamanho informado e impede ultrapassar os limites', async () => {
  const change = vi.fn();
  const { rerender } = render(
    <Pagination label="Páginas de ações" page={1} pageSize={10} total={21} onPageChange={change} />,
  );
  const nav = screen.getByRole('navigation', { name: 'Páginas de ações' });
  expect(within(nav).getByText('1 de 3')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
  expect(change).not.toHaveBeenCalled();
  screen.getByRole('button', { name: 'Próxima página' }).focus();
  await userEvent.keyboard(' ');
  expect(change).toHaveBeenLastCalledWith(2);
  rerender(
    <Pagination label="Páginas de ações" page={3} pageSize={10} total={21} onPageChange={change} />,
  );
  expect(screen.getByText('3 de 3')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
  expect(change).toHaveBeenLastCalledWith(2);
  expect(change).toHaveBeenCalledTimes(2);
});

it('bloqueia as duas direções enquanto aguarda a consulta', async () => {
  const change = vi.fn();
  render(
    <Pagination
      label="Páginas de fichas"
      page={2}
      pageSize={5}
      total={15}
      onPageChange={change}
      pending
      previousLabel="Fichas anteriores"
      nextLabel="Mais fichas"
    />,
  );
  const previous = screen.getByRole('button', { name: 'Fichas anteriores' });
  const next = screen.getByRole('button', { name: 'Mais fichas' });
  expect(previous).toBeDisabled();
  expect(next).toBeDisabled();
  await userEvent.click(previous);
  await userEvent.click(next);
  expect(change).not.toHaveBeenCalled();
});

it('mantém limites válidos em uma coleção vazia', () => {
  render(
    <Pagination
      label="Páginas vazias"
      page={1}
      pageSize={50}
      total={0}
      onPageChange={() => undefined}
    />,
  );
  expect(screen.getByText('1 de 1')).toBeVisible();
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
});
