import type { RiskWorkspace } from '@renr/contracts';

export const pendingLabels = {
  NO_TECHNICAL_EVALUATION: 'Avaliação técnica pendente',
  CONTEXT_CHANGED: 'Reavaliar contexto',
  NO_ACTIONS: 'Sem ações vinculadas',
  INACTIVE_SCOPE: 'Escopo inativo',
};
export function technicalStateLabel(risk: RiskWorkspace) {
  if (risk.technicalEvaluationState === 'CONTEXT_CHANGED')
    return 'Contexto alterado · reavaliação necessária';
  if (risk.technicalEvaluationState === 'CURRENT' && risk.latestTechnicalEvaluation)
    return risk.latestTechnicalEvaluation.level.label;
  return 'Sem avaliação técnica';
}
