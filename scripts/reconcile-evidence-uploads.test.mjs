import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const { Response } = globalThis;

const target = new URL('./reconcile-evidence-uploads.mjs', import.meta.url);
const implementation = existsSync(target) ? await import(target.href) : {};
const plan = implementation.evidenceReconciliationPlan ?? (() => []);
const key = '10000000-0000-4000-8000-000000000001';
const base = {
  key,
  state: 'UNCERTAIN',
  attemptVersion: 2,
  currentActionVersion: 3,
  leaseExpiresAt: null,
  objectState: 'UNKNOWN',
};
test('dry-run identifies exact presence, absence and uncertainty without claiming success', () => {
  assert.deepEqual(
    plan([base, { ...base, objectState: 'PRESENT' }, { ...base, objectState: 'ABSENT' }]).map(
      (v) => v.decision,
    ),
    ['PROBE_REQUIRED', 'RECONCILE_PRESENT', 'RECONCILE_ABSENT'],
  );
});
test('active leases and terminal attempts are never mutated by operational reconciliation', () => {
  assert.deepEqual(
    plan([
      { ...base, state: 'COMPLETED' },
      { ...base, state: 'ABANDONED' },
      { ...base, state: 'UPLOADING', leaseExpiresAt: '2099-01-01T00:00:00Z' },
    ]).map((v) => v.decision),
    ['SKIP_TERMINAL', 'SKIP_TERMINAL', 'WAIT_LEASE'],
  );
});
test('planning preserves the concurrency versions and omits private contents', () => {
  const result = plan([{ ...base, description: 'private content', sha256: 'private digest' }]);
  assert.deepEqual(result[0], {
    key,
    state: 'UNCERTAIN',
    attemptVersion: 2,
    expectedVersion: 3,
    decision: 'PROBE_REQUIRED',
  });
  assert.doesNotMatch(JSON.stringify(result), /private content|private digest/);
});
test('credentials can only target the exact homologation origin or the local API', () => {
  const validate = implementation.reconciliationOrigin ?? (() => '');
  assert.equal(
    validate('https://renr-plus-homologation.onrender.com'),
    'https://renr-plus-homologation.onrender.com',
  );
  assert.equal(validate('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  for (const origin of [
    'https://example.com',
    'https://renr-plus-homologation.onrender.com.attacker.test',
    'https://user:pass@renr-plus-homologation.onrender.com',
    'https://renr-plus-homologation.onrender.com/path',
    'http://127.0.0.1:4000',
  ])
    assert.throws(() => validate(origin));
});
const attempt = {
  ...base,
  organizationId: '20000000-0000-4000-8000-000000000001',
  actionId: '30000000-0000-4000-8000-000000000001',
  description: 'Synthetic verification document',
  fileName: 'synthetic.pdf',
  mimeType: 'application/pdf',
  size: 20,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  retryAllowed: false,
  evidence: null,
};
for (const boundary of ['local-origin', 'active-organization'])
  test(`operational request respects ${boundary}`, async () => {
    let activated = false;
    const fetcher = async (url, options) => {
      if (boundary === 'local-origin' && options.headers.Origin !== 'http://127.0.0.1:5173')
        return Response.json({}, { status: 403 });
      if (url.endsWith('/auth/sessions'))
        return new Response('{}', {
          status: 201,
          headers: { 'Set-Cookie': 'renr_session=synthetic; Path=/api/v1' },
        });
      if (url.endsWith('/auth/session/organization') && options.method === 'PUT') {
        assert.deepEqual(JSON.parse(options.body), { organizationId: attempt.organizationId });
        activated = true;
        return Response.json({});
      }
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      if (boundary === 'active-organization' && !activated)
        return Response.json({}, { status: 404 });
      return Response.json(attempt);
    };
    const report = await implementation.reconcileEvidenceUploads({
      origin: 'http://127.0.0.1:3000',
      organizationId: attempt.organizationId,
      actionId: attempt.actionId,
      keys: [key],
      email: 'synthetic@example.test',
      password: 'synthetic-password',
      fetcher,
    });
    assert.equal(report.mode, 'DRY_RUN');
  });
for (const apply of [false, true])
  test(`operational ${apply ? 'apply' : 'dry-run'} never uploads or deletes files`, async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ path: new URL(url).pathname, method: options.method, body: options.body });
      if (url.endsWith('/auth/sessions'))
        return new Response('{}', {
          status: 201,
          headers: { 'Set-Cookie': 'renr_session=synthetic; Path=/api/v1' },
        });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json(
        url.endsWith('/reconcile')
          ? {
              ...attempt,
              state: 'RETRYABLE',
              attemptVersion: 3,
              objectState: 'ABSENT',
              retryAllowed: true,
            }
          : attempt,
      );
    };
    const report = await implementation.reconcileEvidenceUploads({
      origin: 'http://127.0.0.1:3000',
      organizationId: attempt.organizationId,
      actionId: attempt.actionId,
      keys: [key],
      email: 'synthetic@example.test',
      password: 'synthetic-password',
      apply,
      fetcher,
    });
    assert.equal(report.mode, apply ? 'APPLY' : 'DRY_RUN');
    assert.equal(calls.filter((v) => v.path.endsWith('/reconcile')).length, apply ? 1 : 0);
    assert.ok(calls.every((v) => !/\/retry$|\/abandon$|\/download$/.test(v.path)));
    assert.ok(calls.every((v) => v.method !== 'DELETE' || v.path.endsWith('/auth/session')));
    assert.doesNotMatch(
      JSON.stringify(report),
      /synthetic-password|Synthetic verification document/,
    );
    if (apply)
      assert.deepEqual(JSON.parse(calls.find((v) => v.path.endsWith('/reconcile')).body), {
        expectedVersion: 3,
        attemptVersion: 2,
      });
  });
