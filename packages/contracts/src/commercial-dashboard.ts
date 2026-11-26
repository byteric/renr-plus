import { z } from 'zod';
import { commercialBillingSummarySchema } from './commercial-billing';
import { clientClassificationSchema } from './fiscal-identifier';

const competencePattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const competenceError = 'Informe a competência no formato AAAA-MM.';

export const commercialDashboardQuerySchema = z
  .object({
    organizationId: z.uuid().optional(),
    competenceFrom: z.string().regex(competencePattern, competenceError).optional(),
    competenceTo: z.string().regex(competencePattern, competenceError).optional(),
    renewalWindowDays: z.coerce.number().int().min(1).max(180).default(30),
  })
  .strict()
  .refine(
    (value) =>
      !value.competenceFrom || !value.competenceTo || value.competenceFrom <= value.competenceTo,
    {
      message: 'A competência inicial deve ser anterior ou igual à competência final.',
      path: ['competenceTo'],
    },
  );

export const commercialAlertKindSchema = z.enum([
  'CONTRACT_EXPIRED',
  'CONTRACT_EXPIRING_SOON',
  'CONTRACT_DOCUMENT_PENDING',
  'BILLING_OVERDUE',
  'BILLING_DUE_SOON',
  'CONTRACT_ACCESS_SUSPENDED',
  'CONTRACT_ACCESS_UNRECORDED',
  'CLIENT_FISCAL_PENDING',
  'SUPPORT_OVERDUE',
  'SUPPORT_DUE_SOON',
]);

export const commercialAlertDomainSchema = z.enum([
  'catalog',
  'contracts',
  'billing',
  'access',
  'support',
]);
export const commercialAlertSeveritySchema = z.enum(['high', 'medium', 'info']);
export const commercialAlertActionTargetSchema = z.enum([
  'platform-catalog',
  'commercial-clients',
  'commercial-billing',
  'commercial-access',
  'platform-support',
]);

export const commercialAlertSchema = z
  .object({
    id: z.string().min(3).max(200),
    kind: commercialAlertKindSchema,
    severity: commercialAlertSeveritySchema,
    domain: commercialAlertDomainSchema,
    organizationId: z.uuid(),
    organizationName: z.string().min(1).max(160),
    sourceType: z.enum([
      'organization',
      'contract',
      'billing_charge',
      'contract_access',
      'support_ticket',
    ]),
    sourceId: z.uuid(),
    referenceDate: z.iso.date().nullable(),
    title: z.string().min(3).max(180),
    description: z.string().min(3).max(500),
    amountCents: z.number().int().nonnegative().nullable(),
    itemCount: z.number().int().positive().nullable(),
    actionTarget: commercialAlertActionTargetSchema,
    billingStatusFilter: z.enum(['OPEN', 'OVERDUE']).nullable(),
    clientClassification: clientClassificationSchema.nullable().default(null),
  })
  .strict();

export const commercialDashboardScopeSchema = z
  .object({
    canReadOverview: z.boolean(),
    canManageClients: z.boolean(),
    canReadCatalog: z.boolean(),
    canManageCatalog: z.boolean(),
    canReadBilling: z.boolean(),
    canManageBilling: z.boolean(),
    canReadContractAccess: z.boolean(),
    canManageContractAccess: z.boolean(),
    canReadSupport: z.boolean(),
  })
  .strict();

export const commercialDashboardCatalogSchema = z
  .object({
    totalOrganizations: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative(),
    inactiveClients: z.number().int().nonnegative(),
    demonstrations: z.number().int().nonnegative(),
    unclassified: z.number().int().nonnegative(),
    pendingFiscal: z.number().int().nonnegative(),
  })
  .strict();

export const commercialDashboardContractsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
    expiringSoon: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    withoutContractActiveClients: z.number().int().nonnegative(),
    pendingDocumentCount: z.number().int().nonnegative(),
  })
  .strict();

export const commercialDashboardAccessSchema = z
  .object({
    totalClients: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    unrecorded: z.number().int().nonnegative(),
  })
  .strict();

export const commercialDashboardSupportSchema = z
  .object({
    pending: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
  })
  .strict();

export const commercialDashboardReconciliationSchema = z
  .object({
    source: z.literal('COMMERCIAL_LIVE_RECORDS'),
    referenceDate: z.iso.date(),
    timeZone: z.literal('America/Sao_Paulo'),
    checkedAt: z.iso.datetime(),
    counts: z
      .object({
        organizations: z.number().int().nonnegative().nullable(),
        contracts: z.number().int().nonnegative().nullable(),
        charges: z.number().int().nonnegative().nullable(),
        accessRecords: z.number().int().nonnegative().nullable(),
        alerts: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const commercialDashboardSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    timeZone: z.literal('America/Sao_Paulo'),
    referenceDate: z.iso.date(),
    period: z
      .object({
        competenceFrom: z.string().regex(competencePattern).nullable(),
        competenceTo: z.string().regex(competencePattern).nullable(),
        renewalWindowDays: z.number().int().min(1).max(180),
      })
      .strict(),
    organizationId: z.uuid().nullable(),
    scope: commercialDashboardScopeSchema,
    catalog: commercialDashboardCatalogSchema.nullable(),
    contracts: commercialDashboardContractsSchema.nullable(),
    billing: commercialBillingSummarySchema.nullable(),
    contractAccess: commercialDashboardAccessSchema.nullable(),
    supportTickets: commercialDashboardSupportSchema.nullable(),
    alerts: z.array(commercialAlertSchema),
    reconciliation: commercialDashboardReconciliationSchema,
  })
  .strict();

export type CommercialDashboardQuery = z.infer<typeof commercialDashboardQuerySchema>;
export type CommercialAlertKind = z.infer<typeof commercialAlertKindSchema>;
export type CommercialAlertDomain = z.infer<typeof commercialAlertDomainSchema>;
export type CommercialAlertSeverity = z.infer<typeof commercialAlertSeveritySchema>;
export type CommercialAlertActionTarget = z.infer<typeof commercialAlertActionTargetSchema>;
export type CommercialAlert = z.infer<typeof commercialAlertSchema>;
export type CommercialDashboardScope = z.infer<typeof commercialDashboardScopeSchema>;
export type CommercialDashboard = z.infer<typeof commercialDashboardSchema>;
