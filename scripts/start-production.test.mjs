import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productionConfig, startProduction } from './start-production.mjs';

const env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:secret@db-pooler.example/app?sslmode=verify-full',
  DATABASE_URL_UNPOOLED: 'postgresql://user:secret@db.example/app?sslmode=verify-full',
  CORS_ORIGIN: 'https://renr.example',
  RUN_MIGRATIONS: 'false',
};

test('production startup requires explicit environment, database URLs and HTTPS origin', () => {
  assert.equal(productionConfig(env).runMigrations, false);
  for (const key of ['NODE_ENV', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'CORS_ORIGIN'])
    assert.throws(() => productionConfig({ ...env, [key]: undefined }), new RegExp(key));
  assert.throws(() => productionConfig({ ...env, CORS_ORIGIN: 'http://renr.example' }), /HTTPS/);
  assert.throws(
    () => productionConfig({ ...env, CORS_ORIGIN: 'https://renr.example/path' }),
    /HTTPS/,
  );
  assert.throws(() => productionConfig({ ...env, RUN_MIGRATIONS: 'yes' }), /RUN_MIGRATIONS/);
  assert.throws(
    () => productionConfig({ ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL }),
    /direct database/,
  );
});

test('API starts directly without migrations by default', async () => {
  const calls = [];
  await startProduction({
    env,
    run: async (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.match(calls[0][1][0], /dist[/\\]main.js$/);
});

test('Render derives the exact HTTPS origin and passes it to the API at first deployment', async () => {
  const calls = [];
  const renderEnvironment = {
    ...env,
    CORS_ORIGIN: undefined,
    RENDER: 'true',
    RENDER_EXTERNAL_URL: 'https://renr-homologation-unique.onrender.com',
  };
  await startProduction({ env: renderEnvironment, run: async (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].env.CORS_ORIGIN, renderEnvironment.RENDER_EXTERNAL_URL);
});

test('an explicit origin wins and a missing or untrusted Render origin is rejected', () => {
  const render = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://renr.onrender.com' };
  assert.equal(productionConfig({ ...env, ...render }).corsOrigin, env.CORS_ORIGIN);
  for (const value of [
    undefined,
    'http://renr.onrender.com',
    'https://localhost',
    'https://renr.onrender.com/path',
    'https://renr.onrender.com.attacker.example',
  ]) {
    assert.throws(
      () =>
        productionConfig({ ...env, ...render, CORS_ORIGIN: undefined, RENDER_EXTERNAL_URL: value }),
      /CORS_ORIGIN/,
    );
  }
  assert.throws(
    () => productionConfig({ ...env, ...render, CORS_ORIGIN: undefined, RENDER: undefined }),
    /CORS_ORIGIN/,
  );
});

test('production rejects TLS bypasses, connection overrides and mismatched migration targets', () => {
  assert.throws(() => productionConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS/);
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    for (const url of [
      env[key].replace('verify-full', 'require'),
      `${env[key]}&sslmode=disable`,
      `${env[key]}&host=other.example`,
      `${env[key]}&sslaccept=accept_invalid_certs`,
      `${env[key]}&uselibpqcompat=true`,
    ])
      assert.throws(() => productionConfig({ ...env, [key]: url }), /verify-full/);
  }
  assert.throws(
    () =>
      productionConfig({
        ...env,
        DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace('db.example', 'other.example'),
      }),
    /same endpoint/,
  );
  assert.throws(
    () =>
      productionConfig({
        ...env,
        DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace('/app?', '/other?'),
      }),
    /same endpoint/,
  );
});

test('migration completes before the API starts and migration failure prevents startup', async () => {
  const calls = [];
  const options = {
    env: { ...env, RUN_MIGRATIONS: 'true' },
    resolvePrisma: () => '/prisma/build/index.js',
  };
  await startProduction({
    ...options,
    run: async (...args) => {
      calls.push(args);
    },
  });
  assert.deepEqual(
    calls.map((call) => call[3]),
    ['Migration', 'API'],
  );
  assert.deepEqual(calls[0][1].slice(1), ['migrate', 'deploy', '--config', 'prisma.config.ts']);
  assert.equal(calls[0][2].env.DATABASE_URL_UNPOOLED, env.DATABASE_URL_UNPOOLED);
  let attempts = 0;
  await assert.rejects(
    startProduction({
      ...options,
      run: async () => {
        attempts++;
        throw new Error('migration failed');
      },
    }),
    /migration failed/,
  );
  assert.equal(attempts, 1);
});

test('free Blueprint never auto-deploys, previews or provisions database users', async () => {
  const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /autoDeployTrigger: off/);
  assert.match(blueprint, /generation: off/);
  assert.match(blueprint, /key: STORAGE_ENABLED\s+value: 'true'/);
  for (const key of ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'])
    assert.match(blueprint, new RegExp(`key: ${key}\\s+sync: false`));
  assert.equal((blueprint.match(/type: web/g) ?? []).length, 1);
  assert.doesNotMatch(
    blueprint,
    /preDeployCommand|databases:|type: (worker|cron)|provision-homologation/,
  );
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "scripts\/start-production.mjs"\]/);
  assert.doesNotMatch(dockerfile, /ARG .*PASSWORD|COPY .*\.env/);
});
