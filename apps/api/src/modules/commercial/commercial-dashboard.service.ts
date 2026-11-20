import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  clientClassificationSchema,
  commercialDashboardSchema,
  type CommercialAlert,
  type CommercialAlertSeverity,
  type CommercialDashboard,
  type CommercialDashboardQuery,
  type PlatformCapability,
} from '@renr/contracts';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { referenceDate } from '../actions/actions.repository';

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const civilDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const addDays = (base: Date, days: number) => {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const formatBrDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};
const formatBrl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const severityOrder: Record<CommercialAlertSeverity, number> = {
  high: 0,
  medium: 1,
  info: 2,
};

type ContractRevisionSlice = {
  id: string;
  ordinal: number;
  kind: 'INITIAL' | 'RENEWAL' | 'AMENDMENT' | 'CANCELLATION';
  startsOn: Date;
  endsOn: Date;
  withdrawal: { revisionId: string } | null;
  document: { storedAt: Date | null } | null;
};

function evaluateContract(revisions: ContractRevisionSlice[], reference: Date) {
  let current: ContractRevisionSlice | undefined;
  for (const revision of revisions) {
    if (revision.withdrawal) continue;
    if (revision.startsOn > reference) continue;
    current = revision;
  }
  let situation: 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' =
    revisions.length > 0 && revisions.every((revision) => revision.withdrawal)
      ? 'CANCELLED'
      : 'SCHEDULED';
  if (current) {
    if (current.kind === 'CANCELLATION') situation = 'CANCELLED';
    else situation = current.endsOn < reference ? 'EXPIRED' : 'ACTIVE';
  }
  const pendingDocument = revisions.some(
    (revision) => !revision.withdrawal && Boolean(revision.document && !revision.document.storedAt),
  );
  return { situation, current, pendingDocument };
}

@Injectable()
export class CommercialDashboardService {
  constructor(private readonly database: PrismaService) {}

