import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  canAuthorRiskContribution,
  canViewRiskContribution,
  canViewRiskContributionAttachment,
  canViewRiskContributionRevision,
  riskContributionListSchema,
  riskContributionRevisionSnapshotSchema,
  riskContributionSchema,
  viewerSpecialtiesForActor,
  type ArchiveRiskContributionAttachmentInput,
  type ArchiveRiskContributionInput,
  type Capability,
  type CreateRiskContributionInput,
  type RiskContribution,
  type RiskContributionActorContext,
  type RiskContributionList,
  type RiskContributionQuery,
  type RiskContributionSpecialty,
  type RiskContributionVisibility,
  type ShareRiskContributionInput,
  type UpdateRiskContributionInput,
  type UploadRiskContributionAttachmentInput,
} from '@renr/contracts';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { combineCapabilities } from '../access/capabilities';
import { riskDelegation, type OrganizationScope } from '../access/delegated-scope';
import { assertContractAccessAllowed } from '../commercial/contract-access';
import { EvidenceStorage } from '../evidence/evidence.storage';
import { CollaborationWritesDisabledException } from './risk-collaboration.errors';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

const membershipUserSelect = {
  include: { user: { select: { id: true, name: true } } },
} as const;

const contributionInclude = {
  authorMembership: membershipUserSelect,
  sharedByMembership: membershipUserSelect,
  archivedByMembership: membershipUserSelect,
  revisions: {
    orderBy: [{ version: 'desc' as const }],
    include: { authorMembership: membershipUserSelect },
  },
  attachments: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
    include: {
      createdByMembership: membershipUserSelect,
      archivedByMembership: membershipUserSelect,
    },
  },
} satisfies Prisma.RiskTechnicalContributionInclude;

type ContributionRecord = Prisma.RiskTechnicalContributionGetPayload<{
  include: typeof contributionInclude;
}>;

export interface UploadedContributionFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function detectAllowedMime(
  fileName: string,
  declaredMime: string,
  buffer: Buffer,
): 'application/pdf' | 'image/png' | 'image/jpeg' {
  const lower = fileName.trim().toLowerCase();
  const extMatch = /\.([a-z0-9]+)$/.exec(lower);
  const ext = extMatch ? `.${extMatch[1]}` : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException({
      details: [{ field: 'file', message: 'Extensão não suportada. Envie PDF, PNG ou JPEG.' }],
    });
  }
  const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isJpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  if (ext === '.pdf' && isPdf && (declaredMime === 'application/pdf' || !declaredMime))
    return 'application/pdf';
  if (ext === '.png' && isPng && (declaredMime === 'image/png' || !declaredMime))
    return 'image/png';
  if (
    (ext === '.jpg' || ext === '.jpeg') &&
    isJpeg &&
    (declaredMime === 'image/jpeg' || !declaredMime)
  )
    return 'image/jpeg';

  throw new BadRequestException({
    details: [
      { field: 'file', message: 'Arquivo incompatível com a extensão ou assinatura permitida.' },
    ],
  });
}

function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? 'anexo';
  const stripped = Array.from(base, (char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || '"<>|:*?'.includes(char) ? '_' : char;
  }).join('');
  const cleaned = stripped.replace(/\s+/g, ' ').trim();
  const normalized = cleaned.length > 100 ? cleaned.slice(-100) : cleaned;
  return normalized.length >= 3 ? normalized : 'anexo.pdf';
}

function personFromMembership(
  membership: { user: { id: string; name: string } } | null | undefined,
) {
  return membership ? { id: membership.user.id, name: membership.user.name } : null;
}

