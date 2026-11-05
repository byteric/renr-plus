import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  employeeSchema,
  employmentPeriodSchema,
  hrProfileSchema,
  remunerationSchema,
  vacationPeriodSchema,
  settlementParametersSchema,
  settlementRequestSchema,
  settlementResultSchema,
  vacationEntitlementDaysSchema,
  type UpdateHrProfile,
  type WriteEmploymentPeriod,
  type WriteRemuneration,
  type WriteVacationPeriod,
  type WorkforceQuery,
  type SettlementRequest,
} from '@renr/contracts';
import type { HrCapability } from '../access/capabilities';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';
import { calculateCltSettlement, CltInputError, CLT_POLICY_VERSION } from './clt-calculator';
import { peopleDataAvailable } from './people-availability';

export type PeopleScope = { userId: string; organizationId: string };
export async function requirePeopleCapability(
  tx: Prisma.TransactionClient,
  scope: PeopleScope,
  capabilities: HrCapability[],
) {
  const member = await tx.membership.findUnique({ where: { userId_organizationId: scope } });
  if (!member?.isActive) throw new NotFoundException();
  if (!capabilities.some((capability) => member.hrCapabilities.includes(capability)))
    throw new ForbiddenException();
}
const profileRead: HrCapability[] = ['HR_PROFILE_READ', 'HR_PROFILE_MANAGE'];
const compensationRead: HrCapability[] = ['HR_COMPENSATION_READ', 'HR_COMPENSATION_MANAGE'];
const date = (v: string) => new Date(v + 'T00:00:00Z');
const iso = (v: Date) => v.toISOString().slice(0, 10);
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(v, (_k, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as Prisma.InputJsonValue;
type Page = { page: number; pageSize: number };
type HistoryWrite = { reason: string; source: string; expectedVersion: number };
const missingProfile = (scope: PeopleScope, id: string) => ({
  organizationId: scope.organizationId,
  employeeId: id,
  version: 0,
  birthDate: null,
  gender: null,
  genderDescription: null,
  vacationHistoryKnown: false,
  complexLeaveHistoryKnown: false,
  hasComplexLeaves: false,
  followUp: false,
  source: null,
  updatedAt: null,
});
@Injectable()
export class PeopleService {
  constructor(private readonly database: PrismaService) {}
  private async operation<T>(
    scope: PeopleScope,
    capabilities: HrCapability[],
    employeeId: string | undefined,
    write: boolean,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          if (write)
            await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR UPDATE`;
          await requirePeopleCapability(tx, scope, capabilities);
          if (!peopleDataAvailable(this.database, scope.organizationId))
            throw new ForbiddenException();
          if (
            employeeId &&
            !(await tx.employee.findUnique({
              where: {
                organizationId_id: { organizationId: scope.organizationId, id: employeeId },
              },
              select: { id: true },
            }))
          )
            throw new NotFoundException();
          return fn(tx);
        },
        {
          isolationLevel: write
            ? Prisma.TransactionIsolationLevel.ReadCommitted
            : Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034', 'P2025'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
  private async revision(
    tx: Prisma.TransactionClient,
    scope: PeopleScope,
    employeeId: string,
    kind: string,
    id: string,
    version: number,
    snapshot: unknown,
    reason: string,
    financial = false,
  ) {
    await tx.employeeHrRevision.create({
      data: {
        organizationId: scope.organizationId,
        employeeId,
        resourceType: kind,
        resourceId: id,
        version,
        snapshot: json(snapshot),
        reason,
        financial,
        actorId: scope.userId,
      },
    });
    // Free-form source, birth dates, pay and private HR reasons stay in the restricted revision.
    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: 'HR_RECORD_UPDATED',
        resourceId: employeeId,
        resourceType: 'employee',
      },
    });
  }
  async employees(scope: PeopleScope, query: WorkforceQuery) {
    return this.operation(scope, profileRead, undefined, false, async (tx) => {
      await this.validateFilters(tx, scope, query);
      const where: Prisma.EmployeeWhereInput = {
        organizationId: scope.organizationId,
        unitId: query.unitId,
        sectorId: query.sectorId,
        isActive: query.isActive,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { internalIdentifier: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.employee.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
          include: { unit: { select: { name: true } }, sector: { select: { name: true } } },
        }),
        tx.employee.count({ where }),
      ]);
      return {
        items: items.map((r) =>
          employeeSchema.parse({
            id: r.id,
            organizationId: r.organizationId,
            name: r.name,
            internalIdentifier: r.internalIdentifier,
            unitId: r.unitId,
            sectorId: r.sectorId,
            unitName: r.unit.name,
            sectorName: r.sector.name,
            linkedUserId: r.linkedUserId,
            isActive: r.isActive,
            version: r.version,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          }),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  private async validateFilters(
    tx: Prisma.TransactionClient,
    scope: PeopleScope,
    query: Pick<WorkforceQuery, 'unitId' | 'sectorId'>,
  ) {
    if (
      query.unitId &&
      !(await tx.unit.findFirst({
        where: { id: query.unitId, organizationId: scope.organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    if (query.sectorId) {
      const sector = await tx.sector.findFirst({
        where: { id: query.sectorId, organizationId: scope.organizationId },
        select: { unitId: true },
      });
      if (!sector) throw new NotFoundException();
      if (query.unitId && query.unitId !== sector.unitId)
        throw new BadRequestException('Confira unidade e setor.');
    }
  }
  async profile(scope: PeopleScope, employeeId: string) {
    return this.operation(scope, profileRead, employeeId, false, async (tx) => {
      const row = await tx.employeeHrProfile.findUnique({
        where: { organizationId_employeeId: { organizationId: scope.organizationId, employeeId } },
        omit: { updatedById: true },
      });
      if (!row) return missingProfile(scope, employeeId);
      return hrProfileSchema.parse({
        ...row,
        birthDate: row.birthDate ? iso(row.birthDate) : null,
        updatedAt: row.updatedAt.toISOString(),
      });
    });
  }
  async writeProfile(scope: PeopleScope, employeeId: string, input: UpdateHrProfile) {
    return this.operation(scope, ['HR_PROFILE_MANAGE'], employeeId, true, async (tx) => {
      const key = { organizationId: scope.organizationId, employeeId };
      const row = await tx.employeeHrProfile.findUnique({
        where: { organizationId_employeeId: key },
      });
      if ((row?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: scope.organizationId },
        select: { timezone: true },
      });
      if (input.birthDate) {
        const earliest = await tx.employmentPeriod.findFirst({
          where: key,
          orderBy: { startsOn: 'asc' },
          select: { startsOn: true },
        });
        if (
          input.birthDate > referenceDate(org.timezone, new Date()) ||
          (earliest && input.birthDate > iso(earliest.startsOn))
        )
          throw new BadRequestException('Data de nascimento incompatível.');
      }
      const data = {
        gender: input.gender,
        genderDescription: input.genderDescription,
        vacationHistoryKnown: input.vacationHistoryKnown,
        complexLeaveHistoryKnown: input.complexLeaveHistoryKnown,
        hasComplexLeaves: input.hasComplexLeaves,
        followUp: input.followUp,
        source: input.source,
        birthDate: input.birthDate ? date(input.birthDate) : null,
        updatedById: scope.userId,
      };
      const record = await tx.employeeHrProfile.upsert({
        where: { organizationId_employeeId: key },
        create: { ...key, ...data },
        update: { ...data, version: { increment: 1 } },
        omit: { updatedById: true },
      });
      const result = hrProfileSchema.parse({
        ...record,
        birthDate: record.birthDate ? iso(record.birthDate) : null,
        updatedAt: record.updatedAt.toISOString(),
      });
      await this.revision(
        tx,
        scope,
        employeeId,
        'hr-profile',
        employeeId,
        record.version,
        result,
        input.reason,
      );
      return result;
    });
  }
  async history(scope: PeopleScope, employeeId: string, page: Page) {
    return this.operation(scope, profileRead, employeeId, false, async (tx) => {
      const member = await tx.membership.findUniqueOrThrow({
        where: { userId_organizationId: scope },
        select: { hrCapabilities: true },
      });
      const financial = compensationRead.some((capability) =>
        member.hrCapabilities.includes(capability),
      );
      const where = {
        organizationId: scope.organizationId,
        employeeId,
        ...(!financial ? { financial: false } : {}),
      };
      const rows = await tx.employeeHrRevision.findMany({
        where,
        select: {
          id: true,
          resourceType: true,
          resourceId: true,
          version: true,
          snapshot: true,
          reason: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: await tx.employeeHrRevision.count({ where }),
        ...page,
      };
    });
  }
  async list(
    scope: PeopleScope,
    employeeId: string,
    kind: 'employment' | 'remuneration' | 'vacation',
    page: Page,
  ) {
    return this.operation(
      scope,
      kind === 'remuneration' ? compensationRead : profileRead,
      employeeId,
      false,
      async (tx) => {
        const where = { organizationId: scope.organizationId, employeeId };
        const paging = { skip: (page.page - 1) * page.pageSize, take: page.pageSize };
        if (kind === 'employment') {
          const rows = await tx.employmentPeriod.findMany({
            where,
            ...paging,
            omit: { updatedById: true },
            orderBy: [{ startsOn: 'desc' }, { id: 'desc' }],
          });
          return {
            items: rows.map((r) =>
              employmentPeriodSchema.parse({
                ...r,
                startsOn: iso(r.startsOn),
                endsOn: r.endsOn ? iso(r.endsOn) : null,
                updatedAt: r.updatedAt.toISOString(),
              }),
            ),
            total: await tx.employmentPeriod.count({ where }),
            ...page,
          };
        }
        if (kind === 'remuneration') {
          const rows = await tx.employeeRemuneration.findMany({
            where,
            ...paging,
            omit: { updatedById: true },
            orderBy: [{ competence: 'desc' }, { id: 'desc' }],
          });
          return {
            items: rows.map((r) =>
              remunerationSchema.parse({
                ...r,
                salaryCents: r.salaryCents.toString(),
                updatedAt: r.updatedAt.toISOString(),
              }),
            ),
            total: await tx.employeeRemuneration.count({ where }),
            ...page,
          };
        }
        const rows = await tx.employeeVacationPeriod.findMany({
          where,
          ...paging,
          omit: { updatedById: true },
          orderBy: [{ acquisitionStart: 'desc' }, { id: 'desc' }],
        });
        return {
          items: rows.map((r) =>
            vacationPeriodSchema.parse({
              ...r,
              acquisitionStart: iso(r.acquisitionStart),
              acquisitionEnd: iso(r.acquisitionEnd),
              concessionDeadline: iso(r.concessionDeadline),
              updatedAt: r.updatedAt.toISOString(),
            }),
          ),
          total: await tx.employeeVacationPeriod.count({ where }),
          ...page,
        };
      },
    );
  }
  async writeEmployment(
    scope: PeopleScope,
    employeeId: string,
    id: string | undefined,
    input: WriteEmploymentPeriod,
  ) {
    return this.operation(scope, ['HR_PROFILE_MANAGE'], employeeId, true, async (tx) => {
      const where = { organizationId: scope.organizationId, employeeId };
      const current = id ? await tx.employmentPeriod.findFirst({ where: { ...where, id } }) : null;
      if (id && !current) throw new NotFoundException();
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const profile = await tx.employeeHrProfile.findUnique({
        where: { organizationId_employeeId: where },
        select: { birthDate: true },
      });
      if (profile?.birthDate && input.startsOn < iso(profile.birthDate))
        throw new BadRequestException('Vínculo anterior ao nascimento.');
      const overlaps = await tx.employmentPeriod.count({
        where: {
          ...where,
          ...(id ? { id: { not: id } } : {}),
          startsOn: { lte: date(input.endsOn ?? '2199-12-31') },
          OR: [{ endsOn: null }, { endsOn: { gte: date(input.startsOn) } }],
        },
      });
      if (overlaps) throw new ConflictException('Existe um vínculo sobreposto.');
      const data = {
        startsOn: date(input.startsOn),
        endsOn: input.endsOn ? date(input.endsOn) : null,
        source: input.source,
        updatedById: scope.userId,
      };
      const r = id
        ? await tx.employmentPeriod.update({
            where: { id, version: input.expectedVersion },
            data: { ...data, version: { increment: 1 } },
            omit: { updatedById: true },
          })
        : await tx.employmentPeriod.create({
            data: { ...where, ...data },
            omit: { updatedById: true },
          });
      const result = employmentPeriodSchema.parse({
        ...r,
        startsOn: iso(r.startsOn),
        endsOn: r.endsOn ? iso(r.endsOn) : null,
        updatedAt: r.updatedAt.toISOString(),
      });
      await this.revision(
        tx,
        scope,
        employeeId,
        'employment',
        r.id,
        r.version,
        result,
        input.reason,
      );
      return result;
    });
  }
  async writeRemuneration(
    scope: PeopleScope,
    employeeId: string,
    id: string | undefined,
    input: WriteRemuneration,
  ) {
    return this.operation(scope, ['HR_COMPENSATION_MANAGE'], employeeId, true, async (tx) => {
      const where = { organizationId: scope.organizationId, employeeId };
      const current = id
        ? await tx.employeeRemuneration.findFirst({ where: { ...where, id } })
        : null;
      if (id && !current) throw new NotFoundException();
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const data = {
        competence: input.competence,
        salaryCents: BigInt(input.salaryCents),
        remunerationType: input.remunerationType,
        source: input.source,
        updatedById: scope.userId,
      };
      const r = id
        ? await tx.employeeRemuneration.update({
            where: { id, version: input.expectedVersion },
            data: { ...data, version: { increment: 1 } },
            omit: { updatedById: true },
          })
        : await tx.employeeRemuneration.create({
            data: { ...where, ...data },
            omit: { updatedById: true },
          });
      const result = remunerationSchema.parse({
        ...r,
        salaryCents: r.salaryCents.toString(),
        updatedAt: r.updatedAt.toISOString(),
      });
      await this.revision(
        tx,
        scope,
        employeeId,
        'remuneration',
        r.id,
        r.version,
        result,
        input.reason,
        true,
      );
      return result;
    });
  }
  async writeVacation(
    scope: PeopleScope,
    employeeId: string,
    id: string | undefined,
    input: WriteVacationPeriod,
  ) {
    return this.operation(scope, ['HR_PROFILE_MANAGE'], employeeId, true, async (tx) => {
      const where = { organizationId: scope.organizationId, employeeId };
      const current = id
        ? await tx.employeeVacationPeriod.findFirst({ where: { ...where, id } })
        : null;
      if (id && !current) throw new NotFoundException();
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const overlaps = await tx.employeeVacationPeriod.count({
        where: {
          ...where,
          ...(id ? { id: { not: id } } : {}),
          acquisitionStart: { lte: date(input.acquisitionEnd) },
          acquisitionEnd: { gte: date(input.acquisitionStart) },
        },
      });
      if (overlaps) throw new ConflictException('Período aquisitivo sobreposto.');
      let used = 0;
      const ordered = [...input.uses].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      for (let i = 0; i < ordered.length; i++) {
        const use = ordered[i]!;
        if (use.startsOn < input.acquisitionStart || (i && ordered[i - 1]!.endsOn >= use.startsOn))
          throw new BadRequestException('Confira a utilização de férias.');
        used += (date(use.endsOn).getTime() - date(use.startsOn).getTime()) / 86400000 + 1;
      }
      // Existing entitlement can include sold days/corrections; do not infer their legal cause.
      if (used + input.balanceDays > input.entitlementDays)
        throw new BadRequestException('Saldo e utilização excedem o direito registrado.');
      const data = {
        entitlementDays: input.entitlementDays,
        balanceDays: input.balanceDays,
        unjustifiedAbsences: input.unjustifiedAbsences,
        historyKnown: input.historyKnown,
        uses: input.uses,
        source: input.source,
        acquisitionStart: date(input.acquisitionStart),
        acquisitionEnd: date(input.acquisitionEnd),
        concessionDeadline: date(input.concessionDeadline),
        updatedById: scope.userId,
      };
      const r = id
        ? await tx.employeeVacationPeriod.update({
            where: { id, version: input.expectedVersion },
            data: { ...data, version: { increment: 1 } },
            omit: { updatedById: true },
          })
        : await tx.employeeVacationPeriod.create({
            data: { ...where, ...data },
            omit: { updatedById: true },
          });
      const result = vacationPeriodSchema.parse({
        ...r,
        acquisitionStart: iso(r.acquisitionStart),
        acquisitionEnd: iso(r.acquisitionEnd),
        concessionDeadline: iso(r.concessionDeadline),
        updatedAt: r.updatedAt.toISOString(),
      });
      await this.revision(tx, scope, employeeId, 'vacation', r.id, r.version, result, input.reason);
      return result;
    });
  }
  async settlement(scope: PeopleScope, employeeId: string, input: SettlementRequest) {
    return this.operation(scope, compensationRead, employeeId, false, async (tx) => {
      const employee = await tx.employee.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: scope.organizationId, id: employeeId } },
        include: {
          hrProfile: true,
          employmentPeriods: {
            where: {
              startsOn: { lte: date(input.terminationDate) },
              OR: [{ endsOn: null }, { endsOn: { gte: date(input.terminationDate) } }],
            },
            take: 2,
          },
          remunerations: { where: { competence: input.terminationDate.slice(0, 7) } },
        },
      });
      const period = employee.employmentPeriods[0],
        salary = employee.remunerations[0];
      if (!period || employee.employmentPeriods.length !== 1 || !salary)
        throw new ConflictException('Registre um vínculo vigente e a remuneração da competência.');
      const acquired = await tx.employeeVacationPeriod.findMany({
        where: {
          organizationId: scope.organizationId,
          employeeId,
          acquisitionStart: { gte: period.startsOn },
          acquisitionEnd: { lte: date(input.terminationDate) },
        },
        orderBy: { acquisitionStart: 'asc' },
        take: 301,
      });
      if (acquired.length > 300)
        throw new ConflictException('Revise a extensão do histórico de férias do vínculo.');
      const supported = acquired.filter(
        (row) => vacationEntitlementDaysSchema.safeParse(row.entitlementDays).success,
      );
      const historyNeedsReview = supported.length !== acquired.length;
      try {
        const result = calculateCltSettlement({
          ...input,
          admissionDate: iso(period.startsOn),
          monthlySalaryCents: salary.salaryCents.toString(),
          remunerationType: salary.remunerationType as 'FIXED' | 'VARIABLE',
          vacationHistoryKnown:
            (employee.hrProfile?.vacationHistoryKnown ?? false) && !historyNeedsReview,
          complexLeaveHistoryKnown: employee.hrProfile?.complexLeaveHistoryKnown ?? false,
          hasComplexLeaves: employee.hrProfile?.hasComplexLeaves ?? false,
          acquiredVacationPeriods: supported.map((r) => ({
            acquisitionStart: iso(r.acquisitionStart),
            entitlementDays: r.entitlementDays,
            balanceDays: r.balanceDays,
            concessionDeadline: iso(r.concessionDeadline),
            historyKnown: r.historyKnown,
          })),
        });
        return settlementResultSchema.parse({
          status: result.status,
          noticeDays: result.noticeDays,
          projectedTerminationDate: result.projectedTerminationDate,
          items: result.items,
          subtotalCents: result.subtotalCents,
          grossTotalCents: result.grossTotalCents,
          fgtsPenaltyCents: result.fgtsPenaltyCents,
          missingInputs: result.missingInputs,
          reasons: historyNeedsReview
            ? [
                ...result.reasons,
                'O histórico contém um direito de férias fora das faixas suportadas. Revise o período aquisitivo.',
              ]
            : result.reasons,
          policyVersion: CLT_POLICY_VERSION,
          scenario: 'CLT_FIXED_DISMISSAL_INDEMNIFIED',
          referenceDate: input.terminationDate,
        });
      } catch (error) {
        if (error instanceof CltInputError) throw new BadRequestException(error.message);
        throw error;
      }
    });
  }
  async saveSettlementParameters(
    scope: PeopleScope,
    employeeId: string,
    input: HistoryWrite & { parameters: SettlementRequest },
  ) {
    return this.operation(scope, ['HR_COMPENSATION_MANAGE'], employeeId, true, async (tx) => {
      const key = {
        organizationId: scope.organizationId,
        employeeId,
        referenceDate: date(input.parameters.terminationDate),
      };
      const current = await tx.employeeSettlementParameters.findUnique({
        where: { organizationId_employeeId_referenceDate: key },
      });
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const r = await tx.employeeSettlementParameters.upsert({
        where: { organizationId_employeeId_referenceDate: key },
        create: {
          ...key,
          input: json(input.parameters),
          source: input.source,
          updatedById: scope.userId,
        },
        update: {
          input: json(input.parameters),
          source: input.source,
          updatedById: scope.userId,
          version: { increment: 1 },
        },
      });
      const result = settlementParametersSchema.parse({
        organizationId: r.organizationId,
        employeeId: r.employeeId,
        referenceDate: iso(r.referenceDate),
        parameters: settlementRequestSchema.parse(r.input),
        version: r.version,
        source: r.source,
        updatedAt: r.updatedAt.toISOString(),
      });
      await this.revision(
        tx,
        scope,
        employeeId,
        'settlement-parameters',
        employeeId,
        r.version,
        result,
        input.reason,
        true,
      );
      return result;
    });
  }
  async settlementParameters(scope: PeopleScope, employeeId: string, reference: string) {
    return this.operation(scope, compensationRead, employeeId, false, async (tx) => {
      const row = await tx.employeeSettlementParameters.findUnique({
        where: {
          organizationId_employeeId_referenceDate: {
            organizationId: scope.organizationId,
            employeeId,
            referenceDate: date(reference),
          },
        },
      });
      if (!row) return null;
      return settlementParametersSchema.parse({
        organizationId: row.organizationId,
        employeeId: row.employeeId,
        referenceDate: reference,
        parameters: settlementRequestSchema.parse(row.input),
        version: row.version,
        source: row.source,
        updatedAt: row.updatedAt.toISOString(),
      });
    });
  }
}