  async overview(userId: string, query: CommercialDashboardQuery): Promise<CommercialDashboard> {
    return this.database.client.$transaction(
      async (tx) => {
        const grantRows = await tx.platformGrant.findMany({
          where: { userId, isActive: true },
          select: { capability: true },
        });
        const grants = new Set<PlatformCapability>(grantRows.map((row) => row.capability));
        const scope = {
          canReadOverview: grants.has('READ_OVERVIEW'),
          canManageClients: grants.has('MANAGE_CLIENTS'),
          canReadCatalog: grants.has('READ_COMMERCIAL') || grants.has('MANAGE_COMMERCIAL'),
          canManageCatalog: grants.has('MANAGE_COMMERCIAL'),
          canReadBilling: grants.has('READ_BILLING') || grants.has('MANAGE_BILLING'),
          canManageBilling: grants.has('MANAGE_BILLING'),
          canReadContractAccess:
            grants.has('READ_CONTRACT_ACCESS') || grants.has('MANAGE_CONTRACT_ACCESS'),
          canManageContractAccess: grants.has('MANAGE_CONTRACT_ACCESS'),
          canReadSupport: grants.has('READ_SUPPORT') || grants.has('MANAGE_SUPPORT'),
        };

        if (
          !scope.canReadCatalog &&
          !scope.canReadBilling &&
          !scope.canReadContractAccess &&
          !scope.canReadSupport
        ) {
          throw new ForbiddenException();
        }

        const now = new Date();
        const refIso = referenceDate('America/Sao_Paulo', now);
        const reference = civilDate(refIso);
        const renewalEnd = addDays(reference, query.renewalWindowDays);
        const billingDueSoonEnd = addDays(reference, 7);

        const orgFilter: Prisma.OrganizationWhereInput = query.organizationId
          ? { id: query.organizationId }
          : {};
        const alertsByKey = new Map<string, CommercialAlert>();
        const pushAlert = (alert: CommercialAlert) => {
          if (!alertsByKey.has(alert.id)) {
            alertsByKey.set(alert.id, alert);
          }
        };

        const canReadCatalogSummary =
          scope.canReadOverview || scope.canManageClients || scope.canReadCatalog;

        let catalog: CommercialDashboard['catalog'] = null;
        let organizationCount: number | null = null;
        if (canReadCatalogSummary) {
          const organizations = await tx.organization.findMany({
            where: orgFilter,
            select: {
              id: true,
              name: true,
              isActive: true,
              clientClassification: true,
              fiscalState: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });
          organizationCount = organizations.length;
          let activeClients = 0;
          let inactiveClients = 0;
          let demonstrations = 0;
          let unclassified = 0;
          let pendingFiscal = 0;

          for (const org of organizations) {
            if (org.clientClassification === 'CLIENT') {
              if (org.isActive) activeClients += 1;
              else inactiveClients += 1;
            } else if (org.clientClassification === 'DEMONSTRATION') {
              demonstrations += 1;
            } else {
              unclassified += 1;
            }
            if (org.fiscalState !== 'VALID') {
              pendingFiscal += 1;
              if (org.isActive && org.clientClassification !== 'DEMONSTRATION') {
                pushAlert({
                  id: `CLIENT_FISCAL_PENDING:${org.id}`,
                  kind: 'CLIENT_FISCAL_PENDING',
                  severity: 'medium',
                  domain: 'catalog',
                  organizationId: org.id,
                  organizationName: org.name,
                  sourceType: 'organization',
                  sourceId: org.id,
                  referenceDate: null,
                  title: 'Pendência fiscal de CNPJ no catálogo',
                  description: `${org.name} está ativa sem CNPJ validado no catálogo.`,
                  amountCents: null,
                  itemCount: null,
                  actionTarget:
                    scope.canReadOverview || scope.canManageClients
                      ? 'platform-catalog'
                      : 'commercial-clients',
                  billingStatusFilter: null,
                  clientClassification: clientClassificationSchema.parse(org.clientClassification),
                });
              }
            }
          }

          catalog = {
            totalOrganizations: organizations.length,
            activeClients,
            inactiveClients,
            demonstrations,
            unclassified,
            pendingFiscal,
          };
        }

        let contractsSummary: CommercialDashboard['contracts'] = null;
        let contractCount: number | null = null;
        if (scope.canReadCatalog) {
          const [contracts, withoutContractActiveClients] = await Promise.all([
            tx.commercialContract.findMany({
              where: query.organizationId ? { organizationId: query.organizationId } : {},
              select: {
                id: true,
                organizationId: true,
                organization: { select: { name: true } },
                revisions: {
                  orderBy: { ordinal: 'asc' },
                  select: {
                    id: true,
                    ordinal: true,
                    kind: true,
                    startsOn: true,
                    endsOn: true,
                    withdrawal: { select: { revisionId: true } },
                    document: { select: { storedAt: true } },
                  },
                },
              },
              orderBy: [{ organization: { name: 'asc' } }, { id: 'asc' }],
            }),
            tx.organization.count({
              where: {
                ...orgFilter,
                isActive: true,
                clientClassification: 'CLIENT',
                commercialContract: null,
              },
            }),
          ]);

          contractCount = contracts.length;
          let active = 0;
          let scheduled = 0;
          let expiringSoon = 0;
          let expired = 0;
          let cancelled = 0;
          let pendingDocumentCount = 0;

          for (const contract of contracts) {
            const evaluated = evaluateContract(contract.revisions, reference);
            if (evaluated.situation === 'ACTIVE') active += 1;
            else if (evaluated.situation === 'SCHEDULED') scheduled += 1;
            else if (evaluated.situation === 'EXPIRED') expired += 1;
            else cancelled += 1;

            if (evaluated.pendingDocument) {
              pendingDocumentCount += 1;
              pushAlert({
                id: `CONTRACT_DOCUMENT_PENDING:${contract.organizationId}:${contract.id}`,
                kind: 'CONTRACT_DOCUMENT_PENDING',
                severity: 'info',
                domain: 'contracts',
                organizationId: contract.organizationId,
                organizationName: contract.organization.name,
                sourceType: 'contract',
                sourceId: contract.id,
                referenceDate: evaluated.current ? dateOnly(evaluated.current.endsOn) : null,
                title: 'Documento contratual pendente de conclusão',
                description: `Há envio de PDF assinado pendente no contrato de ${contract.organization.name}.`,
                amountCents: null,
                itemCount: null,
                actionTarget: 'commercial-clients',
                billingStatusFilter: null,
                clientClassification: null,
              });
            }

            if (evaluated.situation === 'EXPIRED' && evaluated.current) {
              const endIso = dateOnly(evaluated.current.endsOn);
              pushAlert({
                id: `CONTRACT_EXPIRED:${contract.organizationId}:${contract.id}`,
                kind: 'CONTRACT_EXPIRED',
                severity: 'high',
                domain: 'contracts',
                organizationId: contract.organizationId,
                organizationName: contract.organization.name,
                sourceType: 'contract',
                sourceId: contract.id,
                referenceDate: endIso,
                title: 'Contrato vencido aguardando renovação ou encerramento',
                description: `A vigência de ${contract.organization.name} encerrou em ${formatBrDate(endIso)}.`,
                amountCents: null,
                itemCount: null,
                actionTarget: 'commercial-clients',
                billingStatusFilter: null,
                clientClassification: null,
              });
            } else if (
              evaluated.situation === 'ACTIVE' &&
              evaluated.current &&
              evaluated.current.endsOn <= renewalEnd
            ) {
              expiringSoon += 1;
              const endIso = dateOnly(evaluated.current.endsOn);
              pushAlert({
                id: `CONTRACT_EXPIRING_SOON:${contract.organizationId}:${contract.id}`,
                kind: 'CONTRACT_EXPIRING_SOON',
                severity: 'medium',
                domain: 'contracts',
                organizationId: contract.organizationId,
                organizationName: contract.organization.name,
                sourceType: 'contract',
                sourceId: contract.id,
                referenceDate: endIso,
                title: 'Contrato próximo do vencimento',
                description: `A vigência de ${contract.organization.name} termina em ${formatBrDate(endIso)}.`,
                amountCents: null,
                itemCount: null,
                actionTarget: 'commercial-clients',
                billingStatusFilter: null,
                clientClassification: null,
              });
            }
          }

          contractsSummary = {
            total: contracts.length,
            active,
            scheduled,
            expiringSoon,
            expired,
            cancelled,
            withoutContractActiveClients,
            pendingDocumentCount,
          };
        }

        let billingSummary: CommercialDashboard['billing'] = null;
        let chargeCount: number | null = null;
        if (scope.canReadBilling) {
          const competenceFilter: Prisma.StringFilter | undefined =
            query.competenceFrom || query.competenceTo
              ? {
                  ...(query.competenceFrom ? { gte: query.competenceFrom } : {}),
                  ...(query.competenceTo ? { lte: query.competenceTo } : {}),
                }
              : undefined;
          const baseWhere: Prisma.CommercialBillingChargeWhereInput = {
            ...(query.organizationId ? { organizationId: query.organizationId } : {}),
            ...(competenceFilter ? { competence: competenceFilter } : {}),
          };

          const [openAgg, overdueAgg, paidAgg, unpaidCharges] = await Promise.all([
            tx.commercialBillingCharge.aggregate({
              where: { AND: [baseWhere, { paidOn: null, dueOn: { gte: reference } }] },
              _count: { _all: true },
              _sum: { amountCents: true },
            }),
            tx.commercialBillingCharge.aggregate({
              where: { AND: [baseWhere, { paidOn: null, dueOn: { lt: reference } }] },
              _count: { _all: true },
              _sum: { amountCents: true },
            }),
            tx.commercialBillingCharge.aggregate({
              where: { AND: [baseWhere, { paidOn: { not: null } }] },
              _count: { _all: true },
              _sum: { amountCents: true },
            }),
            tx.commercialBillingCharge.findMany({
              where: { AND: [baseWhere, { paidOn: null, dueOn: { lte: billingDueSoonEnd } }] },
              select: {
                id: true,
                organizationId: true,
                organization: { select: { name: true } },
                amountCents: true,
                dueOn: true,
              },
              orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
            }),
          ]);

          const openCents = openAgg._sum.amountCents ?? 0;
          const overdueCents = overdueAgg._sum.amountCents ?? 0;
          const paidCents = paidAgg._sum.amountCents ?? 0;
          const totalCount = openAgg._count._all + overdueAgg._count._all + paidAgg._count._all;
          chargeCount = totalCount;

          billingSummary = {
            timeZone: 'America/Sao_Paulo',
            referenceDate: refIso,
            billedCents: openCents + overdueCents + paidCents,
            openCents,
            overdueCents,
            receivedCents: paidCents,
            counts: {
              total: totalCount,
              open: openAgg._count._all,
              overdue: overdueAgg._count._all,
              paid: paidAgg._count._all,
            },
          };

          const overdueByOrg = new Map<
            string,
            { orgName: string; sourceId: string; oldestDue: string; count: number; cents: number }
          >();
          const dueSoonByOrg = new Map<
            string,
            { orgName: string; sourceId: string; earliestDue: string; count: number; cents: number }
          >();

          for (const charge of unpaidCharges) {
            const dueIso = dateOnly(charge.dueOn);
            if (charge.dueOn < reference) {
              const existing = overdueByOrg.get(charge.organizationId);
              if (existing) {
                existing.count += 1;
                existing.cents += charge.amountCents;
              } else {
                overdueByOrg.set(charge.organizationId, {
                  orgName: charge.organization.name,
                  sourceId: charge.id,
                  oldestDue: dueIso,
                  count: 1,
                  cents: charge.amountCents,
                });
              }
            } else {
              const existing = dueSoonByOrg.get(charge.organizationId);
              if (existing) {
                existing.count += 1;
                existing.cents += charge.amountCents;
              } else {
                dueSoonByOrg.set(charge.organizationId, {
                  orgName: charge.organization.name,
                  sourceId: charge.id,
                  earliestDue: dueIso,
                  count: 1,
                  cents: charge.amountCents,
                });
              }
            }
          }

          for (const [orgId, item] of overdueByOrg.entries()) {
            pushAlert({
              id: `BILLING_OVERDUE:${orgId}`,
              kind: 'BILLING_OVERDUE',
              severity: 'high',
              domain: 'billing',
              organizationId: orgId,
              organizationName: item.orgName,
              sourceType: 'billing_charge',
              sourceId: item.sourceId,
              referenceDate: item.oldestDue,
              title:
                item.count === 1
                  ? 'Cobrança vencida em aberto'
                  : `${item.count} cobranças vencidas em aberto`,
              description: `${item.orgName} soma ${formatBrl(item.cents)} vencidos desde ${formatBrDate(item.oldestDue)}.`,
              amountCents: item.cents,
              itemCount: item.count,
              actionTarget: 'commercial-billing',
              billingStatusFilter: 'OVERDUE',
              clientClassification: null,
            });
          }

          for (const [orgId, item] of dueSoonByOrg.entries()) {
            pushAlert({
              id: `BILLING_DUE_SOON:${orgId}`,
              kind: 'BILLING_DUE_SOON',
              severity: 'medium',
              domain: 'billing',
              organizationId: orgId,
              organizationName: item.orgName,
              sourceType: 'billing_charge',
              sourceId: item.sourceId,
              referenceDate: item.earliestDue,
              title:
                item.count === 1
                  ? 'Cobrança com vencimento em até 7 dias'
                  : `${item.count} cobranças com vencimento em até 7 dias`,
              description: `${item.orgName} tem ${formatBrl(item.cents)} a vencer a partir de ${formatBrDate(item.earliestDue)}.`,
              amountCents: item.cents,
              itemCount: item.count,
              actionTarget: 'commercial-billing',
              billingStatusFilter: 'OPEN',
              clientClassification: null,
            });
          }
        }

        let contractAccessSummary: CommercialDashboard['contractAccess'] = null;
        let accessRecordCount: number | null = null;
        if (scope.canReadContractAccess) {
          const orgs = await tx.organization.findMany({
            where: orgFilter,
            select: {
              id: true,
              name: true,
              commercialContract: {
                select: {
                  id: true,
                  revisions: {
                    orderBy: { ordinal: 'asc' },
                    select: {
                      id: true,
                      ordinal: true,
                      kind: true,
                      startsOn: true,
                      endsOn: true,
                      withdrawal: { select: { revisionId: true } },
                      document: { select: { storedAt: true } },
                    },
                  },
                },
              },
              commercialContractAccess: {
                select: {
                  id: true,
                  status: true,
                  lastEffectiveOn: true,
                  lastReason: true,
                },
              },
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });

          let active = 0;
          let suspended = 0;
          let unrecorded = 0;
          let recordedRows = 0;

          for (const org of orgs) {
            const access = org.commercialContractAccess;
            if (!access) {
              unrecorded += 1;
              const hasActiveContract =
                org.commercialContract &&
                evaluateContract(org.commercialContract.revisions, reference).situation ===
                  'ACTIVE';
              if (hasActiveContract && org.commercialContract) {
                pushAlert({
                  id: `CONTRACT_ACCESS_UNRECORDED:${org.id}`,
                  kind: 'CONTRACT_ACCESS_UNRECORDED',
                  severity: 'medium',
                  domain: 'access',
                  organizationId: org.id,
                  organizationName: org.name,
                  sourceType: 'organization',
                  sourceId: org.id,
                  referenceDate: null,
                  title: 'Contrato vigente sem decisão de acesso registrada',
                  description: `${org.name} possui contrato vigente ainda sem ativação contratual explícita registrada.`,
                  amountCents: null,
                  itemCount: null,
                  actionTarget: 'commercial-access',
                  billingStatusFilter: null,
                  clientClassification: null,
                });
              }
            } else {
              recordedRows += 1;
              if (access.status === 'ACTIVE') {
                active += 1;
              } else {
                suspended += 1;
                const effIso = dateOnly(access.lastEffectiveOn);
                pushAlert({
                  id: `CONTRACT_ACCESS_SUSPENDED:${org.id}:${access.id}`,
                  kind: 'CONTRACT_ACCESS_SUSPENDED',
                  severity: 'high',
                  domain: 'access',
                  organizationId: org.id,
                  organizationName: org.name,
                  sourceType: 'contract_access',
                  sourceId: access.id,
                  referenceDate: effIso,
                  title: 'Acesso contratual suspenso',
                  description: `${org.name} está com acesso contratual suspenso desde ${formatBrDate(effIso)}.`,
                  amountCents: null,
                  itemCount: null,
                  actionTarget: 'commercial-access',
                  billingStatusFilter: null,
                  clientClassification: null,
                });
              }
            }
          }

          accessRecordCount = recordedRows;
          contractAccessSummary = {
            totalClients: orgs.length,
            active,
            suspended,
            unrecorded,
          };
        }

        let supportTickets: CommercialDashboard['supportTickets'] = null;
        if (scope.canReadSupport) {
          const filter: Prisma.SupportTicketWhereInput = {
            organizationId: query.organizationId,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          };
          const [pending, deadlines] = await Promise.all([
            tx.supportTicket.count({ where: filter }),
            tx.supportTicket.findMany({
              where: { ...filter, dueOn: { lte: addDays(reference, 7) } },
              select: {
                id: true,
                organizationId: true,
                dueOn: true,
                organization: { select: { name: true } },
              },
            }),
          ]);
          let overdue = 0;
          let dueSoon = 0;
          for (const ticket of deadlines) {
            if (!ticket.dueOn) continue;
            const expired = ticket.dueOn < reference;
            if (expired) overdue += 1;
            else dueSoon += 1;
            const deadline = dateOnly(ticket.dueOn);
            const kind = expired ? 'SUPPORT_OVERDUE' : 'SUPPORT_DUE_SOON';
            pushAlert({
              id: `${kind}:${ticket.id}`,
              kind,
              severity: expired ? 'high' : 'medium',
              domain: 'support',
              organizationId: ticket.organizationId,
              organizationName: ticket.organization.name,
              sourceType: 'support_ticket',
              sourceId: ticket.id,
              referenceDate: deadline,
              title: expired ? 'Chamado com prazo vencido' : 'Chamado com prazo próximo',
              description: `Prazo de atendimento registrado para ${formatBrDate(deadline)}.`,
              amountCents: null,
              itemCount: null,
              actionTarget: 'platform-support',
              billingStatusFilter: null,
              clientClassification: null,
            });
          }
          supportTickets = { pending, dueSoon, overdue };
        }

        const alerts = Array.from(alertsByKey.values()).sort((left, right) => {
          const severityDiff = severityOrder[left.severity] - severityOrder[right.severity];
          if (severityDiff !== 0) return severityDiff;
          const dateLeft = left.referenceDate ?? '9999-12-31';
          const dateRight = right.referenceDate ?? '9999-12-31';
          if (dateLeft !== dateRight) return dateLeft.localeCompare(dateRight);
          return (
            left.organizationName.localeCompare(right.organizationName, 'pt-BR') ||
            left.id.localeCompare(right.id)
          );
        });

        return commercialDashboardSchema.parse({
          generatedAt: now.toISOString(),
          timeZone: 'America/Sao_Paulo',
          referenceDate: refIso,
          period: {
            competenceFrom: query.competenceFrom ?? null,
            competenceTo: query.competenceTo ?? null,
            renewalWindowDays: query.renewalWindowDays,
          },
          organizationId: query.organizationId ?? null,
          scope,
          catalog,
          contracts: contractsSummary,
          billing: billingSummary,
          contractAccess: contractAccessSummary,
          supportTickets,
          alerts,
          reconciliation: {
            source: 'COMMERCIAL_LIVE_RECORDS',
            referenceDate: refIso,
            timeZone: 'America/Sao_Paulo',
            checkedAt: now.toISOString(),
            counts: {
              organizations: organizationCount,
              contracts: contractCount,
              charges: chargeCount,
              accessRecords: accessRecordCount,
              alerts: alerts.length,
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