@Injectable()
export class RiskCollaborationService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: EvidenceStorage,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  assertWritesEnabled(): void {
    if (!this.environment.RISK_COLLABORATION_WRITES_ENABLED) {
      throw new CollaborationWritesDisabledException();
    }
  }

  private async resolveActor(
    tx: Prisma.TransactionClient,
    scope: OrganizationScope,
  ): Promise<RiskContributionActorContext> {
    const member = await tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
      },
      include: { organization: { select: { isActive: true } } },
    });
    if (!member || !member.isActive || !member.organization.isActive) {
      throw new ForbiddenException('Active organizational membership required');
    }
    await assertContractAccessAllowed(tx, scope.organizationId);
    const capabilities: Capability[] = member.scopeRestricted ? [] : combineCapabilities(member);
    return {
      role: member.role,
      capabilities,
      isActive: member.isActive && member.organization.isActive,
      inScope: true,
    };
  }

  private async lockActorForWrite(
    tx: Prisma.TransactionClient,
    scope: OrganizationScope,
    specialty: RiskContributionSpecialty,
  ): Promise<RiskContributionActorContext> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id=${scope.userId}::uuid FOR SHARE`;
    const actor = await this.resolveActor(tx, scope);
    if (!canAuthorRiskContribution(actor, specialty)) {
      throw new ForbiddenException('Specialty technical capability required');
    }
    return actor;
  }

  private async verifyRiskInScope(
    tx: Prisma.TransactionClient,
    scope: OrganizationScope,
    riskId: string,
    lock = false,
  ) {
    if (lock) {
      await tx.$queryRaw`SELECT id FROM risks WHERE organization_id=${scope.organizationId}::uuid AND id=${riskId}::uuid FOR SHARE`;
    }
    const risk = await tx.risk.findFirst({
      where: {
        id: riskId,
        organizationId: scope.organizationId,
        ...riskDelegation(scope.delegation),
      },
      include: {
        assessmentGroup: {
          include: {
            sector: { include: { unit: true, organization: { select: { isActive: true } } } },
          },
        },
      },
    });
    if (!risk) throw new NotFoundException();
    return risk;
  }

  private toDto(
    record: ContributionRecord,
    actor: RiskContributionActorContext,
    actorUserId: string,
  ): RiskContribution {
    const writesEnabled = this.environment.RISK_COLLABORATION_WRITES_ENABLED;
    const isAuthor = record.authorId === actorUserId;
    const hasSpecialty = canAuthorRiskContribution(actor, record.specialty);
    const active = record.status === 'ACTIVE';
    const canModify = writesEnabled && active && isAuthor && hasSpecialty;

    let unavailableReason: string | null = null;
    if (!writesEnabled) {
      unavailableReason =
        'Gravação desabilitada neste ambiente aguardando validação de negócio das especialidades.';
    } else if (!active) {
      unavailableReason = 'Contribuição arquivada · somente leitura com histórico preservado.';
    } else if (!hasSpecialty) {
      unavailableReason =
        record.specialty === 'SST'
          ? 'Alterações exigem capacidade de Decisões técnicas (SST).'
          : 'Alterações exigem capacidade de Colaboração técnica (Psicologia Organizacional).';
    } else if (!isAuthor) {
      unavailableReason =
        'Apenas a autoria original pode editar, compartilhar ou arquivar este registro.';
    }

    const visibleRevisions = record.revisions
      .filter((rev) => canViewRiskContributionRevision(actor, record, rev.visibility))
      .map((rev) => ({
        id: rev.id,
        organizationId: rev.organizationId,
        riskId: rev.riskId,
        contributionId: rev.contributionId,
        version: rev.version,
        event: rev.event,
        visibility: rev.visibility,
        snapshot: riskContributionRevisionSnapshotSchema.parse(rev.snapshot),
        changeReason: rev.changeReason,
        author: personFromMembership(rev.authorMembership)!,
        createdAt: rev.createdAt.toISOString(),
      }));

    const visibleAttachments = record.attachments
      .filter((att) => canViewRiskContributionAttachment(actor, record, att.visibility))
      .map((att) => ({
        id: att.id,
        organizationId: att.organizationId,
        riskId: att.riskId,
        contributionId: att.contributionId,
        contributionVersion: att.contributionVersion,
        visibility: att.visibility,
        description: att.description,
        fileName: att.fileName,
        mimeType: att.mimeType,
        size: att.size,
        sha256: att.sha256,
        version: att.version,
        createdBy: personFromMembership(att.createdByMembership)!,
        createdAt: att.createdAt.toISOString(),
        archivedAt: att.archivedAt ? att.archivedAt.toISOString() : null,
        archivedBy: personFromMembership(att.archivedByMembership),
        archiveReason: att.archiveReason,
      }));

    return riskContributionSchema.parse({
      id: record.id,
      organizationId: record.organizationId,
      riskId: record.riskId,
      specialty: record.specialty,
      kind: record.kind,
      status: record.status,
      visibility: record.visibility,
      title: record.title,
      workFactors: record.workFactors,
      preventiveRecommendations: record.preventiveRecommendations,
      nextStep: record.nextStep,
      sourceRiskVersion: record.sourceRiskVersion,
      version: record.version,
      author: personFromMembership(record.authorMembership)!,
      sharedAt: record.sharedAt ? record.sharedAt.toISOString() : null,
      sharedBy: personFromMembership(record.sharedByMembership),
      archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
      archivedBy: personFromMembership(record.archivedByMembership),
      archiveReason: record.archiveReason,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      attachments: visibleAttachments,
      revisions: visibleRevisions,
      permissions: {
        canEdit: canModify,
        canShare: canModify && record.visibility === 'RESTRICTED',
        canArchive: canModify,
        canAttach: canModify,
        unavailableReason,
      },
    });
  }

  private snapshotFor(record: {
    kind: RiskContribution['kind'];
    title: string;
    workFactors: string;
    preventiveRecommendations: string;
    nextStep: string | null;
    status: RiskContribution['status'];
    visibility: RiskContributionVisibility;
  }): Prisma.InputJsonValue {
    return riskContributionRevisionSnapshotSchema.parse({
      kind: record.kind,
      title: record.title,
      workFactors: record.workFactors,
      preventiveRecommendations: record.preventiveRecommendations,
      nextStep: record.nextStep,
      status: record.status,
      visibility: record.visibility,
    }) as Prisma.InputJsonValue;
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    scope: OrganizationScope,
    contributionId: string,
    action: string,
    version: number,
    referenceId?: string,
  ) {
    // Never store riskId as resourceId or free-text content in AuditEvent so RESTRICTED data never leaks to SST PDFs.
    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        resourceId: contributionId,
        action,
        resourceType: 'risk-technical-contribution',
        reason: null,
        referenceType: referenceId ? 'risk-technical-contribution-revision' : null,
        referenceId: referenceId ?? null,
        version,
      },
    });
  }

  async list(
    scope: OrganizationScope,
    riskId: string,
    query: RiskContributionQuery,
  ): Promise<RiskContributionList> {
    return this.database.client.$transaction(
      async (tx) => {
        const actor = await this.resolveActor(tx, scope);
        await this.verifyRiskInScope(tx, scope, riskId, false);
        const viewerSpecialties = viewerSpecialtiesForActor(actor);

        const visibilityClause: Prisma.RiskTechnicalContributionWhereInput =
          viewerSpecialties.length > 0
            ? {
                OR: [
                  { visibility: 'SHARED' },
                  { visibility: 'RESTRICTED', specialty: { in: viewerSpecialties } },
                ],
              }
            : { visibility: 'SHARED' };

        const where: Prisma.RiskTechnicalContributionWhereInput = {
          organizationId: scope.organizationId,
          riskId,
          ...(query.includeArchived ? {} : { status: 'ACTIVE' }),
          ...(query.specialty ? { specialty: query.specialty } : {}),
          ...(query.visibility ? { visibility: query.visibility } : {}),
          AND: [visibilityClause],
        };

        const [records, total] = await Promise.all([
          tx.riskTechnicalContribution.findMany({
            where,
            include: contributionInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.riskTechnicalContribution.count({ where }),
        ]);

        return riskContributionListSchema.parse({
          writesEnabled: this.environment.RISK_COLLABORATION_WRITES_ENABLED,
          viewerSpecialties,
          items: records.map((record) => this.toDto(record, actor, scope.userId)),
          total,
          page: query.page,
          pageSize: query.pageSize,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async get(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
  ): Promise<RiskContribution> {
    return this.database.client.$transaction(
      async (tx) => {
        const actor = await this.resolveActor(tx, scope);
        await this.verifyRiskInScope(tx, scope, riskId, false);
        const record = await tx.riskTechnicalContribution.findFirst({
          where: { id: contributionId, organizationId: scope.organizationId, riskId },
          include: contributionInclude,
        });
        if (!record || !canViewRiskContribution(actor, record)) {
          throw new NotFoundException();
        }
        return this.toDto(record, actor, scope.userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async create(
    scope: OrganizationScope,
    riskId: string,
    input: CreateRiskContributionInput,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    return this.database.client.$transaction(async (tx) => {
      const actor = await this.lockActorForWrite(tx, scope, input.specialty);
      const risk = await this.verifyRiskInScope(tx, scope, riskId, true);
      if (risk.version !== input.expectedRiskVersion) {
        throw new ConflictException('Risk version changed');
      }
      const sector = risk.assessmentGroup.sector;
      if (
        risk.status === 'ARCHIVED' ||
        !risk.assessmentGroup.isActive ||
        !sector.isActive ||
        !sector.unit.isActive ||
        !sector.organization.isActive
      ) {
        throw new ConflictException(
          'Active non-archived risk required for technical collaboration',
        );
      }

      const now = new Date();
      const isShared = input.visibility === 'SHARED';
      const created = await tx.riskTechnicalContribution.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          specialty: input.specialty,
          kind: input.kind,
          status: 'ACTIVE',
          visibility: input.visibility,
          title: input.title,
          workFactors: input.workFactors,
          preventiveRecommendations: input.preventiveRecommendations,
          nextStep: input.nextStep ?? null,
          sourceRiskVersion: risk.version,
          version: 1,
          authorId: scope.userId,
          sharedAt: isShared ? now : null,
          sharedById: isShared ? scope.userId : null,
        },
      });
      const revision = await tx.riskTechnicalContributionRevision.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          contributionId: created.id,
          version: 1,
          event: 'CREATED',
          visibility: created.visibility,
          snapshot: this.snapshotFor(created),
          changeReason: null,
          authorId: scope.userId,
        },
      });
      await this.recordAudit(tx, scope, created.id, 'RISK_CONTRIBUTION_CREATED', 1, revision.id);
      const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
        where: { id: created.id },
        include: contributionInclude,
      });
      return this.toDto(loaded, actor, scope.userId);
    });
  }

  private async lockOwnedContribution(
    tx: Prisma.TransactionClient,
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    expectedVersion: number,
  ) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id=${scope.userId}::uuid FOR SHARE`;
    const actor = await this.resolveActor(tx, scope);
    await this.verifyRiskInScope(tx, scope, riskId, true);
    await tx.$queryRaw`SELECT id FROM risk_technical_contributions WHERE organization_id=${scope.organizationId}::uuid AND risk_id=${riskId}::uuid AND id=${contributionId}::uuid FOR UPDATE`;
    const existing = await tx.riskTechnicalContribution.findFirst({
      where: { id: contributionId, organizationId: scope.organizationId, riskId },
    });
    if (!existing) throw new NotFoundException();
    if (!canViewRiskContribution(actor, existing)) throw new NotFoundException();
    if (
      existing.authorId !== scope.userId ||
      !canAuthorRiskContribution(actor, existing.specialty)
    ) {
      throw new ForbiddenException(
        'Only the original author with active specialty capability may modify',
      );
    }
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Archived contribution is read-only');
    }
    if (existing.version !== expectedVersion || existing.version === 2147483647) {
      throw new ConflictException('Contribution version changed');
    }
    return { actor, existing };
  }

  async update(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    input: UpdateRiskContributionInput,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    return this.database.client.$transaction(async (tx) => {
      const { actor, existing } = await this.lockOwnedContribution(
        tx,
        scope,
        riskId,
        contributionId,
        input.expectedVersion,
      );
      const nextVersion = existing.version + 1;
      const updated = await tx.riskTechnicalContribution.update({
        where: { id: existing.id },
        data: {
          kind: input.kind ?? existing.kind,
          title: input.title ?? existing.title,
          workFactors: input.workFactors ?? existing.workFactors,
          preventiveRecommendations:
            input.preventiveRecommendations ?? existing.preventiveRecommendations,
          nextStep: input.nextStep !== undefined ? input.nextStep : existing.nextStep,
          version: nextVersion,
        },
      });
      const revision = await tx.riskTechnicalContributionRevision.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          contributionId: existing.id,
          version: nextVersion,
          event: 'UPDATED',
          visibility: updated.visibility,
          snapshot: this.snapshotFor(updated),
          changeReason: input.changeReason,
          authorId: scope.userId,
        },
      });
      await this.recordAudit(
        tx,
        scope,
        existing.id,
        'RISK_CONTRIBUTION_UPDATED',
        nextVersion,
        revision.id,
      );
      const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
        where: { id: existing.id },
        include: contributionInclude,
      });
      return this.toDto(loaded, actor, scope.userId);
    });
  }

  async share(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    input: ShareRiskContributionInput,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    return this.database.client.$transaction(async (tx) => {
      const { actor, existing } = await this.lockOwnedContribution(
        tx,
        scope,
        riskId,
        contributionId,
        input.expectedVersion,
      );
      if (existing.visibility === 'SHARED') {
        throw new ConflictException('Contribution is already shared');
      }
      const nextVersion = existing.version + 1;
      const updated = await tx.riskTechnicalContribution.update({
        where: { id: existing.id },
        data: {
          visibility: 'SHARED',
          sharedAt: new Date(),
          sharedById: scope.userId,
          version: nextVersion,
        },
      });
      if (input.shareAttachments) {
        const restrictedAttachments = await tx.riskTechnicalContributionAttachment.findMany({
          where: {
            organizationId: scope.organizationId,
            contributionId: existing.id,
            visibility: 'RESTRICTED',
            archivedAt: null,
          },
          orderBy: [{ id: 'asc' }],
        });
        for (const attachment of restrictedAttachments) {
          await tx.riskTechnicalContributionAttachment.update({
            where: { id: attachment.id },
            data: { visibility: 'SHARED', version: attachment.version + 1 },
          });
        }
      }
      const revision = await tx.riskTechnicalContributionRevision.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          contributionId: existing.id,
          version: nextVersion,
          event: 'SHARED',
          visibility: 'SHARED',
          snapshot: this.snapshotFor(updated),
          changeReason: input.reason,
          authorId: scope.userId,
        },
      });
      await this.recordAudit(
        tx,
        scope,
        existing.id,
        'RISK_CONTRIBUTION_SHARED',
        nextVersion,
        revision.id,
      );
      const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
        where: { id: existing.id },
        include: contributionInclude,
      });
      return this.toDto(loaded, actor, scope.userId);
    });
  }

  async archive(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    input: ArchiveRiskContributionInput,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    return this.database.client.$transaction(async (tx) => {
      const { actor, existing } = await this.lockOwnedContribution(
        tx,
        scope,
        riskId,
        contributionId,
        input.expectedVersion,
      );
      const nextVersion = existing.version + 1;
      const updated = await tx.riskTechnicalContribution.update({
        where: { id: existing.id },
        data: {
          status: 'ARCHIVED',
          archivedAt: new Date(),
          archivedById: scope.userId,
          archiveReason: input.reason,
          version: nextVersion,
        },
      });
      const revision = await tx.riskTechnicalContributionRevision.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          contributionId: existing.id,
          version: nextVersion,
          event: 'ARCHIVED',
          visibility: updated.visibility,
          snapshot: this.snapshotFor(updated),
          changeReason: input.reason,
          authorId: scope.userId,
        },
      });
      await this.recordAudit(
        tx,
        scope,
        existing.id,
        'RISK_CONTRIBUTION_ARCHIVED',
        nextVersion,
        revision.id,
      );
      const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
        where: { id: existing.id },
        include: contributionInclude,
      });
      return this.toDto(loaded, actor, scope.userId);
    });
  }

  async assertCanUploadAttachment(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
  ): Promise<void> {
    this.assertWritesEnabled();
    this.storage.assertEnabled();
    await this.database.client.$transaction(async (tx) => {
      const actor = await this.resolveActor(tx, scope);
      await this.verifyRiskInScope(tx, scope, riskId, false);
      const existing = await tx.riskTechnicalContribution.findFirst({
        where: { id: contributionId, organizationId: scope.organizationId, riskId },
      });
      if (!existing || !canViewRiskContribution(actor, existing)) throw new NotFoundException();
      if (
        existing.authorId !== scope.userId ||
        !canAuthorRiskContribution(actor, existing.specialty)
      ) {
        throw new ForbiddenException(
          'Only the original author with active specialty capability may attach',
        );
      }
      if (existing.status === 'ARCHIVED') {
        throw new ConflictException('Archived contribution is read-only');
      }
    });
  }

  async uploadAttachment(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    input: UploadRiskContributionAttachmentInput,
    file: UploadedContributionFile | undefined,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    this.storage.assertEnabled();
    if (!file || !file.buffer || file.size <= 0) {
      throw new BadRequestException({
        details: [{ field: 'file', message: 'Selecione um arquivo PDF, PNG ou JPEG.' }],
      });
    }
    if (file.size > MAX_ATTACHMENT_BYTES || file.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException({
        details: [{ field: 'file', message: 'Arquivo excede o limite de 5 MiB.' }],
      });
    }
    const safeName = sanitizeFileName(file.originalname);
    const mimeType = detectAllowedMime(safeName, file.mimetype, file.buffer);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const ext =
      mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
    const objectKey = `risk-contributions/${scope.organizationId}/${riskId}/${contributionId}/${randomUUID()}${ext}`;

    await this.assertCanUploadAttachment(scope, riskId, contributionId);
    await this.storage.put(objectKey, file.buffer, mimeType, sha256);

    try {
      return await this.database.client.$transaction(async (tx) => {
        const { actor, existing } = await this.lockOwnedContribution(
          tx,
          scope,
          riskId,
          contributionId,
          input.expectedVersion,
        );
        const nextVersion = existing.version + 1;
        const updated = await tx.riskTechnicalContribution.update({
          where: { id: existing.id },
          data: { version: nextVersion },
        });
        const revision = await tx.riskTechnicalContributionRevision.create({
          data: {
            organizationId: scope.organizationId,
            riskId,
            contributionId: existing.id,
            version: nextVersion,
            event: 'ATTACHMENT_ADDED',
            visibility: updated.visibility,
            snapshot: this.snapshotFor(updated),
            changeReason: null,
            authorId: scope.userId,
          },
        });
        await tx.riskTechnicalContributionAttachment.create({
          data: {
            organizationId: scope.organizationId,
            riskId,
            contributionId: existing.id,
            contributionVersion: nextVersion,
            visibility: updated.visibility,
            description: input.description,
            fileName: safeName,
            objectKey,
            mimeType,
            size: file.buffer.length,
            sha256,
            version: 1,
            createdById: scope.userId,
          },
        });
        await this.recordAudit(
          tx,
          scope,
          existing.id,
          'RISK_CONTRIBUTION_ATTACHMENT_ADDED',
          nextVersion,
          revision.id,
        );
        const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
          where: { id: existing.id },
          include: contributionInclude,
        });
        return this.toDto(loaded, actor, scope.userId);
      });
    } catch (error) {
      await this.storage.compensate(objectKey);
      throw error;
    }
  }

  async archiveAttachment(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    attachmentId: string,
    input: ArchiveRiskContributionAttachmentInput,
  ): Promise<RiskContribution> {
    this.assertWritesEnabled();
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id=${scope.userId}::uuid FOR SHARE`;
      const actor = await this.resolveActor(tx, scope);
      await this.verifyRiskInScope(tx, scope, riskId, true);
      await tx.$queryRaw`SELECT id FROM risk_technical_contributions WHERE organization_id=${scope.organizationId}::uuid AND risk_id=${riskId}::uuid AND id=${contributionId}::uuid FOR UPDATE`;
      const existing = await tx.riskTechnicalContribution.findFirst({
        where: { id: contributionId, organizationId: scope.organizationId, riskId },
      });
      if (!existing || !canViewRiskContribution(actor, existing)) throw new NotFoundException();
      if (
        existing.authorId !== scope.userId ||
        !canAuthorRiskContribution(actor, existing.specialty)
      ) {
        throw new ForbiddenException(
          'Only the original author with active specialty capability may archive attachments',
        );
      }
      if (existing.status === 'ARCHIVED') {
        throw new ConflictException('Archived contribution is read-only');
      }
      await tx.$queryRaw`SELECT id FROM risk_technical_contribution_attachments WHERE organization_id=${scope.organizationId}::uuid AND contribution_id=${contributionId}::uuid AND id=${attachmentId}::uuid FOR UPDATE`;
      const attachment = await tx.riskTechnicalContributionAttachment.findFirst({
        where: { id: attachmentId, organizationId: scope.organizationId, contributionId },
      });
      if (!attachment) throw new NotFoundException();
      if (attachment.archivedAt) throw new ConflictException('Attachment already archived');
      if (attachment.version !== input.expectedVersion) {
        throw new ConflictException('Attachment version changed');
      }
      const nextContributionVersion = existing.version + 1;
      const updated = await tx.riskTechnicalContribution.update({
        where: { id: existing.id },
        data: { version: nextContributionVersion },
      });
      const revision = await tx.riskTechnicalContributionRevision.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          contributionId: existing.id,
          version: nextContributionVersion,
          event: 'ATTACHMENT_ARCHIVED',
          visibility: updated.visibility,
          snapshot: this.snapshotFor(updated),
          changeReason: input.reason,
          authorId: scope.userId,
        },
      });
      await tx.riskTechnicalContributionAttachment.update({
        where: { id: attachment.id },
        data: {
          archivedAt: new Date(),
          archivedById: scope.userId,
          archiveReason: input.reason,
          version: attachment.version + 1,
        },
      });
      await this.recordAudit(
        tx,
        scope,
        existing.id,
        'RISK_CONTRIBUTION_ATTACHMENT_ARCHIVED',
        nextContributionVersion,
        revision.id,
      );
      const loaded = await tx.riskTechnicalContribution.findUniqueOrThrow({
        where: { id: existing.id },
        include: contributionInclude,
      });
      return this.toDto(loaded, actor, scope.userId);
    });
  }

  private async authorizeAttachmentRead(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    attachmentId: string,
    lockForShare = false,
  ) {
    return this.database.client.$transaction(
      async (tx) => {
        if (lockForShare) {
          await tx.$queryRaw`SELECT id FROM organizations WHERE id=${scope.organizationId}::uuid FOR SHARE`;
          await tx.$queryRaw`SELECT user_id FROM memberships WHERE organization_id=${scope.organizationId}::uuid AND user_id=${scope.userId}::uuid FOR SHARE`;
        }
        const actor = await this.resolveActor(tx, scope);
        await this.verifyRiskInScope(tx, scope, riskId, false);
        const attachment = await tx.riskTechnicalContributionAttachment.findFirst({
          where: { id: attachmentId, organizationId: scope.organizationId, riskId, contributionId },
          include: { contribution: { select: { specialty: true, visibility: true } } },
        });
        if (
          !attachment ||
          !canViewRiskContributionAttachment(actor, attachment.contribution, attachment.visibility)
        ) {
          throw new NotFoundException();
        }
        return attachment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async downloadAttachment(
    scope: OrganizationScope,
    riskId: string,
    contributionId: string,
    attachmentId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string; size: number }> {
    const attachment = await this.authorizeAttachmentRead(
      scope,
      riskId,
      contributionId,
      attachmentId,
    );
    const stream = await this.storage.get(attachment.objectKey);
    let streamError: unknown = null;
    const onEarlyError = (err: unknown) => {
      streamError = err;
    };
    stream.once('error', onEarlyError);
    try {
      // Post-stream authorization recheck with FOR SHARE to stop concurrent revocation/suspension races
      await this.authorizeAttachmentRead(scope, riskId, contributionId, attachmentId, true);
      if (streamError) throw streamError;
    } catch (error) {
      stream.destroy();
      throw error;
    } finally {
      stream.off('error', onEarlyError);
    }
    return {
      stream,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  }
}
