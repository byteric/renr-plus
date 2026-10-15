import { afterEach, expect, it, vi } from 'vitest';
import { send, RequestError } from './api';
afterEach(() => vi.unstubAllGlobals());
it('omite cookies quando o consumidor público pede omit', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await send('/participation/instrument', { method: 'POST', credentials: 'omit', body: '{}' });
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('omit');
});
it('identifica convite indisponível sem sugerir cadastro duplicado', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 409,
          code: 'INVITE_UNAVAILABLE',
          message: 'internal',
          requestId: '10000000-0000-4000-8000-000000000001',
          timestamp: '2026-10-12T12:00:00.000Z',
        }),
        { status: 409 },
      ),
    ),
  );
  const failure = await send('/participation/instrument').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(RequestError);
  expect(failure).toMatchObject({ code: 'INVITE_UNAVAILABLE' });
  expect(failure).toHaveProperty('message', expect.stringContaining('convite'));
});
