import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function productionConfig(env) {
  if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('Strict TLS verification is required');
  const urls = [];
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    let url;
    try {
      url = new URL(env[key]);
    } catch {
      throw new Error(`${key} must be a PostgreSQL URL`);
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      !url.pathname.slice(1) ||
      url.hash
    )
      throw new Error(`${key} must be a PostgreSQL URL`);
    if (
      key === 'DATABASE_URL_UNPOOLED' &&
      (url.hostname.includes('-pooler') || url.searchParams.has('pgbouncer'))
    )
      throw new Error('DATABASE_URL_UNPOOLED must use the direct database endpoint');
    const allowedParameters = new Set(['sslmode', 'channel_binding', 'schema', 'connect_timeout']);
    if (
      url.searchParams.get('sslmode') !== 'verify-full' ||
      [...url.searchParams.keys()].some(
        (parameter) =>
          !allowedParameters.has(parameter) || url.searchParams.getAll(parameter).length !== 1,
      )
    )
      throw new Error(`${key} must use sslmode=verify-full without connection overrides`);
    urls.push(url);
  }
  const [pooled, direct] = urls;
  if (
    pooled.hostname.replace(/-pooler(?=\.|$)/, '') !== direct.hostname ||
    pooled.port !== direct.port ||
    decodeURIComponent(pooled.pathname) !== decodeURIComponent(direct.pathname) ||
    pooled.searchParams.get('schema') !== direct.searchParams.get('schema')
  )
    throw new Error('Database URLs must point to the same endpoint and database');
  let corsOrigin = env.CORS_ORIGIN;
  if (corsOrigin === undefined && env.RENDER === 'true') {
    try {
      const external = new URL(env.RENDER_EXTERNAL_URL);
      if (/^[a-z0-9][a-z0-9-]*\.onrender\.com$/.test(external.hostname)) {
        corsOrigin = env.RENDER_EXTERNAL_URL;
      }
    } catch {
      // A missing platform URL still fails the strict origin check below.
    }
  }
  let origin;
  try {
    origin = new URL(corsOrigin);
  } catch {
    throw new Error('CORS_ORIGIN must be an HTTPS origin');
  }
  if (origin.protocol !== 'https:' || origin.origin !== corsOrigin)
    throw new Error('CORS_ORIGIN must be an HTTPS origin');
  if (env.RUN_MIGRATIONS !== undefined && !['true', 'false'].includes(env.RUN_MIGRATIONS))
    throw new Error('RUN_MIGRATIONS must be true or false');
  return { runMigrations: env.RUN_MIGRATIONS === 'true', corsOrigin: origin.origin };
}

export async function startProduction({ env = process.env, run = runChild, resolvePrisma } = {}) {
  const config = productionConfig(env);
  const runtimeEnvironment = { ...env, CORS_ORIGIN: config.corsOrigin };
  const api = path.join(root, 'apps/api');
  if (config.runMigrations) {
    const requireApi = createRequire(path.join(api, 'package.json'));
    const cli = resolvePrisma ? resolvePrisma() : requireApi.resolve('prisma/build/index.js');
    await run(
      process.execPath,
      [cli, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      { cwd: api, env: runtimeEnvironment },
      'Migration',
    );
  }
  await run(
    process.execPath,
    [path.join(api, 'dist/main.js')],
    { cwd: api, env: runtimeEnvironment },
    'API',
  );
}

function runChild(command, args, options, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    const stop = (signal) => child.kill(signal);
    const terminate = () => stop('SIGTERM');
    const interrupt = () => stop('SIGINT');
    process.on('SIGTERM', terminate);
    process.on('SIGINT', interrupt);
    const cleanup = () => {
      process.off('SIGTERM', terminate);
      process.off('SIGINT', interrupt);
    };
    child.once('error', () => {
      cleanup();
      reject(new Error(`${label} could not start`));
    });
    child.once('exit', (code, signal) => {
      cleanup();
      if (signal || code !== 0) reject(new Error(`${label} exited unsuccessfully`));
      else resolve();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startProduction().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
