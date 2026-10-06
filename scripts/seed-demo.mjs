import { createRequire } from 'node:module';
import { randomBytes, scrypt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localSeedUrl } from './local-seed-url.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const { config } = requireApi('dotenv');
const { PrismaPg } = requireApi('@prisma/adapter-pg');
const { PrismaClient } = requireApi('./dist/generated/prisma/client.js');
config({ path: path.join(root, 'apps/api/.env'), quiet: true });

const url = localSeedUrl(process.env.DATABASE_URL ?? '', process.env.NODE_ENV);
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 16 || password.length > 256)
  throw new Error('DEMO_PASSWORD must contain 16–256 characters');
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }),
});
const salt = randomBytes(16).toString('hex');
const key = await new Promise((resolve, reject) =>
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, value) =>
    error ? reject(error) : resolve(value),
  ),
);
const passwordHash = `scrypt:${salt}:${key.toString('hex')}`;
try {
  await client.$transaction(async (tx) => {
    const users = [];
    for (const [email, name] of [
      ['admin1@renr.example', 'Admin demonstração 1'],
      ['admin2@renr.example', 'Admin demonstração 2'],
      ['reader@renr.example', 'Leitor demonstração'],
    ]) {
      users.push(
        await tx.user.upsert({
          where: { email },
          update: {},
          create: { email, name, passwordHash },
        }),
      );
    }
    for (const [index, id, name] of [
      [0, '10000000-0000-4000-8000-000000000001', 'Empresa demonstração 1'],
      [1, '10000000-0000-4000-8000-000000000002', 'Empresa demonstração 2'],
    ]) {
      await tx.organization.upsert({ where: { id }, update: {}, create: { id, name } });
      await tx.membership.upsert({
        where: { userId_organizationId: { userId: users[index].id, organizationId: id } },
        update: {},
        create: { userId: users[index].id, organizationId: id, role: 'ADMIN' },
      });
      if (index === 0)
        await tx.membership.upsert({
          where: { userId_organizationId: { userId: users[2].id, organizationId: id } },
          update: {},
          create: { userId: users[2].id, organizationId: id, role: 'READER' },
        });
      const unit = await tx.unit.upsert({
        where: {
          organizationId_normalizedName: {
            organizationId: id,
            normalizedName: 'unidade demonstração',
          },
        },
        update: {},
        create: {
          organizationId: id,
          name: 'Unidade demonstração',
          normalizedName: 'unidade demonstração',
        },
      });
      await tx.sector.upsert({
        where: { unitId_normalizedName: { unitId: unit.id, normalizedName: 'setor demonstração' } },
        update: {},
        create: {
          organizationId: id,
          unitId: unit.id,
          name: 'Setor demonstração',
          normalizedName: 'setor demonstração',
        },
      });
    }
  });
  console.log('Dados sintéticos de demonstração preparados; registros existentes preservados.');
} catch {
  throw new Error('Demo seed failed; check local database availability and migrations');
} finally {
  await client.$disconnect();
}
