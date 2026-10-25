import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { localDatabaseUrl } from './local-database-url.mjs';

/** Only exact fixtures of the access suite in a loopback database may be removed. */
export async function cleanupAccessFixtures(organizationId, expectedName, email) {
  if (
    !expectedName.startsWith('e2e-access-') ||
    !/^e2e-access-[a-f0-9-]+@example\.test$/.test(email)
  )
    throw new Error('Refused cleanup outside access test fixtures.');
  const database = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const requireApi = createRequire(resolve('apps/api/package.json'));
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient } = requireApi('./dist/generated/prisma/client.js');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.href, max: 1 }),
  });
  try {
    await client.$transaction(async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id: organizationId, name: expectedName },
      });
      if (!org) return;
      await tx.session.updateMany({
        where: { activeOrganizationId: organizationId },
        data: { activeOrganizationId: null },
      });
      await tx.accessHistory.deleteMany({ where: { organizationId } });
      await tx.accessInvite.deleteMany({ where: { organizationId } });
      await tx.auditEvent.deleteMany({ where: { organizationId } });
      await tx.membership.deleteMany({ where: { organizationId } });
      await tx.organization.delete({ where: { id: organizationId } });
      const user = await tx.user.findUnique({ where: { email } });
      if (user && (await tx.membership.count({ where: { userId: user.id } })) === 0) {
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.user.delete({ where: { id: user.id } });
      }
    });
  } finally {
    await client.$disconnect();
  }
}
