import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { localDatabaseUrl } from './local-database-url.mjs';

/** Removes only the exact workforce E2E fixture; referenced diagnostic/risk history aborts cleanup. */
export async function cleanupWorkforceFixture(organizationId, expectedName) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      organizationId,
    ) ||
    !/^e2e-workforce-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      expectedName,
    )
  )
    throw new Error('Refused cleanup outside exact workforce E2E fixtures.');
  const database = localDatabaseUrl(process.env.DATABASE_URL ?? '');
  const requireApi = createRequire(resolve('apps/api/package.json'));
  const { PrismaPg } = requireApi('@prisma/adapter-pg');
  const { PrismaClient } = requireApi('./dist/generated/prisma/client.js');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database.href, max: 1 }),
  });
  try {
    await client.$transaction(async (tx) => {
      const organization = await tx.organization.findFirst({
        where: { id: organizationId, name: expectedName },
      });
      if (!organization) return;
      await tx.session.updateMany({
        where: { activeOrganizationId: organizationId },
        data: { activeOrganizationId: null },
      });
      await tx.employee.deleteMany({ where: { organizationId } });
      await tx.assessmentGroup.deleteMany({ where: { organizationId } });
      await tx.sector.deleteMany({ where: { organizationId } });
      await tx.unit.deleteMany({ where: { organizationId } });
      await tx.auditEvent.deleteMany({ where: { organizationId } });
      await tx.membership.deleteMany({ where: { organizationId } });
      await tx.organization.delete({ where: { id: organizationId } });
    });
  } finally {
    await client.$disconnect();
  }
}
