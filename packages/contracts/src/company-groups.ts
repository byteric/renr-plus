import { z } from 'zod';
import { hrPaginationSchema } from './people-analytics';

const id = z.uuid().transform((value) => value.toLowerCase());
const count = z.number().int().nonnegative();
const version = count.positive();
const rate = z.number().min(0).max(100);
const name = z.string().trim().min(1).max(160);
const reason = z.string().trim().min(1).max(1000);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const organizationIds = z
  .array(id)
  .max(100)
  .refine((values) => values.length === new Set(values).size, 'Empresas repetidas.');

const groupSummary = z.strictObject({ id, name });
const companySummary = groupSummary.extend({ fiscalIdentifier: z.string().nullable() });
const withheld = z.strictObject({ status: z.enum(['PROTECTED', 'UNAVAILABLE']) });
const metrics = z.strictObject({
  employees: count,
  openRisks: count,
  actions: z.strictObject({ pending: count, inProgress: count, done: count, cancelled: count }),
  participation: z.union([
    z.strictObject({
      status: z.literal('AVAILABLE'),
      responses: count,
      eligible: count,
      ratePercent: rate,
    }),
    withheld,
  ]),
  evolution: z.union([
    z.strictObject({
      status: z.literal('AVAILABLE'),
      referencePercent: rate,
      currentPercent: rate,
      deltaPoints: z.number().min(-100).max(100),
    }),
    withheld,
  ]),
});

export const companyGroupListSchema = z.strictObject({ items: z.array(groupSummary) });
export const companyGroupOverviewQuerySchema = z.strictObject({ organizationId: id.optional() });
export const companyGroupOverviewSchema = z.strictObject({
  group: groupSummary,
  totals: metrics,
  companies: z.array(companySummary.extend({ metrics })),
});
export const companyGroupEligibleClientQuerySchema = hrPaginationSchema
  .extend({
    search: z.string().trim().max(160).optional(),
  })
  .strict();

export const createCompanyGroupSchema = z.strictObject({
  name,
  organizationIds: organizationIds.refine((values) => values.length > 0, 'Inclua uma empresa.'),
  reason,
});
export const updateCompanyGroupSchema = z.strictObject({ name, organizationIds, reason, version });
export const managedCompanyGroupSchema = groupSummary.extend({
  organizationIds,
  organizations: z.array(companySummary),
  version,
});
export const companyGroupGrantSchema = z.strictObject({ email, active: z.boolean(), version });
export const writeCompanyGroupGrantSchema = companyGroupGrantSchema.extend({
  reason,
  version: count,
});

const page = z.strictObject({ page: count.positive(), pageSize: count.positive(), total: count });
export const managedCompanyGroupPageSchema = page.extend({
  items: z.array(managedCompanyGroupSchema),
});
export const companyGroupGrantPageSchema = page.extend({ items: z.array(companyGroupGrantSchema) });
export const companyGroupEligibleClientPageSchema = page.extend({ items: z.array(companySummary) });

export type CompanyGroupOverview = z.infer<typeof companyGroupOverviewSchema>;
export type CompanyGroupMetrics = z.infer<typeof metrics>;
export type CreateCompanyGroup = z.infer<typeof createCompanyGroupSchema>;
export type UpdateCompanyGroup = z.infer<typeof updateCompanyGroupSchema>;
export type WriteCompanyGroupGrant = z.infer<typeof writeCompanyGroupGrantSchema>;
export type CompanyGroupEligibleClientQuery = z.infer<typeof companyGroupEligibleClientQuerySchema>;
