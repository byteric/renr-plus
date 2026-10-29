import { RequestError, send } from '../../lib/api';

/** Both new decision flows accept only an explicitly created, validated record. */
export async function createDecision<T>(
  path: string,
  body: unknown,
  schema: { parse: (value: unknown) => T },
  signal: AbortSignal,
): Promise<T> {
  const response = await send(path, { method: 'POST', body: JSON.stringify(body), signal });
  if (response.status !== 201) throw new RequestError(502);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new RequestError(502);
  }
}

export function decisionScope<T>(
  schema: { parse: (value: unknown) => T },
  organizationId: string,
  owner: Record<string, string>,
) {
  return {
    parse(value: unknown) {
      const parsed = schema.parse(value);
      const check = (item: unknown) => {
        if (item && typeof item === 'object') {
          if ('organizationId' in item && item.organizationId !== organizationId)
            throw new RequestError(502);
          for (const [key, id] of Object.entries(owner))
            if (key in item && (item as Record<string, unknown>)[key] !== id)
              throw new RequestError(502);
          const record = item as Record<string, unknown>;
          for (const key of [
            'efficacy',
            'latest',
            'latestEvaluation',
            'latestReassessment',
            'evaluation',
            'previousEvaluation',
            'opinion',
          ])
            if (record[key]) check(record[key]);
          if (Array.isArray(record.measures)) record.measures.forEach(check);
        }
      };
      check(parsed);
      if (parsed && typeof parsed === 'object' && 'items' in parsed && Array.isArray(parsed.items))
        parsed.items.forEach(check);
      return parsed;
    },
  };
}

export const closureValidityLabels = {
  CURRENT: 'Encerramento vigente',
  SUPERSEDED: 'Substituído por decisão posterior',
  REVIEW_REQUIRED: 'Encerramento exige revisão',
};

export const closureReviewLabels = {
  ACTION_CONTENT_CHANGED: 'Conteúdo técnico da ação alterado',
  RISK_CONTEXT_CHANGED: 'Contexto do risco alterado',
  ORIGIN_INACTIVE: 'Origem inativa',
  OPINION_SUPERSEDED: 'Parecer substituído',
  SELECTED_EVIDENCE_ARCHIVED: 'Prova selecionada arquivada',
  SELECTED_EVIDENCE_UNAVAILABLE: 'Prova selecionada indisponível',
  SELECTED_EVIDENCE_CHANGED: 'Prova selecionada alterada',
  REASSESSMENT_SUPERSEDED: 'Reavaliação substituída por avaliação posterior',
};

export const uncertainDecisionMessage =
  'Resultado incerto ou contexto alterado. Rascunho preservado. Consulte o contexto e histórico atuais antes de revisar e confirmar outro envio.';
