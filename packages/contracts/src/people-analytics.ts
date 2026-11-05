import { z } from 'zod';
import { clientClassificationSchema, fiscalStateSchema } from './fiscal-identifier';

export const hrCivilDateSchema = z.iso.date().refine((v) => v >= '1900-01-01' && v <= '2199-12-31');
export const competenceSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const moneyCentsSchema = z.string().regex(/^(0|[1-9]\d{0,14})$/);
const count = z.number().int().nonnegative();
const source = z.string().trim().min(3).max(500);
const reason = z.string().trim().min(3).max(1000);
const versioned = { expectedVersion: count, reason, source };
export const hrGenderSchema = z.enum([
  'FEMALE',
  'MALE',
  'NON_BINARY',
  'SELF_DESCRIBED',
  'PREFER_NOT_TO_SAY',
]);
const profileFields = {
  birthDate: hrCivilDateSchema.nullable(),
  gender: hrGenderSchema.nullable(),
  genderDescription: z.string().trim().max(120).nullable(),
  vacationHistoryKnown: z.boolean(),
  complexLeaveHistoryKnown: z.boolean(),
  hasComplexLeaves: z.boolean(),
  followUp: z.boolean(),
};
export const updateHrProfileSchema = z
  .object({ ...versioned, ...profileFields })
  .strict()
  .refine(
    (v) => (v.gender === 'SELF_DESCRIBED' ? !!v.genderDescription : v.genderDescription === null),
    'A autodescrição é usada somente na categoria correspondente.',
  );
export const hrProfileSchema = z
  .object({
    organizationId: z.uuid(),
    employeeId: z.uuid(),
    version: count,
    ...profileFields,
    source: z.string().nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const writeEmploymentPeriodSchema = z
  .object({
    ...versioned,
    startsOn: hrCivilDateSchema,
    endsOn: hrCivilDateSchema.nullable(),
  })
  .strict()
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, 'Fim anterior ao início.');
export const employmentPeriodSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    employeeId: z.uuid(),
    version: count,
    startsOn: hrCivilDateSchema,
    endsOn: hrCivilDateSchema.nullable(),
    source,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const writeRemunerationSchema = z
  .object({
    ...versioned,
    competence: competenceSchema,
    salaryCents: moneyCentsSchema,
    remunerationType: z.enum(['FIXED', 'VARIABLE']),
  })
  .strict();
export const remunerationSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    employeeId: z.uuid(),
    version: count,
    competence: competenceSchema,
    salaryCents: moneyCentsSchema,
    remunerationType: z.enum(['FIXED', 'VARIABLE']),
    source,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const vacationUseSchema = z
  .object({
    startsOn: hrCivilDateSchema,
    endsOn: hrCivilDateSchema,
    paidOn: hrCivilDateSchema.nullable(),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, 'Fim anterior ao início.');
export const vacationEntitlementDaysSchema = z
  .number()
  .int()
  .refine(
    (value) => [0, 12, 18, 24, 30].includes(value),
    'Informe 0, 12, 18, 24 ou 30 dias de direito no cenário CLT suportado.',
  );
export const writeVacationPeriodSchema = z
  .object({
    ...versioned,
    acquisitionStart: hrCivilDateSchema,
    acquisitionEnd: hrCivilDateSchema,
    concessionDeadline: hrCivilDateSchema,
    entitlementDays: vacationEntitlementDaysSchema,
    balanceDays: z.number().int().min(0).max(30),
    unjustifiedAbsences: z.number().int().min(0).max(366),
    historyKnown: z.boolean(),
    uses: z.array(vacationUseSchema).max(3),
  })
  .strict()
  .refine(
    (v) =>
      v.acquisitionStart <= v.acquisitionEnd &&
      v.acquisitionEnd < v.concessionDeadline &&
      v.balanceDays <= v.entitlementDays,
    'Confira datas, direito e saldo.',
  );
export const vacationPeriodSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    employeeId: z.uuid(),
    version: count,
    acquisitionStart: hrCivilDateSchema,
    acquisitionEnd: hrCivilDateSchema,
    concessionDeadline: hrCivilDateSchema,
    entitlementDays: count,
    balanceDays: count,
    unjustifiedAbsences: count,
    historyKnown: z.boolean(),
    uses: z.array(vacationUseSchema),
    source,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const hrPaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const hrListSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      total: count,
      page: count,
      pageSize: z.number().int().min(1).max(100),
    })
    .strict();
export const employmentPeriodListSchema = hrListSchema(employmentPeriodSchema);
export const remunerationListSchema = hrListSchema(remunerationSchema);
export const vacationPeriodListSchema = hrListSchema(vacationPeriodSchema);
export const clientRegistrationSchema = z
  .object({
    organizationId: z.uuid(),
    name: z.string(),
    fiscalIdentifier: z.string().nullable(),
    normalizedFiscalIdentifier: z.string().nullable(),
    fiscalState: fiscalStateSchema,
    clientClassification: clientClassificationSchema,
    isActive: z.boolean(),
    version: count,
  })
  .strict();
