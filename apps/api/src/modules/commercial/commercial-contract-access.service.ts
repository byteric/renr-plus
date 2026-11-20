import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  commercialContractAccessClientListSchema,
  commercialContractAccessDetailSchema,
  commercialContractAccessSummarySchema,
  contractAccessTransitionRules,
  isContractAccessTransitionAllowed,
  normalizeCnpj,
  type CommercialContractAccessClientsQuery,
  type CommercialContractAccessStatus,
  type CommercialContractSituation,
  type CommercialRecordContractAccessTransition,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';

type ContractAccessPermission = 'read' | 'manage';

const accessSelect = {
  id: true,
  status: true,
  version: true,
  lastTransitionKind: true,
  lastRule: true,
  lastOrigin: true,
  lastEffectiveOn: true,
  lastReason: true,
  lastNextStep: true,
  updatedAt: true,
  updater: { select: { id: true, name: true } },
} satisfies Prisma.CommercialContractAccessSelect;

const clientInclude = {
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
      ordinal: true,
      kind: true,
      startsOn: true,
      endsOn: true,
      withdrawal: { select: { revisionId: true } },
    },
  },
  contractAccess: { select: accessSelect },
} satisfies Prisma.CommercialContractInclude;

const clientDetailInclude = {
  ...clientInclude,
  contractAccess: {
    select: {
      ...accessSelect,
      transitions: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          ordinal: true,
          kind: true,
          fromStatus: true,
          toStatus: true,
          rule: true,
          origin: true,
          effectiveOn: true,
          reason: true,
          nextStep: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.CommercialContractInclude;

type ClientRecord = Prisma.CommercialContractGetPayload<{ include: typeof clientInclude }>;
type ClientDetailRecord = Prisma.CommercialContractGetPayload<{
  include: typeof clientDetailInclude;
}>;

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const civilDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = () => civilDate(referenceDate('America/Sao_Paulo', new Date()));

function contractSituation(
  revisions: ClientRecord['revisions'],
  reference: Date,
): CommercialContractSituation {
  let current: ClientRecord['revisions'][number] | undefined;
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

function accessStateDto(access: ClientRecord['contractAccess']) {
  if (!access) {
    return {
      status: 'UNRECORDED' as const,
      version: 0,
      lastTransitionKind: null,
      lastRule: null,
      lastOrigin: null,
      lastEffectiveOn: null,
      lastReason: null,
      lastNextStep: null,
      lastActor: null,
      updatedAt: null,
    };
  }
  return {
    status: access.status,
    version: access.version,
    lastTransitionKind: access.lastTransitionKind,
    lastRule: access.lastRule,
    lastOrigin: access.lastOrigin,
    lastEffectiveOn: dateOnly(access.lastEffectiveOn),
    lastReason: access.lastReason,
    lastNextStep: access.lastNextStep,
    lastActor: { id: access.updater.id, name: access.updater.name },
    updatedAt: access.updatedAt.toISOString(),
  };
}

function clientBaseDto(record: ClientRecord, reference: Date) {
  return {
    organizationId: record.organization.id,
    organizationName: record.organization.name,
    isActive: record.organization.isActive,
    clientClassification: record.organization.clientClassification,
    fiscalState: record.organization.fiscalState,
    contract: {
      id: record.id,
      situation: contractSituation(record.revisions, reference),
    },
    access: accessStateDto(record.contractAccess),
  };
}

function clientDetailDto(record: ClientDetailRecord, reference: Date) {
  const transitions =
    record.contractAccess?.transitions.map((item) => ({
      id: item.id,
      ordinal: item.ordinal,
      kind: item.kind,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      rule: item.rule,
      origin: item.origin,
      effectiveOn: dateOnly(item.effectiveOn),
      reason: item.reason,
      nextStep: item.nextStep,
      actor: { id: item.actor.id, name: item.actor.name },
      createdAt: item.createdAt.toISOString(),
    })) ?? [];
  return commercialContractAccessDetailSchema.parse({
    ...clientBaseDto(record, reference),
    transitions,
  });
}

function statusFilter(status: CommercialContractAccessStatus): Prisma.CommercialContractWhereInput {
  if (status === 'UNRECORDED') return { contractAccess: null };
  return { contractAccess: { is: { status } } };
}

function auditActionFor(kind: CommercialRecordContractAccessTransition['kind']) {
  if (kind === 'ACTIVATION') return 'COMMERCIAL_CONTRACT_ACCESS_ACTIVATED';
  if (kind === 'SUSPENSION') return 'COMMERCIAL_CONTRACT_ACCESS_SUSPENDED';
  return 'COMMERCIAL_CONTRACT_ACCESS_REACTIVATED';
}

@Injectable()
export class CommercialContractAccessService {
  constructor(private readonly database: PrismaService) {}

  private async transaction<T>(
    userId: string,
    permission: ContractAccessPermission,
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
                  permission === 'manage'
                    ? ['MANAGE_CONTRACT_ACCESS']
                    : ['READ_CONTRACT_ACCESS', 'MANAGE_CONTRACT_ACCESS'],
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
          'Alteração concorrente ou repetida recusada. Atualize a situação atual antes de tentar novamente.',
        );
      }
      throw error;
    }
  }

  listClients(userId: string, query: CommercialContractAccessClientsQuery) {
    return this.transaction(userId, 'read', async (tx) => {
      const reference = today();
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
      const baseWhere: Prisma.CommercialContractWhereInput = { organization: orgWhere };
      const itemWhere: Prisma.CommercialContractWhereInput = query.status
        ? { AND: [baseWhere, statusFilter(query.status)] }
        : baseWhere;

      const [unrecorded, active, suspended, contracts] = await Promise.all([
        tx.commercialContract.count({ where: { AND: [baseWhere, statusFilter('UNRECORDED')] } }),
        tx.commercialContract.count({ where: { AND: [baseWhere, statusFilter('ACTIVE')] } }),
        tx.commercialContract.count({ where: { AND: [baseWhere, statusFilter('SUSPENDED')] } }),
        tx.commercialContract.findMany({
          where: itemWhere,
          orderBy: [{ organization: { name: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: clientInclude,
        }),
      ]);

      const totalAll = unrecorded + active + suspended;
      const filteredTotal =
        query.status === 'UNRECORDED'
          ? unrecorded
          : query.status === 'ACTIVE'
            ? active
            : query.status === 'SUSPENDED'
              ? suspended
              : totalAll;

      return commercialContractAccessClientListSchema.parse({
        summary: commercialContractAccessSummarySchema.parse({
          timeZone: 'America/Sao_Paulo',
          referenceDate: dateOnly(reference),
          counts: { total: totalAll, unrecorded, active, suspended },
        }),
        items: contracts.map((record) => clientBaseDto(record, reference)),
        total: filteredTotal,
        page: query.page,
        pageSize: query.pageSize,
      });
    });
  }

  findClient(userId: string, organizationId: string) {
    return this.transaction(userId, 'read', async (tx) => {
      const contract = await tx.commercialContract.findUnique({
        where: { organizationId },
        include: clientDetailInclude,
      });
      if (!contract) throw new NotFoundException();
      return clientDetailDto(contract, today());
    });
  }

  recordTransition(
    userId: string,
    organizationId: string,
    input: CommercialRecordContractAccessTransition,
    idempotencyKey: string | null,
  ) {
    return this.transaction(userId, 'manage', async (tx) => {
      const reference = today();
      const effectiveOn = civilDate(input.effectiveOn);
      if (effectiveOn > reference) {
        throw new BadRequestException(
          'A data de vigência da decisão manual não pode ser posterior à data atual.',
        );
      }

      // Lock the tenant organization row to serialize with concurrent transitions and in-flight operations.
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException();

      const contract = await tx.commercialContract.findUnique({
        where: { organizationId },
        include: clientInclude,
      });
      if (!contract) throw new NotFoundException();

      const currentAccess = contract.contractAccess;
      const currentVersion = currentAccess?.version ?? 0;
      const fromStatus: CommercialContractAccessStatus = currentAccess?.status ?? 'UNRECORDED';

      if (currentVersion !== input.expectedVersion) {
        throw new ConflictException(
          'A situação contratual foi alterada por outro operador. Atualize para revisar antes de confirmar.',
        );
      }

      const situation = contractSituation(contract.revisions, reference);
      if (!isContractAccessTransitionAllowed(fromStatus, input.kind, situation)) {
        throw new ConflictException(
          situation === 'CANCELLED' && input.kind !== 'SUSPENSION'
            ? 'Contratos cancelados não permitem ativação ou reativação de acesso.'
            : 'Esta transição não é permitida para a situação atual de acesso contratual.',
        );
      }

      const spec = contractAccessTransitionRules[input.kind];
      const nextOrdinal = currentVersion + 1;

      if (!currentAccess) {
        await tx.commercialContractAccess.create({
          data: {
            organizationId,
            contractId: contract.id,
            status: spec.toStatus,
            version: 1,
            lastTransitionKind: input.kind,
            lastRule: spec.rule,
            lastOrigin: 'MANUAL_OPERATION',
            lastEffectiveOn: effectiveOn,
            lastReason: input.reason,
            lastNextStep: input.nextStep,
            updatedBy: userId,
            transitions: {
              create: {
                contractId: contract.id,
                ordinal: 1,
                kind: input.kind,
                fromStatus,
                toStatus: spec.toStatus,
                rule: spec.rule,
                origin: 'MANUAL_OPERATION',
                effectiveOn,
                reason: input.reason,
                nextStep: input.nextStep,
                idempotencyKey,
                actorId: userId,
              },
            },
          },
        });
      } else {
        await tx.commercialContractAccess.update({
          where: { id: currentAccess.id, organizationId, version: currentVersion },
          data: {
            status: spec.toStatus,
            version: { increment: 1 },
            lastTransitionKind: input.kind,
            lastRule: spec.rule,
            lastOrigin: 'MANUAL_OPERATION',
            lastEffectiveOn: effectiveOn,
            lastReason: input.reason,
            lastNextStep: input.nextStep,
            updatedBy: userId,
            transitions: {
              create: {
                contractId: contract.id,
                ordinal: nextOrdinal,
                kind: input.kind,
                fromStatus,
                toStatus: spec.toStatus,
                rule: spec.rule,
                origin: 'MANUAL_OPERATION',
                effectiveOn,
                reason: input.reason,
                nextStep: input.nextStep,
                idempotencyKey,
                actorId: userId,
              },
            },
          },
        });
      }

      // Immediately clear active organization context on open sessions without touching memberships or registration.
      if (spec.toStatus === 'SUSPENDED') {
        await tx.session.updateMany({
          where: { activeOrganizationId: organizationId },
          data: { activeOrganizationId: null },
        });
      }

      await tx.platformAuditEvent.create({
        data: {
          actorId: userId,
          action: auditActionFor(input.kind),
          resourceId: organizationId,
          reason: input.reason,
        },
      });

      const updated = await tx.commercialContract.findUniqueOrThrow({
        where: { organizationId },
        include: clientDetailInclude,
      });
      return clientDetailDto(updated, reference);
    });
  }
}
