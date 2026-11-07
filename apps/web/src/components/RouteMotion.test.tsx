import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteMotion } from './RouteMotion';
afterEach(() => vi.unstubAllGlobals());
it('preserva o foco do formulário enquanto muda a orientação da página', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  const view = render(
    <RouteMotion route="one">
      <h1>Etapa</h1>
      <input aria-label="Rascunho" />
    </RouteMotion>,
  );
  const input = screen.getByRole('textbox', { name: 'Rascunho' });
  input.focus();
  view.rerender(
    <RouteMotion route="two">
      <h1>Próxima etapa</h1>
      <input aria-label="Rascunho" />
    </RouteMotion>,
  );
  expect(input).toHaveFocus();
});
it('não desloca conteúdo com movimento reduzido', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  const view = render(
    <RouteMotion route="one">
      <h1>Etapa imediata</h1>
      <button>Ação imediata</button>
    </RouteMotion>,
  );
  expect(screen.getByRole('button')).toBeVisible();
  expect(screen.getByRole('button').parentElement?.style.transform).toBe('');
  view.rerender(
    <RouteMotion route="two">
      <h1>Etapa imediata</h1>
      <button>Ação imediata</button>
    </RouteMotion>,
  );
  expect(screen.getByRole('button').parentElement?.style.transform).toBe('');
});
it('reverte estilos GSAP no teardown', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  const view = render(
    <RouteMotion route="one">
      <h1>Etapa</h1>
      <button>Ação</button>
    </RouteMotion>,
  );
  const animated = screen.getByRole('heading');
  expect(animated?.style.transform).not.toBe('');
  view.unmount();
  expect(animated?.style.transform).toBe('');
});

it('conclui a transição imediatamente quando a preferência muda para movimento reduzido', () => {
  const preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(preference));
  render(
    <RouteMotion route="one">
      <h1>Etapa em transição</h1>
    </RouteMotion>,
  );
  const heading = screen.getByRole('heading');
  expect(heading.style.transform).not.toBe('');
  act(() => {
    preference.matches = true;
    preference.dispatchEvent(new Event('change'));
  });
  expect(heading.style.transform).toBe('');
  expect(heading).toBeVisible();
});
