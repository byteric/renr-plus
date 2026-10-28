import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ActionScope } from './actions.repository';

export async function lockOperationalActor(
  tx: Prisma.TransactionClient,
  scope: ActionScope,
  manage: boolean,
  targets: string[] = [],
) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
  const users = [...new Set([scope.userId, ...targets])].sort();
  await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id IN (${Prisma.join(users.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY user_id FOR SHARE`;
  const member = await tx.membership.findUnique({
    where: {
      userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
    },
    include: { organization: { select: { isActive: true } } },
  });
  if (!member?.isActive || !member.organization.isActive || (manage && member.role !== 'ADMIN'))
    throw new ForbiddenException('Active organizational permission required');
  return member;
}
export function assertOperationalActor(
  member: { userId: string; role: string; capabilities: readonly string[] },
  action: { assignedUserId: string | null },
) {
  if (
    member.role !== 'ADMIN' &&
    (!member.capabilities.includes('EXECUTE_ASSIGNED_ACTIONS') ||
      action.assignedUserId !== member.userId)
  )
    throw new ForbiddenException('Explicit executor capability and persisted assignment required');
}
export async function resolveAssignee(
  tx: Prisma.TransactionClient,
  scope: ActionScope,
  userId: string | null,
) {
  if (!userId) return { assignedUserId: null, assignedName: null };
  const member = await tx.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: scope.organizationId } },
    include: { user: { select: { name: true } } },
  });
  if (!member) throw new NotFoundException();
  if (!member.isActive) throw new ConflictException('Assigned membership is inactive');
  return { assignedUserId: userId, assignedName: member.user.name };
}
