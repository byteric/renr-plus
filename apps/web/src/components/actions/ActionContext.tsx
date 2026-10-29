import type { ActionWorkspace, EfficacyContext, TechnicalClosureContext } from '@renr/contracts';
import { closureValidityLabels } from './technical-continuity';

const pendingLabels = {
  ASSIGNEE_INACTIVE: 'Membro atribuído inativo',
  OVERDUE: 'Prazo ultrapassado',
  NO_EVIDENCE: 'Sem evidência anexada',
  ORIGIN_INACTIVE: 'Origem inativa ou arquivada',
  ORIGIN_CONTEXT_CHANGED: 'Contexto da origem alterado',
  NO_CURRENT_TECHNICAL_EVALUATION: 'Sem avaliação técnica vigente',
};

export function ActionPending({ reasons }: { reasons: ActionWorkspace['pendingReasons'] }) {
  return reasons.length ? (
    <ul className="action-pending">
      {reasons.map((reason) => (
        <li key={reason}>{pendingLabels[reason]}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">Sem pendências sinalizadas.</p>
  );
}

export function ActionPriority({ context }: { context: ActionWorkspace['riskContext'] }) {
  const priority =
    context.contextMatches && context.technicalEvaluationState === 'CURRENT'
      ? context.priority
      : null;
  return priority ? (
    <p className="action-priority">
      <strong>{priority.label}</strong>
      <span>
        {priority.methodName} · versão {priority.methodVersion}
      </span>
    </p>
  ) : (
    <p className="muted">Prioridade técnica indisponível neste contexto.</p>
  );
}

export function ActionContext({
  item,
  efficacy,
  closure,
}: {
  item: ActionWorkspace;
  efficacy?: EfficacyContext | null;
  closure?: TechnicalClosureContext | null;
}) {
  return (
    <aside className="action-context risk-stack" aria-label="Contexto da ação">
      <section className="surface risk-stack">
        <h3>Contexto atual</h3>
        <a href={`#/inventario/${item.riskId}`}>{item.risk.factor}</a>
        <p>
          {item.riskContext.unit.name} / {item.riskContext.sector.name}
        </p>
        <h4>Prioridade do risco</h4>
        <ActionPriority context={item.riskContext} />
        <p className="field-hint">
          Prioridade contextual da avaliação técnica; métodos distintos não são comparados.
        </p>
        <h4>Pendências</h4>
        <ActionPending reasons={item.pendingReasons} />
        <p>
          {item.evidenceSummary.active} evidências ativas · {item.evidenceSummary.archived}{' '}
          arquivadas
        </p>
      </section>
      <section className="surface risk-stack">
        <h3>Verificação técnica</h3>
        <dl className="action-technical-states">
          <div>
            <dt>Execução</dt>
            <dd>
              {item.status === 'IMPLEMENTED'
                ? 'Informada pela equipe'
                : 'Acompanhamento operacional'}
            </dd>
          </div>
          <div>
            <dt>Eficácia</dt>
            <dd>
              {!efficacy
                ? 'Consultando parecer técnico'
                : !efficacy.latest
                  ? 'Sem parecer técnico'
                  : `${efficacy.latest.result === 'EFFECTIVE' ? 'Eficaz' : efficacy.latest.result === 'NOT_EFFECTIVE' ? 'Não eficaz' : 'Inconclusivo'} · ${efficacy.state === 'REVIEW_REQUIRED' ? 'Revisão necessária' : 'Vigente'}`}
            </dd>
          </div>
          <div>
            <dt>Encerramento</dt>
            <dd>
              {!closure
                ? 'Consultando encerramento técnico'
                : closure.latest
                  ? closureValidityLabels[closure.latest.validity]
                  : 'Sem encerramento técnico registrado'}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
