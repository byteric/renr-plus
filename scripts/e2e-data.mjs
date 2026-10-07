import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

// Playwright loads its test helpers through CommonJS; resolve from the project cwd.
const apiDirectory = resolve('apps/api');
const apiRequire = createRequire(resolve(apiDirectory, 'package.json'));

export function demoPassword() {
  const environment = {
    ...parse(readFileSync(resolve(apiDirectory, '.env'), 'utf8')),
    ...process.env,
  };
  if (!environment.DEMO_PASSWORD)
    throw new Error('Execute setup:local e db:seed antes dos testes E2E.');
  return environment.DEMO_PASSWORD;
}

/** Remove only the synthetic organization created by this exact test. */
export async function cleanupTestOrganization(id, expectedName) {
  if (!expectedName.startsWith('e2e-v01-'))
    throw new Error('Recusada limpeza de organização fora do teste.');
  const environment = {
    ...parse(readFileSync(resolve(apiDirectory, '.env'), 'utf8')),
    ...process.env,
  };
  const database = new URL(environment.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Limpeza E2E permitida somente no banco local.');
  }
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const { PrismaClient } = apiRequire('./dist/generated/prisma/client.js');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.toString(), max: 1 }),
  });
  try {
    await client.$transaction(async (transaction) => {
      const organization = await transaction.organization.findFirst({
        where: { id, name: expectedName },
      });
      if (!organization) return;
      await transaction.session.updateMany({
        where: { activeOrganizationId: id },
        data: { activeOrganizationId: null },
      });
      await transaction.sector.deleteMany({ where: { organizationId: id } });
      await transaction.unit.deleteMany({ where: { organizationId: id } });
      await transaction.auditEvent.deleteMany({ where: { organizationId: id } });
      await transaction.membership.deleteMany({ where: { organizationId: id } });
      await transaction.organization.delete({ where: { id } });
    });
  } finally {
    await client.$disconnect();
  }
}
