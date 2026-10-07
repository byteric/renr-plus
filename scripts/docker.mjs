import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = ['docker'];
if (process.platform === 'win32') {
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    );
  }
  if (process.env.ProgramFiles) {
    candidates.push(
      join(process.env.ProgramFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    );
  }
}
const executable = candidates.find((candidate) => {
  if (candidate !== 'docker' && !existsSync(candidate)) return false;
  return spawnSync(candidate, ['--version'], { timeout: 5000, windowsHide: true }).status === 0;
});

if (!executable) {
  console.error('Docker não encontrado. Instale Docker Desktop e inicie o engine Linux.');
  process.exit(1);
}

const environment = { ...process.env };
if (executable !== 'docker') {
  environment.PATH = `${dirname(executable)}${delimiter}${environment.PATH ?? ''}`;
}

function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: environment,
      stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    if (input) {
      child.stdin.once('error', reject);
      child.stdin.end(input);
    }
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker encerrou com código ${code ?? 'indisponível'}.`));
    });
  });
}

try {
  const action = process.argv[2];
  const commands = {
    up: ['up', '-d', '--wait', '--wait-timeout', '120'],
    down: ['down'],
    status: ['ps'],
    logs: ['logs', '--tail', '80'],
    'verify-storage': [],
  };
  if (!Object.hasOwn(commands, action ?? ''))
    throw new Error('Use up, down, status, logs ou verify-storage.');

  const probe = spawnSync(executable, ['info', '--format', '{{.OSType}}'], {
    env: environment,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (probe.status !== 0) {
    if (process.platform !== 'win32') throw new Error('Inicie o daemon Docker antes de continuar.');
    await run(['desktop', 'start', '--timeout', '60']);
    const started = spawnSync(executable, ['info', '--format', '{{.OSType}}'], {
      env: environment,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (started.status !== 0 || started.stdout.trim() !== 'linux') {
      throw new Error('O engine Linux ainda não está pronto. Confira o Docker Desktop.');
    }
  } else if (probe.stdout.trim() !== 'linux') {
    throw new Error(
      'O projeto requer containers Linux. Selecione o engine Linux no Docker Desktop.',
    );
  }

  const compose = ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml'];
  // --quiet evita que valores de credenciais resolvidos sejam exibidos no terminal.
  await run([...compose, 'config', '--quiet']);
  if (action === 'verify-storage') {
    const bucket = parse(readFileSync(join(root, 'apps/api/.env'), 'utf8')).S3_BUCKET;
    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error('Configure um S3_BUCKET local válido no ambiente da API.');
    }
    const script = readFileSync(join(root, 'infra/minio/verify-storage.sh'), 'utf8').replace(
      /\r\n?/g,
      '\n',
    );
    await run(
      [...compose, 'exec', '-T', '--env', `RENR_CHECK_BUCKET=${bucket}`, 'minio', 'sh', '-s'],
      script,
    );
  } else {
    await run([...compose, ...commands[action]]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Não foi possível executar o Docker.');
  process.exitCode = 1;
}
