import { z } from 'zod';
import { actionCivilDateSchema } from './actions';
import { clientClassificationSchema, fiscalStateSchema } from './fiscal-identifier';
import { hrPaginationSchema } from './people-analytics';

const id = z.uuid();
const date = actionCivilDateSchema;
const ordinal = z.number().int().positive();
const count = z.number().int().nonnegative();
const name = z.string().trim().min(2).max(160);
const actorName = z.string().trim().min(1).max(120);
const reason = z.string().trim().min(3).max(1000);
const nextStep = z.string().trim().min(3).max(500);

export const commercialContractSituationSchema = z.enum([
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
]);
export const commercialContractAccessStatusSchema = z.enum(['UNRECORDED', 'ACTIVE', 'SUSPENDED']);
export const commercialContractAccessRecordedStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export const commercialContractAccessTransitionKindSchema = z.enum([
  'ACTIVATION',
  'SUSPENSION',
  'REACTIVATION',
]);
export const commercialContractAccessOriginSchema = z.enum(['MANUAL_OPERATION']);
export const commercialContractAccessRuleSchema = z.enum([
  'MANUAL_CONTRACT_ACTIVATION',
  'MANUAL_CONTRACT_SUSPENSION',
  'MANUAL_CONTRACT_REACTIVATION',
]);

export type CommercialContractSituation = z.infer<typeof commercialContractSituationSchema>;
export type CommercialContractAccessStatus = z.infer<typeof commercialContractAccessStatusSchema>;
export type CommercialContractAccessRecordedStatus = z.infer<
  typeof commercialContractAccessRecordedStatusSchema
>;
export type CommercialContractAccessTransitionKind = z.infer<
  typeof commercialContractAccessTransitionKindSchema
>;
export type CommercialContractAccessOrigin = z.infer<typeof commercialContractAccessOriginSchema>;
export type CommercialContractAccessRule = z.infer<typeof commercialContractAccessRuleSchema>;

export const contractAccessTransitionRules: Record<
  CommercialContractAccessTransitionKind,
  {
    allowedFrom: readonly CommercialContractAccessStatus[];
    toStatus: CommercialContractAccessRecordedStatus;
    rule: CommercialContractAccessRule;
    requiresNonCancelledContract: boolean;
  }
> = {
  ACTIVATION: {
    allowedFrom: ['UNRECORDED'],
    toStatus: 'ACTIVE',
    rule: 'MANUAL_CONTRACT_ACTIVATION',
    requiresNonCancelledContract: true,
  },
  SUSPENSION: {
    allowedFrom: ['UNRECORDED', 'ACTIVE'],
    toStatus: 'SUSPENDED',
    rule: 'MANUAL_CONTRACT_SUSPENSION',
    requiresNonCancelledContract: false,
  },
  REACTIVATION: {
    allowedFrom: ['SUSPENDED'],
    toStatus: 'ACTIVE',
    rule: 'MANUAL_CONTRACT_REACTIVATION',
    requiresNonCancelledContract: true,
  },
};

export function isContractAccessTransitionAllowed(
  fromStatus: CommercialContractAccessStatus,
  kind: CommercialContractAccessTransitionKind,
  contractSituation: CommercialContractSituation,
): boolean {
  const spec = contractAccessTransitionRules[kind];
  if (!spec.allowedFrom.includes(fromStatus)) return false;
  if (spec.requiresNonCancelledContract && contractSituation === 'CANCELLED') return false;
  return true;
}

export const commercialContractAccessClientsQuerySchema = hrPaginationSchema
  .extend({
    organizationId: id.optional(),
    search: z.string().trim().max(160).optional(),
    status: commercialContractAccessStatusSchema.optional(),
    classification: clientClassificationSchema.optional(),
  })
  .strict();

export const commercialRecordContractAccessTransitionSchema = z.strictObject({
  expectedVersion: count,
  kind: commercialContractAccessTransitionKindSchema,
  effectiveOn: date,
  reason,
  nextStep,
  confirmed: z.literal(true),
  idempotencyKey: id.optional(),
});

export const commercialContractAccessActorSchema = z.strictObject({
  id,
  name: actorName,
});

export const commercialContractAccessTransitionSchema = z
  .strictObject({
    id,
    ordinal,
    kind: commercialContractAccessTransitionKindSchema,
    fromStatus: commercialContractAccessStatusSchema,
    toStatus: commercialContractAccessRecordedStatusSchema,
    rule: commercialContractAccessRuleSchema,
    origin: commercialContractAccessOriginSchema,
    effectiveOn: date,
    reason,
    nextStep,
    actor: commercialContractAccessActorSchema,
    createdAt: z.iso.datetime(),
  })
  .superRefine((item, context) => {
    const spec = contractAccessTransitionRules[item.kind];
    if (!spec.allowedFrom.includes(item.fromStatus)) {
      context.addIssue({
        code: 'custom',
        path: ['fromStatus'],
        message: 'Estado de origem incompatível com o tipo de transição contratual.',
      });
    }
    if (item.toStatus !== spec.toStatus) {
      context.addIssue({
        code: 'custom',
        path: ['toStatus'],
        message: 'Estado de destino incompatível com o tipo de transição contratual.',
      });
    }
    if (item.rule !== spec.rule) {
      context.addIssue({
        code: 'custom',
        path: ['rule'],
        message: 'Regra de transição incompatível com o tipo de transição contratual.',
      });
    }
  });

