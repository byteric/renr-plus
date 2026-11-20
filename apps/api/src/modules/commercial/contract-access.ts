import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

export class ContractAccessSuspendedException extends ForbiddenException {
  constructor() {
    super('Contractual access is suspended');
  }
}

export function isContractAccessSuspended(
  organization: { commercialContractAccess?: { status: string } | null } | null | undefined,
): boolean {
  return organization?.commercialContractAccess?.status === 'SUSPENDED';
}

export const notContractuallySuspendedWhere: Prisma.OrganizationWhereInput = {
  OR: [
    { commercialContractAccess: null },
    { commercialContractAccess: { status: { not: 'SUSPENDED' } } },
  ],
};

export async function assertContractAccessAllowed(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const access = await tx.commercialContractAccess.findUnique({
    where: { organizationId },
    select: { status: true },
  });
  if (access?.status === 'SUSPENDED') {
    throw new ContractAccessSuspendedException();
  }
}

export async function lockAndAssertContractAccessAllowed(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR SHARE`;
  await assertContractAccessAllowed(tx, organizationId);
}
