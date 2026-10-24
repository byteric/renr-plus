import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateEmployee,
  UpdateEmployee,
  CreateAssessmentGroup,
  UpdateAssessmentGroup,
  WorkforceQuery,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
type Scope = { userId: string; organizationId: string };
const employeeSelect = {
  id: true,
  organizationId: true,
  name: true,
  internalIdentifier: true,
  unitId: true,
  sectorId: true,
  linkedUserId: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  unit: { select: { name: true } },
  sector: { select: { name: true } },
} as const;
const groupInclude = {
  sector: { select: { name: true, unitId: true, unit: { select: { name: true } } } },
} as const;
type EmployeeRecord = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;
const employeeDto = ({ unit, sector, ...employee }: EmployeeRecord) => ({
  ...employee,
  unitName: unit.name,
  sectorName: sector.name,
});
type GroupRecord = Prisma.AssessmentGroupGetPayload<{ include: typeof groupInclude }>;
const groupDto = ({ sector, ...group }: GroupRecord) => ({
  ...group,
  unitId: sector.unitId,
  unitName: sector.unit.name,
  sectorName: sector.name,
});
@Injectable()
export class WorkforceService {
  constructor(private readonly database: PrismaService) {}
  private async write<T>(
    scope: Scope,
    action: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T & { id: string }>,
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(async (tx) => {
        // The same organization lock is shared by group mutations and diagnostic/risk creation.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.organizationId}))::text`;
        const result = await operation(tx);
        await tx.auditEvent.create({
          data: {
            organizationId: scope.organizationId,
            actorId: scope.userId,
            resourceId: result.id,
            action,
          },
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
  private async sector(
    tx: Prisma.TransactionClient,
    scope: Scope,
    sectorId: string,
    unitId?: string,
  ) {
    const sector = await tx.sector.findFirst({
      where: { id: sectorId, organizationId: scope.organizationId, ...(unitId ? { unitId } : {}) },
      include: { unit: true, organization: true },
    });
    if (!sector) throw new NotFoundException();
    if (
      !sector.isActive ||
      !sector.unit.isActive ||
      !sector.organization.isActive ||
      sector.unit.organizationId !== scope.organizationId
    )
      throw new ConflictException();
    return sector;
  }
  async employees(scope: Scope, query: WorkforceQuery) {
    const { page, pageSize, search, isActive, unitId, sectorId } = query;
    const where: Prisma.EmployeeWhereInput = {
      organizationId: scope.organizationId,
      isActive,
      unitId,
      sectorId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { internalIdentifier: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.employee.findMany({
        where,
        select: employeeSelect,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.client.employee.count({ where }),
    ]);
    return { items: items.map(employeeDto), total, page, pageSize };
  }
  async employee(scope: Scope, id: string) {
    const record = await this.database.client.employee.findFirst({
      where: { id, organizationId: scope.organizationId },
      select: employeeSelect,
    });
    if (!record) throw new NotFoundException();
    return employeeDto(record);
  }
  private async membership(tx: Prisma.TransactionClient, scope: Scope, userId: string) {
    if (
      !(await tx.membership.findFirst({
        where: { userId, organizationId: scope.organizationId, isActive: true },
      }))
    )
      throw new NotFoundException();
  }
  createEmployee(scope: Scope, input: CreateEmployee) {
    return this.write(scope, 'EMPLOYEE_CREATE', async (tx) => {
      await this.sector(tx, scope, input.sectorId, input.unitId);
      if (input.linkedUserId) await this.membership(tx, scope, input.linkedUserId);
      return employeeDto(
        await tx.employee.create({
          data: {
            ...input,
            organizationId: scope.organizationId,
            normalizedIdentifier: input.internalIdentifier?.normalize('NFKC').toLowerCase() ?? null,
          },
          select: employeeSelect,
        }),
      );
    });
  }
  updateEmployee(scope: Scope, id: string, input: UpdateEmployee) {
    return this.write(scope, 'EMPLOYEE_UPDATE', async (tx) => {
      const current = await tx.employee.findFirst({
        where: { id, organizationId: scope.organizationId },
      });
      if (!current) throw new NotFoundException();
      if (current.version !== input.version) throw new ConflictException();
      if (
        (input.unitId && input.unitId !== current.unitId) ||
        (input.sectorId && input.sectorId !== current.sectorId)
      )
        await this.sector(
          tx,
          scope,
          input.sectorId ?? current.sectorId,
          input.unitId ?? current.unitId,
        );
      if (input.linkedUserId && input.linkedUserId !== current.linkedUserId)
        await this.membership(tx, scope, input.linkedUserId);
      const { version, ...changes } = input;
      const changed = await tx.employee.updateMany({
        where: { id, organizationId: scope.organizationId, version },
        data: {
          ...changes,
          version: { increment: 1 },
          ...(input.internalIdentifier !== undefined
            ? {
                normalizedIdentifier:
                  input.internalIdentifier?.normalize('NFKC').toLowerCase() ?? null,
              }
            : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException();
      return employeeDto(
        await tx.employee.findUniqueOrThrow({ where: { id }, select: employeeSelect }),
      );
    });
  }
  async groups(scope: Scope, query: WorkforceQuery) {
    const { page, pageSize, search, isActive, unitId, sectorId } = query;
    const where: Prisma.AssessmentGroupWhereInput = {
      organizationId: scope.organizationId,
      isActive,
      sectorId,
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(unitId ? { sector: { unitId } } : {}),
    };
    const [records, total] = await this.database.client.$transaction([
      this.database.client.assessmentGroup.findMany({
        where,
        include: groupInclude,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.client.assessmentGroup.count({ where }),
    ]);
    return { items: records.map(groupDto), total, page, pageSize };
  }
  async group(scope: Scope, id: string) {
    const record = await this.database.client.assessmentGroup.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: groupInclude,
    });
    if (!record) throw new NotFoundException();
    return groupDto(record);
  }
  createGroup(scope: Scope, input: CreateAssessmentGroup) {
    return this.write(scope, 'ASSESSMENT_GROUP_CREATE', async (tx) => {
      await this.sector(tx, scope, input.sectorId);
      return groupDto(
        await tx.assessmentGroup.create({
          data: { ...input, organizationId: scope.organizationId },
          include: groupInclude,
        }),
      );
    });
  }
  updateGroup(scope: Scope, id: string, input: UpdateAssessmentGroup) {
    return this.write(scope, 'ASSESSMENT_GROUP_UPDATE', async (tx) => {
      const current = await tx.assessmentGroup.findFirst({
        where: { id, organizationId: scope.organizationId },
      });
      if (!current) throw new NotFoundException();
      const { version, ...changes } = input;
      const result = await tx.assessmentGroup.updateMany({
        where: { id, organizationId: scope.organizationId, version },
        data: { ...changes, version: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException();
      return groupDto(
        await tx.assessmentGroup.findUniqueOrThrow({ where: { id }, include: groupInclude }),
      );
    });
  }
}
