import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  commercialClientListSchema,
  commercialClientSchema,
  commercialContractSchema,
  commercialDocumentSchema,
  commercialPlanSchema,
  normalizeCnpj,
  type CommercialCreateContract,
  type CommercialCreatePlan,
  type CommercialReviseContract,
  type CommercialRevisePlan,
  type CommercialUpdateClient,
  type PlatformQuery,
} from '@renr/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, ParseSpeeds } from 'pdf-lib';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type CommercialClientProfile,
  type CommercialContractDocument,
  type CommercialPlanVersion,
  type Organization,
} from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';
import { EvidenceStorage } from '../evidence/evidence.storage';

const planInclude = {
  versions: { orderBy: { ordinal: 'asc' } },
} satisfies Prisma.CommercialPlanInclude;
const revisionInclude = {
  planVersion: { include: { plan: true } },
  document: true,
  withdrawal: true,
} satisfies Prisma.CommercialContractRevisionInclude;
const contractInclude = {
  revisions: { orderBy: { ordinal: 'asc' }, include: revisionInclude },
} satisfies Prisma.CommercialContractInclude;
type PlanRecord = Prisma.CommercialPlanGetPayload<{ include: typeof planInclude }>;
type RevisionRecord = Prisma.CommercialContractRevisionGetPayload<{
  include: typeof revisionInclude;
}>;
type ContractRecord = Prisma.CommercialContractGetPayload<{ include: typeof contractInclude }>;
type Permission = 'read' | 'manage';

export type CommercialDocumentTarget = {
  organizationId: string;
  contractId: string;
  revisionId: string;
};

export const commercialDocumentMaxBytes = 5 * 1024 * 1024;
const pdfMime = 'application/pdf';
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const civilDate = (date: string) => new Date(date + 'T00:00:00.000Z');
const today = () => civilDate(referenceDate('America/Sao_Paulo', new Date()));

function offerVersionDto(version: CommercialPlanVersion) {
  return {
    id: version.id,
    ordinal: version.ordinal,
    effectiveOn: dateOnly(version.effectiveOn),
    priceCents: version.priceCents,
    pricingUnit: version.pricingUnit,
    priceMode: version.priceMode,
    conditions: version.conditions,
    limits: version.limits,
    includedFeatures: version.includedFeatures,
    plannedFeatures: version.plannedFeatures,
  };
}

function planDto(plan: PlanRecord) {
  return commercialPlanSchema.parse({
    id: plan.id,
    name: plan.name,
    kind: plan.kind,
    version: plan.version,
    versions: plan.versions.map(offerVersionDto),
  });
}

function documentDto(file: CommercialContractDocument) {
  return commercialDocumentSchema.parse({
    id: file.id,
    fileName: file.fileName,
    size: file.size,
    sha256: file.sha256,
    createdAt: file.createdAt.toISOString(),
  });
}

function contractDto(contract: ContractRecord, reference: Date) {
  let current: RevisionRecord | undefined;
  for (const revision of contract.revisions) {
    if (revision.withdrawal) continue;
    if (revision.startsOn > reference) break;
    current = revision;
  }
  let situation: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' = contract.revisions.every(
    (revision) => revision.withdrawal,
  )
    ? 'CANCELLED'
    : 'SCHEDULED';
  if (current) {
    if (current.kind === 'CANCELLATION') situation = 'CANCELLED';
    else situation = current.endsOn < reference ? 'EXPIRED' : 'ACTIVE';
  }
  return commercialContractSchema.parse({
    id: contract.id,
    organizationId: contract.organizationId,
    version: contract.version,
    situation,
    currentRevisionId: current?.id ?? null,
    revisions: contract.revisions.map((revision) => ({
      id: revision.id,
      ordinal: revision.ordinal,
      kind: revision.kind,
      startsOn: dateOnly(revision.startsOn),
      endsOn: dateOnly(revision.endsOn),
      terms: revision.terms,
      reason: revision.reason,
      createdAt: revision.createdAt.toISOString(),
      plan: { id: revision.planVersion.planId, name: revision.planVersion.plan.name },
      planVersion: offerVersionDto(revision.planVersion),
      document: revision.document?.storedAt ? documentDto(revision.document) : null,
      documentPending: Boolean(revision.document && !revision.document.storedAt),
      withdrawal: revision.withdrawal && {
        at: revision.withdrawal.createdAt.toISOString(),
        reason: revision.withdrawal.reason,
      },
    })),
  });
}

