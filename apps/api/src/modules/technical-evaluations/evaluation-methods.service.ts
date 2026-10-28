import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  evaluationMethodSchema,
  evaluationMethodVersionSchema,
  methodDefinitionSchema,
  type CreateEvaluationMethodInput,
  type UpdateEvaluationMethodDraftInput,
  type PublishEvaluationMethodInput,
  type ForkEvaluationMethodInput,
  type EvaluationMethod,
  type EvaluationMethodVersion,
  type EvaluationMethodQuery,
  type EvaluationMethodVersionQuery,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { parse } from '../../http/parse';
import { technicalWrite, type TechnicalScope } from './technical-scope';

const author = { select: { id: true, name: true } } as const;
export const methodVersionInclude = {
  method: { select: { id: true, name: true } },
  createdBy: author,
  publishedBy: author,
} satisfies Prisma.EvaluationMethodVersionInclude;
type VersionRecord = Prisma.EvaluationMethodVersionGetPayload<{
  include: typeof methodVersionInclude;
}>;
export function toMethodVersion(record: VersionRecord): EvaluationMethodVersion {
  return evaluationMethodVersionSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    method: record.method,
    version: record.version,
    revision: record.revision,
    status: record.status,
    title: record.title,
    description: record.description,
    definition: record.definition,
    approvalReference: record.approvalReference,
    publishedBy: record.publishedBy,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}
