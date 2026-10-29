import { useEffect, useMemo, useRef, useState } from 'react';
import {
  technicalRiskEvaluationListSchema,
  technicalRiskEvaluationSchema,
  type RiskWorkspace,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { riskDate, useRiskData } from './useRiskData';
import { pendingLabels, technicalStateLabel } from './technical-labels';
import { TechnicalEvaluationForm } from './TechnicalEvaluationForm';
import { RiskReassessment } from './RiskReassessment';
import { decisionScope } from '../actions/technical-continuity';
import type { TechnicalRiskEvaluation } from '@renr/contracts';

export function TechnicalEvaluationPanel({
  risk,
  canEvaluate,
  onExpire,
  onSaved,
  onUnavailable,
  refreshKey = 0,
  disabled = false,
}: {
  risk: RiskWorkspace;
  canEvaluate: boolean;
  onExpire: () => void;
  onSaved: () => void;
  onUnavailable?: (status: number) => void;
  refreshKey?: number;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [success, setSuccess] = useState(false);
  const [opened, setOpened] = useState<TechnicalRiskEvaluation | null>(null);
  const [inspectionError, setInspectionError] = useState('');
  const [revoked, setRevoked] = useState(false);
  const controller = useRef(new AbortController());
  const inspectTurn = useRef(0);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const schemas = useMemo(
    () => ({
      history: decisionScope(technicalRiskEvaluationListSchema, risk.organizationId, {
        riskId: risk.id,
      }),
      detail: decisionScope(technicalRiskEvaluationSchema, risk.organizationId, {
        riskId: risk.id,
      }),
    }),
    [risk.organizationId, risk.id],
  );
  const path = `/organizations/${risk.organizationId}/risk-workspaces/${risk.id}`;
  const history = useRiskData(
    `${path}/technical-evaluations?page=${page}&pageSize=50`,
    schemas.history,
    onExpire,
    attempt + refreshKey,
  );
  const deniedStatus =
    history.errorStatus && [401, 403, 404].includes(history.errorStatus)
      ? history.errorStatus
      : null;
  const callbacks = useRef({ onUnavailable });
  useEffect(() => {
    callbacks.current = { onUnavailable };
  });
  useEffect(() => {
    if (deniedStatus) {
      controller.current.abort();
      callbacks.current.onUnavailable?.(deniedStatus);
    }
  }, [deniedStatus]);
  async function inspect(evaluationId: string) {
    const turn = ++inspectTurn.current;
    const signal = controller.current.signal;
    setOpened(null);
    setInspectionError('');
    try {
      const value = await request(`${path}/technical-evaluations/${evaluationId}`, schemas.detail, {
        signal,
      });
      if (value.id !== evaluationId) throw new RequestError(502);
      if (!signal.aborted && turn === inspectTurn.current) setOpened(value);
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
        controller.current.abort();
        setRevoked(true);
        setOpened(null);
        setEditing(false);
        callbacks.current.onUnavailable?.(failure.status);
        if (failure.status === 401) onExpire();
      } else
        setInspectionError(
          failure instanceof Error ? failure.message : 'Não foi possível consultar esta avaliação.',
        );
    }
  }
  if (deniedStatus || revoked) return null;
  return (
    <section className="surface risk-stack" aria-labelledby="technical-title">
      <div className="risk-section-heading">
        <h3 id="technical-title">Avaliação técnica</h3>
        {canEvaluate &&
          risk.status === 'REGISTERED' &&
          risk.unit.isActive &&
          risk.sector.isActive &&
          !editing && (
            <Button
              disabled={disabled}
              onClick={() => {
                setEditing(true);
                setSuccess(false);
              }}
            >
              Registrar avaliação técnica
            </Button>
          )}
      </div>
      <p className="risk-technical-state">
        <strong>{technicalStateLabel(risk)}</strong>
      </p>
      <p>Fonte: {risk.sourceLabel}</p>
      <p>
        {risk.actionSummary.total} ações · {risk.actionSummary.open} abertas ·{' '}
        {risk.actionSummary.overdue} atrasadas
      </p>
      <p className="muted">
        {risk.pendingReasons.map((reason) => pendingLabels[reason]).join(' · ')}
      </p>
      {risk.latestTechnicalEvaluation && (
        <p>
          {risk.technicalEvaluationState === 'CONTEXT_CHANGED'
            ? 'Última avaliação histórica'
            : 'Avaliação mais recente'}
          : {risk.latestTechnicalEvaluation.level.label} ·{' '}
          {risk.latestTechnicalEvaluation.priority.label} ·{' '}
          {risk.latestTechnicalEvaluation.method.name} v
          {risk.latestTechnicalEvaluation.method.version}
        </p>
      )}
      {success && <p role="status">Avaliação técnica registrada e confirmada pelo serviço.</p>}
      {editing && (
        <TechnicalEvaluationForm
          risk={risk}
          disabled={disabled}
          refreshKey={refreshKey + attempt}
          onUnavailable={(status) => {
            controller.current.abort();
            setRevoked(true);
            onUnavailable?.(status);
          }}
          onExpire={onExpire}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSuccess(true);
            setAttempt((value) => value + 1);
            onSaved();
          }}
        />
      )}
      <RiskReassessment
        key={`${risk.organizationId}-${risk.id}`}
        risk={risk}
        disabled={disabled}
        onExpire={onExpire}
        onSaved={onSaved}
        onUnavailable={onUnavailable}
        refreshKey={refreshKey + attempt}
      />
      {inspectionError && <p role="alert">{inspectionError}</p>}
      {opened && <EvaluationReading evaluation={opened} />}
      <details>
        <summary>Histórico de avaliações técnicas</summary>
        {history.loading && <p role="status">Carregando avaliações técnicas…</p>}
        {history.error && (
          <div role="alert">
            <p>{history.error}</p>
            <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
              Atualizar avaliações técnicas
            </Button>
          </div>
        )}
        {history.data?.total === 0 && (
          <p>
            Nenhuma avaliação técnica registrada. Ausência de avaliação não significa risco baixo.
          </p>
        )}
        <ol className="risk-timeline">
          {history.data?.items.map((evaluation) => (
            <li key={evaluation.id}>
              <h4>
                Avaliação {evaluation.sequence} · {evaluation.method.name} v
                {evaluation.method.version}
              </h4>
              <p>
                {evaluation.level.label} · {evaluation.priority.label}
              </p>
              <p>
                {evaluation.author.name} · {riskDate(evaluation.createdAt)}
              </p>
              <Button variant="outline" onClick={() => void inspect(evaluation.id)}>
                Consultar avaliação {evaluation.sequence}
              </Button>
            </li>
          ))}
        </ol>
        {history.data && history.data.total > 50 && (
          <div className="record-actions">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Avaliações anteriores
            </Button>
            <Button
              variant="outline"
              disabled={page * 50 >= history.data.total}
              onClick={() => setPage(page + 1)}
            >
              Mais avaliações
            </Button>
          </div>
        )}
      </details>
    </section>
  );
}