function clientDto(
  organization: Organization,
  profile: CommercialClientProfile | null,
  current: RevisionRecord | null,
  reference: Date,
) {
  const plan =
    current && current.kind !== 'CANCELLATION' && current.endsOn >= reference
      ? current.planVersion
      : null;
  return commercialClientSchema.parse({
    organizationId: organization.id,
    name: organization.name,
    isActive: organization.isActive,
    clientClassification: organization.clientClassification,
    fiscalIdentifier: organization.fiscalIdentifier,
    fiscalState: organization.fiscalState,
    contactName: profile?.contactName ?? null,
    contactEmail: profile?.contactEmail ?? null,
    adoptedOn: profile?.adoptedOn ? dateOnly(profile.adoptedOn) : null,
    version: profile?.version ?? 0,
    activePlan: plan
      ? { id: plan.planId, name: plan.plan.name, versionId: plan.id, ordinal: plan.ordinal }
      : null,
  });
}

function currentRevisionQuery(reference: Date) {
  return {
    where: { startsOn: { lte: reference }, withdrawal: null },
    orderBy: { ordinal: 'desc' },
    take: 1,
    include: revisionInclude,
  } satisfies Prisma.CommercialContract$revisionsArgs;
}

async function safePdf(file: Express.Multer.File | undefined) {
  if (!file) throw new BadRequestException('Envie um PDF.');
  if (file.buffer.length > commercialDocumentMaxBytes) throw new PayloadTooLargeException();
  const originalName = file.originalname.split(/[\\/]/).at(-1) ?? '';
  if (
    file.mimetype !== pdfMime ||
    !/\.pdf$/i.test(originalName) ||
    !/^%PDF-[12]\.[0-9][\r\n]/.test(file.buffer.subarray(0, 10).toString('latin1'))
  ) {
    throw new BadRequestException('Envie um PDF válido.');
  }
  const trailer = /startxref[\t\r\n ]+(\d+)[\t\r\n ]+%%EOF[\t\r\n ]*$/.exec(
    file.buffer.subarray(-4096).toString('latin1'),
  );
  const start = Number(trailer?.[1]);
  if (
    !Number.isSafeInteger(start) ||
    start < 9 ||
    start >= file.buffer.length ||
    !/^(xref\b|\d+\s+\d+\s+obj\b)/.test(file.buffer.subarray(start, start + 64).toString('latin1'))
  ) {
    throw new BadRequestException('Envie um PDF válido e completo.');
  }
  try {
    const document = await PDFDocument.load(file.buffer, {
      updateMetadata: false,
      throwOnInvalidObject: true,
      parseSpeed: ParseSpeeds.Slow,
    });
    if (document.getPageCount() === 0) throw new Error('PDF without pages');
  } catch {
    throw new BadRequestException('Envie um PDF válido, completo e sem senha.');
  }
  const stem = originalName
    .slice(0, -4)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 120);
  return { fileName: (stem || 'contrato') + '.pdf', buffer: file.buffer };
}

async function organization(tx: Prisma.TransactionClient, organizationId: string) {
  const row = await tx.organization.findUnique({ where: { id: organizationId } });
  if (!row) throw new NotFoundException();
  return row;
}

async function lookupContract(
  tx: Prisma.TransactionClient,
  organizationId: string,
  contractId: string,
) {
  const row = await tx.commercialContract.findUnique({
    where: { id: contractId, organizationId },
    include: contractInclude,
  });
  if (!row) throw new NotFoundException();
  return row;
}

async function lookupRevision(tx: Prisma.TransactionClient, target: CommercialDocumentTarget) {
  const row = await tx.commercialContractRevision.findUnique({
    where: {
      id: target.revisionId,
      contractId: target.contractId,
      contract: { organizationId: target.organizationId },
    },
    select: { document: true, withdrawal: true },
  });
  if (!row) throw new NotFoundException();
  return row;
}

async function eligiblePlanVersion(
  tx: Prisma.TransactionClient,
  versionId: string,
  effectiveDate: Date,
) {
  const requested = await tx.commercialPlanVersion.findUnique({
    where: { id: versionId },
    include: { plan: { select: { kind: true } } },
  });
  if (!requested) throw new NotFoundException();
  const effective = await tx.commercialPlanVersion.findFirst({
    where: { planId: requested.planId, effectiveOn: { lte: effectiveDate } },
    orderBy: { effectiveOn: 'desc' },
    select: { id: true },
  });
  if (requested.plan.kind !== 'PLAN' || effective?.id !== versionId)
    throw new ConflictException('Selecione uma versão vigente de um plano na data de início.');
}

