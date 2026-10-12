import { Injectable } from '@nestjs/common';
import type { OrganizationOverview } from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

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

  async getSnapshot(organizationId: string): Promise<OverviewSnapshot | null> {
    return this.database.client.$transaction(
      async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { id: true, name: true, isActive: true },
        });
        if (!organization) return null;
        const where = { organizationId };
        const [units, sectors, unitsWithoutSectors] = await Promise.all([
          tx.unit.groupBy({ by: ['isActive'], where, _count: { _all: true } }),
          tx.sector.groupBy({ by: ['isActive'], where, _count: { _all: true } }),
          tx.unit.count({ where: { ...where, sectors: { none: {} } } }),
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
}
