import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  instrumentPublicationIssues,
  type InstrumentQuery,
  type UpdateInstrumentDraft,
} from '@renr/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

type Scope = { userId: string; organizationId: string };
const include = {
  questions: {
    orderBy: { position: 'asc' },
    include: { options: { orderBy: { position: 'asc' } } },
  },
  _count: { select: { cycles: true, assessmentCycles: true, questions: true } },
} satisfies Prisma.InstrumentVersionInclude;
type Version = Prisma.InstrumentVersionGetPayload<{ include: typeof include }>;
const identityDto = (item: {
  id: string;
  organizationId: string;
  name: string;
  systemKey: string | null;
  createdAt: Date;
}) => ({
  id: item.id,
  organizationId: item.organizationId,
  name: item.name,
  isLegacy: item.systemKey === 'LEGACY_DEMO',
  createdAt: item.createdAt,
});
const summaryDto = (item: Version) => ({
  id: item.id,
  organizationId: item.organizationId,
  instrumentId: item.instrumentId,
  title: item.title,
  version: item.version,
  revision: item.revision,
  status: item.status,
  usageMode: item.usageMode,
  questionCount: item._count.questions,
  approvalReference: item.approvalReference,
  publishedAt: item.publishedAt,
  publishedById: item.publishedById,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  cycleCount: item._count.cycles + item._count.assessmentCycles,
});
const detailDto = (item: Version) => ({
  ...summaryDto(item),
  description: item.description,
  instructions: item.instructions,
  questions: item.questions.map((q) => ({
    id: q.id,
    label: q.label,
    type: q.type,
    required: q.required,
    position: q.position,
    options: q.options.map((o) => ({ id: o.id, label: o.label, position: o.position })),
  })),
});

