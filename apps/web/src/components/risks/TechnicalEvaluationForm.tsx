import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createTechnicalRiskEvaluationSchema,
  evaluationMethodVersionListSchema,
  riskSourceOptionListSchema,
  technicalRiskEvaluationSchema,
  type RiskWorkspace,
  type CreateTechnicalRiskEvaluationInput,
  type EvaluationMethodVersion,
} from '@renr/contracts';
import { RequestError } from '../../lib/api';
import { createDecision } from '../actions/technical-continuity';
import { Button } from '../ui/button';
import { useRiskData } from './useRiskData';

export function TechnicalEvaluationForm({
  risk,
  onExpire,
  onCancel,
  onSaved,
  onPrepare,
  onUnavailable,
  refreshKey = 0,
  disabled = false,
}: {
  risk: RiskWorkspace;
  onExpire: () => void;
  onCancel: () => void;
  onSaved: () => void;
  onPrepare?: (input: CreateTechnicalRiskEvaluationInput, method: EvaluationMethodVersion) => void;
  onUnavailable?: (status: number) => void;
  refreshKey?: number;
  disabled?: boolean;
}) {
  const [methodPage, setMethodPage] = useState(1);
  const [sourcePage, setSourcePage] = useState(1);
  const [methodId, setMethodId] = useState('');
  const [probabilityKey, setProbability] = useState('');
  const [severityKey, setSeverity] = useState('');
  const [rationale, setRationale] = useState('');
  const [context, setContext] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [selectedSources, setSelectedSources] = useState<
    { kind: 'RISK_RECORD' | 'ASSESSMENT_CYCLE' | 'ASSESSMENT_SOURCE'; id: string }[]
  >([]);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const form = useRef<HTMLFormElement>(null);
  const callbacks = useRef({ onUnavailable });
  useEffect(() => {
    callbacks.current = { onUnavailable };
  });
  const root = `/organizations/${risk.organizationId}`;
  const methods = useRiskData(
    `${root}/evaluation-method-versions?status=PUBLISHED&page=${methodPage}&pageSize=50`,
    evaluationMethodVersionListSchema,
    onExpire,
    refreshKey,
  );
  const sources = useRiskData(
    `${root}/risk-workspaces/${risk.id}/source-options?page=${sourcePage}&pageSize=50`,
    riskSourceOptionListSchema,
    onExpire,
    refreshKey,
  );
  const method = methods.data?.items.find((entry) => entry.id === methodId);
  const deniedStatus = [methods, sources]
    .map((item) => item.errorStatus)
    .find((status) => status && [401, 403, 404].includes(status));
  useEffect(() => {
    if (deniedStatus) {
      controller.current.abort();
      callbacks.current.onUnavailable?.(deniedStatus);
    }
  }, [deniedStatus]);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    form.current?.querySelector('select')?.focus();
    return () => current.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked || disabled) return;
    const parsed = createTechnicalRiskEvaluationSchema.safeParse({
      expectedVersion: risk.version,
      methodVersionId: methodId,
      probabilityKey,
      severityKey,
      rationale,
      context,
      sources: [
        ...selectedSources,
        ...(documentReference.trim()
          ? [{ kind: 'DOCUMENT', reference: documentReference.trim() }]
          : []),
      ],
    });
    if (!parsed.success) {
      setError(
        'Preencha método publicado, probabilidade, severidade, justificativa, contexto e fontes válidas.',
      );
      return;
    }
    if (onPrepare && method) {
      onPrepare(parsed.data, method);
      return;
    }
    setPending(true);
    setError('');
    try {
      const saved = await createDecision(
        `${root}/risk-workspaces/${risk.id}/technical-evaluations`,
        parsed.data,
        technicalRiskEvaluationSchema,
        controller.current.signal,
      );
      if (saved.organizationId !== risk.organizationId || saved.riskId !== risk.id)
        throw new RequestError(502);
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
        controller.current.abort();
        callbacks.current.onUnavailable?.(failure.status);
        if (failure.status === 401) onExpire();
      } else if (failure instanceof RequestError && [0, 409, 502].includes(failure.status)) {
        setBlocked(true);
        setError(
          'Não foi possível confirmar esta avaliação ou o contexto mudou. Seu rascunho foi preservado. Consulte o histórico e atualize o registro antes de iniciar outra avaliação; o envio não será repetido automaticamente.',
        );
      } else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível registrar a avaliação.',
        );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  if (deniedStatus) return null;
  return (
    <form
      className="risk-form risk-stack"
      ref={form}
      onSubmit={(event) => void submit(event)}
      aria-label="Nova avaliação técnica"
      noValidate
    >
      <h4>Nova avaliação técnica · contexto v{risk.version}</h4>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {(methods.error || sources.error) && <p role="alert">{methods.error || sources.error}</p>}
      {methods.loading && <p role="status">Carregando métodos publicados…</p>}
      {methods.data?.total === 0 && (
        <p className="feedback">
          Nenhum método publicado disponível. Solicite um método validado ao responsável técnico.
        </p>
      )}
      <div>
        <label htmlFor="technical-method">Método publicado</label>
        <select
          id="technical-method"
          value={methodId}
          disabled={pending || disabled}
          onChange={(event) => {
            setMethodId(event.target.value);
            setProbability('');
            setSeverity('');
          }}
        >
          <option value="">Selecione o método e a versão</option>
          {methods.data?.items.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.method.name} · v{entry.version} · {entry.title}
            </option>
          ))}
        </select>
      </div>
      {methods.data && methods.data.total > 50 && (
        <div className="record-actions">
          <Button
            variant="outline"
            disabled={pending || disabled || methodPage === 1}
            onClick={() => {
              setMethodPage(methodPage - 1);
              setMethodId('');
            }}
          >
            Métodos anteriores
          </Button>
          <Button
            variant="outline"
            disabled={pending || disabled || methodPage * 50 >= methods.data.total}
            onClick={() => {
              setMethodPage(methodPage + 1);
              setMethodId('');
            }}
          >
            Mais métodos
          </Button>
        </div>
      )}
      {method && (
        <p className="muted">
          {method.description} · Aprovação: {method.approvalReference}
        </p>
      )}
      <div>
        <label htmlFor="technical-probability">Probabilidade</label>
        <select
          id="technical-probability"
          value={probabilityKey}
          disabled={!method || pending || disabled}
          onChange={(event) => setProbability(event.target.value)}
        >
          <option value="">Selecione a probabilidade</option>
          {method?.definition.probability.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label} — {entry.description}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="technical-severity">Severidade</label>
        <select
          id="technical-severity"
          value={severityKey}
          disabled={!method || pending || disabled}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="">Selecione a severidade</option>
          {method?.definition.severity.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label} — {entry.description}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="technical-rationale">Justificativa técnica</label>
        <textarea
          id="technical-rationale"
          value={rationale}
          disabled={pending || disabled}
          maxLength={4000}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="technical-context">Contexto da avaliação</label>
        <textarea
          id="technical-context"
          value={context}
          disabled={pending || disabled}
          maxLength={4000}
          onChange={(event) => setContext(event.target.value)}
        />
      </div>
      <fieldset disabled={pending || disabled}>
        <legend>Fontes elegíveis do contexto coletivo</legend>
        {sources.loading && <p role="status">Carregando fontes…</p>}
        {sources.data?.items.map((source) => (
          <label className="risk-source-choice" key={`${source.kind}-${source.id}`}>
            <input
              type="checkbox"
              disabled={!source.eligible}
              checked={selectedSources.some(
                (entry) => entry.id === source.id && entry.kind === source.kind,
              )}
              onChange={(event) =>
                setSelectedSources((current) =>
                  event.target.checked
                    ? [...current, { kind: source.kind, id: source.id }]
                    : current.filter(
                        (entry) => entry.id !== source.id || entry.kind !== source.kind,
                      ),
                )
              }
            />
            {source.label}
            {source.isDemonstration ? ' · Demonstrativa' : ''}
            {!source.eligible
              ? ` · ${source.unavailableReason || 'Indisponível para avaliação'}`
              : ''}
          </label>
        ))}
        {sources.data?.total === 0 && <p>Nenhuma referência coletiva elegível neste contexto.</p>}
        {sources.data && sources.data.total > 50 && (
          <div className="record-actions">
            <Button
              variant="outline"
              disabled={sourcePage === 1}
              onClick={() => setSourcePage(sourcePage - 1)}
            >
              Fontes anteriores
            </Button>
            <Button
              variant="outline"
              disabled={sourcePage * 50 >= sources.data.total}
              onClick={() => setSourcePage(sourcePage + 1)}
            >
              Mais fontes
            </Button>
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor="technical-document">Referência documental (opcional)</label>
        <input
          id="technical-document"
          value={documentReference}
          disabled={pending || disabled}
          maxLength={1000}
          onChange={(event) => setDocumentReference(event.target.value)}
        />
      </div>
      <div className="record-actions">
        <Button
          type="submit"
          disabled={pending || disabled || blocked || !method || !!sources.error}
        >
          {pending
            ? 'Registrando avaliação…'
            : onPrepare
              ? 'Revisar avaliação e medidas'
              : 'Confirmar avaliação técnica'}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar avaliação
        </Button>
      </div>
    </form>
  );
}
