import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  deriveEfficacyValidity,
  efficacyContextSchema,
  efficacyOpinionSchema,
  efficacyProofPackageSchema,
  efficacyCurrentRiskContextSchema,
  type CreateEfficacyOpinionInput,
  type EfficacyContext,
  type EfficacyOpinion,
  type EfficacyOpinionList,
  type EfficacyProofPackage,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import {
  ActionsRepository,
  operational,
  referenceDate,
  type ActionScope,
  type ActionRecord,
} from '../actions/actions.repository';
import { assertActionVersion } from '../actions/actions.service';
import { assertTechnicalScope } from '../technical-evaluations/technical-scope';
import { toRisk } from '../risks/risks.repository';
import { efficacyFingerprints, hashEfficacyScalars } from './efficacy-fingerprint';

const opinionInclude = {
  author: { select: { id: true, name: true } },
  revision: { select: { id: true } },
} satisfies Prisma.ActionEfficacyOpinionInclude;
type OpinionRecord = Prisma.ActionEfficacyOpinionGetPayload<{ include: typeof opinionInclude }>;
type Page = { page: number; pageSize: number };

function originActive(record: ActionRecord): boolean {
  const group = record.risk.assessmentGroup;
  return (
    record.organization.isActive &&
    record.risk.status === 'REGISTERED' &&
    group.isActive &&
    group.sector.isActive &&
    group.sector.unit.isActive
  );
}

@Injectable()
export class ActionEfficacyService {
  constructor(private readonly actions: ActionsRepository) {}

