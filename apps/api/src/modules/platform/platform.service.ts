import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  clientRegistrationSchema,
  normalizeCnpj,
  validCnpj,
  platformOverviewSchema,
  type PlatformCapability,
  type PlatformQuery,
  type WriteClientRegistration,
  type WritePlatformGrant,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type Organization } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';

export function registrationDto(record: Organization) {
  return clientRegistrationSchema.parse({
    organizationId: record.id,
    name: record.name,
    fiscalIdentifier: record.fiscalIdentifier,
    normalizedFiscalIdentifier: record.normalizedFiscalIdentifier,
    fiscalState: record.fiscalState,
    clientClassification: record.clientClassification,
    isActive: record.isActive,
    version: record.registrationVersion,
  });
}
export async function fiscalFields(
  tx: Prisma.TransactionClient,
  fiscalIdentifier: string | null,
  organizationId?: string,
) {
  const candidate = fiscalIdentifier ? normalizeCnpj(fiscalIdentifier) : '';
  if (!candidate)
    return {
      fiscalIdentifier: fiscalIdentifier || null,
      fiscalCandidate: null,
      normalizedFiscalIdentifier: null,
      fiscalState: 'MISSING',
    };
  if (!validCnpj(candidate))
    throw new ConflictException('CNPJ inválido. Use a correção assistida.');
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'cnpj:' + candidate}))::text`;
  if (
    await tx.organization.findFirst({
      where: {
        fiscalCandidate: candidate,
        ...(organizationId ? { id: { not: organizationId } } : {}),
      },
      select: { id: true },
    })
  )
    throw new ConflictException('CNPJ já cadastrado ou com conflito pendente.');
  return {
    fiscalIdentifier,
    fiscalCandidate: candidate,
    normalizedFiscalIdentifier: candidate,
    fiscalState: 'VALID',
  };
}
export const legacyOrganizationSelect = {
  id: true,
  name: true,
  fiscalIdentifier: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class PlatformService {
  constructor(private readonly database: PrismaService) {}
  async authorize(tx: Prisma.TransactionClient, userId: string, capability: PlatformCapability) {
    const grant = await tx.platformGrant.findUnique({
      where: { userId_capability: { userId, capability } },
    });
    if (!grant?.isActive) throw new ForbiddenException();
  }
  async capabilities(userId: string) {
    const rows = await this.database.client.platformGrant.findMany({
      where: { userId, isActive: true },
      select: { capability: true },
    });
    return { capabilities: rows.map((row) => row.capability) };
  }
  private async transaction<T>(
    userId: string,
    capability: PlatformCapability,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    write = false,
    existing?: Prisma.TransactionClient,
  ) {
    try {
      if (existing) {
        await this.authorize(existing, userId, capability);
        return operation(existing);
      }
      return await this.database.client.$transaction(
        async (tx) => {
          if (write)
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
          await this.authorize(tx, userId, capability);
          return operation(tx);
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
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
  async overview(userId: string, existing?: Prisma.TransactionClient) {
    return this.transaction(
      userId,
      'READ_OVERVIEW',
      async (tx) => {
        const now = new Date();
        const eligible = { clientClassification: 'CLIENT', fiscalState: 'VALID' };
        const [organizations, employees, classes, states] = await Promise.all([
          tx.organization.groupBy({ by: ['isActive'], where: eligible, _count: { _all: true } }),
          tx.employee.groupBy({
            by: ['isActive'],
            where: { organization: eligible },
            _count: { _all: true },
          }),
          tx.organization.groupBy({ by: ['clientClassification'], _count: { _all: true } }),
          tx.organization.count({ where: { fiscalState: { not: 'VALID' } } }),
        ]);
        const counts = (rows: { isActive: boolean; _count: { _all: number } }[], active: boolean) =>
          rows.find((r) => r.isActive === active)?._count._all ?? 0;
        const total = organizations.reduce((sum, r) => sum + r._count._all, 0);
        return platformOverviewSchema.parse({
          generatedAt: now.toISOString(),
          timeZone: 'America/Sao_Paulo',
          referenceDate: referenceDate('America/Sao_Paulo', now),
          scope: 'PLATFORM_SERVED_CLIENTS',
          countingUnit: 'EMPLOYEE_RECORDS_NOT_UNIQUE_PEOPLE',
          organizations: total,
          validatedCnpjs: total,
          activeClients: counts(organizations, true),
          inactiveClients: counts(organizations, false),
          unclassified:
            classes.find((r) => r.clientClassification === 'UNCLASSIFIED')?._count._all ?? 0,
          demonstrations:
            classes.find((r) => r.clientClassification === 'DEMONSTRATION')?._count._all ?? 0,
          pendingFiscal: states,
          employees: { active: counts(employees, true), inactive: counts(employees, false) },
        });
      },
      false,
      existing,
    );
  }
  async clients(userId: string, query: PlatformQuery, existing?: Prisma.TransactionClient) {
    return this.transaction(
      userId,
      'READ_OVERVIEW',
      async (tx) => {
        const normalizedSearch = query.search ? normalizeCnpj(query.search) : undefined;
        const where: Prisma.OrganizationWhereInput = {
          ...(query.classification
            ? { clientClassification: query.classification }
            : { clientClassification: 'CLIENT', fiscalState: 'VALID' }),
          ...(query.fiscalState ? { fiscalState: query.fiscalState } : {}),
          ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  ...(normalizedSearch
                    ? [{ fiscalCandidate: { contains: normalizedSearch } }]
                    : []),
                ],
              }
            : {}),
        };
        const [records, total] = await Promise.all([
          tx.organization.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.organization.count({ where }),
        ]);
        const grouped = await tx.employee.groupBy({
          by: ['organizationId', 'isActive'],
          where: { organizationId: { in: records.map((r) => r.id) } },
          _count: { _all: true },
        });
        return {
          items: records.map((r) => ({
            ...registrationDto(r),
            employees: {
              active:
                grouped.find((g) => g.organizationId === r.id && g.isActive)?._count._all ?? 0,
              inactive:
                grouped.find((g) => g.organizationId === r.id && !g.isActive)?._count._all ?? 0,
            },
          })),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      false,
      existing,
    );
  }
  async registration(scope: { organizationId: string }) {
    const row = await this.database.client.organization.findUnique({
      where: { id: scope.organizationId },
    });
    if (!row) throw new NotFoundException();
    return registrationDto(row);
  }
  async updateClient(userId: string, organizationId: string, input: WriteClientRegistration) {
    return this.transaction(
      userId,
      'MANAGE_CLIENTS',
      async (tx) => {
        const current = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!current) throw new NotFoundException();
        if (current.registrationVersion !== input.expectedVersion) throw new ConflictException();
        const fiscal = await fiscalFields(tx, input.fiscalIdentifier, organizationId);
        if (input.clientClassification === 'CLIENT' && fiscal.fiscalState !== 'VALID')
          throw new ConflictException('Confirme um CNPJ válido antes do atendimento.');
        const row = await tx.organization.update({
          where: { id: organizationId, registrationVersion: input.expectedVersion },
          data: {
            ...fiscal,
            clientClassification: input.clientClassification,
            isActive: input.isActive,
            registrationVersion: { increment: 1 },
          },
        });
        await tx.organizationRegistrationRevision.create({
          data: {
            organizationId,
            version: row.registrationVersion,
            snapshot: registrationDto(row),
            actorId: userId,
            reason: input.reason,
          },
        });
        await tx.platformAuditEvent.create({
          data: {
            actorId: userId,
            action: 'CLIENT_REGISTRATION_UPDATED',
            resourceId: organizationId,
            reason: input.reason,
          },
        });
        return registrationDto(row);
      },
      true,
    );
  }
  async grants(userId: string, query: { page: number; pageSize: number }) {
    return this.transaction(userId, 'MANAGE_GRANTS', async (tx) => {
      const rows = await tx.platformGrant.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ userId: 'asc' }, { capability: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        items: rows.map(({ user, updatedAt, ...r }) => ({
          ...r,
          ...user,
          updatedAt: updatedAt.toISOString(),
        })),
        total: await tx.platformGrant.count(),
        ...query,
      };
    });
  }
  async writeGrant(userId: string, input: WritePlatformGrant) {
    return this.transaction(
      userId,
      'MANAGE_GRANTS',
      async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })))
          throw new NotFoundException();
        const key = { userId: input.userId, capability: input.capability };
        const current = await tx.platformGrant.findUnique({ where: { userId_capability: key } });
        if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
        if (
          current?.isActive &&
          !input.isActive &&
          input.capability === 'MANAGE_GRANTS' &&
          (await tx.platformGrant.count({
            where: { capability: 'MANAGE_GRANTS', isActive: true },
          })) <= 1
        )
          throw new ConflictException('Preserve um gestor da plataforma.');
        const row = await tx.platformGrant.upsert({
          where: { userId_capability: key },
          create: { ...key, isActive: input.isActive },
          update: { isActive: input.isActive, version: { increment: 1 } },
          include: { user: { select: { name: true, email: true } } },
        });
        await tx.platformAuditEvent.create({
          data: {
            actorId: userId,
            subjectId: input.userId,
            action: input.isActive ? 'PLATFORM_GRANT_ENABLED' : 'PLATFORM_GRANT_REVOKED',
            reason: input.reason,
          },
        });
        const { user, updatedAt, ...rest } = row;
        return { ...rest, ...user, updatedAt: updatedAt.toISOString() };
      },
      true,
    );
  }
}
