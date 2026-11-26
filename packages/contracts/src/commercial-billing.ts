import { z } from 'zod';
import { actionCivilDateSchema } from './actions';
import { clientClassificationSchema, fiscalStateSchema } from './fiscal-identifier';
import { competenceSchema, hrListSchema, hrPaginationSchema } from './people-analytics';

const id = z.uuid();
const date = actionCivilDateSchema;
const ordinal = z.number().int().positive();
const count = z.number().int().nonnegative();
const safeMoney = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amountCents = z.number().int().min(1).max(2_147_483_647);
const name = z.string().trim().min(2).max(160);
const reason = z.string().trim().min(3).max(1000);
const receiptReference = z.string().trim().min(1).max(240).nullable();
const pricingUnit = z.enum(['EMPLOYEE_MONTH', 'TRAINING_CLASS', 'SERVICE']);
const priceMode = z.enum(['FIXED', 'STARTING_AT']);

export const commercialBillingStatusSchema = z.enum(['OPEN', 'OVERDUE', 'PAID']);
export const commercialBillingRevisionKindSchema = z.enum([
  'CREATED',
  'PAYMENT_CONFIRMED',
  'CORRECTION',
]);

export const commercialBillingPlanVersionSchema = z.strictObject({
  id,
  ordinal,
  effectiveOn: date,
  priceCents: z.number().int().min(0).max(2_147_483_647),
  pricingUnit,
  priceMode,
});

export const commercialBillingContractRevisionRefSchema = z.strictObject({
  id,
  ordinal,
  kind: z.enum(['INITIAL', 'RENEWAL', 'AMENDMENT']),
  startsOn: date,
  endsOn: date,
  plan: z.strictObject({ id, name }),
  planVersion: commercialBillingPlanVersionSchema,
});

export const commercialBillingContractRefSchema = z.strictObject({
  organizationId: id,
  organizationName: name,
  isActive: z.boolean(),
  clientClassification: clientClassificationSchema,
  fiscalState: fiscalStateSchema,
  contract: z.strictObject({
    id,
    situation: z.enum(['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
    revisions: z.array(commercialBillingContractRevisionRefSchema),
  }),
});

export const commercialBillingContractListSchema = hrListSchema(commercialBillingContractRefSchema);

export const commercialBillingContractsQuerySchema = hrPaginationSchema
  .extend({
    organizationId: id.optional(),
    search: z.string().trim().max(160).optional(),
    classification: clientClassificationSchema.optional(),
  })
  .strict();

export const commercialBillingChargesQuerySchema = hrPaginationSchema
  .extend({
    organizationId: id.optional(),
    contractId: id.optional(),
    competenceFrom: competenceSchema.optional(),
    competenceTo: competenceSchema.optional(),
    status: commercialBillingStatusSchema.optional(),
  })
  .strict()
  .refine(
    ({ competenceFrom, competenceTo }) =>
      !competenceFrom || !competenceTo || competenceFrom <= competenceTo,
    {
      path: ['competenceTo'],
      message: 'A competência final deve ser igual ou posterior à inicial.',
    },
  );

function requirePaidDateForReceipt(
  value: { paidOn: string | null; receiptReference: string | null },
  context: z.RefinementCtx,
) {
  if (value.paidOn === null && value.receiptReference !== null) {
    context.addIssue({
      code: 'custom',
      path: ['receiptReference'],
      message: 'Informe a data de recebimento ao registrar a referência do comprovante.',
    });
  }
}

const chargeMutableFields = {
  contractRevisionId: id,
  competence: competenceSchema,
  amountCents,
  dueOn: date,
  paidOn: date.nullable(),
  receiptReference,
  reason,
  idempotencyKey: id.optional(),
};

export const commercialCreateBillingChargeSchema = z
  .strictObject(chargeMutableFields)
  .superRefine(requirePaidDateForReceipt);

export const commercialConfirmBillingPaymentSchema = z.strictObject({
  expectedVersion: ordinal,
  paidOn: date,
  receiptReference,
  reason,
  idempotencyKey: id.optional(),
});

export const commercialCorrectBillingChargeSchema = z
  .strictObject({
    expectedVersion: ordinal,
    ...chargeMutableFields,
  })
  .superRefine(requirePaidDateForReceipt);

export const commercialBillingSummarySchema = z
  .strictObject({
    timeZone: z.literal('America/Sao_Paulo'),
    referenceDate: date,
    billedCents: safeMoney,
    openCents: safeMoney,
    overdueCents: safeMoney,
    receivedCents: safeMoney,
    counts: z.strictObject({
      total: count,
      open: count,
      overdue: count,
      paid: count,
    }),
  })
  .superRefine((summary, context) => {
    const expectedTotalCount = summary.counts.open + summary.counts.overdue + summary.counts.paid;
    if (summary.counts.total !== expectedTotalCount) {
      context.addIssue({
        code: 'custom',
        path: ['counts', 'total'],
        message: 'A contagem total de cobranças precisa reconciliar com os estados do período.',
      });
    }
    const expectedBilled = summary.openCents + summary.overdueCents + summary.receivedCents;
    if (summary.billedCents !== expectedBilled) {
      context.addIssue({
        code: 'custom',
        path: ['billedCents'],
        message: 'O valor cobrado precisa reconciliar com em aberto, vencido e recebido.',
      });
    }
    const buckets: [string, number, number][] = [
      ['openCents', summary.counts.open, summary.openCents],
      ['overdueCents', summary.counts.overdue, summary.overdueCents],
      ['receivedCents', summary.counts.paid, summary.receivedCents],
    ];
    for (const [field, bucketCount, bucketCents] of buckets) {
      if (
        (bucketCount === 0 && bucketCents !== 0) ||
        (bucketCount > 0 && bucketCents < bucketCount)
      ) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Os valores financeiros devem ser consistentes com a quantidade de cobranças.',
        });
      }
    }
  });

