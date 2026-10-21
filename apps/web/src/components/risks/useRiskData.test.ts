import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRiskData } from './useRiskData';

const schema = { parse: (value: unknown) => value as { value: string } };
const onExpire = () => undefined;
afterEach(() => vi.unstubAllGlobals());

it('não reapresenta o snapshot antigo ao alternar A → B → A com consultas pendentes', async () => {
  const pending: ((value: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
  );
  const { result, rerender } = renderHook(({ path }) => useRiskData(path, schema, onExpire), {
    initialProps: { path: '/scope-a' },
  });
  await act(async () => pending[0]!(new Response(JSON.stringify({ value: 'Anterior A' }))));
  await waitFor(() => expect(result.current.data).toEqual({ value: 'Anterior A' }));
  rerender({ path: '/scope-b' });
  expect(result.current.data).toBeNull();
  rerender({ path: '/scope-a' });
  expect(result.current.loading).toBe(true);
  expect(result.current.data).toBeNull();
  await act(async () => pending[1]!(new Response(JSON.stringify({ value: 'Tardio B' }))));
  expect(result.current.data).toBeNull();
  await act(async () => pending[2]!(new Response(JSON.stringify({ value: 'Atual A' }))));
  await waitFor(() => expect(result.current.data).toEqual({ value: 'Atual A' }));
});
