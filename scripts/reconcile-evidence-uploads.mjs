import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as dotenv } from 'dotenv';

export function reconciliationOrigin(value) {
  const allowed = [
    'https://renr-plus-homologation.onrender.com',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ];
  if (!allowed.includes(value))
    throw new Error('Use a origem exata da homologação ou da API local na porta 3000.');
  return value;
}

export function evidenceReconciliationPlan(attempts, now = Date.now()) {
  return attempts.map((attempt) => ({
    key: attempt.key,
    state: attempt.state,
    attemptVersion: attempt.attemptVersion,
    expectedVersion: attempt.currentActionVersion,
    decision: ['COMPLETED', 'ABANDONED'].includes(attempt.state)
      ? 'SKIP_TERMINAL'
      : attempt.leaseExpiresAt && Date.parse(attempt.leaseExpiresAt) > now
        ? 'WAIT_LEASE'
        : attempt.objectState === 'PRESENT'
          ? 'RECONCILE_PRESENT'
          : attempt.objectState === 'ABSENT'
            ? 'RECONCILE_ABSENT'
            : 'PROBE_REQUIRED',
  }));
}

export async function reconcileEvidenceUploads({
  origin,
  organizationId,
  actionId,
  keys,
  email,
  password,
  apply = false,
  fetcher = fetch,
}) {
  reconciliationOrigin(origin);
  const appOrigin = origin.startsWith('http:') ? 'http://127.0.0.1:5173' : origin;
  const requireContracts = createRequire(
    new URL('../packages/contracts/package.json', import.meta.url),
  );
  const { evidenceUploadAttemptSchema } = requireContracts('./dist/index.cjs');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !uuid.test(organizationId) ||
    !uuid.test(actionId) ||
    !Array.isArray(keys) ||
    !keys.length ||
    keys.length > 20 ||
    keys.some((key) => !uuid.test(key)) ||
    new Set(keys).size !== keys.length
  )
    throw new Error('Informe organização, ação e até 20 chaves UUID distintas.');
  if (!email || !password) throw new Error('Credencial ausente no arquivo privado de acesso.');
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const response = await fetcher(`${origin}/api/v1${path}`, {
      method,
      headers: {
        Origin: appOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30000),
    });
    if (path === '/auth/sessions' && response.ok)
      cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    if (!response.ok)
      throw new Error(
        `A API retornou HTTP ${response.status}; nenhuma repetição automática foi realizada.`,
      );
    return response.status === 204 ? null : response.json();
  };
  try {
    await call('/auth/sessions', 'POST', { email, password });
    if (!cookie) throw new Error('Sessão demonstrativa não foi estabelecida.');
    await call('/auth/session/organization', 'PUT', { organizationId });
    const base = `/organizations/${organizationId}/actions/${actionId}/evidence/upload-attempts`;
    const results = [];
    for (const key of keys) {
      const attempt = evidenceUploadAttemptSchema.parse(await call(`${base}/${key}`));
      if (
        attempt.key !== key ||
        attempt.organizationId !== organizationId ||
        attempt.actionId !== actionId
      )
        throw new Error('A resposta não corresponde à tentativa solicitada.');
      const [planned] = evidenceReconciliationPlan([attempt]);
      if (!apply || ['SKIP_TERMINAL', 'WAIT_LEASE'].includes(planned.decision)) {
        results.push({ ...planned, applied: false });
        continue;
      }
      // Explicit --apply reconciles metadata only. Never retry PUT, archive or delete bytes.
      const result = evidenceUploadAttemptSchema.parse(
        await call(`${base}/${key}/reconcile`, 'POST', {
          expectedVersion: planned.expectedVersion,
          attemptVersion: planned.attemptVersion,
        }),
      );
      if (
        result.key !== key ||
        result.organizationId !== organizationId ||
        result.actionId !== actionId
      )
        throw new Error('A reconciliação retornou outro contexto.');
      results.push({ ...planned, applied: true, resultingState: result.state });
    }
    return { mode: apply ? 'APPLY' : 'DRY_RUN', results };
  } finally {
    if (cookie) await call('/auth/session', 'DELETE').catch(() => undefined);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      origin: { type: 'string' },
      organization: { type: 'string' },
      action: { type: 'string' },
      key: { type: 'string', multiple: true },
      'access-file': { type: 'string' },
      email: { type: 'string' },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'node scripts/reconcile-evidence-uploads.mjs --origin ORIGEM --organization UUID --action UUID --key UUID --access-file CAMINHO_PRIVADO --email EMAIL [--apply]\nSem --apply: consulta somente leitura. Com --apply: uma reconciliação por tentativa, sem reenvio ou exclusão de arquivos.',
    );
    return;
  }
  reconciliationOrigin(values.origin);
  if (!values['access-file'])
    throw new Error('Informe --access-file. Não passe senhas na linha de comando.');
  const access = dotenv(readFileSync(resolve(values['access-file']), 'utf8'));
  const report = await reconcileEvidenceUploads({
    origin: values.origin,
    organizationId: values.organization,
    actionId: values.action,
    keys: values.key,
    email: values.email ?? access.HOMOLOGATION_EMAIL,
    password: access.HOMOLOGATION_PASSWORD,
    apply: values.apply,
  });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    // Never print provider payloads, environment variables or raw credential errors.
    console.error(
      error instanceof Error && !error.message.includes('password')
        ? error.message
        : 'Reconciliação indisponível; confira o arquivo privado e o acesso à API.',
    );
    process.exitCode = 1;
  });
