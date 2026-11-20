import type { PrismaService } from '../src/database/prisma.service';
import { bootstrapPlatform } from '../src/modules/platform/bootstrap-platform';

it('provisions the initial administrative grants separately from named recovery operators', async () => {
  const userId = '86000000-0000-4000-8000-000000000001';
  let grantWrites: unknown;
  const transaction = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: userId }) },
    platformGrant: {
      count: async () => 0,
      createMany: async (input: unknown) => {
        grantWrites = input;
      },
    },
    platformAuditEvent: { create: async () => undefined },
  };
  const database = {
    client: {
      $transaction: (mutate: (value: typeof transaction) => unknown) => mutate(transaction),
    },
  } as unknown as PrismaService;
  const base = ['READ_OVERVIEW', 'MANAGE_CLIENTS', 'MANAGE_GRANTS'];
  const reason = 'Concessões iniciais para a plataforma de teste';

  await expect(bootstrapPlatform(database, { userId, reason, apply: false })).resolves.toEqual({
    applied: false,
    subjectId: userId,
    capabilities: base,
  });
  expect(grantWrites).toBeUndefined();

  await bootstrapPlatform(database, { userId, reason, apply: true });
  expect(grantWrites).toEqual({
    data: base.map((capability) => ({ userId, capability })),
  });
});