@Injectable()
export class InstrumentsService {
  constructor(private readonly database: PrismaService) {}
  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.client.$transaction(operation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2004'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
  private async identity(tx: Prisma.TransactionClient, scope: Scope, id: string) {
    const item = await tx.instrument.findFirst({
      where: { id, organizationId: scope.organizationId },
    });
    if (!item) throw new NotFoundException();
    return item;
  }
  private async version(
    tx: Prisma.TransactionClient,
    scope: Scope,
    instrumentId: string,
    id: string,
  ) {
    const item = await tx.instrumentVersion.findFirst({
      where: { id, instrumentId, organizationId: scope.organizationId },
      include,
    });
    if (!item) throw new NotFoundException();
    return item;
  }
  private audit(tx: Prisma.TransactionClient, scope: Scope, action: string, resourceId: string) {
    return tx.auditEvent.create({
      data: { actorId: scope.userId, organizationId: scope.organizationId, action, resourceId },
    });
  }
  private async lock(tx: Prisma.TransactionClient, scope: Scope, instrumentId: string) {
    await tx.$queryRaw`SELECT id FROM instruments WHERE id=${instrumentId}::uuid AND organization_id=${scope.organizationId}::uuid FOR UPDATE`;
  }
  async list(scope: Scope, query: InstrumentQuery) {
    const { page, pageSize, search } = query;
    const where: Prisma.InstrumentWhereInput = {
      organizationId: scope.organizationId,
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.instrument.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.database.client.instrument.count({ where }),
    ]);
    return { items: items.map(identityDto), total, page, pageSize };
  }
  async get(scope: Scope, id: string) {
    return identityDto(await this.identity(this.database.client, scope, id));
  }
  async versions(scope: Scope, instrumentId: string, query: InstrumentQuery) {
    await this.identity(this.database.client, scope, instrumentId);
    const { page, pageSize } = query;
    const where = { organizationId: scope.organizationId, instrumentId };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.instrumentVersion.findMany({
        where,
        include,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { version: 'desc' },
      }),
      this.database.client.instrumentVersion.count({ where }),
    ]);
    return { items: items.map(summaryDto), total, page, pageSize };
  }
  async getVersion(scope: Scope, instrumentId: string, id: string) {
    return detailDto(await this.version(this.database.client, scope, instrumentId, id));
  }
  create(scope: Scope, name: string) {
    return this.write(async (tx) => {
      const instrument = await tx.instrument.create({
        data: { organizationId: scope.organizationId, name },
      });
      const version = await tx.instrumentVersion.create({
        data: {
          organizationId: scope.organizationId,
          instrumentId: instrument.id,
          title: '',
          version: 1,
          status: 'DRAFT',
          isDemo: false,
        },
        include,
      });
      await this.audit(tx, scope, 'INSTRUMENT_CREATE', instrument.id);
      return { instrument: identityDto(instrument), version: detailDto(version) };
    });
  }
  update(scope: Scope, instrumentId: string, id: string, input: UpdateInstrumentDraft) {
    return this.write(async (tx) => {
      await this.lock(tx, scope, instrumentId);
      const current = await this.version(tx, scope, instrumentId, id);
      if (current.status !== 'DRAFT' || current.revision !== input.expectedRevision)
        throw new ConflictException();
      const allIds = input.questions.flatMap((q) => [q.id, ...q.options.map((o) => o.id)]);
      const [questions, options] = await Promise.all([
        tx.diagnosticQuestion.findMany({
          where: { id: { in: allIds } },
          select: { id: true, instrumentVersionId: true },
        }),
        tx.questionOption.findMany({
          where: { id: { in: allIds } },
          select: { id: true, instrumentVersionId: true, questionId: true },
        }),
      ]);
      for (const q of input.questions) {
        if (
          questions.some((old) => old.id === q.id && old.instrumentVersionId !== id) ||
          options.some((old) => old.id === q.id)
        )
          throw new BadRequestException({
            details: [
              {
                field: 'questions',
                message: 'Question identity belongs to another version or type',
              },
            ],
          });
        for (const option of q.options)
          if (
            questions.some((old) => old.id === option.id) ||
            options.some(
              (old) =>
                old.id === option.id && (old.instrumentVersionId !== id || old.questionId !== q.id),
            )
          )
            throw new BadRequestException({
              details: [
                {
                  field: 'questions',
                  message: 'Option identity belongs to another question or version',
                },
              ],
            });
      }
      await tx.diagnosticQuestion.deleteMany({ where: { instrumentVersionId: id } });
      const { expectedRevision, questions: content, ...metadata } = input;
      const updated = await tx.instrumentVersion.updateMany({
        where: {
          id,
          organizationId: scope.organizationId,
          revision: expectedRevision,
          status: 'DRAFT',
        },
        data: { ...metadata, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException();
      for (const q of content)
        await tx.diagnosticQuestion.create({
          data: {
            id: q.id,
            instrumentVersionId: id,
            label: q.label,
            type: q.type,
            required: q.required,
            position: q.position,
            options: { create: q.options.map((o) => ({ ...o })) },
          },
        });
      await this.audit(tx, scope, 'INSTRUMENT_DRAFT_UPDATE', id);
      return detailDto(await this.version(tx, scope, instrumentId, id));
    });
  }
  publish(
    scope: Scope,
    instrumentId: string,
    id: string,
    input: { expectedRevision: number; approvalReference?: string },
    permissions: { admin: boolean; technical: boolean },
  ) {
    return this.write(async (tx) => {
      await this.lock(tx, scope, instrumentId);
      const current = await this.version(tx, scope, instrumentId, id);
      if (current.status !== 'DRAFT' || current.revision !== input.expectedRevision)
        throw new ConflictException();
      if (current.usageMode === 'REAL' ? !permissions.technical : !permissions.admin)
        throw new ForbiddenException();
      const issues = instrumentPublicationIssues(detailDto(current));
      if (current.usageMode === 'REAL' && !input.approvalReference?.trim())
        issues.push({
          field: 'approvalReference',
          message: 'Informe a referência de aprovação para uso real',
        });
      if (issues.length) throw new BadRequestException({ details: issues });
      await tx.instrumentVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          revision: { increment: 1 },
          publishedAt: new Date(),
          publishedById: scope.userId,
          approvalReference: current.usageMode === 'REAL' ? input.approvalReference!.trim() : null,
        },
      });
      await this.audit(tx, scope, 'INSTRUMENT_PUBLISH', id);
      return detailDto(await this.version(tx, scope, instrumentId, id));
    });
  }
  fork(scope: Scope, instrumentId: string, id: string, expectedRevision: number) {
    return this.write(async (tx) => {
      await this.lock(tx, scope, instrumentId);
      const current = await this.version(tx, scope, instrumentId, id);
      if (current.status !== 'PUBLISHED' || current.revision !== expectedRevision)
        throw new ConflictException();
      const last = await tx.instrumentVersion.aggregate({
        where: { instrumentId, organizationId: scope.organizationId },
        _max: { version: true },
      });
      const version = await tx.instrumentVersion.create({
        data: {
          organizationId: scope.organizationId,
          instrumentId,
          title: current.title,
          description: current.description,
          instructions: current.instructions,
          usageMode: current.usageMode,
          version: (last._max.version ?? 0) + 1,
          status: 'DRAFT',
          isDemo: false,
          questions: {
            create: current.questions.map((q) => ({
              id: randomUUID(),
              label: q.label,
              type: q.type,
              required: q.required,
              position: q.position,
              options: {
                create: q.options.map((o) => ({
                  id: randomUUID(),
                  label: o.label,
                  position: o.position,
                })),
              },
            })),
          },
        },
        include,
      });
      await this.audit(tx, scope, 'INSTRUMENT_FORK', version.id);
      return detailDto(version);
    });
  }
}
