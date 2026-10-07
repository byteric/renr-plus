import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const localPath = resolve(root, '.env');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function createIfMissing(path, contents) {
  try {
    await writeFile(path, contents, { flag: 'wx', mode: 0o600 });
    console.log(`Criado: ${path.slice(root.length)}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Preservado: ${path.slice(root.length)}`);
  }
}

if (!(await exists(localPath))) {
  const template = await readFile(resolve(root, '.env.example'), 'utf8');
  const generated = template
    .replace('POSTGRES_PASSWORD=CHANGE_ME', `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`)
    .replace(
      'MINIO_ROOT_PASSWORD=CHANGE_ME',
      `MINIO_ROOT_PASSWORD=${randomBytes(24).toString('hex')}`,
    );
  await createIfMissing(localPath, generated);
}

const infra = parse(await readFile(localPath, 'utf8'));
for (const field of [
  'POSTGRES_USER',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
]) {
  if (!infra[field] || infra[field] === 'CHANGE_ME') {
    throw new Error(`Configure ${field} no .env local antes de continuar.`);
  }
}

const databaseUrl = `postgresql://${encodeURIComponent(infra.POSTGRES_USER)}:${encodeURIComponent(infra.POSTGRES_PASSWORD)}@127.0.0.1:5432/${encodeURIComponent(infra.POSTGRES_DB)}?schema=public`;
const apiTemplate = await readFile(resolve(root, 'apps/api/.env.example'), 'utf8');
const apiContents = apiTemplate
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`)
  .replace(/^S3_ACCESS_KEY=.*$/m, `S3_ACCESS_KEY=${infra.MINIO_ROOT_USER}`)
  .replace(/^S3_SECRET_KEY=.*$/m, `S3_SECRET_KEY=${infra.MINIO_ROOT_PASSWORD}`);
await createIfMissing(resolve(root, 'apps/api/.env'), apiContents);
const apiLocalPath = resolve(root, 'apps/api/.env');
const apiLocalContents = await readFile(apiLocalPath, 'utf8');
if (!parse(apiLocalContents).DEMO_PASSWORD) {
  // Only development accounts use this value. Preserve all existing configuration.
  await writeFile(
    apiLocalPath,
    `${apiLocalContents.trimEnd()}\nDEMO_PASSWORD=${randomBytes(24).toString('base64url')}\n`,
    {
      mode: 0o600,
    },
  );
  console.log('Senha aleatória de demonstração preparada no arquivo local da API.');
}
await createIfMissing(
  resolve(root, 'apps/web/.env'),
  await readFile(resolve(root, 'apps/web/.env.example'), 'utf8'),
);
console.log(
  'Configuração local pronta. Credenciais não foram exibidas; arquivos existentes não foram sobrescritos.',
);
