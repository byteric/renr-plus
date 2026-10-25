import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { localDatabaseUrl } from './local-database-url.mjs';

/** Exact disposable E2E organizations only. Any diagnostic/history reference aborts atomically. */
export async function cleanupInstrumentsFixture(organizationId, expectedName) {
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  if (
    !new RegExp(`^${uuid}$`, 'i').test(organizationId) ||
    !new RegExp(`^e2e-instruments-${uuid}$`, 'i').test(expectedName)
  )
    throw new Error('Refused cleanup outside exact instrument E2E fixtures.');
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
      // Version-first maintenance cascades children; cycle FKs remain RESTRICT and are never bypassed.
      await tx.instrumentVersion.deleteMany({ where: { organizationId } });
      await tx.instrument.deleteMany({ where: { organizationId } });
      await tx.employee.deleteMany({ where: { organizationId } });
      await tx.assessmentGroup.deleteMany({ where: { organizationId } });
      await tx.sector.deleteMany({ where: { organizationId } });
      await tx.unit.deleteMany({ where: { organizationId } });
      await tx.auditEvent.deleteMany({ where: { organizationId } });
      await tx.accessHistory.deleteMany({ where: { organizationId } });
      await tx.accessInvite.deleteMany({ where: { organizationId } });
      await tx.session.updateMany({
        where: { activeOrganizationId: organizationId },
        data: { activeOrganizationId: null },
      });
      await tx.membership.deleteMany({ where: { organizationId } });
      await tx.organization.delete({ where: { id: organizationId } });
    });
  } finally {
    await client.$disconnect();
  }
}
