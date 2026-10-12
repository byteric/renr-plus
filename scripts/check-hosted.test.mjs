import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHosted, hostedOrigin } from './check-hosted.mjs';

const { Response } = globalThis;

const origin = 'https://renr-plus-homologation.onrender.com';
function healthyResponse(url) {
  const path = new URL(url).pathname;
  if (path === '/') {
    return new Response('<!doctype html><html><body>ReNR+</body></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  const status = ['/api/v1/health', '/api/v1/ready'].includes(path)
    ? 200
    : path.includes('/overview') || path === '/api/v1/auth/session'
      ? 401
      : 404;
  return Response.json(
    status === 200
      ? { status: 'ok', service: 'renr-api' }
      : { statusCode: status, code: status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' },
    { status },
  );
}

test('accepts a Render HTTPS origin', () => {
  assert.equal(hostedOrigin(origin), origin);
});
for (const value of [
  'http://renr-plus.onrender.com',
  'https://renr-plus.onrender.com/',
  'https://user:password@renr-plus.onrender.com',
  'https://renr-plus.onrender.com?key=secret',
  'https://renr-plus.onrender.com/#/painel',
  'https://localhost',
  'https://127.0.0.1',
  'https://onrender.com.attacker.example',
  undefined,
]) {
  test(`rejects an invalid origin ${String(value)}`, () => {
    assert.throws(() => hostedOrigin(value));
  });
}
test('checks eight read-only endpoints without cookies and without following redirects', async () => {
  const calls = [];
  const result = await checkHosted(origin, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return healthyResponse(url);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 8);
  assert.ok(calls.every(({ options }) => options.method === 'GET'));
  assert.ok(calls.every(({ options }) => options.redirect === 'error'));
  assert.ok(calls.every(({ options }) => !('Cookie' in options.headers)));
});
test('does not report a database outage as a healthy release', async () => {
  const result = await checkHosted(origin, {
    fetcher: async (url) =>
      new URL(url).pathname.endsWith('/ready')
        ? Response.json({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
        : healthyResponse(url),
  });
  assert.equal(result.ok, false);
  assert.equal(result.results[1].status, 503);
});
test('rejects HTML masquerading as the API or an error', async () => {
  const result = await checkHosted(origin, {
    fetcher: async (url) =>
      new URL(url).pathname === '/api/v1/health'
        ? new Response('<html>fallback</html>')
        : healthyResponse(url),
  });
  assert.equal(result.ok, false);
});
test('does not expose response text or thrown sensitive details', async () => {
  const result = await checkHosted(origin, {
    fetcher: async () => {
      throw new Error('password=must-not-leak');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.results.length, 8);
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
});
test('fails if private files or Swagger are publicly served', async () => {
  const result = await checkHosted(origin, {
    fetcher: async (url) =>
      ['/api/docs', '/.env'].includes(new URL(url).pathname)
        ? new Response('not-public')
        : healthyResponse(url),
  });
  assert.equal(result.ok, false);
});
test('validates timeout before any external call', async () => {
  await assert.rejects(checkHosted(origin, { timeoutMs: 0 }));
  await assert.rejects(checkHosted(origin, { timeoutMs: 60_001 }));
});
