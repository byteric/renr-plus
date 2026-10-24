import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  diagnosticInstrumentSchema,
  DEMO_MINIMUM_RESPONSES,
  type CreateDiagnosticCycle,
  type DiagnosticCycle,
  type DiagnosticInstrument,
  type DiagnosticResults,
  type SubmitDiagnosticResponse,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';

type Scope = { userId: string; organizationId: string };
type Page = { page: number; pageSize: number };
const instrumentInclude = {
  questions: {
    orderBy: { position: 'asc' },
    include: { options: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.InstrumentVersionInclude;
const cycleInclude = {
  organization: true,
  instrumentVersion: { include: instrumentInclude },
  groups: { include: { assessmentGroup: { include: { sector: { include: { unit: true } } } } } },
} satisfies Prisma.DiagnosticCycleInclude;
type Cycle = Prisma.DiagnosticCycleGetPayload<{ include: typeof cycleInclude }>;
type Instrument = Prisma.InstrumentVersionGetPayload<{ include: typeof instrumentInclude }>;
const hash = (code: string): string => createHash('sha256').update(code).digest('hex');

export class InviteUnavailableException extends ConflictException {
  constructor() {
    super('Invite unavailable');
  }
}

@Injectable()
export class DiagnosticsService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(private readonly database: PrismaService) {}

  rateLimit(ip: string): void {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    const key = hash(ip);
    const attempt = this.attempts.get(key) ?? { count: 0, expires: now + 60000 };
    if (attempt.count >= 60 || (!this.attempts.has(key) && this.attempts.size >= 10000))
      throw new HttpException('Too many requests', 429);
    attempt.count += 1;
    this.attempts.set(key, attempt);
  }

  private toInstrument(instrument: Instrument): DiagnosticInstrument {
    this.legacyInstrument(instrument);
    return diagnosticInstrumentSchema.parse({
      id: instrument.id,
      organizationId: instrument.organizationId,
      title: instrument.title,
      version: instrument.version,
      status: instrument.status,
      isDemo: instrument.isDemo,
      questions: instrument.questions.map((question) => ({
        id: question.id,
        label: question.label,
        type: this.legacyQuestionType(question.type),
        required: question.required,
        position: question.position,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          position: option.position,
        })),
      })),
    });
  }

  private legacyQuestionType(type: string): 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' {
    if (type !== 'SINGLE_CHOICE' && type !== 'MULTIPLE_CHOICE')
      throw new BadRequestException({
        details: [
          {
            field: 'instrumentVersionId',
            message: 'This instrument is unavailable in the legacy diagnostic flow',
          },
        ],
      });
    return type;
  }

  private legacyInstrument(instrument: Instrument): void {
    if (!instrument.isDemo || instrument.version !== 1 || instrument.status !== 'PUBLISHED')
      throw new BadRequestException({
        details: [
          {
            field: 'instrumentVersionId',
            message:
              'Use the reserved legacy demonstration instrument until catalog cycles are supported',
          },
        ],
      });
    for (const question of instrument.questions) this.legacyQuestionType(question.type);
  }

  private toCycle(cycle: Cycle): DiagnosticCycle {
    const sector = cycle.groups[0]?.assessmentGroup.sector;
    if (!sector) throw new ConflictException();
    return {
      id: cycle.id,
      organizationId: cycle.organizationId,
      name: cycle.name,
      sectorId: sector.id,
      sectorName: sector.name,
      unitId: sector.unitId,
      unitName: sector.unit.name,
      instrumentVersionId: cycle.instrumentVersionId,
      instrumentTitle: cycle.instrumentVersion.title,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString(),
      status: cycle.status,
      createdAt: cycle.createdAt.toISOString(),
      closedAt: cycle.closedAt?.toISOString() ?? null,
    };
  }

  private async requireCycle(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<Cycle> {
    const cycle = await tx.diagnosticCycle.findFirst({
      where: { id, organizationId },
      include: cycleInclude,
    });
    if (!cycle) throw new NotFoundException();
    this.legacyInstrument(cycle.instrumentVersion);
    return cycle;
  }
  private active(cycle: Cycle): boolean {
    const sector = cycle.groups[0]?.assessmentGroup.sector;
    return (
      cycle.organization.isActive &&
      !!sector?.isActive &&
      sector.unit.isActive &&
      sector.unit.organizationId === cycle.organizationId
    );
  }
  private inPeriod(cycle: Cycle, now: Date): boolean {
    return cycle.startsAt <= now && now < cycle.endsAt;
  }
  private async lockCycle(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM diagnostic_cycles WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  }
  private audit(tx: Prisma.TransactionClient, scope: Scope, action: string, resourceId: string) {
    return tx.auditEvent.create({
      data: { actorId: scope.userId, organizationId: scope.organizationId, action, resourceId },
    });
  }

  async instrument(scope: Scope): Promise<DiagnosticInstrument> {
    const instrument = await this.database.client.instrumentVersion.findFirst({
      where: {
        organizationId: scope.organizationId,
        version: 1,
        status: 'PUBLISHED',
        isDemo: true,
      },
      include: instrumentInclude,
    });
    if (!instrument) throw new NotFoundException();
    return this.toInstrument(instrument);
  }
  async list(scope: Scope, pagination: Page) {
    const where = { organizationId: scope.organizationId };
    const [cycles, total] = await this.database.client.$transaction([
      this.database.client.diagnosticCycle.findMany({
        where,
        include: cycleInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.database.client.diagnosticCycle.count({ where }),
    ]);
    return { items: cycles.map((cycle) => this.toCycle(cycle)), total, ...pagination };
  }
  async get(scope: Scope, id: string): Promise<DiagnosticCycle> {
    return this.toCycle(await this.requireCycle(this.database.client, scope.organizationId, id));
  }
  async create(scope: Scope, input: CreateDiagnosticCycle): Promise<DiagnosticCycle> {
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.organizationId}))::text`;
      const sector = await tx.sector.findFirst({
        where: { id: input.sectorId, organizationId: scope.organizationId },
        include: { organization: true, unit: true },
      });
      if (!sector) throw new NotFoundException();
      if (
        !sector.isActive ||
        !sector.unit.isActive ||
        !sector.organization.isActive ||
        sector.unit.organizationId !== scope.organizationId
      )
        throw new ConflictException();
      const instrument = await tx.instrumentVersion.findFirst({
        where: {
          id: input.instrumentVersionId,
          organizationId: scope.organizationId,
        },
        include: instrumentInclude,
      });
      if (!instrument) throw new NotFoundException();
      this.toInstrument(instrument);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (!(startsAt < endsAt)) throw new BadRequestException();
      const group = await tx.assessmentGroup.upsert({
        where: {
          organizationId_sectorId: { organizationId: scope.organizationId, sectorId: sector.id },
        },
        create: { organizationId: scope.organizationId, sectorId: sector.id, name: sector.name },
        update: {},
      });
      if (group.isActive === false) throw new ConflictException('Inactive assessment group');
      const cycle = await tx.diagnosticCycle.create({
        data: {
          organizationId: scope.organizationId,
          name: input.name,
          instrumentVersionId: instrument.id,
          startsAt,
          endsAt,
          groups: { create: { assessmentGroupId: group.id } },
        },
        include: cycleInclude,
      });
      await this.audit(tx, scope, 'DIAGNOSTIC_CYCLE_CREATE', cycle.id);
      return this.toCycle(cycle);
    });
  }
  async transition(scope: Scope, id: string, target: 'OPEN' | 'CLOSED'): Promise<DiagnosticCycle> {
    return this.database.client.$transaction(async (tx) => {
      await this.lockCycle(tx, scope.organizationId, id);
      const cycle = await this.requireCycle(tx, scope.organizationId, id);
      const now = new Date();
      if (
        target === 'OPEN'
          ? cycle.status !== 'DRAFT' || !this.inPeriod(cycle, now) || !this.active(cycle)
          : cycle.status !== 'OPEN'
      )
        throw new ConflictException();
      const updated = await tx.diagnosticCycle.update({
        where: { id: cycle.id },
        data: { status: target, ...(target === 'CLOSED' ? { closedAt: now } : {}) },
        include: cycleInclude,
      });
      await this.audit(tx, scope, `DIAGNOSTIC_CYCLE_${target}`, id);
      return this.toCycle(updated);
    });
  }
  async invites(scope: Scope, id: string, count: number) {
    return this.database.client.$transaction(async (tx) => {
      await this.lockCycle(tx, scope.organizationId, id);
      const cycle = await this.requireCycle(tx, scope.organizationId, id);
      if (cycle.status !== 'OPEN' || !this.inPeriod(cycle, new Date()) || !this.active(cycle))
        throw new ConflictException();
      const invites = Array.from({ length: count }, () => ({
        code: randomBytes(32).toString('base64url'),
        expiresAt: cycle.endsAt.toISOString(),
      }));
      await tx.participationInvite.createMany({
        data: invites.map((invite) => ({
          organizationId: scope.organizationId,
          cycleId: id,
          tokenHash: hash(invite.code),
          expiresAt: cycle.endsAt,
        })),
      });
      await this.audit(tx, scope, 'DIAGNOSTIC_INVITES_CREATE', id);
      return { cycleId: id, participationPath: '/#/participar' as const, invites };
    });
  }
  private async availableInvite(tx: Prisma.TransactionClient, tokenHash: string) {
    const invite = await tx.participationInvite.findUnique({
      where: { tokenHash },
      include: { cycle: { include: cycleInclude } },
    });
    const now = new Date();
    if (
      !invite ||
      invite.consumedAt ||
      invite.revokedAt ||
      invite.expiresAt <= now ||
      invite.cycle.status !== 'OPEN' ||
      !this.inPeriod(invite.cycle, now) ||
      !this.active(invite.cycle)
    )
      throw new InviteUnavailableException();
    return invite;
  }
  async participationInstrument(code: string) {
    const invite = await this.availableInvite(this.database.client, hash(code));
    return {
      cycleName: invite.cycle.name,
      endsAt: invite.cycle.endsAt.toISOString(),
      instrument: this.toInstrument(invite.cycle.instrumentVersion),
    };
  }
  async submit(input: SubmitDiagnosticResponse): Promise<{ status: 'accepted' }> {
    const tokenHash = hash(input.inviteCode);
    return this.database.client.$transaction(async (tx) => {
      // Find the cycle without acquiring an invite lock; all write paths lock cycle first.
      const reference = await tx.participationInvite.findUnique({
        where: { tokenHash },
        select: { organizationId: true, cycleId: true },
      });
      if (!reference) throw new InviteUnavailableException();
      await this.lockCycle(tx, reference.organizationId, reference.cycleId);
      await tx.$queryRaw`SELECT id FROM participation_invites WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const invite = await this.availableInvite(tx, tokenHash);
      const instrument = this.toInstrument(invite.cycle.instrumentVersion);
      if (input.instrumentVersionId !== instrument.id)
        throw new BadRequestException({
          details: [
            { field: 'instrumentVersionId', message: 'Use a versão do instrumento deste ciclo.' },
          ],
        });
      const details: Array<{ field: string; message: string }> = [];
      for (const question of instrument.questions) {
        const answer = input.answers.find((item) => item.questionId === question.id);
        const field = `answers.${question.id}.optionIds`;
        if (!answer || answer.optionIds.length === 0)
          details.push({ field, message: 'Responda esta pergunta obrigatória.' });
        else if (question.type === 'SINGLE_CHOICE' && answer.optionIds.length !== 1)
          details.push({ field, message: 'Selecione exatamente uma opção.' });
        else if (new Set(answer.optionIds).size !== answer.optionIds.length)
          details.push({ field, message: 'Não repita opções.' });
        else if (
          answer.optionIds.some((id) => !question.options.some((option) => option.id === id))
        )
          details.push({ field, message: 'Selecione apenas opções desta pergunta.' });
      }
      if (
        input.answers.some(
          (answer) => !instrument.questions.some((question) => question.id === answer.questionId),
        )
      )
        details.push({ field: 'answers', message: 'Responda apenas perguntas deste instrumento.' });
      if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length)
        details.push({ field: 'answers', message: 'Não repita perguntas.' });
      if (details.length > 0) throw new BadRequestException({ details });
      const now = new Date();
      const consumed = await tx.participationInvite.updateMany({
        where: { id: invite.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new InviteUnavailableException();
      // Date only; neither the invite nor participant identity is linked to the response.
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: invite.cycle.organization.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      const answers: Prisma.ResponseAnswerUncheckedCreateWithoutResponseInput[] = input.answers.map(
        (answer) => ({ questionId: answer.questionId, optionIds: answer.optionIds }),
      );
      await tx.diagnosticResponse.create({
        data: {
          organizationId: invite.organizationId,
          cycleId: invite.cycleId,
          instrumentVersionId: instrument.id,
          submittedPeriod: new Date(`${date}T00:00:00.000Z`),
          answers: { create: answers },
        },
      });
      return { status: 'accepted' };
    });
  }
  async results(scope: Scope, id: string): Promise<DiagnosticResults> {
    return this.database.client.$transaction(
      async (tx) => {
        const cycle = await this.requireCycle(tx, scope.organizationId, id);
        const hidden = {
          cycleId: id,
          responseCount: null,
          minimumResponses: DEMO_MINIMUM_RESPONSES,
          questions: [],
        } as const;
        if (cycle.status !== 'CLOSED')
          return { ...hidden, questions: [], availability: 'CYCLE_OPEN' };
        const responseCount = await tx.diagnosticResponse.count({
          where: { organizationId: scope.organizationId, cycleId: id },
        });
        if (responseCount < DEMO_MINIMUM_RESPONSES)
          return { ...hidden, questions: [], availability: 'INSUFFICIENT_RESPONSES' };
        // Aggregate inside PostgreSQL instead of loading individual responses into memory.
        const buckets = await tx.$queryRaw<
          Array<{ questionId: string; optionId: string; count: bigint }>
        >`
        SELECT a.question_id::text AS "questionId", option_id AS "optionId", count(*) AS count
        FROM response_answers a JOIN diagnostic_responses r ON r.id = a.response_id
        CROSS JOIN LATERAL jsonb_array_elements_text(a.option_ids) AS option_id
        WHERE r.organization_id = ${scope.organizationId}::uuid AND r.cycle_id = ${id}::uuid
        GROUP BY a.question_id, option_id`;
        return {
          cycleId: id,
          availability: 'AVAILABLE',
          responseCount,
          minimumResponses: DEMO_MINIMUM_RESPONSES,
          questions: cycle.instrumentVersion.questions.map((question) => {
            const options = question.options.map((option) => {
              const count = Number(
                buckets.find(
                  (bucket) => bucket.questionId === question.id && bucket.optionId === option.id,
                )?.count ?? 0,
              );
              return {
                id: option.id,
                label: option.label,
                count,
                percentage: Math.round((count / responseCount) * 10000) / 100,
              };
            });
            const suppressed = options.some(
              (option) => option.count > 0 && option.count < DEMO_MINIMUM_RESPONSES,
            );
            return {
              id: question.id,
              label: question.label,
              type: this.legacyQuestionType(question.type),
              suppressed,
              options: suppressed ? [] : options,
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
