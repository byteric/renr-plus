import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  companyGroupEligibleClientPageSchema,
  companyGroupGrantPageSchema,
  companyGroupGrantSchema,
  companyGroupListSchema,
  companyGroupOverviewSchema,
  managedCompanyGroupPageSchema,
  managedCompanyGroupSchema,
  normalizeCnpj,
  type CompanyGroupEligibleClientQuery,
  type CreateCompanyGroup,
  type UpdateCompanyGroup,
  type WriteCompanyGroupGrant,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type PlatformCapability } from '../../generated/prisma/client';
import { companyGroupMetrics } from './company-group-metrics';

type Page = { page: number; pageSize: number };
const orderBy = [{ name: 'asc' }, { id: 'asc' }] as const;
const summary = { id: true, name: true } as const;
const company = { ...summary, fiscalIdentifier: true } as const;
const activeCompany = {
  isActive: true,
  OR: [
    { clientClassification: 'CLIENT', fiscalState: 'VALID' },
    { clientClassification: 'DEMONSTRATION', fiscalState: { in: ['VALID', 'MISSING'] } },
  ],
} satisfies Prisma.OrganizationWhereInput;
const managedGroup = {
  ...summary,
  version: true,
  clients: { select: { organization: { select: company } }, orderBy: { organizationId: 'asc' } },
} satisfies Prisma.CompanyGroupSelect;
const grantSelect = { isActive: true, version: true, user: { select: { email: true } } } as const;

function toGroup({
  clients,
  ...item
}: Prisma.CompanyGroupGetPayload<{ select: typeof managedGroup }>) {
  const organizations = clients.map(({ organization }) => organization);
  return { ...item, organizations, organizationIds: organizations.map(({ id }) => id) };
}

function toGrant(grant: Prisma.CompanyGroupGrantGetPayload<{ select: typeof grantSelect }>) {
  return { email: grant.user.email, active: grant.isActive, version: grant.version };
}

function pagination({ page, pageSize }: Page) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

async function authorizePlatform(
  tx: Prisma.TransactionClient,
  userId: string,
  capabilities: PlatformCapability[],
) {
  const allowed = await tx.platformGrant.findFirst({
    where: { userId, isActive: true, capability: { in: capabilities } },
    select: { userId: true },
  });
  if (!allowed) throw new ForbiddenException();
}

async function verifyCompanies(tx: Prisma.TransactionClient, organizationIds: string[]) {
  const total = await tx.organization.count({
    where: { ...activeCompany, id: { in: organizationIds } },
  });
  if (total !== organizationIds.length)
    throw new ConflictException(
      'Inclua somente clientes com CNPJ validado ou empresas de demonstração ativas.',
    );
}

@Injectable()
export class CompanyGroupsService {
  constructor(private readonly database: PrismaService) {}

  async list(userId: string) {
    const items = await this.database.client.companyGroup.findMany({
      where: { grants: { some: { userId, isActive: true } } },
      select: summary,
      orderBy: [...orderBy],
    });
    return companyGroupListSchema.parse({ items });
  }

  async overview(userId: string, id: string, organizationId?: string) {
    return this.read(async (tx) => {
      const group = await tx.companyGroup.findFirst({
        where: { id, grants: { some: { userId, isActive: true } } },
        select: {
          ...summary,
          clients: {
            where: { ...(organizationId && { organizationId }), organization: activeCompany },
            select: { organization: { select: company } },
            orderBy: { organization: { name: 'asc' } },
          },
        },
      });
      if (!group || (organizationId && !group.clients.length)) throw new NotFoundException();

      const companies = group.clients.map(({ organization }) => organization);
      const metrics = await companyGroupMetrics(
        tx,
        companies.map(({ id: companyId }) => companyId),
      );
      return companyGroupOverviewSchema.parse({
        group: { id: group.id, name: group.name },
        totals: metrics.totals,
        companies: companies.map((item) => ({ ...item, metrics: metrics.companies.get(item.id) })),
      });
    });
  }

  async management(userId: string, page: Page) {
    return this.read(async (tx) => {
      await authorizePlatform(tx, userId, ['MANAGE_CLIENTS', 'MANAGE_GRANTS']);
      const items = await tx.companyGroup.findMany({
        ...pagination(page),
        select: managedGroup,
        orderBy: [...orderBy],
      });
      return managedCompanyGroupPageSchema.parse({
        ...page,
        total: await tx.companyGroup.count(),
        items: items.map(toGroup),
      });
    });
  }

