import { Injectable } from '@nestjs/common';
import type { OrganizationOverview, WorkspaceJourney } from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { participationProtected } from '../assessments/assessment-eligibility';
import {
  actionDelegation,
  groupDelegation,
  sectorDelegation,
  unitDelegation,
  type OrganizationScope,
} from '../access/delegated-scope';

export type OverviewSnapshot = Omit<OrganizationOverview, 'generatedAt'>;

function statusCounts(
  groups: { isActive: boolean; _count: { _all: number } }[],
): OrganizationOverview['units'] {
  const active = groups.find((group) => group.isActive)?._count._all ?? 0;
  const inactive = groups.find((group) => !group.isActive)?._count._all ?? 0;
  return { total: active + inactive, active, inactive };
}

@Injectable()
export class OverviewRepository {
  constructor(private readonly database: PrismaService) {}

  async getSnapshot(
    organizationId: string,
    delegation?: OrganizationScope['delegation'],
  ): Promise<OverviewSnapshot | null> {
    return this.database.client.$transaction(
      async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { id: true, name: true, isActive: true },
        });
        if (!organization) return null;
        const where = { organizationId };
        const unitWhere = { ...where, ...unitDelegation(delegation) };
        const sectorsWhere = sectorDelegation(delegation);
        const [units, sectors, unitsWithoutSectors] = await Promise.all([
          tx.unit.groupBy({ by: ['isActive'], where: unitWhere, _count: { _all: true } }),
          tx.sector.groupBy({
            by: ['isActive'],
            where: { ...where, ...sectorsWhere },
            _count: { _all: true },
          }),
          tx.unit.count({ where: { ...unitWhere, sectors: { none: sectorsWhere } } }),
        ]);
        return {
          organization,
          units: statusCounts(units),
          sectors: statusCounts(sectors),
          unitsWithoutSectors,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getJourney({
    organizationId,
    userId,
    delegation,
  }: OrganizationScope): Promise<WorkspaceJourney | null> {
    return this.database.client.$transaction(
      async (tx) => {
        const [organization, membership] = await Promise.all([
          tx.organization.findUnique({
            where: { id: organizationId },
            select: { isActive: true, clientClassification: true },
          }),
          tx.membership.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
            select: { isActive: true, role: true },
          }),
        ]);
        if (!organization || !membership?.isActive) return null;

        const active = { organizationId, isActive: true };
        const activeSector = { isActive: true, unit: { isActive: true } };
        const select = { id: true };
        const [unit, sector, preparation, versions, cycle, action] = await Promise.all([
          tx.unit.findFirst({ where: { ...active, ...unitDelegation(delegation) }, select }),
          tx.sector.findFirst({
            where: { ...active, ...activeSector, ...sectorDelegation(delegation) },
            select,
          }),
          !delegation && membership.role === 'ADMIN'
            ? Promise.all([
                tx.employee.findFirst({ where: { ...active, sector: activeSector }, select }),
                tx.assessmentGroup.findFirst({
                  where: { ...active, sector: activeSector },
                  select,
                }),
              ])
            : null,
          tx.instrumentVersion.groupBy({
            by: ['usageMode'],
            where: { organizationId, status: 'PUBLISHED', instrument: { systemKey: null } },
          }),
          tx.assessmentCycle.findFirst({
            where: { organizationId, assessmentGroup: groupDelegation(delegation) },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              status: true,
              eligibleCount: true,
              policyVersion: { select: { minimumResponses: true } },
            },
          }),
          tx.action.findFirst({
            where: {
              organizationId,
              ...actionDelegation(delegation),
              status: { not: 'CANCELLED' },
            },
            select,
          }),
        ]);
        const policy = versions.length
          ? await tx.consolidationPolicyVersion.findFirst({
              where: {
                organizationId,
                status: 'PUBLISHED',
                usageMode: { in: versions.map(({ usageMode }) => usageMode) },
              },
              select,
            })
          : null;

        let result: WorkspaceJourney['result'] = 'PENDING';
        if (cycle?.status === 'CLOSED') {
          const minimum = cycle.policyVersion.minimumResponses;
          const hasEligibleBase = cycle.eligibleCount !== null && cycle.eligibleCount > 0;
          const scope = { organizationId, cycleId: cycle.id };
          const [responses, issued] = await Promise.all([
            tx.assessmentResponse.count({
              where: scope,
              ...(hasEligibleBase ? {} : { take: Math.max(1, minimum ?? 1) }),
            }),
            hasEligibleBase ? tx.assessmentInvite.count({ where: scope }) : 0,
          ]);
          result =
            minimum !== null &&
            participationProtected(cycle.eligibleCount, responses, minimum, issued)
              ? 'PROTECTED'
              : responses === 0
                ? 'NO_RESPONSES'
                : minimum && responses >= minimum
                  ? 'READY'
                  : 'PROTECTED';
        }
        return {
          organizationId,
          demo: organization.clientClassification === 'DEMONSTRATION',
          structure: !organization.isActive
            ? 'INACTIVE'
            : !unit
              ? 'MISSING_UNIT'
              : !sector
                ? 'MISSING_SECTOR'
                : 'READY',
          preparation: preparation && { employees: !!preparation[0], groups: !!preparation[1] },
          instruments: !versions.length
            ? 'MISSING_INSTRUMENT'
            : !policy
              ? 'MISSING_POLICY'
              : 'READY',
          collection: cycle?.status ?? 'MISSING',
          result,
          actions: action ? 'READY' : 'MISSING',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