export const commercialContractAccessStateSchema = z
  .strictObject({
    status: commercialContractAccessStatusSchema,
    version: count,
    lastTransitionKind: commercialContractAccessTransitionKindSchema.nullable(),
    lastRule: commercialContractAccessRuleSchema.nullable(),
    lastOrigin: commercialContractAccessOriginSchema.nullable(),
    lastEffectiveOn: date.nullable(),
    lastReason: reason.nullable(),
    lastNextStep: nextStep.nullable(),
    lastActor: commercialContractAccessActorSchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .superRefine((state, context) => {
    const unrecorded = state.status === 'UNRECORDED';
    if (unrecorded) {
      if (
        state.version !== 0 ||
        state.lastTransitionKind !== null ||
        state.lastRule !== null ||
        state.lastOrigin !== null ||
        state.lastEffectiveOn !== null ||
        state.lastReason !== null ||
        state.lastNextStep !== null ||
        state.lastActor !== null ||
        state.updatedAt !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['version'],
          message: 'Contrato sem decisão manual registrada não deve possuir transição anterior.',
        });
      }
      return;
    }
    if (
      state.version < 1 ||
      state.lastTransitionKind === null ||
      state.lastRule === null ||
      state.lastOrigin === null ||
      state.lastEffectiveOn === null ||
      state.lastReason === null ||
      state.lastNextStep === null ||
      state.lastActor === null ||
      state.updatedAt === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'Situação contratual registrada exige versão e metadados da última transição.',
      });
      return;
    }
    const spec = contractAccessTransitionRules[state.lastTransitionKind];
    if (spec.toStatus !== state.status || spec.rule !== state.lastRule) {
      context.addIssue({
        code: 'custom',
        path: ['lastTransitionKind'],
        message: 'A última transição registrada deve corresponder à situação atual de acesso.',
      });
    }
  });

export const commercialContractAccessClientSchema = z.strictObject({
  organizationId: id,
  organizationName: name,
  isActive: z.boolean(),
  clientClassification: clientClassificationSchema,
  fiscalState: fiscalStateSchema,
  contract: z.strictObject({
    id,
    situation: commercialContractSituationSchema,
  }),
  access: commercialContractAccessStateSchema,
});

export const commercialContractAccessDetailSchema = commercialContractAccessClientSchema
  .extend({
    transitions: z.array(commercialContractAccessTransitionSchema),
  })
  .strict()
  .superRefine((detail, context) => {
    if (detail.transitions.length !== detail.access.version) {
      context.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: 'O histórico de transições deve corresponder exatamente à versão atual.',
      });
      return;
    }
    for (let index = 0; index < detail.transitions.length; index += 1) {
      const expectedOrdinal = index + 1;
      if (detail.transitions[index]?.ordinal !== expectedOrdinal) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'ordinal'],
          message: 'A sequência do histórico de transições deve ser contínua a partir de 1.',
        });
        return;
      }
    }
    const last = detail.transitions[detail.transitions.length - 1];
    if (last && last.toStatus !== detail.access.status) {
      context.addIssue({
        code: 'custom',
        path: ['access', 'status'],
        message: 'A situação atual deve corresponder ao resultado da última transição.',
      });
    }
  });

export const commercialContractAccessSummarySchema = z
  .strictObject({
    timeZone: z.literal('America/Sao_Paulo'),
    referenceDate: date,
    counts: z.strictObject({
      total: count,
      unrecorded: count,
      active: count,
      suspended: count,
    }),
  })
  .superRefine((summary, context) => {
    const sum = summary.counts.unrecorded + summary.counts.active + summary.counts.suspended;
    if (summary.counts.total !== sum) {
      context.addIssue({
        code: 'custom',
        path: ['counts', 'total'],
        message: 'O total de contratos precisa reconciliar com as situações de acesso.',
      });
    }
  });

export const commercialContractAccessClientListSchema = z.strictObject({
  summary: commercialContractAccessSummarySchema,
  items: z.array(commercialContractAccessClientSchema),
  total: count,
  page: ordinal,
  pageSize: z.number().int().min(1).max(100),
});

export type CommercialContractAccessClientsQuery = z.infer<
  typeof commercialContractAccessClientsQuerySchema
>;
export type CommercialRecordContractAccessTransition = z.infer<
  typeof commercialRecordContractAccessTransitionSchema
>;
export type CommercialContractAccessTransition = z.infer<
  typeof commercialContractAccessTransitionSchema
>;
export type CommercialContractAccessState = z.infer<typeof commercialContractAccessStateSchema>;
export type CommercialContractAccessClient = z.infer<typeof commercialContractAccessClientSchema>;
export type CommercialContractAccessDetail = z.infer<typeof commercialContractAccessDetailSchema>;
export type CommercialContractAccessSummary = z.infer<typeof commercialContractAccessSummarySchema>;
export type CommercialContractAccessClientList = z.infer<
  typeof commercialContractAccessClientListSchema
>;
