import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = 'postgresql://test:test@127.0.0.1:5432/prisma_guard_test';
const direct = 'postgresql://test:test@neon.example/prisma_guard_test?sslmode=verify-full';
const pooled = 'postgresql://test:test@neon-pooler.example/prisma_guard_test?sslmode=verify-full';

function loadConfig(environment) {
  const env = { ...process.env, ...environment };
  if (environment.DATABASE_URL_UNPOOLED === undefined) delete env.DATABASE_URL_UNPOOLED;
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      'const module = await import("./apps/api/prisma.config.ts"); console.log(JSON.stringify(module.default.datasource));',
    ],
    { cwd: root, env, encoding: 'utf8', windowsHide: true },
  );
}

test('local Prisma commands ignore a residual cloud migration URL', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const result = loadConfig({ NODE_ENV, DATABASE_URL: local, DATABASE_URL_UNPOOLED: direct });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).url, local);
  }
});

test('production Prisma commands use the direct URL, not the runtime pool', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: pooled,
    DATABASE_URL_UNPOOLED: direct,
  });
  assert.equal(result.status, 0, result.stderr);
  const actual = new URL(JSON.parse(result.stdout.trim()).url);
  assert.equal(actual.hostname, 'neon.example');
  assert.equal(actual.searchParams.get('sslmode'), 'require');
  assert.equal(actual.searchParams.get('sslaccept'), 'strict');
});

test('production Prisma commands reject TLS overrides and pooled migration URLs', () => {
  for (const url of [
    direct.replace('verify-full', 'prefer'),
    `${direct}&sslaccept=accept_invalid_certs`,
    `${direct}&sslmode=disable`,
    pooled,
  ]) {
    const result = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: pooled,
      DATABASE_URL_UNPOOLED: url,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verified TLS/);
  }
});

test('production Prisma commands reject global TLS verification bypass', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    DATABASE_URL: pooled,
    DATABASE_URL_UNPOOLED: direct,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verified TLS/);
});

test('production Prisma commands fail before connecting when direct URL is absent', () => {
  const result = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: pooled,
    DATABASE_URL_UNPOOLED: undefined,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL_UNPOOLED/);
});
