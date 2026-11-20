import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  commercialBillingChargeDetailSchema,
  commercialBillingChargeListSchema,
  commercialBillingChargeSchema,
  commercialBillingContractListSchema,
  commercialBillingSummarySchema,
  normalizeCnpj,
  type CommercialBillingChargesQuery,
  type CommercialBillingContractsQuery,
  type CommercialBillingStatus,
  type CommercialConfirmBillingPayment,
  type CommercialCorrectBillingCharge,
  type CommercialCreateBillingCharge,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';

type BillingPermission = 'read' | 'manage';

const planVersionSelect = {
  id: true,
  planId: true,
  ordinal: true,
  effectiveOn: true,
  priceCents: true,
  pricingUnit: true,
  priceMode: true,
  plan: { select: { id: true, name: true } },
} satisfies Prisma.CommercialPlanVersionSelect;

const chargeInclude = {
  organization: { select: { name: true } },
  contractRevision: { select: { ordinal: true } },
  planVersion: { select: planVersionSelect },
  _count: { select: { revisions: true } },
} satisfies Prisma.CommercialBillingChargeInclude;

const chargeDetailInclude = {
  ...chargeInclude,
  revisions: {
    orderBy: { ordinal: 'asc' },
    include: {
      contractRevision: { select: { ordinal: true } },
      planVersion: { select: planVersionSelect },
      creator: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CommercialBillingChargeInclude;

const contractRefInclude = {
  organization: {
    select: {
      id: true,
      name: true,
      isActive: true,
      clientClassification: true,
      fiscalState: true,
    },
  },
  revisions: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      ordinal: true,
      kind: true,
      startsOn: true,
      endsOn: true,
      withdrawal: { select: { revisionId: true } },
      planVersion: { select: planVersionSelect },
    },
  },
} satisfies Prisma.CommercialContractInclude;

type ChargeRecord = Prisma.CommercialBillingChargeGetPayload<{ include: typeof chargeInclude }>;
type ChargeDetailRecord = Prisma.CommercialBillingChargeGetPayload<{
  include: typeof chargeDetailInclude;
}>;
type ContractRefRecord = Prisma.CommercialContractGetPayload<{
  include: typeof contractRefInclude;
}>;

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const civilDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = () => civilDate(referenceDate('America/Sao_Paulo', new Date()));

function competenceBounds(competence: string): { start: Date; end: Date } {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

function billingStatus(dueOn: Date, paidOn: Date | null, reference: Date): CommercialBillingStatus {
  if (paidOn) return 'PAID';
  return dueOn < reference ? 'OVERDUE' : 'OPEN';
}

function contractSituation(
  revisions: ContractRefRecord['revisions'],
  reference: Date,
): 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' {
  let current: ContractRefRecord['revisions'][number] | undefined;
  for (const revision of revisions) {
    if (revision.withdrawal) continue;
    if (revision.startsOn > reference) break;
    current = revision;
  }
  if (!current) {
    return revisions.every((revision) => revision.withdrawal) ? 'CANCELLED' : 'SCHEDULED';
  }
  if (current.kind === 'CANCELLATION') return 'CANCELLED';
  return current.endsOn < reference ? 'EXPIRED' : 'ACTIVE';
}

function planVersionDto(version: ChargeRecord['planVersion']) {
  return {
    id: version.id,
    ordinal: version.ordinal,
    effectiveOn: dateOnly(version.effectiveOn),
    priceCents: version.priceCents,
    pricingUnit: version.pricingUnit,
    priceMode: version.priceMode,
  };
}

function chargeBaseFields(charge: ChargeRecord, reference: Date) {
  return {
    id: charge.id,
    organizationId: charge.organizationId,
    organizationName: charge.organization.name,
    contractId: charge.contractId,
    contractRevisionId: charge.contractRevisionId,
    contractRevisionOrdinal: charge.contractRevision.ordinal,
    plan: { id: charge.planVersion.plan.id, name: charge.planVersion.plan.name },
    planVersion: planVersionDto(charge.planVersion),
    competence: charge.competence,
    amountCents: charge.amountCents,
    dueOn: dateOnly(charge.dueOn),
    paidOn: charge.paidOn ? dateOnly(charge.paidOn) : null,
    receiptReference: charge.receiptReference,
    status: billingStatus(charge.dueOn, charge.paidOn, reference),
    version: charge.version,
    revisionCount: charge._count.revisions,
    createdAt: charge.createdAt.toISOString(),
    updatedAt: charge.updatedAt.toISOString(),
  };
}

function chargeDto(charge: ChargeRecord, reference: Date) {
  return commercialBillingChargeSchema.parse(chargeBaseFields(charge, reference));
}

function chargeDetailDto(charge: ChargeDetailRecord, reference: Date) {
  return commercialBillingChargeDetailSchema.parse({
    ...chargeBaseFields(charge, reference),
    revisions: charge.revisions.map((revision) => ({
      id: revision.id,
      ordinal: revision.ordinal,
      kind: revision.kind,
      contractRevisionId: revision.contractRevisionId,
      contractRevisionOrdinal: revision.contractRevision.ordinal,
      plan: { id: revision.planVersion.plan.id, name: revision.planVersion.plan.name },
      planVersion: planVersionDto(revision.planVersion),
      competence: revision.competence,
      amountCents: revision.amountCents,
      dueOn: dateOnly(revision.dueOn),
      paidOn: revision.paidOn ? dateOnly(revision.paidOn) : null,
      receiptReference: revision.receiptReference,
      reason: revision.reason,
      actor: { id: revision.creator.id, name: revision.creator.name },
      createdAt: revision.createdAt.toISOString(),
    })),
  });
}

function assertNotFuturePayment(paidOn: Date | null, reference: Date) {
  if (paidOn && paidOn > reference) {
    throw new BadRequestException('A data de recebimento não pode ser posterior à data atual.');
  }
}

function previousCivilDay(date: Date): Date {
  return new Date(date.getTime() - 86_400_000);
}

function effectiveBillableEnd(
  revisions: { ordinal: number; kind: string; startsOn: Date; endsOn: Date; withdrawal: unknown }[],
  targetOrdinal: number,
  targetEndsOn: Date,
): Date {
  for (const revision of revisions) {
    if (revision.withdrawal || revision.ordinal <= targetOrdinal) continue;
    const dayBeforeNext = previousCivilDay(revision.startsOn);
    return dayBeforeNext < targetEndsOn ? dayBeforeNext : targetEndsOn;
  }
  return targetEndsOn;
}

async function resolveBillableContractRevision(
  tx: Prisma.TransactionClient,
  organizationId: string,
  contractId: string,
  contractRevisionId: string,
  competence: string,
) {
  const contract = await tx.commercialContract.findUnique({
    where: { id: contractId, organizationId },
    select: {
      id: true,
      revisions: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          kind: true,
          planVersionId: true,
          startsOn: true,
          endsOn: true,
          withdrawal: { select: { revisionId: true } },
        },
      },
    },
  });
  if (!contract) throw new NotFoundException();
  const target = contract.revisions.find((revision) => revision.id === contractRevisionId);
  if (!target) throw new NotFoundException();
  if (target.withdrawal || target.kind === 'CANCELLATION') {
    throw new ConflictException(
      'Selecione um termo contratual ativo ou vigente (não cancelado ou retirado).',
    );
  }
  const { start, end } = competenceBounds(competence);
  const billableEnd = effectiveBillableEnd(contract.revisions, target.ordinal, target.endsOn);
  if (target.startsOn > end || billableEnd < start) {
    throw new ConflictException(
      'A competência informada está fora da vigência faturável do termo contratual selecionado.',
    );
  }
  return target;
}