export const metricStateSchema = z.enum([
  'KNOWN',
  'INSUFFICIENT_DATA',
  'SUPPRESSED',
  'FORBIDDEN',
  'UNCONFIGURED',
]);
export const peopleMetricSchema = z
  .object({
    state: metricStateSchema,
    value: z.string().nullable(),
    known: count.nullable(),
    missing: count.nullable(),
    explanation: z.string(),
  })
  .strict();
export const peopleDistributionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    state: metricStateSchema,
    items: z.array(
      z.object({ key: z.string(), label: z.string(), count: count.nullable() }).strict(),
    ),
  })
  .strict();
export const peopleOverviewQuerySchema = z
  .object({
    unitId: z.uuid().optional(),
    sectorId: z.uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
    competence: competenceSchema.optional(),
  })
  .strict();
export const peopleOverviewSchema = z
  .object({
    registration: clientRegistrationSchema,
    generatedAt: z.iso.datetime(),
    referenceDate: hrCivilDateSchema,
    timeZone: z.string(),
    competence: competenceSchema,
    privacyPolicy: z.literal('HR_MIN5_COMPLEMENT_V1'),
    filters: z
      .object({
        unitId: z.uuid().nullable(),
        sectorId: z.uuid().nullable(),
        isActive: z.boolean().nullable(),
      })
      .strict(),
    population: z
      .object({ total: count, active: count, inactive: count, unit: z.literal('EMPLOYEE_RECORDS') })
      .strict(),
    metrics: z
      .object({
        averageAge: peopleMetricSchema,
        averageTenureMonths: peopleMetricSchema,
        genderCoveragePercent: peopleMetricSchema,
        salaryMassCents: peopleMetricSchema,
        averageSalaryCents: peopleMetricSchema,
        terminationGrossCents: peopleMetricSchema,
        vacationOverdue: peopleMetricSchema,
        vacationUnknown: peopleMetricSchema,
        vacationDueSoon: peopleMetricSchema,
      })
      .strict(),
    distributions: z.array(peopleDistributionSchema),
    settlementPolicy: z
      .object({ version: z.string(), scenario: z.string(), limitations: z.array(z.string()) })
      .strict(),
  })
  .strict();
export const settlementRequestSchema = z
  .object({
    terminationDate: hrCivilDateSchema,
    paidSalaryDays: z.number().int().min(0).max(31).optional(),
    thirteenthAdvanceCents: moneyCentsSchema.optional(),
    thirteenthHistoryKnown: z.boolean(),
    thirteenthComputableDaysByMonth: z
      .record(competenceSchema, z.number().int().min(0).max(31))
      .optional(),
    currentAcquisitionStart: hrCivilDateSchema.optional(),
    currentAcquisitionHistoryKnown: z.boolean(),
    unjustifiedAbsences: z.number().int().min(0).max(366).optional(),
    fgts: z
      .object({
        terminationBaseCents: moneyCentsSchema.optional(),
        confirmedIncludesPending: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const writeSettlementParametersSchema = z
  .object({
    ...versioned,
    parameters: settlementRequestSchema,
  })
  .strict();
export const settlementParametersSchema = z
  .object({
    organizationId: z.uuid(),
    employeeId: z.uuid(),
    referenceDate: hrCivilDateSchema,
    parameters: settlementRequestSchema,
    version: count,
    source,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export const settlementResultSchema = z
  .object({
    policyVersion: z.string(),
    scenario: z.string(),
    referenceDate: hrCivilDateSchema,
    status: z.enum(['complete', 'partial']),
    noticeDays: count,
    projectedTerminationDate: hrCivilDateSchema,
    items: z.array(
      z
        .object({
          code: z.string(),
          label: z.string(),
          amountCents: z.string().nullable(),
          reference: z.string().optional(),
          units: z.number().optional(),
        })
        .passthrough(),
    ),
    subtotalCents: z.string(),
    grossTotalCents: z.string().nullable(),
    fgtsPenaltyCents: z.string().nullable(),
    missingInputs: z.array(z.string()),
    reasons: z.array(z.string()),
  })
  .strict();
export type HrProfile = z.infer<typeof hrProfileSchema>;
export type UpdateHrProfile = z.infer<typeof updateHrProfileSchema>;
export type WriteEmploymentPeriod = z.infer<typeof writeEmploymentPeriodSchema>;
export type WriteRemuneration = z.infer<typeof writeRemunerationSchema>;
export type WriteVacationPeriod = z.infer<typeof writeVacationPeriodSchema>;
export type PeopleOverview = z.infer<typeof peopleOverviewSchema>;
export type PeopleOverviewQuery = z.infer<typeof peopleOverviewQuerySchema>;
export type PeopleMetric = z.infer<typeof peopleMetricSchema>;
export type PeopleDistribution = z.infer<typeof peopleDistributionSchema>;
export type ClientRegistration = z.infer<typeof clientRegistrationSchema>;
export type SettlementRequest = z.infer<typeof settlementRequestSchema>;
export type SettlementResult = z.infer<typeof settlementResultSchema>;
