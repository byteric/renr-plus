import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import {
  evidenceSchema,
  evidenceUploadAttemptSchema,
  evidenceUsageSchema,
  type EvidenceUploadAttempt,
  type EvidenceUsage,
  type ReconcileEvidenceUploadInput,
  type RetryEvidenceUploadInput,
  type AbandonEvidenceUploadInput,
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
import { assertOperationalActor, lockOperationalActor } from '../actions/operational-access';
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
  private async context(tx: Prisma.TransactionClient, scope: ActionScope, actionId: string) {
    const actor = await lockOperationalActor(tx, scope, false);
    const action = await this.repository.lock(tx, scope.organizationId, actionId);
    assertOperationalActor(actor, action);
    return action;
  }
  private async attempt(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    actionId: string,
    key: string,
  ) {
    await tx.$queryRaw`SELECT id FROM evidence_upload_attempts WHERE organization_id=${scope.organizationId}::uuid AND action_id=${actionId}::uuid AND creator_id=${scope.userId}::uuid AND key=${key}::uuid FOR UPDATE`;
    const attempt = await tx.evidenceUploadAttempt.findFirst({
      where: {
        organizationId: scope.organizationId,
        actionId,
        creatorId: scope.userId,
        key,
      },
    });
    if (!attempt) throw new NotFoundException();
    return attempt;
  }
  private fingerprint(
    input: UploadEvidenceInput,
    file: ReturnType<typeof validateEvidenceFile>,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([file.sha256, file.mimeType, file.buffer.length, input.description.trim()]),
      )
      .digest('hex');
  }
  private async dto(
    tx: Prisma.TransactionClient,
    attempt: Prisma.EvidenceUploadAttemptGetPayload<object>,
    version: number,
  ): Promise<EvidenceUploadAttempt> {
    const evidence = attempt.evidenceId
      ? await tx.actionEvidence.findUnique({
          where: { id: attempt.evidenceId },
          include: evidenceInclude,
        })
      : null;
    return evidenceUploadAttemptSchema.parse({
      key: attempt.key,
      organizationId: attempt.organizationId,
      actionId: attempt.actionId,
      state: attempt.state,
      attemptVersion: attempt.attemptVersion,
      description: attempt.description,
      fileName: attempt.fileName,
      mimeType: attempt.mimeType,
      size: attempt.size,
      sha256: attempt.sha256,
      createdAt: attempt.createdAt.toISOString(),
      updatedAt: attempt.updatedAt.toISOString(),
      leaseExpiresAt: attempt.leaseExpiresAt?.toISOString() ?? null,
      currentActionVersion: version,
      retryAllowed: attempt.state === 'RETRYABLE',
      objectState: attempt.objectState,
      evidence: evidence ? toEvidence(evidence) : null,
    });
  }
  async getAttempt(
    scope: ActionScope,
    actionId: string,
    key: string,
  ): Promise<EvidenceUploadAttempt> {
    const record = await this.repository.snapshot(async (tx) => {
      const actor = await tx.membership.findUnique({
        where: {
          userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
        },
        include: { organization: true },
      });
      const action = await this.repository.get(tx, scope.organizationId, actionId);
      if (!actor?.isActive || !actor.organization.isActive) throw new NotFoundException();
      assertOperationalActor(actor, action);
      const attempt = await tx.evidenceUploadAttempt.findFirst({
        where: { organizationId: scope.organizationId, actionId, creatorId: scope.userId, key },
      });
      if (!attempt) throw new NotFoundException();
      return { attempt, dto: await this.dto(tx, attempt, action.version) };
    });
    const { attempt, dto } = record;
    if (
      !['COMPLETED', 'ABANDONED'].includes(attempt.state) &&
      (!attempt.leaseExpiresAt || attempt.leaseExpiresAt.getTime() <= Date.now())
    ) {
      dto.objectState = await this.storage.probe(attempt.objectKey, {
        mimeType: attempt.mimeType,
        size: attempt.size,
        sha256: attempt.sha256,
      });
    }
    dto.retryAllowed =
      dto.state === 'RETRYABLE' &&
      dto.objectState === 'ABSENT' &&
      (!attempt.leaseExpiresAt || attempt.leaseExpiresAt.getTime() <= Date.now());
    return dto;
  }
  async upload(
    scope: ActionScope,
    actionId: string,
    input: UploadEvidenceInput,
    file: Express.Multer.File | undefined,
    key: string = randomUUID(),
  ): Promise<Evidence> {
    const validated = validateEvidenceFile(file);
    const fingerprint = this.fingerprint(input, validated);
    const reserved = await this.repository.transaction(async (tx) => {
      const action = await this.context(tx, scope, actionId);
      const existing = await tx.evidenceUploadAttempt.findFirst({
        where: { organizationId: scope.organizationId, actionId, creatorId: scope.userId, key },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException('Idempotency key has different content');
        if (existing.state === 'COMPLETED') {
          const evidence = await tx.actionEvidence.findUniqueOrThrow({
            where: { id: existing.evidenceId! },
            include: evidenceInclude,
          });
          return { evidence: toEvidence(evidence), attempt: null };
        }
        throw new ConflictException('Upload attempt requires explicit recovery');
      }
      this.storage.assertEnabled();
      assertActionVersion(action, input.expectedVersion);
      const active = await tx.actionEvidence.count({
        where: { organizationId: scope.organizationId, actionId, archivedAt: null },
      });
      const pending = await tx.evidenceUploadAttempt.count({
        where: {
          organizationId: scope.organizationId,
          actionId,
          state: { notIn: ['COMPLETED', 'ABANDONED'] },
        },
      });
      if (active + pending >= 20)
        throw new ConflictException('Active evidence and reservation limit reached');
      const id = randomUUID();
      const fileName = `${id}${validated.extension}`;
      const attempt = await tx.evidenceUploadAttempt.create({
        data: {
          id,
          organizationId: scope.organizationId,
          actionId,
          creatorId: scope.userId,
          key,
          fingerprint,
          description: input.description.trim(),
          fileName,
          objectKey: `${scope.organizationId}/${actionId}/${fileName}`,
          mimeType: validated.mimeType,
          size: validated.buffer.length,
          sha256: validated.sha256,
          state: 'UPLOADING',
          expectedVersion: input.expectedVersion,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      return { evidence: null, attempt };
    });
    if (reserved.evidence) return reserved.evidence;
    return this.putAndComplete(scope, actionId, reserved.attempt!, validated.buffer);
  }
  private async uncertain(
    scope: ActionScope,
    actionId: string,
    attempt: Prisma.EvidenceUploadAttemptGetPayload<object>,
  ): Promise<void> {
    try {
      await this.repository.transaction(async (tx) => {
        await this.repository.lock(tx, scope.organizationId, actionId);
        await tx.evidenceUploadAttempt.updateMany({
          where: {
            id: attempt.id,
            attemptVersion: attempt.attemptVersion,
            leaseToken: attempt.leaseToken,
            state: { in: ['UPLOADING', 'UNCERTAIN'] },
          },
          data: {
            state: 'UNCERTAIN',
            objectState: 'UNKNOWN',
            leaseToken: null,
            leaseExpiresAt: null,
            attemptVersion: { increment: 1 },
          },
        });
      });
    } catch {
      // Retain the durable reservation and object when the database outcome is unavailable.
      this.logger.error({
        message: 'Upload outcome persistence deferred; durable reservation retained',
      });
    }
  }
  private assertLease(
    attempt: Prisma.EvidenceUploadAttemptGetPayload<object>,
    expected: Prisma.EvidenceUploadAttemptGetPayload<object>,
  ): void {
    if (
      attempt.attemptVersion !== expected.attemptVersion ||
      attempt.leaseToken !== expected.leaseToken ||
      !attempt.leaseExpiresAt ||
      attempt.leaseExpiresAt.getTime() <= Date.now() ||
      !['UPLOADING', 'UNCERTAIN'].includes(attempt.state)
    )
      throw new ConflictException('Upload lease is expired or superseded');
  }
  private async complete(
    scope: ActionScope,
    actionId: string,
    expected: Prisma.EvidenceUploadAttemptGetPayload<object>,
  ): Promise<Evidence> {
    return this.repository.transaction(async (tx) => {
      const action = await this.context(tx, scope, actionId);
      const attempt = await this.attempt(tx, scope, actionId, expected.key);
      this.assertLease(attempt, expected);
      assertActionVersion(action, attempt.expectedVersion);
      const evidence = await tx.actionEvidence.create({
        data: {
          id: attempt.id,
          organizationId: scope.organizationId,
          actionId,
          description: attempt.description,
          fileName: attempt.fileName,
          objectKey: attempt.objectKey,
          mimeType: attempt.mimeType,
          size: attempt.size,
          sha256: attempt.sha256,
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
        attempt.description,
        evidence.id,
      );
      await tx.evidenceUploadAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'COMPLETED',
          evidenceId: evidence.id,
          objectState: 'PRESENT',
          leaseToken: null,
          leaseExpiresAt: null,
          attemptVersion: { increment: 1 },
        },
      });
      return toEvidence(evidence);
    });
  }
  private async putAndComplete(
    scope: ActionScope,
    actionId: string,
    attempt: Prisma.EvidenceUploadAttemptGetPayload<object>,
    buffer: Buffer,
  ): Promise<Evidence> {
    try {
      await this.storage.put(attempt.objectKey, buffer, attempt.mimeType, attempt.sha256);
      return await this.complete(scope, actionId, attempt);
    } catch (error) {
      await this.uncertain(scope, actionId, attempt);
      throw error;
    }
  }
  async reconcile(
    scope: ActionScope,
    actionId: string,
    key: string,
    input: ReconcileEvidenceUploadInput,
  ): Promise<EvidenceUploadAttempt> {
    const claimed = await this.repository.transaction(async (tx) => {
      const action = await this.context(tx, scope, actionId);
      const attempt = await this.attempt(tx, scope, actionId, key);
      if (attempt.state === 'COMPLETED') return null;
      if (
        attempt.state === 'ABANDONED' ||
        attempt.attemptVersion !== input.attemptVersion ||
        (attempt.leaseExpiresAt && attempt.leaseExpiresAt.getTime() > Date.now())
      )
        throw new ConflictException('Attempt changed or upload lease active');
      assertActionVersion(action, input.expectedVersion);
      return tx.evidenceUploadAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'UNCERTAIN',
          expectedVersion: input.expectedVersion,
          attemptVersion: { increment: 1 },
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
    });
    if (!claimed) return this.getAttempt(scope, actionId, key);
    const objectState = await this.storage.probe(claimed.objectKey, {
      mimeType: claimed.mimeType,
      size: claimed.size,
      sha256: claimed.sha256,
    });
    if (objectState === 'PRESENT') {
      try {
        await this.complete(scope, actionId, claimed);
      } catch (error) {
        await this.uncertain(scope, actionId, claimed);
        throw error;
      }
    } else {
      await this.repository.transaction(async (tx) => {
        await this.context(tx, scope, actionId);
        const attempt = await this.attempt(tx, scope, actionId, key);
        this.assertLease(attempt, claimed);
        await tx.evidenceUploadAttempt.update({
          where: { id: attempt.id },
          data: {
            state: objectState === 'ABSENT' ? 'RETRYABLE' : 'UNCERTAIN',
            objectState,
            leaseToken: null,
            leaseExpiresAt: null,
            attemptVersion: { increment: 1 },
          },
        });
      });
      if (objectState === 'UNKNOWN')
        throw new ServiceUnavailableException('Object outcome remains unknown');
    }
    return this.getAttempt(scope, actionId, key);
  }
  async retry(
    scope: ActionScope,
    actionId: string,
    key: string,
    input: RetryEvidenceUploadInput,
    file: Express.Multer.File | undefined,
  ): Promise<EvidenceUploadAttempt> {
    const validated = validateEvidenceFile(file);
    this.storage.assertEnabled();
    const attempt = await this.repository.transaction(async (tx) => {
      const action = await this.context(tx, scope, actionId);
      const current = await this.attempt(tx, scope, actionId, key);
      if (current.fingerprint !== this.fingerprint(input, validated))
        throw new ConflictException('Original upload content required');
      if (
        current.attemptVersion !== input.attemptVersion ||
        current.state !== 'RETRYABLE' ||
        current.objectState !== 'ABSENT'
      )
        throw new ConflictException('Reconcile absence before retry');
      assertActionVersion(action, input.expectedVersion);
      return tx.evidenceUploadAttempt.update({
        where: { id: current.id },
        data: {
          state: 'UPLOADING',
          objectState: null,
          expectedVersion: input.expectedVersion,
          attemptVersion: { increment: 1 },
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
    });
    const objectState = await this.storage.probe(attempt.objectKey, {
      mimeType: attempt.mimeType,
      size: attempt.size,
      sha256: attempt.sha256,
    });
    if (objectState === 'UNKNOWN') {
      await this.uncertain(scope, actionId, attempt);
      throw new ServiceUnavailableException('Object outcome remains unknown');
    }
    if (objectState === 'PRESENT') {
      try {
        await this.complete(scope, actionId, attempt);
      } catch (error) {
        await this.uncertain(scope, actionId, attempt);
        throw error;
      }
    } else {
      await this.putAndComplete(scope, actionId, attempt, validated.buffer);
    }
    return this.getAttempt(scope, actionId, key);
  }
  async abandon(
    scope: ActionScope,
    actionId: string,
    key: string,
    input: AbandonEvidenceUploadInput,
  ): Promise<EvidenceUploadAttempt> {
    return this.repository.transaction(async (tx) => {
      const action = await this.context(tx, scope, actionId);
      const attempt = await this.attempt(tx, scope, actionId, key);
      if (
        attempt.attemptVersion !== input.attemptVersion ||
        ['COMPLETED', 'ABANDONED'].includes(attempt.state)
      )
        throw new ConflictException('Attempt changed or terminal');
      const updated = await tx.evidenceUploadAttempt.update({
        where: { id: attempt.id },
        data: {
          state: 'ABANDONED',
          abandonReason: input.reason,
          leaseToken: null,
          leaseExpiresAt: null,
          attemptVersion: { increment: 1 },
        },
      });
      return this.dto(tx, updated, action.version);
    });
  }
  async usage(
    scope: ActionScope,
    actionId: string,
    evidenceId: string,
    page: { page: number; pageSize: number },
  ): Promise<EvidenceUsage> {
    return this.repository.snapshot(async (tx) => {
      await this.repository.get(tx, scope.organizationId, actionId);
      if (
        !(await tx.actionEvidence.findFirst({
          where: { id: evidenceId, organizationId: scope.organizationId, actionId },
        }))
      )
        throw new NotFoundException();
      const filter = {
        organizationId: scope.organizationId,
        actionId,
        proofPackage: { path: ['files'], array_contains: [{ id: evidenceId }] },
      };
      const [opinionTotal, closureTotal, rows] = await Promise.all([
        tx.actionEfficacyOpinion.count({ where: filter }),
        tx.actionTechnicalClosure.count({ where: filter }),
        tx.$queryRaw<Array<{ kind: string; id: string; sequence: number; createdAt: Date }>>`
          SELECT kind,id,sequence,created_at AS "createdAt" FROM (
            SELECT 'OPINION' AS kind,id,sequence,created_at FROM action_efficacy_opinions
            WHERE organization_id=${scope.organizationId}::uuid AND action_id=${actionId}::uuid AND proof_package @> ${JSON.stringify({ files: [{ id: evidenceId }] })}::jsonb
            UNION ALL
            SELECT 'TECHNICAL_CLOSURE' AS kind,id,sequence,created_at FROM action_technical_closures
            WHERE organization_id=${scope.organizationId}::uuid AND action_id=${actionId}::uuid AND proof_package @> ${JSON.stringify({ files: [{ id: evidenceId }] })}::jsonb
          ) usage ORDER BY created_at DESC,id ASC LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`,
      ]);
      return evidenceUsageSchema.parse({
        evidenceId,
        opinionTotal,
        closureTotal,
        total: opinionTotal + closureTotal,
        ...page,
        items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      });
    });
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
      await lockOperationalActor(tx, scope, true);
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
