import { act, render, screen } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { App } from './App';
const id = '10000000-0000-4000-8000-000000000001';
const session = {
  user: { id, name: 'Admin', email: 'admin@example.test' },
  memberships: [{ organizationId: id, organizationName: 'Empresa', role: 'ADMIN' }],
  activeOrganizationId: id,
  expiresAt: '2099-10-12T12:00:00.000Z',
};
const healthy = { status: 'ok', service: 'renr-api', timestamp: '2026-10-12T12:00:00.000Z' };
const json = (value: unknown) => new Response(JSON.stringify(value));
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });
const fetchMock = vi.fn<typeof fetch>();
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('mantém participação pública quando a sessão administrativa anterior expira', async () => {
  window.location.hash = '/empresas';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('/health')) return json(healthy);
    if (String(url).endsWith('/auth/session'))
      return json({ ...session, expiresAt: new Date(Date.now() + 1000).toISOString() });
    return json(list([]));
  });
  vi.useFakeTimers();
  const view = render(<App />);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByLabelText('Empresa ativa')).toBeInTheDocument();
  await act(async () => {
    window.location.hash = '/participar';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByLabelText('Código do convite')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByLabelText('Código do convite')).toBeInTheDocument();
  expect(window.location.hash).toBe('#/participar');
  view.unmount();
});
