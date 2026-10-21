import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrandIntro } from './BrandIntro';

it('apresenta a jornada rastreável sem exigir interação para acessar o login', () => {
  render(<BrandIntro />);
  expect(
    screen.getByRole('heading', { level: 2, name: /informação.*decisão rastreável/i }),
  ).toBeVisible();
  expect(screen.getByRole('list', { name: 'Jornada de gestão preventiva' })).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Diagnóstico')).toBeVisible();
  expect(screen.getByText('Inventário')).toBeVisible();
  expect(screen.getByText('Ficha preliminar')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
