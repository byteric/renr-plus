import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

it('preserva o estado informado em texto sem inferir conclusão técnica', () => {
  render(<StatusBadge label="Execução informada" tone="neutral" />);
  expect(screen.getByText('Execução informada')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(/eficácia|concluída|aprovada/i)).not.toBeInTheDocument();
});
