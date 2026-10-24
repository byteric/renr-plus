import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  AssessmentCycleQuery,
  AssessmentConsolidationQuery,
  CreateAssessmentCycle,
  UpdateAssessmentCycle,
  CreateConsolidationPolicy,
  UpdateConsolidationPolicy,
  PublishConsolidationPolicy,
  CreateAssessmentSource,
  SubmitAssessmentResponse,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { projectAssessment, type ResultInput } from './assessment-projection';
type Scope = { userId: string; organizationId: string };
type Page = { page: number; pageSize: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const instrumentInclude = {
  questions: {
    orderBy: { position: 'asc' },
    include: { options: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.InstrumentVersionInclude;
const include = {
  organization: true,
  assessmentGroup: { include: { sector: { include: { unit: true } } } },
  instrumentVersion: { include: instrumentInclude },
  policyVersion: true,
} satisfies Prisma.AssessmentCycleInclude;
type Cycle = Prisma.AssessmentCycleGetPayload<{ include: typeof include }>;
const dto = (c: Cycle) => ({
  id: c.id,
  organizationId: c.organizationId,
  name: c.name,
  assessmentGroupId: c.assessmentGroupId,
  assessmentGroupName: c.assessmentGroup.name,
  sectorId: c.assessmentGroup.sectorId,
  sectorName: c.assessmentGroup.sector.name,
  unitId: c.assessmentGroup.sector.unitId,
  unitName: c.assessmentGroup.sector.unit.name,
  instrumentId: c.instrumentVersion.instrumentId,
  instrumentTitle: c.instrumentVersion.title,
  instrumentVersionId: c.instrumentVersionId,
  instrumentVersion: c.instrumentVersion.version,
  usageMode: c.instrumentVersion.usageMode,
  policyVersionId: c.policyVersionId,
  policyVersion: c.policyVersion.version,
  minimumResponses: c.policyVersion.minimumResponses!,
  status: c.status,
  revision: c.revision,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  closedAt: c.closedAt,
});
const canonical = (input: SubmitAssessmentResponse) =>
  JSON.stringify({
    instrumentVersionId: input.instrumentVersionId,
    answers: input.answers
      .filter((a) => a.optionIds.length)
      .map((a) => ({ questionId: a.questionId, optionIds: [...a.optionIds].sort() }))
      .sort((a, b) => a.questionId.localeCompare(b.questionId)),
  });
@Injectable()
export class AssessmentsService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(private readonly database: PrismaService) {}
  rateLimit(ip: string) {
    const now = Date.now();
    for (const [key, v] of this.attempts) if (v.expires <= now) this.attempts.delete(key);
    const key = hash(ip);
    const value = this.attempts.get(key) ?? { count: 0, expires: now + 60000 };
    if (value.count >= 60 || (!this.attempts.has(key) && this.attempts.size >= 10000))
      throw new HttpException('Too many requests', 429);
    value.count++;
    this.attempts.set(key, value);
  }
  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.client.$transaction(operation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2004', 'P2010'].includes(error.code)
      )
        throw new ConflictException();
      throw error;
    }
  }
  private audit(tx: Prisma.TransactionClient, s: Scope, action: string, resourceId: string) {
    return tx.auditEvent.create({
      data: { actorId: s.userId, organizationId: s.organizationId, action, resourceId },
    });
  }
  private async cycle(tx: Prisma.TransactionClient, s: Scope, id: string) {
    const c = await tx.assessmentCycle.findFirst({
      where: { id, organizationId: s.organizationId },
      include,
    });
    if (!c) throw new NotFoundException();
    return c;
  }
  private async lock(tx: Prisma.TransactionClient, s: Scope, id: string) {
    await tx.$queryRaw`SELECT id FROM assessment_cycles WHERE id=${id}::uuid AND organization_id=${s.organizationId}::uuid FOR UPDATE`;
  }
  private async policy(tx: Prisma.TransactionClient, s: Scope, id: string) {
    const p = await tx.consolidationPolicyVersion.findFirst({
      where: { id, organizationId: s.organizationId },
    });
    if (!p) throw new NotFoundException();
    return p;
  }
  async policies(s: Scope, q: Page) {
    const where = { organizationId: s.organizationId };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.consolidationPolicyVersion.findMany({
        where,
        orderBy: { version: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.database.client.consolidationPolicyVersion.count({ where }),
    ]);
    return { items, total, ...q };
  }
  getPolicy(s: Scope, id: string) {
    return this.policy(this.database.client, s, id);
  }
  private async nextPolicy(
    tx: Prisma.TransactionClient,
    s: Scope,
    input: CreateConsolidationPolicy,
  ) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${s.organizationId}::uuid FOR UPDATE`;
    const latest = await tx.consolidationPolicyVersion.aggregate({
      where: { organizationId: s.organizationId },
      _max: { version: true },
    });
    const p = await tx.consolidationPolicyVersion.create({
      data: { organizationId: s.organizationId, version: (latest._max.version ?? 0) + 1, ...input },
    });
    await this.audit(tx, s, 'assessment.policy.created', p.id);
    return p;
  }
  createPolicy(s: Scope, input: CreateConsolidationPolicy) {
    return this.write((tx) => this.nextPolicy(tx, s, input));
  }
  updatePolicy(s: Scope, id: string, input: UpdateConsolidationPolicy) {
    return this.write(async (tx) => {
      await tx.$queryRaw`SELECT id FROM consolidation_policy_versions WHERE id=${id}::uuid AND organization_id=${s.organizationId}::uuid FOR UPDATE`;
      const p = await this.policy(tx, s, id);
      if (p.status !== 'DRAFT' || p.revision !== input.expectedRevision)
        throw new ConflictException();
      return tx.consolidationPolicyVersion.update({
        where: { id },
        data: {
          usageMode: input.usageMode,
          minimumResponses: input.minimumResponses,
          revision: { increment: 1 },
        },
      });
    });
  }
  publishPolicy(
    s: Scope,
    id: string,
    input: PublishConsolidationPolicy,
    permission: { admin: boolean; technical: boolean },
  ) {
    return this.write(async (tx) => {
      await tx.$queryRaw`SELECT id FROM consolidation_policy_versions WHERE id=${id}::uuid AND organization_id=${s.organizationId}::uuid FOR UPDATE`;
      const p = await this.policy(tx, s, id);
      if (p.status !== 'DRAFT' || p.revision !== input.expectedRevision)
        throw new ConflictException();
      if (p.usageMode === 'REAL' ? !permission.technical : !permission.admin)
        throw new ForbiddenException();
      if (p.minimumResponses === null || (p.usageMode === 'REAL' && !input.approvalReference))
        throw new BadRequestException({
          details: [
            {
              field: 'minimumResponses',
              message: 'Explicit threshold and approval required for REAL publication',
            },
          ],
        });
      const result = await tx.consolidationPolicyVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          revision: { increment: 1 },
          approvalReference: p.usageMode === 'REAL' ? input.approvalReference : null,
          publishedById: s.userId,
          publishedAt: new Date(),
        },
      });
      await this.audit(tx, s, 'assessment.policy.published', id);
      return result;
    });
  }
  forkPolicy(s: Scope, id: string, revision: number) {
    return this.write(async (tx) => {
      const p = await this.policy(tx, s, id);
      if (p.status !== 'PUBLISHED' || p.revision !== revision) throw new ConflictException();
      return this.nextPolicy(tx, s, {
        usageMode: p.usageMode,
        minimumResponses: p.minimumResponses,
      });
    });
  }
  private async context(tx: Prisma.TransactionClient, s: Scope, input: CreateAssessmentCycle) {
    const [g, i, p, o] = await Promise.all([
      tx.assessmentGroup.findFirst({
        where: { id: input.assessmentGroupId, organizationId: s.organizationId },
        include: { sector: { include: { unit: true } } },
      }),
      tx.instrumentVersion.findFirst({
        where: { id: input.instrumentVersionId, organizationId: s.organizationId },
      }),
      tx.consolidationPolicyVersion.findFirst({
        where: { id: input.policyVersionId, organizationId: s.organizationId },
      }),
      tx.organization.findUnique({ where: { id: s.organizationId } }),
    ]);
    if (!g || !i || !p) throw new NotFoundException();
    if (
      !o?.isActive ||
      !g.isActive ||
      !g.sector.isActive ||
      !g.sector.unit.isActive ||
      i.status !== 'PUBLISHED' ||
      p.status !== 'PUBLISHED' ||
      i.usageMode !== p.usageMode
    )
      throw new BadRequestException('Active context and matching published versions required');
  }
  async list(s: Scope, q: AssessmentCycleQuery) {
    const { page, pageSize, ...filters } = q;
    const where = { organizationId: s.organizationId, ...filters };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.assessmentCycle.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.client.assessmentCycle.count({ where }),
    ]);
    return { items: items.map(dto), total, page, pageSize };
  }
  async get(s: Scope, id: string) {
    return dto(await this.cycle(this.database.client, s, id));
  }
  create(s: Scope, input: CreateAssessmentCycle) {
    return this.write(async (tx) => {
      await this.context(tx, s, input);
      const c = await tx.assessmentCycle.create({
        data: { ...input, organizationId: s.organizationId },
        include,
      });
      await this.audit(tx, s, 'assessment.cycle.created', c.id);
      return dto(c);
    });
  }
  update(s: Scope, id: string, input: UpdateAssessmentCycle) {
    return this.write(async (tx) => {
      await this.lock(tx, s, id);
      const c = await this.cycle(tx, s, id);
      const { expectedRevision, ...data } = input;
      if (c.status !== 'DRAFT' || c.revision !== expectedRevision) throw new ConflictException();
      await this.context(tx, s, data);
      return dto(
        await tx.assessmentCycle.update({
          where: { id },
          data: { ...data, revision: { increment: 1 } },
          include,
        }),
      );
    });
  }
  transition(s: Scope, id: string, revision: number, status: 'OPEN' | 'CLOSED') {
    return this.write(async (tx) => {
      await this.lock(tx, s, id);
      const c = await this.cycle(tx, s, id);
      if (c.revision !== revision || c.status !== (status === 'OPEN' ? 'DRAFT' : 'OPEN'))
        throw new ConflictException();
      if (status === 'OPEN') {
        await this.context(tx, s, {
          ...dto(c),
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
        });
        if (c.startsAt.getTime() > Date.now() || c.endsAt.getTime() <= Date.now())
          throw new ConflictException('Collection period unavailable');
      }
      const result = await tx.assessmentCycle.update({
        where: { id },
        data: {
          status,
          revision: { increment: 1 },
          ...(status === 'CLOSED' ? { closedAt: new Date() } : {}),
        },
        include,
      });
      await this.audit(tx, s, `assessment.cycle.${status.toLowerCase()}`, id);
      return dto(result);
    });
  }
  invites(s: Scope, id: string, count: number) {
    return this.write(async (tx) => {
      await this.lock(tx, s, id);
      const c = await this.cycle(tx, s, id);
      this.available(c);
      const invites = [];
      for (let n = 0; n < count; n++) {
        const code = randomBytes(32).toString('base64url');
        await tx.assessmentInvite.create({
          data: {
            organizationId: s.organizationId,
            cycleId: id,
            tokenHash: hash(code),
            expiresAt: c.endsAt,
          },
        });
        invites.push({ code, expiresAt: c.endsAt });
      }
      return { cycleId: id, participationPath: '/#/responder', invites };
    });
  }
  private available(c: Cycle) {
    if (
      c.status !== 'OPEN' ||
      c.startsAt.getTime() > Date.now() ||
      c.endsAt.getTime() <= Date.now() ||
      !c.organization.isActive
    )
      throw new ConflictException('Invite unavailable');
  }
  async access(code: string) {
    const invite = await this.database.client.assessmentInvite.findUnique({
      where: { tokenHash: hash(code) },
      include: { cycle: { include } },
    });
    if (!invite || invite.consumedAt || invite.expiresAt.getTime() <= Date.now())
      throw new ConflictException('Invite unavailable');
    const c = invite.cycle;
    this.available(c);
    return {
      cycleName: c.name,
      endsAt: c.endsAt,
      usageMode: c.instrumentVersion.usageMode,
      instrument: {
        id: c.instrumentVersionId,
        title: c.instrumentVersion.title,
        version: c.instrumentVersion.version,
        description: c.instrumentVersion.description,
        instructions: c.instrumentVersion.instructions,
        questions: c.instrumentVersion.questions.map((q) => ({
          id: q.id,
          label: q.label,
          type: q.type,
          required: q.required,
          position: q.position,
          options: q.options.map((o) => ({ id: o.id, label: o.label, position: o.position })),
        })),
      },
    };
  }
  submit(input: SubmitAssessmentResponse) {
    return this.write(async (tx) => {
      const inviteHash = hash(input.inviteCode);
      const secretHash = hash(input.submissionSecret);
      const payloadMac = createHmac('sha256', input.submissionSecret)
        .update(canonical(input))
        .digest('hex');
      const invitation = await tx.assessmentInvite.findUnique({
        where: { tokenHash: inviteHash },
        select: { cycleId: true, organizationId: true },
      });
      if (!invitation) throw new ConflictException('Invite unavailable');
      await this.lock(
        tx,
        { organizationId: invitation.organizationId, userId: '' },
        invitation.cycleId,
      );
      await tx.$queryRaw`SELECT id FROM assessment_invites WHERE token_hash=${inviteHash} FOR UPDATE`;
      const receipt = await tx.assessmentSubmissionReceipt.findUnique({ where: { inviteHash } });
      if (receipt) {
        if (receipt.secretHash !== secretHash || receipt.payloadMac !== payloadMac)
          throw new ConflictException('Submission conflicts with accepted content');
        return { status: 'accepted' as const };
      }
      const invite = await tx.assessmentInvite.findUniqueOrThrow({
        where: { tokenHash: inviteHash },
        include: { cycle: { include } },
      });
      const c = invite.cycle;
      if (invite.consumedAt || invite.expiresAt.getTime() <= Date.now())
        throw new ConflictException('Invite unavailable');
      this.available(c);
      if (input.instrumentVersionId !== c.instrumentVersionId)
        throw new BadRequestException('Instrument version mismatch');
      for (const a of input.answers) {
        const q = c.instrumentVersion.questions.find((q) => q.id === a.questionId);
        if (
          !q ||
          a.optionIds.some((id) => !q.options.some((o) => o.id === id)) ||
          (a.optionIds.length > 0 && q.type !== 'MULTIPLE_CHOICE' && a.optionIds.length !== 1)
        )
          throw new BadRequestException('Invalid answer');
      }
      for (const q of c.instrumentVersion.questions)
        if (
          q.required &&
          !input.answers.some((a) => a.questionId === q.id && a.optionIds.length > 0)
        )
          throw new BadRequestException({
            details: [{ field: `answers.${q.id}`, message: 'Required answer missing' }],
          });
      await tx.assessmentInvite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date() },
      });
      const response = await tx.assessmentResponse.create({
        data: {
          organizationId: c.organizationId,
          cycleId: c.id,
          instrumentVersionId: c.instrumentVersionId,
        },
      });
      await tx.assessmentAnswer.createMany({
        data: input.answers
          .filter((a) => a.optionIds.length > 0)
          .map((a) => ({
            responseId: response.id,
            instrumentVersionId: c.instrumentVersionId,
            questionId: a.questionId,
            optionIds: a.optionIds,
          })),
      });
      await tx.assessmentSubmissionReceipt.create({ data: { inviteHash, secretHash, payloadMac } });
      return { status: 'accepted' as const };
    });
  }
  async sources(s: Scope, id: string, q: Page) {
    await this.cycle(this.database.client, s, id);
    const where = { organizationId: s.organizationId, cycleId: id };
    const [items, total] = await this.database.client.$transaction([
      this.database.client.assessmentSource.findMany({
        where,
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.database.client.assessmentSource.count({ where }),
    ]);
    return { items: items.map((source) => this.sourceDto(source)), total, ...q };
  }
  private sourceDto(
    source: Prisma.AssessmentSourceGetPayload<{
      include: { createdBy: { select: { id: true; name: true } } };
    }>,
  ) {
    return {
      id: source.id,
      organizationId: source.organizationId,
      cycleId: source.cycleId,
      kind: source.kind,
      context: source.context,
      occurredOn: source.occurredOn.toISOString().slice(0, 10),
      summary: source.summary,
      createdAt: source.createdAt,
      createdBy: source.createdBy,
    };
  }
  source(s: Scope, id: string, input: CreateAssessmentSource) {
    return this.write(async (tx) => {
      const c = await this.cycle(tx, s, id);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: c.organization.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (input.occurredOn > today) throw new BadRequestException('Source date cannot be future');
      const source = await tx.assessmentSource.create({
        data: {
          ...input,
          occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
          organizationId: s.organizationId,
          cycleId: id,
          createdById: s.userId,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      await this.audit(tx, s, 'assessment.source.created', source.id);
      return this.sourceDto(source);
    });
  }
  async results(s: Scope, id: string) {
    const c = await this.cycle(this.database.client, s, id);
    const responses = await this.database.client.assessmentResponse.findMany({
      where: { organizationId: s.organizationId, cycleId: id },
      include: { answers: true },
    });
    return {
      organizationId: s.organizationId,
      instrumentVersionId: c.instrumentVersionId,
      policyVersionId: c.policyVersionId,
      minimumResponses: c.policyVersion.minimumResponses!,
      node: projectAssessment(
        { id: c.id, name: c.name, nodeType: 'CYCLE', status: c.status, responses, children: [] },
        c.instrumentVersion.questions,
        c.policyVersion.minimumResponses!,
      ),
    };
  }
  async consolidation(s: Scope, q: AssessmentConsolidationQuery) {
    const p = await this.policy(this.database.client, s, q.policyVersionId);
    const i = await this.database.client.instrumentVersion.findFirst({
      where: { id: q.instrumentVersionId, organizationId: s.organizationId },
      include: instrumentInclude,
    });
    if (!i || p.status !== 'PUBLISHED' || i.status !== 'PUBLISHED' || p.usageMode !== i.usageMode)
      throw new NotFoundException();
    const org = await this.database.client.organization.findUniqueOrThrow({
      where: { id: s.organizationId },
    });
    const cycles = await this.database.client.assessmentCycle.findMany({
      where: {
        organizationId: s.organizationId,
        instrumentVersionId: q.instrumentVersionId,
        policyVersionId: q.policyVersionId,
      },
      include: { ...include, responses: { include: { answers: true } } },
    });
    const root: ResultInput = {
      id: org.id,
      name: org.name,
      nodeType: 'ORGANIZATION',
      responses: cycles.flatMap((c) => c.responses),
      children: [],
    };
    for (const c of cycles) {
      const sector = c.assessmentGroup.sector;
      let unit = root.children.find((u) => u.id === sector.unitId);
      if (!unit) {
        unit = {
          id: sector.unitId,
          name: sector.unit.name,
          nodeType: 'UNIT',
          responses: [],
          children: [],
        };
        root.children.push(unit);
      }
      let group = unit.children.find((g) => g.id === c.assessmentGroupId);
      if (!group) {
        group = {
          id: c.assessmentGroupId,
          name: `${sector.name} / ${c.assessmentGroup.name}`,
          nodeType: 'GROUP',
          responses: [],
          children: [],
        };
        unit.children.push(group);
      }
      unit.responses.push(...c.responses);
      group.responses.push(...c.responses);
      group.children.push({
        id: c.id,
        name: c.name,
        nodeType: 'CYCLE',
        status: c.status,
        responses: c.responses,
        children: [],
      });
    }
    const family = projectAssessment(root, i.questions, p.minimumResponses!);
    const node = q.unitId ? family.children.find((u) => u.id === q.unitId) : family;
    if (!node) throw new NotFoundException();
    return {
      organizationId: s.organizationId,
      instrumentVersionId: i.id,
      policyVersionId: p.id,
      minimumResponses: p.minimumResponses!,
      node,
    };
  }
}
