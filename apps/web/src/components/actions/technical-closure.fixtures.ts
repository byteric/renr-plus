import { technicalClosureContextSchema } from '@renr/contracts';
import { operationalEfficacyContext } from './ActionEfficacy.fixtures';

/** Synthetic read-only closure context for existing operational tests. */
export function operationalClosureContext(action: Record<string, unknown>) {
  return technicalClosureContextSchema.parse({
    organizationId: action.organizationId,
    actionId: action.id,
    riskId: action.riskId,
    riskVersion: action.sourceRiskVersion,
    efficacy: operationalEfficacyContext(action),
    latestEvaluation: null,
    latestReassessment: null,
    latest: null,
    permissions: { hasTechnicalCapability: false, canClose: false, canCreateCorrective: false },
    blockingReasons: [
      'NO_TECHNICAL_CAPABILITY',
      'NO_CURRENT_EFFECTIVE_OPINION',
      'NO_CURRENT_REASSESSMENT',
    ],
  });
}