async function auditBilling(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  resourceId: string,
  reason: string,
) {
  await tx.platformAuditEvent.create({ data: { actorId, action, resourceId, reason } });
}

function statusWhere(
  status: CommercialBillingStatus,
  reference: Date,
): Prisma.CommercialBillingChargeWhereInput {
  if (status === 'PAID') return { paidOn: { not: null } };
  if (status === 'OVERDUE') return { paidOn: null, dueOn: { lt: reference } };
  return { paidOn: null, dueOn: { gte: reference } };
}

@Injectable()
export class CommercialBillingService {
  constructor(private readonly database: PrismaService) {}

  private async transaction<T>(
    userId: string,
    permission: BillingPermission,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    lock = permission === 'manage',
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          if (lock) {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
          }
          const grant = await tx.platformGrant.findFirst({
            where: {
              userId,
              isActive: true,
              capability: {
                in:
                  permission === 'manage' ? ['MANAGE_BILLING'] : ['READ_BILLING', 'MANAGE_BILLING'],
              },
            },
            select: { userId: true },
          });
          if (!grant) throw new ForbiddenException();
          return operation(tx);
        },
        {
          isolationLevel: lock
            ? Prisma.TransactionIsolationLevel.ReadCommitted
            : Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2025', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException(
          'Registro concorrente ou repetido recusado. Atualize os dados antes de tentar novamente.',
        );
      }
      throw error;
    }
  }

  listContracts(userId: string, query: CommercialBillingContractsQuery) {
    return this.transaction(userId, 'read', async (tx) => {
      const normalizedSearch = query.search ? normalizeCnpj(query.search) : undefined;
      const orgWhere: Prisma.OrganizationWhereInput = {
        ...(query.organizationId ? { id: query.organizationId } : {}),
        ...(query.classification ? { clientClassification: query.classification } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                ...(normalizedSearch ? [{ fiscalCandidate: { contains: normalizedSearch } }] : []),
              ],
            }
          : {}),
      };
      const where: Prisma.CommercialContractWhereInput = { organization: orgWhere };
      const [contracts, total] = await Promise.all([
        tx.commercialContract.findMany({
          where,
          orderBy: [{ organization: { name: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: contractRefInclude,
        }),
        tx.commercialContract.count({ where }),
      ]);
      const reference = today();
      return commercialBillingContractListSchema.parse({
        items: contracts.map((record) => ({
          organizationId: record.organization.id,
          organizationName: record.organization.name,
          isActive: record.organization.isActive,
          clientClassification: record.organization.clientClassification,
          fiscalState: record.organization.fiscalState,
          contract: {
            id: record.id,
            situation: contractSituation(record.revisions, reference),
            revisions: record.revisions
              .filter(
                (
                  revision,
                ): revision is typeof revision & {
                  kind: 'INITIAL' | 'RENEWAL' | 'AMENDMENT';
                } => !revision.withdrawal && revision.kind !== 'CANCELLATION',
              )
              .map((revision) => ({
                id: revision.id,
                ordinal: revision.ordinal,
                kind: revision.kind,
                startsOn: dateOnly(revision.startsOn),
                endsOn: dateOnly(revision.endsOn),
                plan: {
                  id: revision.planVersion.plan.id,
                  name: revision.planVersion.plan.name,
                },
                planVersion: planVersionDto(revision.planVersion),
              })),
          },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      });
    });
  }

  listCharges(userId: string, query: CommercialBillingChargesQuery) {
    return this.transaction(userId, 'read', async (tx) => {
      const reference = today();
      const competenceFilter: Prisma.StringFilter | undefined =
        query.competenceFrom || query.competenceTo
          ? {
              ...(query.competenceFrom ? { gte: query.competenceFrom } : {}),
              ...(query.competenceTo ? { lte: query.competenceTo } : {}),
            }
          : undefined;
      const baseWhere: Prisma.CommercialBillingChargeWhereInput = {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.contractId ? { contractId: query.contractId } : {}),
        ...(competenceFilter ? { competence: competenceFilter } : {}),
      };
      const itemWhere: Prisma.CommercialBillingChargeWhereInput = query.status
        ? { AND: [baseWhere, statusWhere(query.status, reference)] }
        : baseWhere;

      const [openAgg, overdueAgg, paidAgg, items] = await Promise.all([
        tx.commercialBillingCharge.aggregate({
          where: { AND: [baseWhere, statusWhere('OPEN', reference)] },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        tx.commercialBillingCharge.aggregate({
          where: { AND: [baseWhere, statusWhere('OVERDUE', reference)] },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        tx.commercialBillingCharge.aggregate({
          where: { AND: [baseWhere, statusWhere('PAID', reference)] },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        tx.commercialBillingCharge.findMany({
          where: itemWhere,
          orderBy: [{ competence: 'desc' }, { dueOn: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: chargeInclude,
        }),
      ]);

      const openCents = openAgg._sum.amountCents ?? 0;
      const overdueCents = overdueAgg._sum.amountCents ?? 0;
      const receivedCents = paidAgg._sum.amountCents ?? 0;
      const counts = {
        open: openAgg._count._all,
        overdue: overdueAgg._count._all,
        paid: paidAgg._count._all,
        total: openAgg._count._all + overdueAgg._count._all + paidAgg._count._all,
      };
      const summary = commercialBillingSummarySchema.parse({
        timeZone: 'America/Sao_Paulo',
        referenceDate: dateOnly(reference),
        billedCents: openCents + overdueCents + receivedCents,
        openCents,
        overdueCents,
        receivedCents,
        counts,
      });
      const filteredTotal =
        query.status === 'OPEN'
          ? counts.open
          : query.status === 'OVERDUE'
            ? counts.overdue
            : query.status === 'PAID'
              ? counts.paid
              : counts.total;

      return commercialBillingChargeListSchema.parse({
        summary,
        items: items.map((item) => chargeDto(item, reference)),
        total: filteredTotal,
        page: query.page,
        pageSize: query.pageSize,
      });
    });
  }

  findCharge(userId: string, organizationId: string, chargeId: string) {
    return this.transaction(userId, 'read', async (tx) => {
      const charge = await tx.commercialBillingCharge.findUnique({
        where: { id: chargeId, organizationId },
        include: chargeDetailInclude,
      });
      if (!charge) throw new NotFoundException();
      return chargeDetailDto(charge, today());
    });
  }

  createCharge(
    userId: string,
    organizationId: string,
    contractId: string,
    input: CommercialCreateBillingCharge,
    idempotencyKey: string | null,
  ) {
    return this.transaction(userId, 'manage', async (tx) => {
      const reference = today();
      const dueOn = civilDate(input.dueOn);
      const paidOn = input.paidOn ? civilDate(input.paidOn) : null;
      assertNotFuturePayment(paidOn, reference);
      const contractRevision = await resolveBillableContractRevision(
        tx,
        organizationId,
        contractId,
        input.contractRevisionId,
        input.competence,
      );

      const created = await tx.commercialBillingCharge.create({
        data: {
          organizationId,
          contractId,
          contractRevisionId: contractRevision.id,
          planVersionId: contractRevision.planVersionId,
          competence: input.competence,
          amountCents: input.amountCents,
          dueOn,
          paidOn,
          receiptReference: input.receiptReference,
          createdBy: userId,
          updatedBy: userId,
          revisions: {
            create: {
              contractId,
              contractRevisionId: contractRevision.id,
              planVersionId: contractRevision.planVersionId,
              ordinal: 1,
              kind: 'CREATED',
              competence: input.competence,
              amountCents: input.amountCents,
              dueOn,
              paidOn,
              receiptReference: input.receiptReference,
              reason: input.reason,
              idempotencyKey,
              createdBy: userId,
            },
          },
        },
        include: chargeDetailInclude,
      });
      await auditBilling(tx, userId, 'COMMERCIAL_BILLING_CHARGE_CREATED', created.id, input.reason);
      return chargeDetailDto(created, reference);
    });
  }

  confirmPayment(
    userId: string,
    organizationId: string,
    chargeId: string,
    input: CommercialConfirmBillingPayment,
    idempotencyKey: string | null,
  ) {
    return this.transaction(userId, 'manage', async (tx) => {
      const reference = today();
      const paidOn = civilDate(input.paidOn);
      assertNotFuturePayment(paidOn, reference);

      const current = await tx.commercialBillingCharge.findUnique({
        where: { id: chargeId, organizationId },
      });
      if (!current) throw new NotFoundException();
      if (current.version !== input.expectedVersion) {
        throw new ConflictException(
          'A cobrança foi alterada por outro operador. Atualize para revisar antes de confirmar.',
        );
      }
      if (current.paidOn !== null) {
        throw new ConflictException(
          'O recebimento desta cobrança já foi confirmado. Registre uma correção para alterar dados preservando o histórico.',
        );
      }

      const updated = await tx.commercialBillingCharge.update({
        where: { id: chargeId, organizationId, version: input.expectedVersion, paidOn: null },
        data: {
          paidOn,
          receiptReference: input.receiptReference,
          updatedBy: userId,
          version: { increment: 1 },
          revisions: {
            create: {
              contractId: current.contractId,
              contractRevisionId: current.contractRevisionId,
              planVersionId: current.planVersionId,
              ordinal: current.version + 1,
              kind: 'PAYMENT_CONFIRMED',
              competence: current.competence,
              amountCents: current.amountCents,
              dueOn: current.dueOn,
              paidOn,
              receiptReference: input.receiptReference,
              reason: input.reason,
              idempotencyKey,
              createdBy: userId,
            },
          },
        },
        include: chargeDetailInclude,
      });
      await auditBilling(
        tx,
        userId,
        'COMMERCIAL_BILLING_PAYMENT_CONFIRMED',
        updated.id,
        input.reason,
      );
      return chargeDetailDto(updated, reference);
    });
  }

  correctCharge(
    userId: string,
    organizationId: string,
    chargeId: string,
    input: CommercialCorrectBillingCharge,
    idempotencyKey: string | null,
  ) {
    return this.transaction(userId, 'manage', async (tx) => {
      const reference = today();
      const dueOn = civilDate(input.dueOn);
      const paidOn = input.paidOn ? civilDate(input.paidOn) : null;
      assertNotFuturePayment(paidOn, reference);

      const current = await tx.commercialBillingCharge.findUnique({
        where: { id: chargeId, organizationId },
      });
      if (!current) throw new NotFoundException();
      if (current.version !== input.expectedVersion) {
        throw new ConflictException(
          'A cobrança foi alterada por outro operador. Atualize para revisar antes de corrigir.',
        );
      }
      const unchanged =
        current.contractRevisionId === input.contractRevisionId &&
        current.competence === input.competence &&
        current.amountCents === input.amountCents &&
        dateOnly(current.dueOn) === input.dueOn &&
        (current.paidOn ? dateOnly(current.paidOn) : null) === input.paidOn &&
        current.receiptReference === input.receiptReference;
      if (unchanged) {
        throw new BadRequestException('Informe ao menos uma alteração para registrar a correção.');
      }

      const contractRevision = await resolveBillableContractRevision(
        tx,
        organizationId,
        current.contractId,
        input.contractRevisionId,
        input.competence,
      );

      const updated = await tx.commercialBillingCharge.update({
        where: { id: chargeId, organizationId, version: input.expectedVersion },
        data: {
          contractRevisionId: contractRevision.id,
          planVersionId: contractRevision.planVersionId,
          competence: input.competence,
          amountCents: input.amountCents,
          dueOn,
          paidOn,
          receiptReference: input.receiptReference,
          updatedBy: userId,
          version: { increment: 1 },
          revisions: {
            create: {
              contractId: current.contractId,
              contractRevisionId: contractRevision.id,
              planVersionId: contractRevision.planVersionId,
              ordinal: current.version + 1,
              kind: 'CORRECTION',
              competence: input.competence,
              amountCents: input.amountCents,
              dueOn,
              paidOn,
              receiptReference: input.receiptReference,
              reason: input.reason,
              idempotencyKey,
              createdBy: userId,
            },
          },
        },
        include: chargeDetailInclude,
      });
      await auditBilling(
        tx,
        userId,
        'COMMERCIAL_BILLING_CHARGE_CORRECTED',
        updated.id,
        input.reason,
      );
      return chargeDetailDto(updated, reference);
    });
  }
}