  private async membership(tx: Prisma.TransactionClient, scope: ActionScope) {
    const membership = await tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
      },
    });
    if (!membership?.isActive)
      throw new ForbiddenException('Active organizational membership required');
    return membership;
  }
  private latest(tx: Prisma.TransactionClient, scope: ActionScope, actionId: string) {
    return tx.actionEfficacyOpinion.findFirst({
      where: { organizationId: scope.organizationId, actionId },
      orderBy: { sequence: 'desc' },
      include: opinionInclude,
    });
  }
  async opinionsInTransaction(
    tx: Prisma.TransactionClient,
    record: ActionRecord,
    rows: OpinionRecord[],
    latestId: string | null,
  ): Promise<EfficacyOpinion[]> {
    const fingerprints = efficacyFingerprints(operational(record), toRisk(record.risk));
    const parsed = rows.map((row) => ({
      row,
      proof: efficacyProofPackageSchema.parse(row.proofPackage),
    }));
    const ids = [...new Set(parsed.flatMap((item) => item.proof.files.map((file) => file.id)))];
    const currentFiles = ids.length
      ? await tx.actionEvidence.findMany({
          where: { organizationId: record.organizationId, actionId: record.id, id: { in: ids } },
          select: { id: true, sha256: true, archivedAt: true },
        })
      : [];
    const files = new Map(currentFiles.map((file) => [file.id, file]));
    return parsed.map(({ row, proof }) =>
      efficacyOpinionSchema.parse({
        id: row.id,
        organizationId: row.organizationId,
        actionId: row.actionId,
        riskId: row.riskId,
        sequence: row.sequence,
        supersedesId: row.supersedesId,
        actionVersion: row.actionVersion,
        actionRevisionId: row.revision.id,
        actionSnapshot: row.actionSnapshot,
        riskContextSnapshot: row.riskContextSnapshot,
        actionFingerprint: row.actionFingerprint,
        riskContextFingerprint: row.riskContextFingerprint,
        contextFingerprint: row.contextFingerprint,
        criterionReference: row.criterionReference,
        result: row.result,
        verifiedOn: row.verifiedOn.toISOString().slice(0, 10),
        observation: row.observation,
        rationale: row.rationale,
        nextSteps: row.nextSteps,
        proofPackage: proof,
        author: row.author,
        createdAt: row.createdAt.toISOString(),
        ...deriveEfficacyValidity({
          isLatest: row.id === latestId,
          ...fingerprints,
          opinionActionFingerprint: row.actionFingerprint,
          opinionRiskContextFingerprint: row.riskContextFingerprint,
          originActive: originActive(record),
          selectedEvidence: proof.files.map((file) => {
            const current = files.get(file.id);
            return {
              available: !!current,
              archived: !!current?.archivedAt,
              hashMatches: current?.sha256 === file.sha256,
            };
          }),
        }),
      }),
    );
  }
  async contextInTransaction(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    record: ActionRecord,
  ): Promise<EfficacyContext> {
    const member = await this.membership(tx, scope);
    const revision = await tx.actionRevision.findUnique({
      where: { actionId_version: { actionId: record.id, version: record.version } },
      select: { id: true },
    });
    if (!revision) throw new ConflictException('Operational revision unavailable');
    const latest = await this.latest(tx, scope, record.id);
    const opinion = latest
      ? (await this.opinionsInTransaction(tx, record, [latest], latest.id))[0]!
      : null;
    const hasTechnicalCapability = member.capabilities.includes('TECHNICAL_DECISIONS');
    const active = originActive(record);
    const blockingReasons: EfficacyContext['blockingReasons'] = [];
    if (!hasTechnicalCapability) blockingReasons.push('NO_TECHNICAL_CAPABILITY');
    if (record.status !== 'IMPLEMENTED') blockingReasons.push('ACTION_NOT_IMPLEMENTED');
    if (!active) blockingReasons.push('ORIGIN_INACTIVE');
    return efficacyContextSchema.parse({
      organizationId: scope.organizationId,
      actionId: record.id,
      riskId: record.riskId,
      actionVersion: record.version,
      actionRevisionId: revision.id,
      actionSnapshot: operational(record),
      riskContextSnapshot: efficacyCurrentRiskContextSchema.strip().parse(toRisk(record.risk)),
      ...efficacyFingerprints(operational(record), toRisk(record.risk)),
      referenceDate: referenceDate(record.organization.timezone, new Date()),
      timeZone: record.organization.timezone,
      state: opinion?.validity ?? 'ABSENT',
      latest: opinion,
      permissions: { hasTechnicalCapability, canRecord: !blockingReasons.length },
      blockingReasons,
    });
  }
  get(scope: ActionScope, actionId: string): Promise<EfficacyContext> {
    return this.actions.snapshot(async (tx) =>
      this.contextInTransaction(
        tx,
        scope,
        await this.actions.get(tx, scope.organizationId, actionId),
      ),
    );
  }
  list(scope: ActionScope, actionId: string, page: Page): Promise<EfficacyOpinionList> {
    return this.actions.snapshot(async (tx) => {
      await this.membership(tx, scope);
      const record = await this.actions.get(tx, scope.organizationId, actionId);
      const where = { organizationId: scope.organizationId, actionId };
      const latest = await this.latest(tx, scope, actionId);
      const rows = await tx.actionEfficacyOpinion.findMany({
        where,
        include: opinionInclude,
        orderBy: { sequence: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: await this.opinionsInTransaction(tx, record, rows, latest?.id ?? null),
        total: await tx.actionEfficacyOpinion.count({ where }),
        ...page,
      };
    });
  }
  opinion(scope: ActionScope, actionId: string, id: string): Promise<EfficacyOpinion> {
    return this.actions.snapshot(async (tx) => {
      await this.membership(tx, scope);
      const record = await this.actions.get(tx, scope.organizationId, actionId);
      const row = await tx.actionEfficacyOpinion.findFirst({
        where: { id, actionId, organizationId: scope.organizationId },
        include: opinionInclude,
      });
      if (!row) throw new NotFoundException();
      const latest = await this.latest(tx, scope, actionId);
      return (await this.opinionsInTransaction(tx, record, [row], latest?.id ?? null))[0]!;
    });
  }
  create(
    scope: ActionScope,
    actionId: string,
    input: CreateEfficacyOpinionInput,
  ): Promise<EfficacyOpinion> {
    return this.actions.transaction(async (tx) => {
      await assertTechnicalScope(tx, scope);
      const source = await tx.action.findFirst({
        where: { id: actionId, organizationId: scope.organizationId },
        select: { riskId: true },
      });
      if (!source) throw new NotFoundException();
      await tx.$queryRaw`SELECT id FROM risks WHERE organization_id=${scope.organizationId}::uuid AND id=${source.riskId}::uuid FOR SHARE`;
      await this.actions.lock(tx, scope.organizationId, actionId);
      await tx.$queryRaw`SELECT g.id FROM assessment_groups g JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id JOIN risks r ON r.organization_id=g.organization_id AND r.assessment_group_id=g.id WHERE r.organization_id=${scope.organizationId}::uuid AND r.id=${source.riskId}::uuid FOR SHARE OF g,s,u`;
      const record = await this.actions.get(tx, scope.organizationId, actionId);
      assertActionVersion(record, input.expectedVersion);
      const context = await this.contextInTransaction(tx, scope, record);
      if (!context.permissions.canRecord)
        throw new ConflictException('Implemented action and active origin required');
      if (
        input.expectedLatestOpinionId !== (context.latest?.id ?? null) ||
        input.expectedContextFingerprint !== context.contextFingerprint
      )
        throw new ConflictException(
          'Technical context or latest opinion changed; review the current record',
        );
      if (input.verifiedOn > context.referenceDate)
        throw new ConflictException('Verification date is in the future for this organization');
      const ids = [...input.evidenceIds].sort();
      if (ids.length)
        await tx.$queryRaw`SELECT id FROM action_evidence WHERE organization_id=${scope.organizationId}::uuid AND action_id=${actionId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
      const files = ids.length
        ? await tx.actionEvidence.findMany({
            where: { organizationId: scope.organizationId, actionId, id: { in: ids } },
            orderBy: { id: 'asc' },
          })
        : [];
      if (files.length !== ids.length)
        throw new NotFoundException('Evidence unavailable for this action');
      if (files.some((file) => file.archivedAt))
        throw new ConflictException('Selected evidence was archived');
      const proofPackage: EfficacyProofPackage = {
        files: files.map((file) => ({
          id: file.id,
          fileName: file.fileName,
          description: file.description,
          mimeType: file.mimeType,
          size: file.size,
          sha256: file.sha256,
        })),
        texts: input.textualEvidence.map((text) => ({
          ...text,
          id: randomUUID(),
          sha256: hashEfficacyScalars(text),
        })),
      };
      const row = await tx.actionEfficacyOpinion.create({
        data: {
          organizationId: scope.organizationId,
          actionId,
          riskId: record.riskId,
          sequence: (context.latest?.sequence ?? 0) + 1,
          supersedesId: context.latest?.id ?? null,
          actionVersion: record.version,
          actionSnapshot: context.actionSnapshot as Prisma.InputJsonValue,
          riskContextSnapshot: context.riskContextSnapshot as Prisma.InputJsonValue,
          actionFingerprint: context.actionFingerprint,
          riskContextFingerprint: context.riskContextFingerprint,
          contextFingerprint: context.contextFingerprint,
          criterionReference: record.verificationCriterion,
          result: input.result,
          verifiedOn: new Date(`${input.verifiedOn}T00:00:00Z`),
          observation: input.observation,
          rationale: input.rationale,
          nextSteps: input.nextSteps ?? null,
          proofPackage: proofPackage as Prisma.InputJsonValue,
          authorId: scope.userId,
        },
        include: opinionInclude,
      });
      await tx.auditEvent.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          resourceId: row.id,
          action: 'ACTION_EFFICACY_RECORDED',
        },
      });
      return (await this.opinionsInTransaction(tx, record, [row], row.id))[0]!;
    });
  }
}
