import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  compareTechnicalEvaluations,
  correctiveActionCreatedSchema,
  correctiveActionLinkSchema,
  reassessmentContextSchema,
  riskReassessmentSchema,
  riskReassessmentSummarySchema,
  technicalClosureContextSchema,
  technicalClosureSchema,
  technicalRiskEvaluationSummarySchema,
  type CreateCorrectiveActionInput,
  type CreateRiskReassessmentInput,
  type CreateTechnicalClosureInput,
  type CorrectiveActionCreated,
  type CorrectiveActionList,
  type ReassessmentContext,
  type RiskReassessment,
  type RiskReassessmentList,
  type RiskReassessmentSummary,
  type TechnicalClosure,
  type TechnicalClosureContext,
  type TechnicalClosureList,
  type TechnicalClosureReviewReason,
  type EfficacyContext,
} from '@renr/contracts';
import { Prisma } from '../../generated/prisma/client';
import {
  ActionsRepository,
  type ActionRecord,
  type ActionScope,
} from '../actions/actions.repository';
import { ActionsService, assertActionVersion } from '../actions/actions.service';
import { ActionEfficacyService } from '../action-efficacy/action-efficacy.service';
import { riskInclude, toRisk } from '../risks/risks.repository';
import { assertTechnicalScope } from '../technical-evaluations/technical-scope';
import {
  RiskWorkspacesService,
  technicalContextFingerprint,
  toTechnicalEvaluation,
} from '../technical-evaluations/risk-workspaces.service';

const author = { select: { id: true, name: true } } as const;
const evaluationInclude = { author } as const;
const reassessmentSummaryInclude = {
  author,
  evaluation: { include: evaluationInclude },
  previousEvaluation: { include: evaluationInclude },
  _count: { select: { measures: true } },
} satisfies Prisma.RiskReassessmentInclude;
const reassessmentInclude = {
  ...reassessmentSummaryInclude,
  measures: {
    orderBy: { actionId: 'asc' },
    include: { opinion: { include: { author, revision: { select: { id: true } } } } },
  },
} satisfies Prisma.RiskReassessmentInclude;
const closureInclude = {
  author,
  reassessment: { select: { evaluationId: true } },
} satisfies Prisma.ActionTechnicalClosureInclude;
type ReassessmentSummaryRecord = Prisma.RiskReassessmentGetPayload<{
  include: typeof reassessmentSummaryInclude;
}>;
type ReassessmentRecord = Prisma.RiskReassessmentGetPayload<{
  include: typeof reassessmentInclude;
}>;
type ClosureRecord = Prisma.ActionTechnicalClosureGetPayload<{ include: typeof closureInclude }>;
type Page = { page: number; pageSize: number };

function summary(row: ReassessmentSummaryRecord): RiskReassessmentSummary {
  const evaluation = toTechnicalEvaluation(row.evaluation);
  const previousEvaluation = toTechnicalEvaluation(row.previousEvaluation);
  return riskReassessmentSummarySchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    riskId: row.riskId,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
    evaluation: technicalRiskEvaluationSummarySchema.strip().parse(evaluation),
    previousEvaluation: technicalRiskEvaluationSummarySchema.strip().parse(previousEvaluation),
    comparison: compareTechnicalEvaluations(previousEvaluation, evaluation),
    measureCount: row._count.measures,
  });
}

@Injectable()
export class RiskContinuityService {
  constructor(
    private readonly actions: ActionsRepository,
    private readonly operational: ActionsService,
    private readonly efficacy: ActionEfficacyService,
    private readonly evaluations: RiskWorkspacesService,
  ) {}

