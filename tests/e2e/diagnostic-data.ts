import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { localDatabaseUrl } from '../../scripts/local-database-url.mjs';

/** Only exact synthetic cycles created by this test may be removed. */
export async function cleanupDiagnosticCycles(cycles: { id: string; name: string }[]) {
  const apiRequire = createRequire(resolve('apps/api/package.json'));
  const environment = { ...parse(readFileSync(resolve('apps/api/.env'), 'utf8')), ...process.env };
  const url = localDatabaseUrl(environment.DATABASE_URL);
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const { PrismaClient } = apiRequire('./dist/generated/prisma/client.js');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 1 }),
  });
  try {
    for (const cycle of cycles) {
      if (!cycle.name.startsWith('e2e-v02-')) throw new Error('Recusada limpeza fora do teste.');
      await client.$transaction(async (tx: typeof client) => {
        const record = await tx.diagnosticCycle.findFirst({
          where: { id: cycle.id, name: cycle.name },
        });
        if (!record) return;
        const responses = await tx.diagnosticResponse.findMany({
          where: { cycleId: cycle.id },
          select: { id: true },
        });
        await tx.responseAnswer.deleteMany({
          where: { responseId: { in: responses.map((response: { id: string }) => response.id) } },
        });
        await tx.diagnosticResponse.deleteMany({ where: { cycleId: cycle.id } });
        await tx.participationInvite.deleteMany({ where: { cycleId: cycle.id } });
        await tx.cycleGroup.deleteMany({ where: { cycleId: cycle.id } });
        await tx.auditEvent.deleteMany({
          where: { resourceId: cycle.id, organizationId: record.organizationId },
        });
        await tx.diagnosticCycle.delete({ where: { id: cycle.id } });
      });
    }
  } finally {
    await client.$disconnect();
  }
}
