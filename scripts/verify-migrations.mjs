import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { localDatabaseUrl } from './local-database-url.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const environment = {
  ...parse(readFileSync(resolve(root, 'apps/api/.env'), 'utf8')),
  ...process.env,
  NODE_ENV: 'development',
};
const configured = localDatabaseUrl(environment.DATABASE_URL);

const name = `renr_verify_${randomUUID().replaceAll('-', '')}`;
if (!/^renr_verify_[a-f0-9]{32}$/.test(name)) throw new Error('Nome temporário inválido.');
const adminUrl = new URL(configured);
adminUrl.pathname = '/postgres';
const testUrl = new URL(configured);
testUrl.pathname = `/${name}`;
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const { Pool } = requireApi('pg');
const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const testPool = new Pool({ connectionString: testUrl.toString(), max: 1 });
let created = false;

async function pnpm(args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(root, 'node_modules/pnpm/bin/pnpm.cjs'), ...args],
      {
        cwd: root,
        env: { ...environment, DATABASE_URL: testUrl.toString() },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.once('error', () => reject(new Error('Não foi possível iniciar a verificação.')));
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error('Verificação de migração ou seed falhou.')),
    );
  });
}

try {
  // The generated identifier is validated above; no existing database is reused or reset.
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await pnpm(['db:deploy']);
  await pnpm(['db:deploy']);
  await pnpm(['db:seed']);
  await pnpm(['db:seed']);
  const counts = await testPool.query(`SELECT
    (SELECT count(*) FROM "users") AS users,
    (SELECT count(*) FROM "organizations") AS organizations,
    (SELECT count(*) FROM "memberships") AS memberships,
    (SELECT count(*) FROM "units") AS units,
    (SELECT count(*) FROM "sectors") AS sectors`);
  const expected = { users: '3', organizations: '2', memberships: '3', units: '2', sectors: '2' };
  for (const [key, value] of Object.entries(expected)) {
    if (counts.rows[0][key] !== value) throw new Error(`Contagem sintética inesperada: ${key}.`);
  }
  console.log(
    'Migrações em banco vazio e repetição do deploy/seed verificadas. Banco principal preservado.',
  );
} catch {
  process.exitCode = 1;
  console.error('Verificação de banco vazio falhou. Confira PostgreSQL local, build e migrações.');
} finally {
  await testPool.end();
  if (created) {
    // Drop only the exact database that this execution created successfully.
    await admin.query(`DROP DATABASE "${name}"`);
    console.log('Banco temporário desta verificação removido; não contém dados do projeto.');
  }
  await admin.end();
}
