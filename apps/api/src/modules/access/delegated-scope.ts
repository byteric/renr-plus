import type { MembershipScope } from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';

export type OrganizationScope = {
  userId: string;
  organizationId: string;
  delegation?: readonly MembershipScope[];
};

export function unitDelegation(delegation: OrganizationScope['delegation']) {
  return delegation ? { id: { in: [...new Set(delegation.map(({ unitId }) => unitId))] } } : {};
}

export function sectorDelegation(delegation: OrganizationScope['delegation']) {
  return delegation
    ? {
        OR: delegation.map(({ unitId, sectorId }) => ({
          unitId,
          ...(sectorId ? { id: sectorId } : {}),
        })),
      }
    : {};
}

export function groupDelegation(delegation: OrganizationScope['delegation']) {
  return delegation ? { sector: sectorDelegation(delegation) } : {};
}

export function riskDelegation(delegation: OrganizationScope['delegation']): Prisma.RiskWhereInput {
  return delegation ? { assessmentGroup: groupDelegation(delegation) } : {};
}

export function actionDelegation(
  delegation: OrganizationScope['delegation'],
): Prisma.ActionWhereInput {
  return delegation ? { risk: riskDelegation(delegation) } : {};
}

export function methodVersionDelegation(
  delegation: OrganizationScope['delegation'],
): Prisma.EvaluationMethodVersionWhereInput {
  return delegation
    ? {
        status: 'PUBLISHED',
        technicalEvaluations: { some: { risk: riskDelegation(delegation) } },
      }
    : {};
}

export function containsDelegatedScope(
  delegation: OrganizationScope['delegation'],
  unitId: string | null,
  sectorId: string | null,
): boolean {
  return (
    !delegation ||
    delegation.some(
      (scope) =>
        scope.unitId === unitId && (scope.sectorId === null || scope.sectorId === sectorId),
    )
  );
}

/** Column expressions are static SQL. Grant IDs are passed as query parameters. */
export function delegatedSql(
  delegation: OrganizationScope['delegation'],
  unitColumn: Prisma.Sql,
  sectorColumn: Prisma.Sql,
): Prisma.Sql {
  if (!delegation) return Prisma.empty;
  if (!delegation.length) return Prisma.sql`AND FALSE`;
  const conditions = delegation.map(
    ({ unitId, sectorId }) => Prisma.sql`(
    ${unitColumn} = ${unitId}
    ${sectorId ? Prisma.sql`AND ${sectorColumn} = ${sectorId}` : Prisma.empty}
  )`,
  );
  return Prisma.sql`AND (${Prisma.join(conditions, ' OR ')})`;
}
