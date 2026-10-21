import { StrictMode, useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePresentationMotion } from './usePresentationMotion';

function Probe({ dataset = 1 }: { dataset?: number }) {
  const scope = useRef<HTMLDivElement>(null);
  usePresentationMotion(scope, dataset);
  return (
    <>
      <div ref={scope}>
        <span data-motion-value="">{dataset}</span>
        <input aria-label="Rascunho" />
        <a href="#/inventario">Ver inventário</a>
        <svg>
          <g data-chart-bar="">
            <rect width={dataset * 10} height="20" />
          </g>
        </svg>
      </div>
      <span data-motion-value="">Fora do escopo</span>
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());
it('anima apenas apresentação no escopo e reverte estilos em StrictMode/desmontagem', () => {
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  const view = render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  const value = screen.getByText('1');
  expect(value.style.transform).not.toBe('');
  expect(screen.getByText('Fora do escopo').style.transform).toBe('');
  const input = screen.getByRole('textbox');
  input.focus();
  view.rerender(
    <StrictMode>
      <Probe dataset={8} />
    </StrictMode>,
  );
  expect(input).toHaveFocus();
  expect(screen.getByText('8')).toBeVisible();
  view.unmount();
  expect(value.style.transform).toBe('');
});

it('mostra o estado final imediatamente com movimento reduzido ou aba oculta', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  const view = render(<Probe />);
  expect(screen.getByText('1').style.transform).toBe('');
  expect(screen.getByRole('link')).toBeVisible();
  view.unmount();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  render(<Probe />);
  expect(screen.getByText('1').style.transform).toBe('');
  vi.restoreAllMocks();
});

it('conclui animação ao ocultar aba ou mudar preferência sem ocultar números', () => {
  let change!: () => void;
  const preference = {
    matches: false,
    addEventListener: (_name: string, listener: () => void) => {
      change = listener;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(preference));
  render(<Probe />);
  const value = screen.getByText('1');
  expect(value.style.transform).not.toBe('');
  preference.matches = true;
  act(() => change());
  expect(value.style.transform).toBe('');
  expect(value).toBeVisible();
});
