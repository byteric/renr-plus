import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  evidenceSchema,
  type Evidence,
  type EvidenceList,
  type UploadEvidenceInput,
  type ArchiveEvidenceInput,
} from '@renr/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type {} from 'multer';
import { Prisma } from '../../generated/prisma/client';
import { ActionsRepository, actionInclude, type ActionScope } from '../actions/actions.repository';
import { assertActionVersion } from '../actions/actions.service';
import { EvidenceStorage } from './evidence.storage';

export const evidenceInclude = {
  createdBy: { select: { id: true, name: true } },
  archivedBy: { select: { id: true, name: true } },
} satisfies Prisma.ActionEvidenceInclude;
type EvidenceRecord = Prisma.ActionEvidenceGetPayload<{ include: typeof evidenceInclude }>;
function toEvidence(record: EvidenceRecord): Evidence {
  return evidenceSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    actionId: record.actionId,
    description: record.description,
    fileName: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
    sha256: record.sha256,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    archivedAt: record.archivedAt?.toISOString() ?? null,
    archivedBy: record.archivedBy,
    archiveReason: record.archiveReason,
    actionVersion: record.actionVersion,
  });
}
export function validateEvidenceFile(file: Express.Multer.File | undefined): {
  buffer: Buffer;
  extension: string;
  mimeType: Evidence['mimeType'];
  sha256: string;
} {
  if (
    !file ||
    file.buffer.length === 0 ||
    file.buffer.length > 5 * 1024 * 1024 ||
    file.size !== file.buffer.length
  )
    throw new BadRequestException();
  const extension = extname(file.originalname).toLowerCase();
  const data = file.buffer;
  const pdf =
    extension === '.pdf' &&
    file.mimetype === 'application/pdf' &&
    data.subarray(0, 5).equals(Buffer.from('%PDF-'));
  const png =
    extension === '.png' &&
    file.mimetype === 'image/png' &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    ['.jpg', '.jpeg'].includes(extension) &&
    file.mimetype === 'image/jpeg' &&
    data.length >= 3 &&
    data[0] === 255 &&
    data[1] === 216 &&
    data[2] === 255;
  if (!pdf && !png && !jpeg)
    throw new BadRequestException({
      details: [
        {
          field: 'file',
          message: 'PDF, PNG ou JPEG com extensão, MIME e assinatura compatíveis é obrigatório.',
        },
      ],
    });
  return {
    buffer: data,
    extension: pdf ? '.pdf' : png ? '.png' : '.jpg',
    mimeType: pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg',
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  constructor(
    private readonly repository: ActionsRepository,
    private readonly storage: EvidenceStorage,
  ) {}
  async upload(
    scope: ActionScope,
    actionId: string,
    input: UploadEvidenceInput,
    file: Express.Multer.File | undefined,
  ): Promise<Evidence> {
    const validated = validateEvidenceFile(file);
    this.storage.assertEnabled();
    const id = randomUUID();
    const fileName = `${id}${validated.extension}`;
    const key = `${scope.organizationId}/${actionId}/${fileName}`;
    let uploaded = false;
    try {
      return await this.repository.transaction(async (tx) => {
        const action = await this.repository.lock(tx, scope.organizationId, actionId);
        assertActionVersion(action, input.expectedVersion);
        if (
          (await tx.actionEvidence.count({
            where: { organizationId: scope.organizationId, actionId, archivedAt: null },
          })) >= 20
        )
          throw new ConflictException('Active evidence limit reached');
        await this.storage.put(key, validated.buffer, validated.mimeType, validated.sha256);
        uploaded = true;
        const evidence = await tx.actionEvidence.create({
          data: {
            id,
            organizationId: scope.organizationId,
            actionId,
            description: input.description,
            fileName,
            objectKey: key,
            mimeType: validated.mimeType,
            size: validated.buffer.length,
            sha256: validated.sha256,
            actionVersion: action.version + 1,
            createdById: scope.userId,
          },
          include: evidenceInclude,
        });
        const updated = await tx.action.update({
          where: { id: actionId },
          data: { version: { increment: 1 }, updatedById: scope.userId },
          include: actionInclude,
        });
        await this.repository.revision(
          tx,
          scope,
          updated,
          'EVIDENCE_ADDED',
          null,
          input.description,
          id,
        );
        return toEvidence(evidence);
      });
    } catch (error) {
      if (uploaded) {
        // A rejected commit acknowledgement does not prove rollback. Never delete bytes
        // that may already be referenced; retain the object if the database cannot confirm.
        let absent = false;
        try {
          absent = await this.repository.transaction(async (tx) => {
            // Wait for any pending commit/rollback holding the parent action lock.
            // READ COMMITTED then observes the completed transaction's metadata.
            await this.repository.lock(tx, scope.organizationId, actionId);
            return !(await tx.actionEvidence.findFirst({
              where: { id, organizationId: scope.organizationId, actionId },
              select: { id: true },
            }));
          });
        } catch {
          this.logger.error({ message: 'Evidence cleanup deferred; commit outcome unavailable' });
        }
        if (absent) await this.storage.compensate(key);
      }
      throw error;
    }
  }
  async list(
    scope: ActionScope,
    actionId: string,
    page: { page: number; pageSize: number },
  ): Promise<EvidenceList> {
    return this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, actionId);
      const where = { organizationId: scope.organizationId, actionId };
      const [records, total] = await Promise.all([
        tx.actionEvidence.findMany({
          where,
          include: evidenceInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        }),
        tx.actionEvidence.count({ where }),
      ]);
      return { items: records.map(toEvidence), total, ...page };
    });
  }
  async archive(
    scope: ActionScope,
    actionId: string,
    id: string,
    input: ArchiveEvidenceInput,
  ): Promise<Evidence> {
    return this.repository.transaction(async (tx) => {
      const action = await this.repository.lock(tx, scope.organizationId, actionId);
      assertActionVersion(action, input.expectedVersion);
      const evidence = await tx.actionEvidence.findFirst({
        where: { id, organizationId: scope.organizationId, actionId },
      });
      if (!evidence) throw new NotFoundException();
      if (evidence.archivedAt) throw new ConflictException();
      const archived = await tx.actionEvidence.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          archivedById: scope.userId,
          archiveReason: input.changeReason,
        },
        include: evidenceInclude,
      });
      const updated = await tx.action.update({
        where: { id: actionId },
        data: { version: { increment: 1 }, updatedById: scope.userId },
        include: actionInclude,
      });
      await this.repository.revision(
        tx,
        scope,
        updated,
        'EVIDENCE_ARCHIVED',
        input.changeReason,
        null,
        id,
      );
      return toEvidence(archived);
    });
  }
  async download(
    scope: ActionScope,
    actionId: string,
    id: string,
  ): Promise<{ stream: Readable; file: Evidence }> {
    const record = await this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, actionId);
      const evidence = await tx.actionEvidence.findFirst({
        where: { id, organizationId: scope.organizationId, actionId },
        include: evidenceInclude,
      });
      if (!evidence) throw new NotFoundException();
      return evidence;
    });
    const stream = await this.storage.get(record.objectKey);
    return { stream, file: toEvidence(record) };
  }
}
