import { efficacyContextSchema } from '@renr/contracts';

/** Synthetic read-only context for existing operational UI tests. */
export function operationalEfficacyContext(action: Record<string, unknown>) {
  const fields = [
    'title',
    'description',
    'responsibleName',
    'dueDate',
    'expectedResult',
    'verificationCriterion',
    'status',
    'implementationNote',
    'implementedAt',
  ];
  return efficacyContextSchema.parse({
    organizationId: action.organizationId,
    actionId: action.id,
    riskId: action.riskId,
    actionVersion: action.version,
    actionRevisionId: action.id,
    actionSnapshot: Object.fromEntries(fields.map((field) => [field, action[field]])),
    riskContextSnapshot: action.contextSnapshot,
    contextFingerprint: 'a'.repeat(64),
    actionFingerprint: 'b'.repeat(64),
    riskContextFingerprint: 'c'.repeat(64),
    referenceDate: action.referenceDate,
    timeZone: action.timeZone,
    state: 'ABSENT',
    latest: null,
    permissions: { hasTechnicalCapability: false, canRecord: false },
    blockingReasons: ['NO_TECHNICAL_CAPABILITY'],
  });
}
