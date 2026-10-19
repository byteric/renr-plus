import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { RiskOverview } from '@renr/contracts';

type Counts = RiskOverview['totals'];
type UnitCounts = {
  unitId: string;
  name: string;
  isActive: boolean;
  total: bigint;
  draft: bigint;
  registered: bigint;
  withEvaluation: bigint;
};

@Injectable()
export class RiskOverviewRepository {
  constructor(private readonly database: PrismaService) {}
  async snapshot(organizationId: string): Promise<Omit<RiskOverview, 'generatedAt'> | null> {
    return this.database.client.$transaction(
      async (tx) => {
        if (
          !(await tx.organization.findUnique({
            where: { id: organizationId },
            select: { id: true },
          }))
        )
          return null;
        // EXISTS avoids multiplying a risk by its number of evaluations. No individual diagnostic data is read.
        const rows = await tx.$queryRaw<UnitCounts[]>`
        SELECT u.id::text AS "unitId", u.name, u.is_active AS "isActive", count(*) AS total,
          count(*) FILTER (WHERE r.status = 'DRAFT') AS draft,
          count(*) FILTER (WHERE r.status = 'REGISTERED') AS registered,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM risk_evaluations e WHERE e.organization_id = r.organization_id AND e.risk_id = r.id)) AS "withEvaluation"
        FROM risks r
        JOIN assessment_groups g ON g.organization_id = r.organization_id AND g.id = r.assessment_group_id
        JOIN sectors s ON s.organization_id = g.organization_id AND s.id = g.sector_id
        JOIN units u ON u.organization_id = s.organization_id AND u.id = s.unit_id
        WHERE r.organization_id = ${organizationId}::uuid AND r.status IN ('DRAFT', 'REGISTERED')
        GROUP BY u.id, u.name, u.is_active
        ORDER BY total DESC, u.name ASC, u.id ASC`;
        const totals: Counts = {
          total: 0,
          draft: 0,
          registered: 0,
          withEvaluation: 0,
          withoutEvaluation: 0,
        };
        for (const row of rows) {
          totals.total += Number(row.total);
          totals.draft += Number(row.draft);
          totals.registered += Number(row.registered);
          totals.withEvaluation += Number(row.withEvaluation);
        }
        totals.withoutEvaluation = totals.total - totals.withEvaluation;
        const units: RiskOverview['units'] = rows.slice(0, 8).map((row) => ({
          kind: 'UNIT',
          unitId: row.unitId,
          name: row.name,
          isActive: row.isActive,
          total: Number(row.total),
          draft: Number(row.draft),
          registered: Number(row.registered),
        }));
        if (rows.length > 8)
          units.push({
            kind: 'OTHERS',
            name: 'Outras unidades',
            total: rows.slice(8).reduce((sum, row) => sum + Number(row.total), 0),
            draft: rows.slice(8).reduce((sum, row) => sum + Number(row.draft), 0),
            registered: rows.slice(8).reduce((sum, row) => sum + Number(row.registered), 0),
          });
        return { organizationId, totals, units };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
