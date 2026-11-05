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

it('reutiliza o símbolo Percurso aprovado com espaço reservado nos dois temas', () => {
  const { container } = render(<BrandIntro />);
  const illustration = container.querySelector('.brand-illustration');
  expect(illustration).toHaveAttribute('aria-hidden', 'true');
  for (const asset of ['/brand/renr-plus-symbol.svg', '/brand/renr-plus-symbol-dark.svg']) {
    const image = illustration?.querySelector(`image[href="${asset}"]`);
    expect(image).toHaveAttribute('width', '216');
    expect(image).toHaveAttribute('height', '216');
  }
  expect(illustration?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 520 270');
});
