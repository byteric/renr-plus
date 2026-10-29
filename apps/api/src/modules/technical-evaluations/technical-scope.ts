import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type TechnicalScope = { userId: string; organizationId: string };
function isProtectedCheckViolation(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.code !== 'P2039') return false;
  const adapter = error.meta?.driverAdapterError;
  if (!adapter || typeof adapter !== 'object') return false;
  const cause = (adapter as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const details = cause as { originalCode?: unknown; code?: unknown };
  return details.originalCode === '23514' || details.code === '23514';
}
export async function assertTechnicalScope(
  tx: Prisma.TransactionClient,
  scope: TechnicalScope,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id=${scope.userId}::uuid FOR SHARE`;
  const membership = await tx.membership.findUnique({
    where: {
      userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
    },
    include: { organization: { select: { isActive: true } } },
  });
  if (
    !membership?.isActive ||
    !membership.organization.isActive ||
    !membership.capabilities.includes('TECHNICAL_DECISIONS')
  )
    throw new ForbiddenException('Explicit technical capability required');
}
export async function technicalWrite<T>(
  database: PrismaService,
  scope: TechnicalScope,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await database.client.$transaction(async (tx) => {
      await assertTechnicalScope(tx, scope);
      return operation(tx);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (['P2002', 'P2003', 'P2004', 'P2034'].includes(error.code) ||
        isProtectedCheckViolation(error))
    )
      throw new ConflictException('Technical resource changed or violates a protected reference');
    throw error;
  }
}
