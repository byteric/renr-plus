import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiDirectory = fileURLToPath(new URL('../apps/api/', import.meta.url));
const environment = {
  ...parse(readFileSync(`${apiDirectory}.env`, 'utf8')),
  ...process.env,
  NODE_ENV: 'test',
  RUN_DB_TESTS: '1',
};
const database = new URL(environment.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
  throw new Error('Os testes de banco só podem executar em PostgreSQL local.');
}
if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
  throw new Error('Configure um PostgreSQL local antes de executar os testes.');
}

const child = spawn(
  process.execPath,
  [
    '--experimental-vm-modules',
    'node_modules/jest/bin/jest.js',
    '--runInBand',
    '--testPathPatterns=integration|persistence',
  ],
  { cwd: apiDirectory, env: environment, stdio: 'inherit', windowsHide: true },
);
child.on('error', () => {
  console.error(`Não foi possível iniciar os testes em ${root}.`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  const recovery = spawn(
    process.execPath,
    ['--test', 'scripts/reconcile-evidence-uploads.integration.test.mjs'],
    {
      cwd: root,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  recovery.once('error', () => {
    console.error('Não foi possível verificar a reconciliação pela API local.');
    process.exitCode = 1;
  });
  recovery.once('exit', (recoveryCode) => {
    process.exitCode = recoveryCode ?? 1;
  });
});
