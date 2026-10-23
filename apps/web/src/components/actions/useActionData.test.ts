import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { actionOverviewSchema } from '@renr/contracts';
import { useActionData } from './useActionData';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const snapshot = (organizationId: string) => ({
  organizationId,
  generatedAt: '2026-10-21T12:00:00.000Z',
  referenceDate: '2026-10-21',
  timeZone: 'America/Sao_Paulo',
  totals: {
    total: 0,
    planned: 0,
    inProgress: 0,
    implemented: 0,
    cancelled: 0,
    open: 0,
    overdue: 0,
  },
});
afterEach(() => vi.unstubAllGlobals());

it('descarta respostas atrasadas A → B → A e aborta cada consulta abandonada', async () => {
  const requests: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => requests.push({ resolve, signal: init.signal })),
    ),
  );
  const onExpire = vi.fn();
  const view = renderHook(
    ({ organizationId }) =>
      useActionData(
        `/organizations/${organizationId}/action-overview`,
        actionOverviewSchema,
        organizationId,
        onExpire,
      ),
    { initialProps: { organizationId: first } },
  );
  view.rerender({ organizationId: second });
  view.rerender({ organizationId: first });
  expect(requests[0]?.signal?.aborted).toBe(true);
  expect(requests[1]?.signal?.aborted).toBe(true);
  await act(async () => requests[0]?.resolve(new Response(JSON.stringify(snapshot(first)))));
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.loading).toBe(true);
  await act(async () => requests[2]?.resolve(new Response(JSON.stringify(snapshot(first)))));
  await waitFor(() => expect(view.result.current.data?.organizationId).toBe(first));
});

it('rejeita resposta de outra empresa mesmo quando o formato é válido', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot(second)))));
  const onExpire = vi.fn();
  const { result } = renderHook(() =>
    useActionData(`/organizations/${first}/action-overview`, actionOverviewSchema, first, onExpire),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toBeNull();
  expect(result.current.error).toMatch(/Não foi possível/);
});
