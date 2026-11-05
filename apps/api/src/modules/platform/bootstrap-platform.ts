import { parseArgs } from 'node:util';
import { platformCapabilitySchema } from '@renr/contracts';
import { z } from 'zod';
import { parseEnvironment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';

const inputSchema = z
  .object({
    userId: z.uuid(),
    reason: z.string().trim().min(3).max(1000),
    apply: z.boolean(),
  })
  .strict();

export async function bootstrapPlatform(
  database: PrismaService,
  input: z.input<typeof inputSchema>,
) {
  const { userId, reason, apply } = inputSchema.parse(input);
  return database.client.$transaction(async (tx) => {
    // Mutations use the same lock and read committed isolation in PlatformService.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
    if (await tx.platformGrant.count()) {
      throw new Error('A plataforma já tem histórico de concessões.');
    }
    const subject = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!subject) throw new Error('Conta de destino indisponível.');
    const capabilities = [...platformCapabilitySchema.options];
    if (apply) {
      await tx.platformGrant.createMany({
        data: capabilities.map((capability) => ({ userId, capability })),
      });
      await tx.platformAuditEvent.create({
        data: { subjectId: userId, action: 'PLATFORM_BOOTSTRAP', reason },
      });
    }
    return { applied: apply, subjectId: userId, capabilities };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'user-id': { type: 'string' },
      reason: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  const input = inputSchema.parse({
    userId: values['user-id'],
    reason: values.reason,
    apply: values.apply,
  });
  const database = new PrismaService(parseEnvironment(process.env));
  try {
    process.stdout.write(JSON.stringify(await bootstrapPlatform(database, input)) + '\n');
  } finally {
    await database.onApplicationShutdown();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write(
      'Bootstrap recusado. Confira o destino, a conta e o histórico de concessões.\n',
    );
    process.exitCode = 1;
  });
}
