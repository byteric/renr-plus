import { z } from 'zod';
import { actionCivilDateSchema } from './actions';
import { clientClassificationSchema, fiscalStateSchema } from './fiscal-identifier';
import { hrListSchema } from './people-analytics';

const id = z.uuid();
const date = actionCivilDateSchema;
const ordinal = z.number().int().positive();
const version = z.number().int().nonnegative();
const name = z.string().trim().min(2).max(160);
const reason = z.string().trim().min(3).max(1000);
const planKind = z.enum(['PLAN', 'SERVICE']);
const pricingUnit = z.enum(['EMPLOYEE_MONTH', 'TRAINING_CLASS', 'SERVICE']);
const priceMode = z.enum(['FIXED', 'STARTING_AT']);
const features = z.array(z.string().trim().min(1).max(240)).max(30);

export const commercialOfferVersionInputSchema = z.strictObject({
  effectiveOn: date,
  priceCents: z.number().int().min(0).max(2_147_483_647),
  pricingUnit,
  priceMode,
  conditions: z.string().trim().max(4000),
  limits: z.string().trim().max(4000),
  includedFeatures: features,
  plannedFeatures: features,
});

export const commercialCreatePlanSchema = z
  .strictObject({
    name,
    kind: planKind,
    version: commercialOfferVersionInputSchema,
    reason,
  })
  .refine(
    ({ kind, version: offer }) => (kind === 'PLAN') === (offer.pricingUnit === 'EMPLOYEE_MONTH'),
    {
      path: ['version', 'pricingUnit'],
      message: 'A unidade de preço precisa corresponder ao tipo de oferta.',
    },
  );

export const commercialRevisePlanSchema = z.strictObject({
  expectedVersion: ordinal,
  version: commercialOfferVersionInputSchema,
  reason,
});

export const commercialOfferVersionSchema = commercialOfferVersionInputSchema.extend({
  id,
  ordinal,
});
export const commercialPlanSchema = z.strictObject({
  id,
  name,
  kind: planKind,
  version: ordinal,
  versions: z.array(commercialOfferVersionSchema).min(1),
});
export const commercialPlanListSchema = z.strictObject({ items: z.array(commercialPlanSchema) });

const profileFields = {
  contactName: name.nullable(),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable(),
  adoptedOn: date.nullable(),
};

export const commercialUpdateClientSchema = z.strictObject({
  ...profileFields,
  expectedVersion: version,
  reason,
});

export const commercialClientSchema = z.strictObject({
  ...profileFields,
  organizationId: id,
  name,
  isActive: z.boolean(),
  clientClassification: clientClassificationSchema,
  fiscalIdentifier: z.string().nullable(),
  fiscalState: fiscalStateSchema,
  version,
  activePlan: z.strictObject({ id, name, versionId: id, ordinal }).nullable(),
});
export const commercialClientListSchema = hrListSchema(commercialClientSchema);

const contractFields = {
  planVersionId: id,
  startsOn: date,
  endsOn: date,
  terms: z.string().trim().max(8000),
  reason,
};

export const commercialCreateContractSchema = z
  .strictObject(contractFields)
  .refine(({ startsOn, endsOn }) => startsOn <= endsOn, {
    path: ['endsOn'],
    message: 'O fim da vigência deve ser igual ou posterior ao início.',
  });

export const commercialReviseContractSchema = z.discriminatedUnion('kind', [
  commercialCreateContractSchema.safeExtend({
    expectedVersion: ordinal,
    kind: z.enum(['RENEWAL', 'AMENDMENT']),
  }),
  z.strictObject({
    expectedVersion: ordinal,
    kind: z.literal('CANCELLATION'),
    startsOn: date,
    reason,
  }),
  z.strictObject({
    expectedVersion: ordinal,
    kind: z.literal('WITHDRAW_SCHEDULED'),
    revisionId: id,
    reason,
  }),
]);

export const commercialDocumentSchema = z.strictObject({
  id,
  fileName: z.string().min(1).max(200),
  size: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});
const contractRevisionSchema = z.strictObject({
  id,
  ordinal,
  kind: z.enum(['INITIAL', 'RENEWAL', 'AMENDMENT', 'CANCELLATION']),
  startsOn: date,
  endsOn: date,
  terms: contractFields.terms,
  reason,
  createdAt: z.iso.datetime(),
  plan: z.strictObject({ id, name }),
  planVersion: commercialOfferVersionSchema,
  document: commercialDocumentSchema.nullable(),
  documentPending: z.boolean(),
  withdrawal: z.strictObject({ at: z.iso.datetime(), reason }).nullable(),
});

export const commercialContractSchema = z.strictObject({
  id,
  organizationId: id,
  version: ordinal,
  situation: z.enum(['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
  currentRevisionId: id.nullable(),
  revisions: z.array(contractRevisionSchema).min(1),
});
export const commercialContractResponseSchema = z.strictObject({
  contract: commercialContractSchema.nullable(),
});

export type CommercialOfferVersion = z.infer<typeof commercialOfferVersionSchema>;
export type CommercialOfferVersionInput = z.infer<typeof commercialOfferVersionInputSchema>;
export type CommercialPlan = z.infer<typeof commercialPlanSchema>;
export type CommercialCreatePlan = z.infer<typeof commercialCreatePlanSchema>;
export type CommercialRevisePlan = z.infer<typeof commercialRevisePlanSchema>;
export type CommercialClient = z.infer<typeof commercialClientSchema>;
export type CommercialUpdateClient = z.infer<typeof commercialUpdateClientSchema>;
export type CommercialCreateContract = z.infer<typeof commercialCreateContractSchema>;
export type CommercialReviseContract = z.infer<typeof commercialReviseContractSchema>;
export type CommercialDocument = z.infer<typeof commercialDocumentSchema>;
export type CommercialContract = z.infer<typeof commercialContractSchema>;
