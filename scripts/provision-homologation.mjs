import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homologationConfig } from './homologation-config.mjs';
import { provisionHomologationData } from './homologation-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function provisionHomologation(env = process.env) {
  // Validate before loading dependencies or opening any database connection.
  const { url, password } = homologationConfig(env);
  const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient } = requireApi('./dist/generated/prisma/client.js');
  const { hashPassword } = requireApi('./dist/modules/identity/password.js');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }),
  });
  try {
    await provisionHomologationData(client, await hashPassword(password));
    console.log('Dados sintéticos de homologação preparados; registros existentes preservados.');
  } catch {
    throw new Error('Homologation provisioning failed; check database availability and migrations');
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  provisionHomologation().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