  async eligibleClients(userId: string, { search, ...page }: CompanyGroupEligibleClientQuery) {
    return this.read(async (tx) => {
      await authorizePlatform(tx, userId, ['MANAGE_CLIENTS']);
      const fiscal = search && normalizeCnpj(search);
      const where: Prisma.OrganizationWhereInput = {
        AND: [
          activeCompany,
          ...(search
            ? [
                {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    ...(fiscal ? [{ normalizedFiscalIdentifier: { contains: fiscal } }] : []),
                  ],
                },
              ]
            : []),
        ],
      };
      const items = await tx.organization.findMany({
        where,
        select: company,
        orderBy: [...orderBy],
        ...pagination(page),
      });
      return companyGroupEligibleClientPageSchema.parse({
        ...page,
        total: await tx.organization.count({ where }),
        items,
      });
    });
  }

  async create(userId: string, input: CreateCompanyGroup) {
    return this.write(userId, 'MANAGE_CLIENTS', async (tx) => {
      await verifyCompanies(tx, input.organizationIds);
      const group = await tx.companyGroup.create({
        data: {
          name: input.name,
          clients: {
            createMany: {
              data: input.organizationIds.map((organizationId) => ({ organizationId })),
            },
          },
        },
        select: managedGroup,
      });
      await tx.platformAuditEvent.create({
        data: {
          actorId: userId,
          resourceId: group.id,
          action: 'COMPANY_GROUP_CREATED',
          reason: input.reason,
        },
      });
      return managedCompanyGroupSchema.parse(toGroup(group));
    });
  }

  async update(userId: string, id: string, input: UpdateCompanyGroup) {
    return this.write(userId, 'MANAGE_CLIENTS', async (tx) => {
      const current = await tx.companyGroup.findUnique({ where: { id }, select: managedGroup });
      if (!current) throw new NotFoundException();
      if (current.version !== input.version) throw new ConflictException();

      const existing = new Set(current.clients.map(({ organization }) => organization.id));
      const added = input.organizationIds.filter((companyId) => !existing.has(companyId));
      if (added.length) await verifyCompanies(tx, added);
      const group = await tx.companyGroup.update({
        where: { id, version: input.version },
        data: {
          name: input.name,
          version: { increment: 1 },
          clients: {
            deleteMany: { organizationId: { notIn: input.organizationIds } },
            ...(added.length && {
              createMany: { data: added.map((organizationId) => ({ organizationId })) },
            }),
          },
        },
        select: managedGroup,
      });
      await tx.platformAuditEvent.create({
        data: {
          actorId: userId,
          resourceId: id,
          action: 'COMPANY_GROUP_UPDATED',
          reason: input.reason,
        },
      });
      return managedCompanyGroupSchema.parse(toGroup(group));
    });
  }

  async grants(userId: string, groupId: string, page: Page) {
    return this.read(async (tx) => {
      await authorizePlatform(tx, userId, ['MANAGE_GRANTS']);
      if (!(await tx.companyGroup.findUnique({ where: { id: groupId }, select: { id: true } })))
        throw new NotFoundException();
      const items = await tx.companyGroupGrant.findMany({
        where: { groupId },
        select: grantSelect,
        orderBy: { user: { email: 'asc' } },
        ...pagination(page),
      });
      return companyGroupGrantPageSchema.parse({
        ...page,
        total: await tx.companyGroupGrant.count({ where: { groupId } }),
        items: items.map(toGrant),
      });
    });
  }

  async writeGrant(userId: string, groupId: string, input: WriteCompanyGroupGrant) {
    return this.write(userId, 'MANAGE_GRANTS', async (tx) => {
      const group = await tx.companyGroup.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
      const recipient = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (!group || !recipient) throw new NotFoundException();

      const key = { groupId, userId: recipient.id };
      const current = await tx.companyGroupGrant.findUnique({
        where: { groupId_userId: key },
        select: grantSelect,
      });
      if ((current?.version ?? 0) !== input.version || (!current && !input.active))
        throw new ConflictException();
      if (current?.isActive === input.active)
        return companyGroupGrantSchema.parse(toGrant(current));

      const grant = current
        ? await tx.companyGroupGrant.update({
            where: { groupId_userId: key, version: input.version },
            data: { isActive: input.active, version: { increment: 1 } },
            select: grantSelect,
          })
        : await tx.companyGroupGrant.create({ data: key, select: grantSelect });
      await tx.platformAuditEvent.create({
        data: {
          actorId: userId,
          subjectId: recipient.id,
          resourceId: groupId,
          action: input.active ? 'COMPANY_GROUP_ACCESS_GRANTED' : 'COMPANY_GROUP_ACCESS_REVOKED',
          reason: input.reason,
        },
      });
      return companyGroupGrantSchema.parse(toGrant(grant));
    });
  }

  private read<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.database.client.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async write<T>(
    userId: string,
    capability: PlatformCapability,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(async (tx) => {
        // Serialize with existing platform grant edits, so revoked administrators cannot write.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
        await authorizePlatform(tx, userId, [capability]);
        return operation(tx);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2025', 'P2034'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
}