export const commercialBillingChargeRevisionSchema = z.strictObject({
  id,
  ordinal,
  kind: commercialBillingRevisionKindSchema,
  contractRevisionId: id,
  contractRevisionOrdinal: ordinal,
  plan: z.strictObject({ id, name }),
  planVersion: commercialBillingPlanVersionSchema,
  competence: competenceSchema,
  amountCents,
  dueOn: date,
  paidOn: date.nullable(),
  receiptReference,
  reason,
  actor: z.strictObject({
    id,
    name: z.string().trim().min(1).max(120),
  }),
  createdAt: z.iso.datetime(),
});

const billingChargeShape = {
  id,
  organizationId: id,
  organizationName: name,
  contractId: id,
  contractRevisionId: id,
  contractRevisionOrdinal: ordinal,
  plan: z.strictObject({ id, name }),
  planVersion: commercialBillingPlanVersionSchema,
  competence: competenceSchema,
  amountCents,
  dueOn: date,
  paidOn: date.nullable(),
  receiptReference,
  status: commercialBillingStatusSchema,
  version: ordinal,
  revisionCount: ordinal,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const commercialBillingChargeSchema = z.strictObject(billingChargeShape);

export const commercialBillingChargeDetailSchema = z.strictObject({
  ...billingChargeShape,
  revisions: z.array(commercialBillingChargeRevisionSchema).min(1),
});

export const commercialBillingChargeListSchema = z.strictObject({
  summary: commercialBillingSummarySchema,
  items: z.array(commercialBillingChargeSchema),
  total: count,
  page: ordinal,
  pageSize: z.number().int().min(1).max(100),
});

export type CommercialBillingStatus = z.infer<typeof commercialBillingStatusSchema>;
export type CommercialBillingRevisionKind = z.infer<typeof commercialBillingRevisionKindSchema>;
export type CommercialBillingContractRef = z.infer<typeof commercialBillingContractRefSchema>;
export type CommercialBillingContractsQuery = z.infer<typeof commercialBillingContractsQuerySchema>;
export type CommercialBillingChargesQuery = z.infer<typeof commercialBillingChargesQuerySchema>;
export type CommercialCreateBillingCharge = z.infer<typeof commercialCreateBillingChargeSchema>;
export type CommercialConfirmBillingPayment = z.infer<typeof commercialConfirmBillingPaymentSchema>;
export type CommercialCorrectBillingCharge = z.infer<typeof commercialCorrectBillingChargeSchema>;
export type CommercialBillingSummary = z.infer<typeof commercialBillingSummarySchema>;
export type CommercialBillingChargeRevision = z.infer<typeof commercialBillingChargeRevisionSchema>;
export type CommercialBillingCharge = z.infer<typeof commercialBillingChargeSchema>;
export type CommercialBillingChargeDetail = z.infer<typeof commercialBillingChargeDetailSchema>;
export type CommercialBillingChargeList = z.infer<typeof commercialBillingChargeListSchema>;
