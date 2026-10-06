import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateOrganization,
  CreateSector,
  CreateUnit,
  UpdateOrganization,
  UpdateSector,
  UpdateUnit,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

type Page = { page: number; pageSize: number };
type Scope = { userId: string; organizationId: string };
const normalized = (name: string): string => name.toLowerCase();

@Injectable()
export class OrganizationsService {
  constructor(private readonly database: PrismaService) {}
  async requireUnit(scope: Scope, id: string): Promise<void> {
    await this.unit(this.database.client, scope, id);
  }
  async requireSector(scope: Scope, id: string): Promise<void> {
    if (
      !(await this.database.client.sector.findFirst({
        where: { id, organizationId: scope.organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
  }

  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.client.$transaction(operation);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        throw new NotFoundException();
      throw error;
    }
  }
  private audit(tx: Prisma.TransactionClient, scope: Scope, action: string, resourceId: string) {
    return tx.auditEvent.create({
      data: { actorId: scope.userId, organizationId: scope.organizationId, action, resourceId },
    });
  }
  async organizations(userId: string, pagination: Page) {
    const where = { memberships: { some: { userId } } };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.organization.findMany({
        where,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.database.client.organization.count({ where }),
    ]);
    return { items, total, ...pagination };
  }
  async createOrganization(userId: string, input: CreateOrganization) {
    return this.write(async (tx) => {
      // Serialize names for one user's organization catalog without a global cross-tenant constraint.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
      if (
        await tx.organization.findFirst({
          where: {
            name: { equals: input.name, mode: 'insensitive' },
            memberships: { some: { userId } },
          },
        })
      )
        throw new ConflictException();
      const organization = await tx.organization.create({
        data: { ...input, memberships: { create: { userId, role: 'ADMIN' } } },
      });
      await this.audit(
        tx,
        { userId, organizationId: organization.id },
        'ORGANIZATION_CREATE',
        organization.id,
      );
      return organization;
    });
  }
  async updateOrganization(scope: Scope, input: UpdateOrganization) {
    return this.write(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.userId}))::text`;
      if (
        input.name &&
        (await tx.organization.findFirst({
          where: {
            id: { not: scope.organizationId },
            name: { equals: input.name, mode: 'insensitive' },
            memberships: { some: { userId: scope.userId } },
          },
        }))
      )
        throw new ConflictException();
      const organization = await tx.organization.update({
        where: { id: scope.organizationId },
        data: input,
      });
      await this.audit(tx, scope, 'ORGANIZATION_UPDATE', organization.id);
      return organization;
    });
  }
  async units(scope: Scope, pagination: Page) {
    const where = { organizationId: scope.organizationId };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.unit.findMany({
        where,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy: { name: 'asc' },
        omit: { normalizedName: true },
      }),
      this.database.client.unit.count({ where }),
    ]);
    return { items, total, ...pagination };
  }
  async createUnit(scope: Scope, input: CreateUnit) {
    return this.write(async (tx) => {
      const unit = await tx.unit.create({
        data: {
          ...input,
          organizationId: scope.organizationId,
          normalizedName: normalized(input.name),
        },
        omit: { normalizedName: true },
      });
      await this.audit(tx, scope, 'UNIT_CREATE', unit.id);
      return unit;
    });
  }
  async updateUnit(scope: Scope, id: string, input: UpdateUnit) {
    return this.write(async (tx) => {
      const unit = await tx.unit.update({
        where: { id, organizationId: scope.organizationId },
        data: { ...input, ...(input.name ? { normalizedName: normalized(input.name) } : {}) },
        omit: { normalizedName: true },
      });
      await this.audit(tx, scope, 'UNIT_UPDATE', unit.id);
      return unit;
    });
  }
  private async unit(tx: Prisma.TransactionClient, scope: Scope, id: string): Promise<void> {
    if (
      !(await tx.unit.findFirst({
        where: { id, organizationId: scope.organizationId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
  }
  async sectors(scope: Scope, unitId: string, pagination: Page) {
    return this.database.client.$transaction(async (tx) => {
      await this.unit(tx, scope, unitId);
      const where = { unitId, organizationId: scope.organizationId };
      const [items, total] = await Promise.all([
        tx.sector.findMany({
          where,
          skip: (pagination.page - 1) * pagination.pageSize,
          take: pagination.pageSize,
          orderBy: { name: 'asc' },
          omit: { normalizedName: true },
        }),
        tx.sector.count({ where }),
      ]);
      return { items, total, ...pagination };
    });
  }
  async createSector(scope: Scope, unitId: string, input: CreateSector) {
    return this.write(async (tx) => {
      await this.unit(tx, scope, unitId);
      const sector = await tx.sector.create({
        data: {
          ...input,
          unitId,
          organizationId: scope.organizationId,
          normalizedName: normalized(input.name),
        },
        omit: { normalizedName: true },
      });
      await this.audit(tx, scope, 'SECTOR_CREATE', sector.id);
      return sector;
    });
  }
  async updateSector(scope: Scope, id: string, input: UpdateSector) {
    return this.write(async (tx) => {
      const sector = await tx.sector.update({
        where: { id, organizationId: scope.organizationId },
        data: { ...input, ...(input.name ? { normalizedName: normalized(input.name) } : {}) },
        omit: { normalizedName: true },
      });
      await this.audit(tx, scope, 'SECTOR_UPDATE', sector.id);
      return sector;
    });
  }
}
