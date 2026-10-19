import { Injectable } from '@nestjs/common';
import type { RiskRegistrations, RiskRegistrationsQuery } from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class RiskRegistrationsRepository {
  constructor(private readonly database: PrismaService) {}

  async snapshot(
    organizationId: string,
    days: RiskRegistrationsQuery['days'],
    generatedAt: string,
  ): Promise<RiskRegistrations | null> {
    return this.database.client.$transaction(
      async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { timezone: true },
        });
        if (!organization) return null;
        const timeZone = organization.timezone;
        // Share Intl's canonical region/offset with PostgreSQL, preserving the original wire value.
        // Abbreviations such as CST/PST otherwise use fixed SQL offsets instead of regional DST.
        const canonicalZone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions()
          .timeZone;
        const offset = /^([+-])(\d{2}):(\d{2})$/.exec(canonicalZone);
        const signedSeconds = offset
          ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 3600 + Number(offset[3]) * 60)
          : 0;
        // Numeric offsets use ISO signs (positive is east of UTC), not PostgreSQL's POSIX text signs.
        const interval = offset
          ? Prisma.sql`make_interval(secs => ${signedSeconds}::double precision)`
          : null;
        const localNow = interval
          ? Prisma.sql`((${generatedAt}::timestamptz AT TIME ZONE 'UTC') + ${interval})::date`
          : Prisma.sql`(${generatedAt}::timestamptz AT TIME ZONE ${canonicalZone})::date`;
        const localCreated = interval
          ? Prisma.sql`(r.created_at + ${interval})::date`
          : Prisma.sql`(r.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${canonicalZone})::date`;
        const firstUtc = interval
          ? Prisma.sql`(b.first_date::timestamp - ${interval})`
          : Prisma.sql`((b.first_date::timestamp AT TIME ZONE ${canonicalZone}) AT TIME ZONE 'UTC')`;
        const afterLastUtc = interval
          ? Prisma.sql`((b.last_date + 1)::timestamp - ${interval})`
          : Prisma.sql`(((b.last_date + 1)::timestamp AT TIME ZONE ${canonicalZone}) AT TIME ZONE 'UTC')`;
        // Prisma stores created_at as UTC timestamp without time zone. Interpret UTC first,
        // then apply the organization's zone; local midnight bounds preserve DST and filter the stored UTC column.
        const rows = await tx.$queryRaw<Array<{ date: string; count: bigint }>>`
        WITH calendar AS (
          SELECT ${localNow} AS last_date
        ), bounds AS (
          SELECT last_date - (${days}::integer - 1) AS first_date, last_date FROM calendar
        ), counts AS (
          SELECT ${localCreated} AS date,
            count(*) AS count
          FROM risks r CROSS JOIN bounds b
          WHERE r.organization_id = ${organizationId}::uuid
            AND r.created_at >= ${firstUtc}
            AND r.created_at < ${afterLastUtc}
          GROUP BY 1
        )
        SELECT to_char(b.first_date + d.day_index, 'YYYY-MM-DD') AS date,
          coalesce(c.count, 0)::bigint AS count
        FROM bounds b CROSS JOIN generate_series(0, ${days}::integer - 1) AS d(day_index)
        LEFT JOIN counts c ON c.date = b.first_date + d.day_index
        ORDER BY d.day_index`;
        const fromDate = rows[0]?.date;
        const toDate = rows.at(-1)?.date;
        if (!fromDate || !toDate) throw new Error('Daily registration calendar unavailable');
        const points = rows.map((row) => ({ date: row.date, count: Number(row.count) }));
        return {
          organizationId,
          generatedAt,
          timeZone,
          fromDate,
          toDate,
          days,
          total: points.reduce((sum, point) => sum + point.count, 0),
          points,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
