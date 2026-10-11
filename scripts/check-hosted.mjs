import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function hostedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Informe a origem HTTPS do serviço Render.');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    !/^[a-z0-9][a-z0-9-]*\.onrender\.com$/.test(url.hostname)
  ) {
    throw new Error('Use a origem HTTPS onrender.com, sem caminho, credenciais ou parâmetros.');
  }
  return url.origin;
}

const checks = [
  { path: '/api/v1/health', status: 200, kind: 'health' },
  { path: '/api/v1/ready', status: 200, kind: 'health' },
  { path: '/', status: 200, kind: 'html' },
  { path: '/api/v1/check-hosted-missing', status: 404, kind: 'error' },
  { path: '/api/v1/auth/session', status: 401, kind: 'error' },
  {
    path: '/api/v1/organizations/00000000-0000-4000-8000-000000000000/overview',
    status: 401,
    kind: 'error',
  },
  { path: '/.env', status: 404, kind: 'private' },
  { path: '/api/docs', status: 404, kind: 'private' },
];

export async function checkHosted(value, { fetcher = fetch, timeoutMs = 30_000 } = {}) {
  const origin = hostedOrigin(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Timeout deve estar entre 1 e 60000 milissegundos.');
  }
  // Serial requests avoid a burst during the first cold start. No login or database writes.
  const results = [];
  for (const check of checks) {
    let status = null;
    let ok;
    try {
      const response = await fetcher(new URL(check.path, origin), {
        method: 'GET',
        headers: { Accept: check.kind === 'html' ? 'text/html' : 'application/json' },
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      ok = status === check.status;
      if (ok && check.kind === 'html') {
        ok =
          (response.headers.get('content-type') ?? '').includes('text/html') &&
          /<!doctype html>/i.test(await response.text());
      } else if (ok && ['health', 'error'].includes(check.kind)) {
        const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
        const body = isJson ? await response.json() : null;
        ok =
          body !== null &&
          typeof body === 'object' &&
          (check.kind === 'health'
            ? body.status === 'ok' && body.service === 'renr-api'
            : body.statusCode === check.status && typeof body.code === 'string');
      }
    } catch {
      // Return a safe failure, never a raw response, environment variable, or credential.
      ok = false;
    }
    results.push({ path: check.path, status, ok });
  }
  return { origin, ok: results.every((result) => result.ok), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await checkHosted(process.argv[2]);
    for (const item of result.results) {
      console.log(
        `${item.ok ? 'OK' : 'FALHOU'} ${item.path} HTTP ${item.status ?? 'indisponível'}`,
      );
    }
    if (!result.ok) {
      console.error('Não liberar o link: revisar serviço, banco e proteção dos endpoints.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
