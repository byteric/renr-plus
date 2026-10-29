import { useEffect, useMemo, useRef, useState } from 'react';
import {
  reassessmentContextSchema,
  riskReassessmentListSchema,
  riskReassessmentSchema,
  actionListSchema,
  efficacyContextSchema,
  createRiskReassessmentSchema,
  type RiskWorkspace,
  type RiskReassessment as Reassessment,
  type CreateRiskReassessmentInput,
  type CreateTechnicalRiskEvaluationInput,
  type TechnicalRiskEvaluation,
  type EfficacyContext,
  type ReassessmentContext,
  type EvaluationMethodVersion,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { riskDate, useRiskData } from './useRiskData';
import { TechnicalEvaluationForm } from './TechnicalEvaluationForm';
import {
  createDecision,
  decisionScope,
  uncertainDecisionMessage,
} from '../actions/technical-continuity';
import '../actions/TechnicalContinuity.css';

const comparisonLabels = {
  COMPARABLE: 'Comparável: mesma versão de método',
  METHOD_VERSION_CHANGED: 'Método ou versão alterados: classificações não comparáveis',
  NO_BASELINE: 'Sem avaliação anterior para comparação',
};
const resultLabels = {
  EFFECTIVE: 'Eficaz',
  NOT_EFFECTIVE: 'Não eficaz',
  INCONCLUSIVE: 'Inconclusivo',
};
const blockerLabels = {
  NO_TECHNICAL_CAPABILITY: 'A preparação exige capacidade de decisões técnicas.',
  NO_BASELINE: 'Registre uma avaliação técnica inicial antes de reavaliar.',
  ORIGIN_INACTIVE: 'A origem precisa estar registrada e ativa para reavaliar.',
};
function Evaluation({ evaluation, label }: { evaluation: TechnicalRiskEvaluation; label: string }) {
  return (
    <section className="continuity-reading risk-stack">
      <h5>
        {label} · avaliação {evaluation.sequence}
      </h5>
      <p>
        {evaluation.method.name} · v{evaluation.method.version}
      </p>
      <p>Aprovação: {evaluation.method.approvalReference}</p>
      <dl className="risk-metadata">
        <div>
          <dt>Probabilidade</dt>
          <dd>{evaluation.probability.label}</dd>
        </div>
        <div>
          <dt>Severidade</dt>
          <dd>{evaluation.severity.label}</dd>
        </div>
        <div>
          <dt>Classificação</dt>
          <dd>{evaluation.level.label}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>{evaluation.priority.label}</dd>
        </div>
      </dl>
      <p>{evaluation.rationale}</p>
      <p>{evaluation.context}</p>
      <p>
        {evaluation.author.name} · {riskDate(evaluation.createdAt)}
      </p>
      <details>
        <summary>Fontes e contexto desta avaliação</summary>
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
          ].map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value || 'Não informado'}</dd>
            </div>
          ))}
        </dl>
        <ul>
          {evaluation.sources.map((source, index) => (
            <li key={index}>
              <strong>{source.title}</strong> · {source.reference}
              {source.isDemonstration ? ' · Fonte demonstrativa' : ''} ·{' '}
              {riskDate(source.capturedAt)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
function ReassessmentReading({ item }: { item: Reassessment }) {
  return (
    <article
      className="risk-stack technical-continuity"
      aria-label={`Reavaliação consultada ${item.evaluation.sequence}`}
    >
      <h4>Reavaliação · avaliação {item.evaluation.sequence}</h4>
      <p>
        <strong>{comparisonLabels[item.comparison]}</strong>
      </p>
      <div className="continuity-comparison">
        <Evaluation evaluation={item.previousEvaluation} label="Anterior" />
        <Evaluation evaluation={item.evaluation} label="Atual" />
      </div>
      <h5>Medidas consideradas</h5>
      <ul className="risk-stack">
        {item.measures.map((measure) => (
          <li className="continuity-measure" key={measure.id}>
            <a href={`#/acoes/${measure.actionId}`}>{measure.opinion.actionSnapshot.title}</a>
            <p>
              Ação v{measure.actionVersion} · parecer {measure.opinion.sequence} ·{' '}
              {resultLabels[measure.opinion.result]}
            </p>
            <p>{measure.consideration}</p>
            <p>{measure.opinion.observation}</p>
            <p>{measure.opinion.rationale}</p>
            <p>
              {measure.opinion.author.name} · {riskDate(measure.opinion.createdAt)}
            </p>
            <details>
              <summary>Provas do parecer considerado</summary>
              {measure.opinion.proofPackage.files.map((file) => (
                <p key={file.id}>
                  {file.fileName} · {file.description} · SHA-256 {file.sha256}
                </p>
              ))}
              {measure.opinion.proofPackage.texts.map((text) => (
                <div key={text.id}>
                  <p>
                    {text.reference} · {text.description}
                  </p>
                  <p>{text.rationale}</p>
                  <code>SHA-256 {text.sha256}</code>
                </div>
              ))}
            </details>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ClassificationPreview({
  input,
  method,
}: {
  input: CreateTechnicalRiskEvaluationInput;
  method: EvaluationMethodVersion;
}) {
  const cell = method.definition.matrix.find(
    (item) =>
      item.probabilityKey === input.probabilityKey && item.severityKey === input.severityKey,
  );
  return cell ? (
    <p>
      Classificação prevista no método:{' '}
      {method.definition.levels.find((item) => item.key === cell.levelKey)?.label} · prioridade:{' '}
      {method.definition.priorities.find((item) => item.key === cell.priorityKey)?.label}
    </p>
  ) : (
    <p role="alert">A combinação informada não possui classificação neste método publicado.</p>
  );
}
type Selection = Record<string, { title: string; consideration: string }>;
type Review = {
  input: CreateRiskReassessmentInput;
  context: ReassessmentContext;
  method: EvaluationMethodVersion;
  opinions: Record<string, EfficacyContext>;
};

export function RiskReassessment({
  risk,
  onExpire,
  onSaved,
  onUnavailable,
  refreshKey = 0,
  disabled: externallyDisabled = false,
}: {
  risk: RiskWorkspace;
  onExpire: () => void;
  onSaved: () => void;
  onUnavailable?: (status: number) => void;
  refreshKey?: number;
  disabled?: boolean;
}) {
  const root = `/organizations/${risk.organizationId}`;
  const path = `${root}/risk-workspaces/${risk.id}`;
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [actionPage, setActionPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Selection>({});
  const [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [consulted, setConsulted] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [opened, setOpened] = useState<{ item: Reassessment; context: ReassessmentContext } | null>(
    null,
  );
  const [revoked, setRevoked] = useState(false);
  const [opinionState, setOpinionState] = useState<{
    key: string;
    data: Record<string, EfficacyContext>;
    loading: boolean;
    error: string;
  }>({ key: '', data: {}, loading: false, error: '' });
  const controller = useRef(new AbortController());
  const inspection = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onExpire, onSaved, onUnavailable });
  useEffect(() => {
    callbacks.current = { onExpire, onSaved, onUnavailable };
  });
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    if (review) heading.current?.focus();
  }, [review]);
  const schemas = useMemo(
    () => ({
      context: decisionScope(reassessmentContextSchema, risk.organizationId, { riskId: risk.id }),
      history: decisionScope(riskReassessmentListSchema, risk.organizationId, { riskId: risk.id }),
      detail: decisionScope(riskReassessmentSchema, risk.organizationId, { riskId: risk.id }),
      actions: decisionScope(actionListSchema, risk.organizationId, { riskId: risk.id }),
    }),
    [risk.organizationId, risk.id],
  );
  const generation = refreshKey + attempt;
  const context = useRiskData(
    `${path}/reassessment-context`,
    schemas.context,
    onExpire,
    generation,
  );
  const history = useRiskData(
    `${path}/reassessments?page=${page}&pageSize=20`,
    schemas.history,
    onExpire,
    generation,
  );
  const actions = useRiskData(
    editing
      ? `${root}/actions?riskId=${risk.id}&status=IMPLEMENTED&page=${actionPage}&pageSize=20`
      : null,
    schemas.actions,
    onExpire,
    generation,
  );
  const current = context.data;
  const deniedStatus = [context, history, actions]
    .map((item) => item.errorStatus)
    .find((status) => status && [401, 403, 404].includes(status));
  const selectedIds = Object.keys(selected).sort().join(',');
  const candidateIds =
    actions.data?.items
      .map((item) => item.id)
      .sort()
      .join(',') ?? '';
  const opinionKey = `${generation}:${candidateIds}:${selectedIds}`;
  useEffect(() => {
    if (!editing || !actions.data || deniedStatus || revoked) return;
    let active = true;
    const signal = controller.current.signal;
    const ids = [
      ...new Set([...candidateIds.split(','), ...selectedIds.split(',')].filter(Boolean)),
    ];
    void Promise.all(
      ids.map(async (actionId) => {
        const value = await request(
          `${root}/actions/${actionId}/efficacy`,
          decisionScope(efficacyContextSchema, risk.organizationId, { actionId }),
          { signal },
        );
        if (value.riskId !== risk.id) throw new RequestError(502);
        return [actionId, value] as const;
      }),
    )
      .then((values) => {
        if (active && !signal.aborted)
          setOpinionState({
            key: opinionKey,
            data: Object.fromEntries(values),
            loading: false,
            error: '',
          });
      })
      .catch((failure: unknown) => {
        if (!active || signal.aborted) return;
        if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
          controller.current.abort();
          setRevoked(true);
          setSelected({});
          setReview(null);
          setOpened(null);
          setEditing(false);
          callbacks.current.onUnavailable?.(failure.status);
          if (failure.status === 401) callbacks.current.onExpire();
        } else
          setOpinionState({
            key: opinionKey,
            data: {},
            loading: false,
            error:
              failure instanceof Error
                ? failure.message
                : 'Não foi possível consultar os pareceres.',
          });
      });
    return () => {
      active = false;
    };
  }, [
    editing,
    actions.data,
    deniedStatus,
    revoked,
    candidateIds,
    selectedIds,
    opinionKey,
    root,
    risk.organizationId,
    risk.id,
  ]);
  useEffect(() => {
    if (deniedStatus) {
      controller.current.abort();
      callbacks.current.onUnavailable?.(deniedStatus);
    }
  }, [deniedStatus]);
  const opinionsReady = !editing || (opinionState.key === opinionKey && !opinionState.error);
  const opinions = opinionState.key === opinionKey ? opinionState.data : {};
  const disabled =
    externallyDisabled ||
    pending ||
    context.loading ||
    history.loading ||
    !!context.error ||
    !!history.error ||
    !!deniedStatus ||
    revoked;
  const activeReview =
    review?.context === current && review.opinions === opinionState.data ? review : null;
  if (current && !current.permissions.hasTechnicalCapability && editing) {
    setEditing(false);
    setSelected({});
    setReview(null);
  }
  function fail(failure: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    setReview(null);
    if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
      controller.current.abort();
      setRevoked(true);
      setSelected({});
      setReview(null);
      setOpened(null);
      setEditing(false);
      setSuccess('');
      callbacks.current.onUnavailable?.(failure.status);
      if (failure.status === 401) callbacks.current.onExpire();
    } else if (failure instanceof RequestError && [0, 409, 502].includes(failure.status)) {
      setBlocked(true);
      setConsulted(null);
      setError(uncertainDecisionMessage);
    } else
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível registrar. Rascunho preservado.',
      );
  }
  function prepare(
    evaluation: CreateTechnicalRiskEvaluationInput,
    method: EvaluationMethodVersion,
  ) {
    if (
      !current ||
      disabled ||
      blocked ||
      !current.permissions.canReassess ||
      !opinionsReady ||
      actions.loading ||
      actions.error
    )
      return;
    const measures = Object.entries(selected).map(([actionId, item]) => ({
      actionId,
      expectedVersion: opinions[actionId]?.actionVersion,
      opinionId: opinions[actionId]?.latest?.id,
      expectedContextFingerprint: opinions[actionId]?.contextFingerprint,
      consideration: item.consideration,
    }));
    const eligible = Object.keys(selected).every(
      (actionId) =>
        opinions[actionId]?.state === 'CURRENT' &&
        opinions[actionId]?.latest?.validity === 'CURRENT' &&
        opinions[actionId]?.actionSnapshot.status === 'IMPLEMENTED',
    );
    const parsed = createRiskReassessmentSchema.safeParse({
      evaluation: { ...evaluation, expectedVersion: current.riskVersion },
      expectedPreviousEvaluationId: current.latestEvaluation?.id,
      measures,
    });
    if (!parsed.success || !eligible) {
      setError(
        'Selecione de 1 a 20 medidas implementadas com parecer vigente e descreva a consideração de cada uma (20 a 4.000 caracteres).',
      );
      return;
    }
    setReview({ input: parsed.data, context: current, method, opinions: opinionState.data });
    setError('');
  }
  async function confirm() {
    if (!activeReview || !current?.permissions.canReassess || disabled || blocked) return;
    const signal = controller.current.signal;
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const value = await createDecision(
        `${path}/reassessments`,
        activeReview.input,
        schemas.detail,
        signal,
      );
      if (
        value.previousEvaluation.id !== activeReview.input.expectedPreviousEvaluationId ||
        value.evaluation.method.versionId !== activeReview.input.evaluation.methodVersionId ||
        value.measures.length !== activeReview.input.measures.length ||
        !value.measures.every((item) =>
          activeReview.input.measures.some(
            (input) => input.actionId === item.actionId && input.opinionId === item.opinion.id,
          ),
        )
      )
        throw new RequestError(502);
      // A validated publication remains successful even if a background query replaced its context.
      if (signal.aborted) return;
      setEditing(false);
      setReview(null);
      setSelected({});
      setOpened(null);
      setPage(1);
      setSuccess('Reavaliação registrada e confirmada pelo serviço.');
      setAttempt((value) => value + 1);
      callbacks.current.onSaved();
    } catch (failure) {
      fail(failure, signal);
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  async function inspect(reassessmentId: string) {
    if (!current || disabled) return;
    const turn = ++inspection.current;
    const signal = controller.current.signal;
    setOpened(null);
    try {
      const value = await request(`${path}/reassessments/${reassessmentId}`, schemas.detail, {
        signal,
      });
      if (value.id !== reassessmentId) throw new RequestError(502);
      if (!signal.aborted && turn === inspection.current)
        setOpened({ item: value, context: current });
    } catch (failure) {
      fail(failure, signal);
    }
  }
  if (deniedStatus || revoked) return null;
  return (
    <section className="risk-stack technical-continuity" aria-label="Reavaliação do risco">
      <header>
        <p className="panel-label">CONTINUIDADE DA AVALIAÇÃO</p>
        <h4>Reavaliação do risco</h4>
      </header>
      <p>
        Registre a nova avaliação com as medidas consideradas e preserve a comparação com o contexto
        anterior.
      </p>
      {context.loading && <p role="status">Consultando contexto de reavaliação…</p>}
      {[context.error, history.error].filter(Boolean).map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      {current?.blockingReasons.length ? (
        <ul>
          {current.blockingReasons.map((reason) => (
            <li key={reason}>{blockerLabels[reason]}</li>
          ))}
        </ul>
      ) : null}
      {current?.latestEvaluation && (
        <details>
          <summary>
            Consultar referência atual · avaliação {current.latestEvaluation.sequence}
          </summary>
          <Evaluation evaluation={current.latestEvaluation} label="Referência atual" />
        </details>
      )}
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {(context.error || history.error || actions.error || opinionState.error || blocked) && (
        <Button
          variant="outline"
          disabled={pending || context.loading || history.loading}
          onClick={() => {
            setReview(null);
            setOpened(null);
            setAttempt((value) => value + 1);
            setConsulted(attempt + 1);
          }}
        >
          Consultar reavaliações e contexto atuais
        </Button>
      )}
      {blocked &&
        consulted === attempt &&
        current &&
        !disabled &&
        opinionsReady &&
        !actions.loading &&
        !actions.error && (
          <Button
            variant="outline"
            onClick={() => {
              setBlocked(false);
              setReview(null);
              setError('Revise as medidas e a avaliação preservadas antes de confirmar novamente.');
            }}
          >
            Revisar rascunho com contexto consultado
          </Button>
        )}
      {current?.permissions.canReassess && !editing && (
        <Button
          disabled={disabled}
          onClick={() => {
            setEditing(true);
            setSuccess('');
          }}
        >
          Preparar reavaliação do risco
        </Button>
      )}
      {editing && (
        <div className="risk-stack">
          <div hidden={!!activeReview} className="risk-stack">
            <h5>Medidas implementadas e pareceres vigentes</h5>
            <p>Selecione de 1 a 20 medidas. Seleções são preservadas entre páginas.</p>
            {actions.loading && <p role="status">Consultando medidas implementadas…</p>}
            {actions.error && <p role="alert">{actions.error}</p>}
            {!opinionsReady && (opinionState.key !== opinionKey || !opinionState.error) && (
              <p role="status">Consultando pareceres das medidas…</p>
            )}
            {opinionState.key === opinionKey && opinionState.error && (
              <p role="alert">{opinionState.error}</p>
            )}
            <fieldset
              className="risk-fieldset risk-stack"
              disabled={disabled || blocked || !opinionsReady || actions.loading || !!actions.error}
            >
              <legend>Medidas elegíveis</legend>
              {actions.data?.items.map((item) => {
                const ctx = opinions[item.id];
                const eligible =
                  item.status === 'IMPLEMENTED' &&
                  ctx?.state === 'CURRENT' &&
                  ctx.latest?.validity === 'CURRENT' &&
                  ctx.actionSnapshot.status === 'IMPLEMENTED';
                return (
                  <div className="continuity-measure" key={item.id}>
                    <label className="risk-source-choice">
                      <input
                        type="checkbox"
                        checked={!!selected[item.id]}
                        disabled={
                          !eligible || (!selected[item.id] && Object.keys(selected).length >= 20)
                        }
                        onChange={(event) =>
                          setSelected((value) => {
                            const next = { ...value };
                            if (event.target.checked)
                              next[item.id] = { title: item.title, consideration: '' };
                            else delete next[item.id];
                            return next;
                          })
                        }
                      />
                      {item.title}
                    </label>
                    <p>
                      {ctx?.latest
                        ? `Parecer ${ctx.latest.sequence} · ${resultLabels[ctx.latest.result]} · ${eligible ? 'Vigente' : 'Revisão necessária'}`
                        : 'Sem parecer vigente: medida indisponível.'}
                    </p>
                    {ctx?.latest && (
                      <details>
                        <summary>Consultar parecer de {item.title}</summary>
                        <p>{ctx.latest.observation}</p>
                        <p>{ctx.latest.rationale}</p>
                        <p>
                          {ctx.latest.author.name} · {riskDate(ctx.latest.createdAt)}
                        </p>
                        <p>Critério: {ctx.latest.criterionReference}</p>
                        {ctx.latest.nextSteps && <p>Próximos passos: {ctx.latest.nextSteps}</p>}
                        {ctx.latest.proofPackage.files.map((file) => (
                          <p key={file.id}>
                            Prova: {file.fileName} · {file.description}
                          </p>
                        ))}
                        {ctx.latest.proofPackage.texts.map((text) => (
                          <div key={text.id}>
                            <p>
                              Prova: {text.reference} · {text.description}
                            </p>
                            <p>{text.rationale}</p>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                );
              })}
              {actions.data?.total === 0 && <p>Nenhuma medida implementada encontrada.</p>}
            </fieldset>
            {actions.data && (
              <Pagination
                label="Paginação de medidas implementadas"
                page={actionPage}
                pageSize={actions.data.pageSize}
                total={actions.data.total}
                pending={pending || actions.loading}
                onPageChange={setActionPage}
              />
            )}
            <fieldset className="risk-fieldset risk-stack" disabled={disabled || blocked}>
              <legend>
                Consideração das medidas selecionadas ({Object.keys(selected).length}/20)
              </legend>
              {Object.entries(selected).map(([actionId, item]) => (
                <div key={actionId}>
                  <label htmlFor={`consideration-${actionId}`}>Consideração de {item.title}</label>
                  <textarea
                    id={`consideration-${actionId}`}
                    value={item.consideration}
                    maxLength={4000}
                    onChange={(event) =>
                      setSelected((value) => ({
                        ...value,
                        [actionId]: { ...item, consideration: event.target.value },
                      }))
                    }
                  />
                  <p className="field-hint">20 a 4.000 caracteres.</p>
                  {opinions[actionId] && opinions[actionId].state !== 'CURRENT' && (
                    <p role="alert">
                      O parecer desta medida exige revisão. Remova-a ou atualize o parecer antes de
                      registrar.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSelected((value) => {
                        const next = { ...value };
                        delete next[actionId];
                        return next;
                      })
                    }
                  >
                    Remover medida {item.title}
                  </Button>
                </div>
              ))}
            </fieldset>
          </div>
          <div hidden={!!activeReview}>
            <TechnicalEvaluationForm
              risk={{ ...risk, version: current?.riskVersion ?? risk.version }}
              refreshKey={generation}
              onUnavailable={(status) => {
                controller.current.abort();
                setRevoked(true);
                setEditing(false);
                setReview(null);
                setSelected({});
                setOpened(null);
                callbacks.current.onUnavailable?.(status);
              }}
              onExpire={onExpire}
              onSaved={onSaved}
              onCancel={() => {
                setEditing(false);
                setReview(null);
              }}
              onPrepare={prepare}
              disabled={
                disabled ||
                blocked ||
                !opinionsReady ||
                actions.loading ||
                !!actions.error ||
                !current?.permissions.canReassess
              }
            />
          </div>
          {activeReview && (
            <section className="continuity-review risk-stack" aria-label="Revisão da reavaliação">
              <h5 ref={heading} tabIndex={-1}>
                Revise a reavaliação antes de confirmar
              </h5>
              <p>
                Predecessor: avaliação {activeReview.context.latestEvaluation?.sequence} · contexto
                v{activeReview.input.evaluation.expectedVersion}
              </p>
              <p>
                <strong>
                  {
                    comparisonLabels[
                      activeReview.context.latestEvaluation?.method.versionId ===
                      activeReview.input.evaluation.methodVersionId
                        ? 'COMPARABLE'
                        : 'METHOD_VERSION_CHANGED'
                    ]
                  }
                </strong>
              </p>
              <p>
                {activeReview.method.method.name} · v{activeReview.method.version} ·{' '}
                {activeReview.method.approvalReference}
              </p>
              <p>
                Probabilidade:{' '}
                {
                  activeReview.method.definition.probability.find(
                    (item) => item.key === activeReview.input.evaluation.probabilityKey,
                  )?.label
                }{' '}
                · severidade:{' '}
                {
                  activeReview.method.definition.severity.find(
                    (item) => item.key === activeReview.input.evaluation.severityKey,
                  )?.label
                }
              </p>
              <p>{activeReview.input.evaluation.rationale}</p>
              <ClassificationPreview
                input={activeReview.input.evaluation}
                method={activeReview.method}
              />
              <p>{activeReview.input.evaluation.context}</p>
              <h5>Fontes selecionadas</h5>
              <ul>
                {activeReview.input.evaluation.sources.map((source, index) => (
                  <li key={index}>
                    {source.kind === 'DOCUMENT' ? source.reference : `${source.kind}: ${source.id}`}
                  </li>
                ))}
              </ul>
              <h5>Medidas consideradas</h5>
              <ul>
                {activeReview.input.measures.map((item) => (
                  <li key={item.actionId}>
                    <strong>{selected[item.actionId]?.title}</strong>
                    <p>{item.consideration}</p>
                    <p>
                      Parecer: {item.opinionId} · ação v{item.expectedVersion}
                    </p>
                  </li>
                ))}
              </ul>
              <p>
                A confirmação cria uma nova avaliação e preserva os vínculos com as medidas e
                pareceres considerados.
              </p>
              <div className="record-actions">
                <Button disabled={disabled || blocked} onClick={() => void confirm()}>
                  {pending ? 'Registrando reavaliação…' : 'Confirmar e registrar reavaliação'}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setReview(null)}>
                  Voltar à preparação da reavaliação
                </Button>
              </div>
            </section>
          )}
        </div>
      )}
      <section className="risk-stack">
        <h5>Linha do tempo de reavaliações</h5>
        {history.loading && <p role="status">Consultando reavaliações…</p>}
        {history.data?.total === 0 && <p>Nenhuma reavaliação registrada.</p>}
        <ol className="risk-timeline">
          {history.data?.items.map((item) => (
            <li key={item.id}>
              <strong>
                Avaliação {item.previousEvaluation.sequence} → {item.evaluation.sequence}
              </strong>
              <p>{comparisonLabels[item.comparison]}</p>
              <p>
                {item.measureCount} medidas · {item.author.name} · {riskDate(item.createdAt)}
              </p>
              <Button variant="outline" disabled={disabled} onClick={() => void inspect(item.id)}>
                Consultar reavaliação {item.evaluation.sequence}
              </Button>
            </li>
          ))}
        </ol>
        {history.data && (
          <Pagination
            label="Paginação de reavaliações"
            page={page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            pending={history.loading || pending}
            onPageChange={setPage}
          />
        )}
        {opened?.context === current && <ReassessmentReading item={opened.item} />}
      </section>
    </section>
  );
}