  private async member(tx: Prisma.TransactionClient, scope: ActionScope) {
    const member = await tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: scope.userId, organizationId: scope.organizationId },
      },
    });
    if (!member?.isActive) throw new ForbiddenException('Active membership required');
    return member;
  }
  private async risk(tx: Prisma.TransactionClient, scope: ActionScope, riskId: string) {
    const record = await tx.risk.findFirst({
      where: { id: riskId, organizationId: scope.organizationId },
      include: riskInclude,
    });
    if (!record) throw new NotFoundException();
    return record;
  }
  private latestEvaluation(tx: Prisma.TransactionClient, scope: ActionScope, riskId: string) {
    return tx.technicalRiskEvaluation.findFirst({
      where: { riskId, organizationId: scope.organizationId },
      orderBy: { sequence: 'desc' },
      include: evaluationInclude,
    });
  }
  private reassessmentFor(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    evaluationId: string | undefined,
  ) {
    if (!evaluationId) return null;
    return tx.riskReassessment.findFirst({
      where: { organizationId: scope.organizationId, evaluationId },
      include: reassessmentSummaryInclude,
    });
  }
  private latestClosure(tx: Prisma.TransactionClient, scope: ActionScope, actionId: string) {
    return tx.actionTechnicalClosure.findFirst({
      where: { organizationId: scope.organizationId, actionId },
      orderBy: { sequence: 'desc' },
      include: closureInclude,
    });
  }
  private async lockRisk(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    riskId: string,
    write: boolean,
  ) {
    if (write)
      await tx.$queryRaw`SELECT id FROM risks WHERE organization_id=${scope.organizationId}::uuid AND id=${riskId}::uuid FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM risks WHERE organization_id=${scope.organizationId}::uuid AND id=${riskId}::uuid FOR SHARE`;
  }
  private async lockHierarchy(tx: Prisma.TransactionClient, scope: ActionScope, riskId: string) {
    await tx.$queryRaw`SELECT g.id FROM assessment_groups g JOIN sectors s ON s.organization_id=g.organization_id AND s.id=g.sector_id JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id JOIN risks r ON r.organization_id=g.organization_id AND r.assessment_group_id=g.id WHERE r.organization_id=${scope.organizationId}::uuid AND r.id=${riskId}::uuid FOR SHARE OF g,s,u`;
  }
  private async lockProofs(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    contexts: EfficacyContext[],
  ) {
    const ids = [
      ...new Set(
        contexts.flatMap((value) => value.latest?.proofPackage.files.map((file) => file.id) ?? []),
      ),
    ].sort();
    if (ids.length)
      await tx.$queryRaw`SELECT id FROM action_evidence WHERE organization_id=${scope.organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
  }
  private async lockActionContext(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    actionId: string,
    writeRisk = false,
  ) {
    await assertTechnicalScope(tx, scope);
    const source = await tx.action.findFirst({
      where: { id: actionId, organizationId: scope.organizationId },
      select: { riskId: true },
    });
    if (!source) throw new NotFoundException();
    await this.lockRisk(tx, scope, source.riskId, writeRisk);
    await this.actions.lock(tx, scope.organizationId, actionId);
    await this.lockHierarchy(tx, scope, source.riskId);
    const action = await this.actions.get(tx, scope.organizationId, actionId);
    await this.lockProofs(tx, scope, [await this.efficacy.contextInTransaction(tx, scope, action)]);
    return action;
  }

  reassessmentContext(scope: ActionScope, riskId: string): Promise<ReassessmentContext> {
    return this.actions.snapshot(async (tx) => {
      const member = await this.member(tx, scope);
      const risk = await this.risk(tx, scope, riskId);
      const latest = await this.latestEvaluation(tx, scope, riskId);
      const reassessment = await this.reassessmentFor(tx, scope, latest?.id);
      const group = risk.assessmentGroup;
      const blockingReasons: ReassessmentContext['blockingReasons'] = [];
      const hasTechnicalCapability = member.capabilities.includes('TECHNICAL_DECISIONS');
      if (!hasTechnicalCapability) blockingReasons.push('NO_TECHNICAL_CAPABILITY');
      if (!latest) blockingReasons.push('NO_BASELINE');
      if (
        risk.status !== 'REGISTERED' ||
        !group.isActive ||
        !group.sector.isActive ||
        !group.sector.unit.isActive ||
        !group.sector.organization.isActive
      )
        blockingReasons.push('ORIGIN_INACTIVE');
      return reassessmentContextSchema.parse({
        organizationId: scope.organizationId,
        riskId,
        riskVersion: risk.version,
        latestEvaluation: latest ? toTechnicalEvaluation(latest) : null,
        latestReassessment: reassessment ? summary(reassessment) : null,
        permissions: { hasTechnicalCapability, canReassess: !blockingReasons.length },
        blockingReasons,
      });
    });
  }
  evaluation(scope: ActionScope, riskId: string, id: string) {
    return this.actions.snapshot(async (tx) => {
      await this.member(tx, scope);
      await this.risk(tx, scope, riskId);
      const row = await tx.technicalRiskEvaluation.findFirst({
        where: { id, riskId, organizationId: scope.organizationId },
        include: evaluationInclude,
      });
      if (!row) throw new NotFoundException();
      return toTechnicalEvaluation(row);
    });
  }
  private async toReassessment(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    row: ReassessmentRecord,
  ): Promise<RiskReassessment> {
    const measures = [];
    for (const item of row.measures) {
      const action = await this.actions.get(tx, scope.organizationId, item.actionId);
      const current = await this.efficacy.contextInTransaction(tx, scope, action);
      const [opinion] = await this.efficacy.opinionsInTransaction(
        tx,
        action,
        [item.opinion],
        current.latest?.id ?? null,
      );
      measures.push({
        id: item.id,
        actionId: item.actionId,
        actionVersion: item.actionVersion,
        actionFingerprint: item.actionFingerprint,
        riskContextFingerprint: item.riskContextFingerprint,
        contextFingerprint: item.contextFingerprint,
        consideration: item.consideration,
        opinion,
      });
    }
    const evaluation = toTechnicalEvaluation(row.evaluation);
    const previousEvaluation = toTechnicalEvaluation(row.previousEvaluation);
    return riskReassessmentSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      riskId: row.riskId,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
      evaluation,
      previousEvaluation,
      comparison: compareTechnicalEvaluations(previousEvaluation, evaluation),
      measures,
    });
  }
  reassessments(scope: ActionScope, riskId: string, page: Page): Promise<RiskReassessmentList> {
    return this.actions.snapshot(async (tx) => {
      await this.member(tx, scope);
      await this.risk(tx, scope, riskId);
      const where = { organizationId: scope.organizationId, riskId };
      const rows = await tx.riskReassessment.findMany({
        where,
        include: reassessmentSummaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: rows.map(summary),
        total: await tx.riskReassessment.count({ where }),
        ...page,
      };
    });
  }
  reassessment(scope: ActionScope, riskId: string, id: string): Promise<RiskReassessment> {
    return this.actions.snapshot(async (tx) => {
      await this.member(tx, scope);
      await this.risk(tx, scope, riskId);
      const row = await tx.riskReassessment.findFirst({
        where: { id, riskId, organizationId: scope.organizationId },
        include: reassessmentInclude,
      });
      if (!row) throw new NotFoundException();
      return this.toReassessment(tx, scope, row);
    });
  }
  reassess(
    scope: ActionScope,
    riskId: string,
    input: CreateRiskReassessmentInput,
  ): Promise<RiskReassessment> {
    return this.actions.transaction(async (tx) => {
      await assertTechnicalScope(tx, scope);
      await this.lockRisk(tx, scope, riskId, true);
      const risk = await this.risk(tx, scope, riskId);
      const previous = await this.latestEvaluation(tx, scope, riskId);
      if (
        risk.version !== input.evaluation.expectedVersion ||
        previous?.id !== input.expectedPreviousEvaluationId
      )
        throw new ConflictException('Risk or preceding evaluation changed');
      // A reassessment joins a risk-wide evaluation to selected measures. Lock the
      // complete action set before hierarchy, matching the additive SQL guard.
      await tx.$queryRaw`SELECT id FROM actions WHERE organization_id=${scope.organizationId}::uuid AND risk_id=${riskId}::uuid ORDER BY id FOR UPDATE`;
      const ordered = [...input.measures].sort((a, b) => (a.actionId < b.actionId ? -1 : 1));
      const records: ActionRecord[] = [];
      for (const item of ordered) {
        const record = await this.actions.lock(tx, scope.organizationId, item.actionId);
        if (record.riskId !== riskId) throw new NotFoundException();
        records.push(record);
      }
      await this.lockHierarchy(tx, scope, riskId);
      const contexts = [];
      for (const record of records)
        contexts.push(await this.efficacy.contextInTransaction(tx, scope, record));
      await this.lockProofs(tx, scope, contexts);
      const measures = [];
      for (const [index, record] of records.entries()) {
        const item = ordered[index]!;
        assertActionVersion(record, item.expectedVersion);
        const context = await this.efficacy.contextInTransaction(tx, scope, record);
        if (
          context.state !== 'CURRENT' ||
          context.latest?.id !== item.opinionId ||
          context.contextFingerprint !== item.expectedContextFingerprint
        )
          throw new ConflictException('Measure opinion, context or proofs changed');
        measures.push({
          organizationId: scope.organizationId,
          riskId,
          actionId: record.id,
          opinionId: item.opinionId,
          actionVersion: record.version,
          actionFingerprint: context.actionFingerprint,
          riskContextFingerprint: context.riskContextFingerprint,
          contextFingerprint: context.contextFingerprint,
          consideration: item.consideration,
        });
      }
      const evaluation = await this.evaluations.evaluateInTransaction(
        tx,
        scope,
        riskId,
        input.evaluation,
      );
      const reassessment = await tx.riskReassessment.create({
        data: {
          organizationId: scope.organizationId,
          riskId,
          evaluationId: evaluation.id,
          previousEvaluationId: previous.id,
          authorId: scope.userId,
        },
      });
      for (const measure of measures)
        await tx.reassessmentMeasure.create({
          data: { ...measure, reassessmentId: reassessment.id },
        });
      await tx.auditEvent.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          resourceId: reassessment.id,
          action: 'risk.reassessment_created',
        },
      });
      const row = await tx.riskReassessment.findUniqueOrThrow({
        where: { id: reassessment.id },
        include: reassessmentInclude,
      });
      return this.toReassessment(tx, scope, row);
    });
  }

  private closureDto(
    row: ClosureRecord,
    latestId: string | null,
    efficacy: EfficacyContext,
    latestEvaluationId: string | null,
  ): TechnicalClosure {
    const reasons: TechnicalClosureReviewReason[] = [];
    if (row.id === latestId) {
      if (row.actionFingerprint !== efficacy.actionFingerprint)
        reasons.push('ACTION_CONTENT_CHANGED');
      if (row.riskContextFingerprint !== efficacy.riskContextFingerprint)
        reasons.push('RISK_CONTEXT_CHANGED');
      if (efficacy.blockingReasons.includes('ORIGIN_INACTIVE')) reasons.push('ORIGIN_INACTIVE');
      if (row.opinionId !== efficacy.latest?.id) reasons.push('OPINION_SUPERSEDED');
      else reasons.push(...(efficacy.latest?.reviewReasons ?? []));
      if (row.reassessment.evaluationId !== latestEvaluationId)
        reasons.push('REASSESSMENT_SUPERSEDED');
    }
    const reviewReasons = [...new Set(reasons)];
    return technicalClosureSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      riskId: row.riskId,
      actionId: row.actionId,
      sequence: row.sequence,
      supersedesId: row.supersedesId,
      reassessmentId: row.reassessmentId,
      opinionId: row.opinionId,
      actionVersion: row.actionVersion,
      riskVersion: row.riskVersion,
      actionFingerprint: row.actionFingerprint,
      riskContextFingerprint: row.riskContextFingerprint,
      contextFingerprint: row.contextFingerprint,
      proofPackage: row.proofPackage,
      rationale: row.rationale,
      author: row.author,
      createdAt: row.createdAt.toISOString(),
      validity:
        row.id !== latestId ? 'SUPERSEDED' : reviewReasons.length ? 'REVIEW_REQUIRED' : 'CURRENT',
      reviewReasons,
    });
  }
  private async closureContextInTransaction(
    tx: Prisma.TransactionClient,
    scope: ActionScope,
    action: ActionRecord,
  ): Promise<TechnicalClosureContext> {
    const member = await this.member(tx, scope);
    const efficacy = await this.efficacy.contextInTransaction(tx, scope, action);
    const evaluation = await this.latestEvaluation(tx, scope, action.riskId);
    const reassessment = await this.reassessmentFor(tx, scope, evaluation?.id);
    const row = await this.latestClosure(tx, scope, action.id);
    const latest = row ? this.closureDto(row, row.id, efficacy, evaluation?.id ?? null) : null;
    const considered =
      reassessment && efficacy.latest
        ? await tx.reassessmentMeasure.findUnique({
            where: {
              reassessmentId_actionId: { reassessmentId: reassessment.id, actionId: action.id },
            },
          })
        : null;
    const blockingReasons: TechnicalClosureContext['blockingReasons'] = [];
    const hasTechnicalCapability = member.capabilities.includes('TECHNICAL_DECISIONS');
    if (!hasTechnicalCapability) blockingReasons.push('NO_TECHNICAL_CAPABILITY');
    if (action.status !== 'IMPLEMENTED') blockingReasons.push('ACTION_NOT_IMPLEMENTED');
    if (efficacy.blockingReasons.includes('ORIGIN_INACTIVE'))
      blockingReasons.push('ORIGIN_INACTIVE');
    if (efficacy.state !== 'CURRENT' || efficacy.latest?.result !== 'EFFECTIVE')
      blockingReasons.push('NO_CURRENT_EFFECTIVE_OPINION');
    if (
      !reassessment ||
      !evaluation ||
      evaluation.contextFingerprint !== technicalContextFingerprint(toRisk(action.risk))
    )
      blockingReasons.push('NO_CURRENT_REASSESSMENT');
    if (reassessment && considered?.opinionId !== efficacy.latest?.id)
      blockingReasons.push('MEASURE_NOT_CONSIDERED');
    if (latest?.validity === 'CURRENT') blockingReasons.push('ALREADY_CLOSED');
    return technicalClosureContextSchema.parse({
      organizationId: scope.organizationId,
      actionId: action.id,
      riskId: action.riskId,
      riskVersion: action.risk.version,
      efficacy,
      latestEvaluation: evaluation
        ? technicalRiskEvaluationSummarySchema.strip().parse(toTechnicalEvaluation(evaluation))
        : null,
      latestReassessment: reassessment ? summary(reassessment) : null,
      latest,
      permissions: {
        hasTechnicalCapability,
        canClose: !blockingReasons.length,
        canCreateCorrective:
          member.role === 'ADMIN' &&
          hasTechnicalCapability &&
          action.status === 'IMPLEMENTED' &&
          efficacy.state === 'CURRENT',
      },
      blockingReasons,
    });
  }
  closureContext(scope: ActionScope, actionId: string): Promise<TechnicalClosureContext> {
    return this.actions.snapshot(async (tx) =>
      this.closureContextInTransaction(
        tx,
        scope,
        await this.actions.get(tx, scope.organizationId, actionId),
      ),
    );
  }
  closures(scope: ActionScope, actionId: string, page: Page): Promise<TechnicalClosureList> {
    return this.actions.snapshot(async (tx) => {
      const action = await this.actions.get(tx, scope.organizationId, actionId);
      const context = await this.closureContextInTransaction(tx, scope, action);
      const where = { organizationId: scope.organizationId, actionId };
      const rows = await tx.actionTechnicalClosure.findMany({
        where,
        include: closureInclude,
        orderBy: { sequence: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: rows.map((row) =>
          this.closureDto(
            row,
            context.latest?.id ?? null,
            context.efficacy,
            context.latestEvaluation?.id ?? null,
          ),
        ),
        total: await tx.actionTechnicalClosure.count({ where }),
        ...page,
      };
    });
  }
  closure(scope: ActionScope, actionId: string, id: string): Promise<TechnicalClosure> {
    return this.actions.snapshot(async (tx) => {
      const action = await this.actions.get(tx, scope.organizationId, actionId);
      const context = await this.closureContextInTransaction(tx, scope, action);
      const row = await tx.actionTechnicalClosure.findFirst({
        where: { id, actionId, organizationId: scope.organizationId },
        include: closureInclude,
      });
      if (!row) throw new NotFoundException();
      return this.closureDto(
        row,
        context.latest?.id ?? null,
        context.efficacy,
        context.latestEvaluation?.id ?? null,
      );
    });
  }
  close(
    scope: ActionScope,
    actionId: string,
    input: CreateTechnicalClosureInput,
  ): Promise<TechnicalClosure> {
    return this.actions.transaction(async (tx) => {
      const action = await this.lockActionContext(tx, scope, actionId);
      assertActionVersion(action, input.expectedVersion);
      const context = await this.closureContextInTransaction(tx, scope, action);
      if (
        context.riskVersion !== input.expectedRiskVersion ||
        context.latestEvaluation?.id !== input.expectedLatestEvaluationId ||
        (context.latest?.id ?? null) !== input.expectedLatestClosureId ||
        context.efficacy.contextFingerprint !== input.expectedContextFingerprint ||
        context.latestReassessment?.id !== input.reassessmentId ||
        context.efficacy.latest?.id !== input.opinionId ||
        !context.permissions.canClose
      )
        throw new ConflictException('Technical closure prerequisites changed; consult and review');
      const sequence = (context.latest?.sequence ?? 0) + 1;
      if (sequence > 2147483647) throw new ConflictException('Closure sequence limit reached');
      const row = await tx.actionTechnicalClosure.create({
        data: {
          organizationId: scope.organizationId,
          riskId: action.riskId,
          actionId,
          sequence,
          supersedesId: context.latest?.id ?? null,
          reassessmentId: input.reassessmentId,
          opinionId: input.opinionId,
          actionVersion: action.version,
          riskVersion: action.risk.version,
          actionFingerprint: context.efficacy.actionFingerprint,
          riskContextFingerprint: context.efficacy.riskContextFingerprint,
          contextFingerprint: context.efficacy.contextFingerprint,
          proofPackage: context.efficacy.latest!.proofPackage as Prisma.InputJsonValue,
          rationale: input.rationale,
          authorId: scope.userId,
        },
        include: closureInclude,
      });
      await tx.auditEvent.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          resourceId: row.id,
          action: 'action.technical_closure_created',
        },
      });
      return this.closureDto(row, row.id, context.efficacy, context.latestEvaluation!.id);
    });
  }
  correctiveActions(
    scope: ActionScope,
    actionId: string,
    page: Page,
  ): Promise<CorrectiveActionList> {
    return this.actions.snapshot(async (tx) => {
      await this.member(tx, scope);
      await this.actions.get(tx, scope.organizationId, actionId);
      const where = { organizationId: scope.organizationId, previousActionId: actionId };
      const rows = await tx.actionCorrectiveLink.findMany({
        where,
        include: { author },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      });
      return {
        items: rows.map((row) =>
          correctiveActionLinkSchema.parse({
            id: row.id,
            organizationId: row.organizationId,
            riskId: row.riskId,
            previousActionId: row.previousActionId,
            newActionId: row.newActionId,
            opinionId: row.opinionId,
            reason: row.reason,
            author: row.author,
            createdAt: row.createdAt.toISOString(),
          }),
        ),
        total: await tx.actionCorrectiveLink.count({ where }),
        ...page,
      };
    });
  }
  createCorrective(
    scope: ActionScope,
    actionId: string,
    input: CreateCorrectiveActionInput,
  ): Promise<CorrectiveActionCreated> {
    return this.actions.transaction(async (tx) => {
      const action = await this.lockActionContext(tx, scope, actionId, true);
      const member = await this.member(tx, scope);
      if (member.role !== 'ADMIN')
        throw new ForbiddenException(
          'Operational administrator and explicit technical capability required',
        );
      assertActionVersion(action, input.expectedVersion);
      const context = await this.efficacy.contextInTransaction(tx, scope, action);
      if (
        action.status !== 'IMPLEMENTED' ||
        context.state !== 'CURRENT' ||
        context.latest?.id !== input.opinionId ||
        context.contextFingerprint !== input.expectedContextFingerprint
      )
        throw new ConflictException('Corrective action context changed');
      const created = await this.operational.createInTransaction(
        tx,
        scope,
        action.riskId,
        input.action,
      );
      const row = await tx.actionCorrectiveLink.create({
        data: {
          organizationId: scope.organizationId,
          riskId: action.riskId,
          previousActionId: actionId,
          newActionId: created.id,
          opinionId: input.opinionId,
          reason: input.reason,
          authorId: scope.userId,
        },
        include: { author },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          resourceId: row.id,
          action: 'action.corrective_created',
        },
      });
      return correctiveActionCreatedSchema.parse({
        link: {
          id: row.id,
          organizationId: row.organizationId,
          riskId: row.riskId,
          previousActionId: row.previousActionId,
          newActionId: row.newActionId,
          opinionId: row.opinionId,
          reason: row.reason,
          author: row.author,
          createdAt: row.createdAt.toISOString(),
        },
        action: created,
      });
    });
  }
}