function assertRevision(actual: number, expected: number): void {
  if (actual !== expected || actual === 2147483647)
    throw new ConflictException('Method revision changed');
}
@Injectable()
export class EvaluationMethodsService {
  constructor(private readonly database: PrismaService) {}
  async create(
    scope: TechnicalScope,
    input: CreateEvaluationMethodInput,
  ): Promise<EvaluationMethodVersion> {
    return technicalWrite(this.database, scope, async (tx) => {
      const method = await tx.evaluationMethod.create({
        data: { organizationId: scope.organizationId, name: input.name, createdById: scope.userId },
      });
      const record = await tx.evaluationMethodVersion.create({
        data: {
          organizationId: scope.organizationId,
          methodId: method.id,
          version: 1,
          title: method.name,
          description: input.description,
          definition: { probability: [], severity: [], levels: [], priorities: [], matrix: [] },
          createdById: scope.userId,
        },
        include: methodVersionInclude,
      });
      await this.audit(tx, scope, record.id, 'evaluation_method.created');
      return toMethodVersion(record);
    });
  }
  async list(scope: TechnicalScope, query: EvaluationMethodQuery) {
    const where: Prisma.EvaluationMethodWhereInput = {
      organizationId: scope.organizationId,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    return this.database.client.$transaction(
      async (tx) => {
        const [items, total] = await Promise.all([
          tx.evaluationMethod.findMany({
            where,
            include: { createdBy: author },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.evaluationMethod.count({ where }),
        ]);
        return {
          items: items.map((item) =>
            evaluationMethodSchema.parse({
              id: item.id,
              organizationId: item.organizationId,
              name: item.name,
              createdAt: item.createdAt.toISOString(),
              createdBy: item.createdBy,
            }),
          ),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(scope: TechnicalScope, id: string): Promise<EvaluationMethod> {
    const item = await this.database.client.evaluationMethod.findFirst({
      where: { organizationId: scope.organizationId, id },
      include: { createdBy: author },
    });
    if (!item) throw new NotFoundException();
    return evaluationMethodSchema.parse({
      id: item.id,
      organizationId: item.organizationId,
      name: item.name,
      createdBy: item.createdBy,
      createdAt: item.createdAt.toISOString(),
    });
  }
  async versions(scope: TechnicalScope, query: EvaluationMethodVersionQuery) {
    if (query.methodId) await this.get(scope, query.methodId);
    const where: Prisma.EvaluationMethodVersionWhereInput = {
      organizationId: scope.organizationId,
      ...(query.methodId ? { methodId: query.methodId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    return this.database.client.$transaction(
      async (tx) => {
        const [items, total] = await Promise.all([
          tx.evaluationMethodVersion.findMany({
            where,
            include: methodVersionInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.evaluationMethodVersion.count({ where }),
        ]);
        return {
          items: items.map(toMethodVersion),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async getVersion(scope: TechnicalScope, id: string): Promise<EvaluationMethodVersion> {
    return toMethodVersion(await this.load(this.database.client, scope, id));
  }
  private async load(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    id: string,
    lock = false,
  ): Promise<VersionRecord> {
    if (lock) {
      const rows = await tx.$queryRaw<
        { method_id: string }[]
      >`SELECT method_id FROM evaluation_method_versions WHERE organization_id=${scope.organizationId}::uuid AND id=${id}::uuid`;
      if (!rows[0]) throw new NotFoundException();
      await tx.$queryRaw`SELECT id FROM evaluation_methods WHERE organization_id=${scope.organizationId}::uuid AND id=${rows[0].method_id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM evaluation_method_versions WHERE organization_id=${scope.organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
    }
    const item = await tx.evaluationMethodVersion.findFirst({
      where: { organizationId: scope.organizationId, id },
      include: methodVersionInclude,
    });
    if (!item) throw new NotFoundException();
    return item;
  }
  async update(
    scope: TechnicalScope,
    id: string,
    input: UpdateEvaluationMethodDraftInput,
  ): Promise<EvaluationMethodVersion> {
    return technicalWrite(this.database, scope, async (tx) => {
      const item = await this.load(tx, scope, id, true);
      if (item.status !== 'DRAFT') throw new ConflictException('Published versions are immutable');
      assertRevision(item.revision, input.expectedRevision);
      const updated = await tx.evaluationMethodVersion.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          definition: input.definition as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
        include: methodVersionInclude,
      });
      await this.audit(tx, scope, id, 'evaluation_method.draft_updated');
      return toMethodVersion(updated);
    });
  }
  async publish(
    scope: TechnicalScope,
    id: string,
    input: PublishEvaluationMethodInput,
  ): Promise<EvaluationMethodVersion> {
    return technicalWrite(this.database, scope, async (tx) => {
      const item = await this.load(tx, scope, id, true);
      if (item.status !== 'DRAFT') throw new ConflictException('Version is not a draft');
      assertRevision(item.revision, input.expectedRevision);
      parse(methodDefinitionSchema, item.definition);
      const updated = await tx.evaluationMethodVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          approvalReference: input.approvalReference,
          publishedById: scope.userId,
          publishedAt: new Date(),
          revision: { increment: 1 },
        },
        include: methodVersionInclude,
      });
      await this.audit(tx, scope, id, 'evaluation_method.published');
      return toMethodVersion(updated);
    });
  }
  async fork(
    scope: TechnicalScope,
    id: string,
    input: ForkEvaluationMethodInput,
  ): Promise<EvaluationMethodVersion> {
    return technicalWrite(this.database, scope, async (tx) => {
      const item = await this.load(tx, scope, id, true);
      if (item.status !== 'PUBLISHED')
        throw new ConflictException('Only a published version can be forked');
      assertRevision(item.revision, input.expectedRevision);
      const last = await tx.evaluationMethodVersion.aggregate({
        where: { organizationId: scope.organizationId, methodId: item.methodId },
        _max: { version: true },
      });
      if ((last._max.version ?? 0) >= 2147483647)
        throw new ConflictException('Method version limit reached');
      const draft = await tx.evaluationMethodVersion.create({
        data: {
          organizationId: scope.organizationId,
          methodId: item.methodId,
          version: (last._max.version ?? 0) + 1,
          title: item.title,
          description: item.description,
          definition: item.definition as Prisma.InputJsonValue,
          createdById: scope.userId,
        },
        include: methodVersionInclude,
      });
      await this.audit(tx, scope, draft.id, 'evaluation_method.version_forked');
      return toMethodVersion(draft);
    });
  }
  private async audit(
    tx: Prisma.TransactionClient,
    scope: TechnicalScope,
    resourceId: string,
    action: string,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: { actorId: scope.userId, organizationId: scope.organizationId, resourceId, action },
    });
  }
}
