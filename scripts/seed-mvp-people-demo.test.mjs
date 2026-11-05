import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./seed-mvp-people-demo.mjs', import.meta.url));
const secret = 'test-secret-must-not-leak';

function run(databaseUrl) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl,
      MVP_DEMO_HR_PASSWORD: '',
      MVP_DEMO_OPERATOR_PASSWORD: '',
    },
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  return result.stderr;
}

test('rejects every target except the dedicated loopback PostgreSQL database before checking passwords', () => {
  for (const target of [
    '',
    'not a URL',
    'https://127.0.0.1/renr_mvp_demo',
    'postgresql://user:' + secret + '@cloud.invalid/renr_mvp_demo',
    'postgresql://127.0.0.1/renr_test',
    'postgresql://127.0.0.1/renr_mvp_demo?host=cloud.invalid',
    'postgresql://127.0.0.1/renr_mvp_demo?dbname=other',
    'postgresql://127.0.0.1/renr_mvp%5fdemo',
    'postgresql://127.0.0.1/renr_mvp_demo?schema=private',
  ]) {
    assert.match(run(target), /PostgreSQL local.*renr_mvp_demo/);
  }
});

test('requires explicit passwords before connecting to the dedicated database', () => {
  for (const target of [
    'postgresql://127.0.0.1/renr_mvp_demo?schema=public',
    'postgresql://[::1]/renr_mvp_demo',
  ]) {
    assert.match(run(target), /MVP_DEMO_HR_PASSWORD.*MVP_DEMO_OPERATOR_PASSWORD/);
  }
});
