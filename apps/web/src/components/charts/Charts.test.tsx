import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { OperationalBars } from './OperationalBars';
import { CompletionRing } from './CompletionRing';

it('expõe valores e filtros de unidade com origem zero e categoria Outras sem filtro fictício', async () => {
  render(
    <OperationalBars
      units={[
        {
          kind: 'UNIT',
          unitId: '10000000-0000-4000-8000-000000000001',
          name: 'Recife',
          isActive: false,
          total: 5,
          draft: 2,
          registered: 3,
        },
        { kind: 'OTHERS', name: 'Outras unidades', total: 3, draft: 1, registered: 2 },
      ]}
    />,
  );
  expect(screen.getByRole('img', { name: /registros por unidade/i })).toHaveAccessibleDescription(
    /eixo.*zero/i,
  );
  expect(screen.getByRole('table')).not.toBeVisible();
  await userEvent.setup().click(screen.getByText('Ver valores e filtrar por unidade'));
  expect(screen.getByRole('link', { name: /Recife/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&unitId=10000000-0000-4000-8000-000000000001',
  );
  const row = screen.getByRole('row', { name: /Recife/ });
  expect(
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['Recife · inativa', '2', '3', '5']);
  expect(screen.getByRole('link', { name: 'Ver inventário completo' })).toHaveAttribute(
    'href',
    '#/inventario?page=1',
  );
  expect(screen.getByText(/Sem registros não aparecem/)).toBeVisible();
});

it('explicita zero no anel e não comunica conclusão de 100% sem registros', () => {
  render(<CompletionRing total={0} completed={0} />);
  expect(screen.getByText('Sem registros')).toBeVisible();
  expect(screen.queryByText('100%')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /0 de 0/ })).toBeVisible();
});

it('mantém denominador verdadeiro e links independentes para com e sem ficha', () => {
  render(<CompletionRing total={8} completed={3} />);
  expect(screen.getByRole('img', { name: /3 de 8/ })).toBeVisible();
  expect(screen.getByText('38%')).toBeVisible();
  expect(screen.getByRole('link', { name: /Com ficha.*3/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&evaluationPresence=WITH',
  );
  expect(screen.getByRole('link', { name: /Sem ficha.*5/ })).toHaveAttribute(
    'href',
    '#/inventario?page=1&evaluationPresence=WITHOUT',
  );
});