function EvaluationReading({ evaluation }: { evaluation: TechnicalRiskEvaluation }) {
  return (
    <section
      className="continuity-reading risk-stack technical-continuity"
      aria-label={`Avaliação técnica consultada ${evaluation.sequence}`}
    >
      <h4>Avaliação {evaluation.sequence} · consulta completa</h4>
      <p>
        {evaluation.method.name} · versão {evaluation.method.version} ·{' '}
        {evaluation.method.approvalReference}
      </p>
      <p>
        {evaluation.probability.label} × {evaluation.severity.label} · {evaluation.level.label} ·{' '}
        {evaluation.priority.label}
      </p>
      <p>
        {evaluation.author.name} · {riskDate(evaluation.createdAt)}
      </p>
      <p>{evaluation.rationale}</p>
      <p>{evaluation.context}</p>
      <dl className="risk-metadata">
        {[
          ['Fator', evaluation.contextSnapshot.factor],
          ['Descrição', evaluation.contextSnapshot.description],
          ['Exposição', evaluation.contextSnapshot.exposureDescription],
          ['Grupo exposto', evaluation.contextSnapshot.exposedGroupDescription],
          ['Possíveis agravos', evaluation.contextSnapshot.possibleHarms],
          ['Controles existentes', evaluation.contextSnapshot.existingControls],
          ['Origem', evaluation.contextSnapshot.sourceNote],
          [
            'Unidade / setor',
            `${evaluation.contextSnapshot.unit.name} / ${evaluation.contextSnapshot.sector.name}`,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || 'Não informado'}</dd>
          </div>
        ))}
      </dl>
      <ul>
        {evaluation.sources.map((source, index) => (
          <li key={index}>
            <strong>{source.title}</strong> · {source.reference}
            {source.isDemonstration ? ' · Fonte demonstrativa' : ''} · {riskDate(source.capturedAt)}
          </li>
        ))}
      </ul>
    </section>
  );
}