async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  resourceId: string,
  reason: string,
) {
  await tx.platformAuditEvent.create({ data: { actorId, action, resourceId, reason } });
}

@Injectable()
export class CommercialService {
  constructor(
    private readonly database: PrismaService,
    private readonly storage: EvidenceStorage,
  ) {}

  private async transaction<T>(
    userId: string,
    permission: Permission,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    lock = permission === 'manage',
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          if (lock)
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('renr-platform-access'))::text`;
          const grant = await tx.platformGrant.findFirst({
            where: {
              userId,
              isActive: true,
              capability: {
                in:
                  permission === 'manage'
                    ? ['MANAGE_COMMERCIAL']
                    : ['READ_COMMERCIAL', 'MANAGE_COMMERCIAL'],
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
        throw new ConflictException();
      }
      throw error;
    }
  }

  listPlans(userId: string) {
    return this.transaction(userId, 'read', async (tx) => {
      const plans = await tx.commercialPlan.findMany({
        orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        include: planInclude,
      });
      return { items: plans.map(planDto) };
    });
  }

  createPlan(userId: string, input: CommercialCreatePlan) {
    return this.transaction(userId, 'manage', async (tx) => {
      const plan = await tx.commercialPlan.create({
        data: {
          name: input.name,
          kind: input.kind,
          versions: {
            create: {
              ...input.version,
              effectiveOn: civilDate(input.version.effectiveOn),
              ordinal: 1,
              createdBy: userId,
              reason: input.reason,
            },
          },
        },
        include: planInclude,
      });
      await audit(tx, userId, 'COMMERCIAL_PLAN_CREATED', plan.id, input.reason);
      return planDto(plan);
    });
  }

  revisePlan(userId: string, planId: string, input: CommercialRevisePlan) {
    return this.transaction(userId, 'manage', async (tx) => {
      const plan = await tx.commercialPlan.findUnique({
        where: { id: planId },
        include: planInclude,
      });
      if (!plan) throw new NotFoundException();
      if (plan.version !== input.expectedVersion) throw new ConflictException();
      if ((plan.kind === 'PLAN') !== (input.version.pricingUnit === 'EMPLOYEE_MONTH'))
        throw new BadRequestException('A unidade de preço precisa corresponder ao tipo de oferta.');

      const effectiveOn = civilDate(input.version.effectiveOn);
      const latest = plan.versions.at(-1);
      if (!latest || effectiveOn <= latest.effectiveOn)
        throw new ConflictException('A nova vigência deve começar após a versão anterior.');

      const updated = await tx.commercialPlan.update({
        where: { id: planId, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          versions: {
            create: {
              ...input.version,
              effectiveOn,
              ordinal: latest.ordinal + 1,
              createdBy: userId,
              reason: input.reason,
            },
          },
        },
        include: planInclude,
      });
      await audit(tx, userId, 'COMMERCIAL_PLAN_REVISED', plan.id, input.reason);
      return planDto(updated);
    });
  }

  listClients(userId: string, query: PlatformQuery) {
    return this.transaction(userId, 'read', async (tx) => {
      const normalizedSearch = query.search ? normalizeCnpj(query.search) : undefined;
      const where: Prisma.OrganizationWhereInput = {
        ...(query.classification ? { clientClassification: query.classification } : {}),
        ...(query.fiscalState ? { fiscalState: query.fiscalState } : {}),
        ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                ...(normalizedSearch ? [{ fiscalCandidate: { contains: normalizedSearch } }] : []),
              ],
            }
          : {}),
      };
      const [companies, total] = await Promise.all([
        tx.organization.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.organization.count({ where }),
      ]);
      const scope = { organizationId: { in: companies.map((company) => company.id) } };
      const reference = today();
      const [profiles, contracts] = await Promise.all([
        tx.commercialClientProfile.findMany({ where: scope }),
        tx.commercialContract.findMany({
          where: scope,
          include: { revisions: currentRevisionQuery(reference) },
        }),
      ]);
      const profilesByCompany = new Map(profiles.map((row) => [row.organizationId, row]));
      const currentByCompany = new Map(
        contracts.map((contract) => [contract.organizationId, contract.revisions[0]]),
      );
      return commercialClientListSchema.parse({
        items: companies.map((company) =>
          clientDto(
            company,
            profilesByCompany.get(company.id) ?? null,
            currentByCompany.get(company.id) ?? null,
            reference,
          ),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      });
    });
  }

  updateClient(userId: string, organizationId: string, input: CommercialUpdateClient) {
    return this.transaction(userId, 'manage', async (tx) => {
      const company = await organization(tx, organizationId);
      const where = { organizationId };
      const current = await tx.commercialClientProfile.findUnique({ where });
      if ((current?.version ?? 0) !== input.expectedVersion) throw new ConflictException();
      const data = {
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        adoptedOn: input.adoptedOn ? civilDate(input.adoptedOn) : null,
      };
      const profile = current
        ? await tx.commercialClientProfile.update({
            where: { ...where, version: input.expectedVersion },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.commercialClientProfile.create({ data: { ...data, organizationId } });
      await audit(tx, userId, 'COMMERCIAL_CLIENT_UPDATED', organizationId, input.reason);
      const reference = today();
      const contract = await tx.commercialContract.findUnique({
        where,
        include: { revisions: currentRevisionQuery(reference) },
      });
      return clientDto(company, profile, contract?.revisions[0] ?? null, reference);
    });
  }

  findContract(userId: string, organizationId: string) {
    return this.transaction(userId, 'read', async (tx) => {
      await organization(tx, organizationId);
      const contract = await tx.commercialContract.findUnique({
        where: { organizationId },
        include: contractInclude,
      });
      return { contract: contract && contractDto(contract, today()) };
    });
  }

  createContract(userId: string, organizationId: string, input: CommercialCreateContract) {
    return this.transaction(userId, 'manage', async (tx) => {
      const company = await organization(tx, organizationId);
      if (
        !company.isActive ||
        (company.clientClassification !== 'DEMONSTRATION' &&
          !(company.clientClassification === 'CLIENT' && company.fiscalState === 'VALID'))
      ) {
        throw new ConflictException(
          'Selecione uma demonstração ativa ou um cliente ativo com CNPJ válido.',
        );
      }
      const startsOn = civilDate(input.startsOn);
      await eligiblePlanVersion(tx, input.planVersionId, startsOn);
      const contract = await tx.commercialContract.create({
        data: {
          organizationId,
          revisions: {
            create: {
              ordinal: 1,
              kind: 'INITIAL',
              planVersionId: input.planVersionId,
              startsOn,
              endsOn: civilDate(input.endsOn),
              terms: input.terms,
              reason: input.reason,
              createdBy: userId,
            },
          },
        },
        include: contractInclude,
      });
      await audit(tx, userId, 'COMMERCIAL_CONTRACT_CREATED', contract.id, input.reason);
      return contractDto(contract, today());
    });
  }

  reviseContract(
    userId: string,
    organizationId: string,
    contractId: string,
    input: CommercialReviseContract,
  ) {
    return this.transaction(userId, 'manage', async (tx) => {
      const contract = await lookupContract(tx, organizationId, contractId);
      const lastRecorded = contract.revisions.at(-1);
      if (!lastRecorded || contract.version !== input.expectedVersion)
        throw new ConflictException();
      const reference = today();
      const previous = contract.revisions.filter((revision) => !revision.withdrawal).at(-1);
      if (input.kind === 'WITHDRAW_SCHEDULED') {
        if (previous?.id !== input.revisionId || previous.startsOn <= reference)
          throw new ConflictException(
            'Retire primeiro o último termo agendado ainda sem vigência.',
          );
        const linkedCharges = await tx.commercialBillingChargeRevision.count({
          where: { contractId, contractRevisionId: previous.id },
        });
        if (linkedCharges > 0)
          throw new ConflictException(
            'Não é possível retirar um termo agendado que já possui cobranças vinculadas.',
          );
        await tx.commercialContractWithdrawal.create({
          data: { revisionId: previous.id, reason: input.reason },
        });
        const revised = await tx.commercialContract.update({
          where: { id: contractId, organizationId, version: input.expectedVersion },
          data: { version: { increment: 1 } },
          include: contractInclude,
        });
        await audit(
          tx,
          userId,
          'COMMERCIAL_CONTRACT_SCHEDULE_WITHDRAWN',
          previous.id,
          input.reason,
        );
        return contractDto(revised, reference);
      }
      const startsOn = civilDate(input.startsOn);
      if (previous && startsOn <= previous.startsOn)
        throw new ConflictException('A data deve ser posterior à revisão anterior.');
      if (input.kind === 'RENEWAL') {
        if (previous && startsOn <= previous.endsOn)
          throw new ConflictException('A renovação deve começar após o fim da vigência anterior.');
      } else if (!previous || previous.kind === 'CANCELLATION' || startsOn > previous.endsOn) {
        throw new ConflictException('Use uma data dentro da vigência anterior.');
      }
      let data: Pick<
        Prisma.CommercialContractRevisionUncheckedCreateInput,
        'endsOn' | 'terms' | 'planVersionId'
      >;
      if (input.kind === 'CANCELLATION') {
        if (!previous) throw new ConflictException();
        data = { endsOn: startsOn, terms: previous.terms, planVersionId: previous.planVersionId };
      } else {
        await eligiblePlanVersion(tx, input.planVersionId, startsOn);
        data = {
          endsOn: civilDate(input.endsOn),
          terms: input.terms,
          planVersionId: input.planVersionId,
        };
      }

      const revised = await tx.commercialContract.update({
        where: { id: contractId, organizationId, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          revisions: {
            create: {
              ordinal: lastRecorded.ordinal + 1,
              kind: input.kind,
              startsOn,
              ...data,
              reason: input.reason,
              createdBy: userId,
            },
          },
        },
        include: contractInclude,
      });
      await audit(tx, userId, 'COMMERCIAL_CONTRACT_' + input.kind, contractId, input.reason);
      return contractDto(revised, reference);
    });
  }

  assertDocumentUpload(userId: string, target: CommercialDocumentTarget) {
    return this.transaction(
      userId,
      'manage',
      async (tx) => {
        const revision = await lookupRevision(tx, target);
        if ((revision.withdrawal && !revision.document) || revision.document?.storedAt)
          throw new ConflictException('O anexo desta revisão está encerrado.');
      },
      false,
    );
  }

  async uploadDocument(
    userId: string,
    target: CommercialDocumentTarget,
    file: Express.Multer.File | undefined,
  ) {
    const { fileName, buffer } = await safePdf(file);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    this.storage.assertEnabled();
    const reserved = await this.transaction(userId, 'manage', async (tx) => {
      const revision = await lookupRevision(tx, target);
      if ((revision.withdrawal && !revision.document) || revision.document?.storedAt)
        throw new ConflictException();
      if (revision.document) {
        if (revision.document.sha256 !== sha256 || revision.document.size !== buffer.length)
          throw new ConflictException('Reenvie o mesmo PDF da tentativa pendente.');
        return revision.document;
      }
      return tx.commercialContractDocument.create({
        data: {
          revisionId: target.revisionId,
          fileName,
          size: buffer.length,
          sha256,
          storageKey: `commercial/contracts/${target.organizationId}/${target.contractId}/${target.revisionId}/${randomUUID()}.pdf`,
          createdBy: userId,
        },
      });
    });
    // A retry can overwrite this reservation only with the exact same bytes.
    await this.storage.put(reserved.storageKey, buffer, pdfMime, sha256);
    return this.transaction(userId, 'manage', async (tx) => {
      const revision = await lookupRevision(tx, target);
      if (revision.document?.id !== reserved.id || revision.document.storedAt)
        throw new ConflictException();
      const saved = await tx.commercialContractDocument.update({
        where: { id: reserved.id },
        data: { storedAt: new Date(Math.max(Date.now(), reserved.createdAt.getTime())) },
      });
      await audit(
        tx,
        userId,
        'COMMERCIAL_DOCUMENT_ATTACHED',
        saved.id,
        'Documento da revisão anexado.',
      );
      return documentDto(saved);
    });
  }

  async downloadDocument(userId: string, target: CommercialDocumentTarget) {
    const file = await this.transaction(userId, 'read', async (tx) => {
      const { document } = await lookupRevision(tx, target);
      if (!document?.storedAt) throw new NotFoundException();
      return document;
    });
    const stream = await this.storage.get(file.storageKey);
    const chunks: Buffer[] = [];
    let length = 0;
    const digest = createHash('sha256');
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > file.size || length > commercialDocumentMaxBytes)
          throw new ServiceUnavailableException();
        digest.update(buffer);
        chunks.push(buffer);
      }
      if (length !== file.size || digest.digest('hex') !== file.sha256)
        throw new ServiceUnavailableException();
    } catch {
      throw new ServiceUnavailableException();
    } finally {
      stream.destroy();
    }

    await this.transaction(
      userId,
      'read',
      async (tx) => {
        const current = (await lookupRevision(tx, target)).document;
        if (current?.id !== file.id) throw new NotFoundException();
        await audit(
          tx,
          userId,
          'COMMERCIAL_DOCUMENT_DOWNLOADED',
          file.id,
          'Documento da revisão consultado.',
        );
      },
      true,
    );
    return { file: documentDto(file), buffer: Buffer.concat(chunks, length) };
  }
}
