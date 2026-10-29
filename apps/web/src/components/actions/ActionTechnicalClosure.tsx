import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTechnicalClosureSchema,
  createCorrectiveActionSchema,
  technicalClosureContextSchema,
  technicalClosureListSchema,
  technicalClosureSchema,
  correctiveActionListSchema,
  correctiveActionCreatedSchema,
  preliminaryEvaluationListSchema,
  type ActionWorkspace,
  type TechnicalClosureContext,
  type TechnicalClosure,
  type CreateTechnicalClosureInput,
  type CreateCorrectiveActionInput,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { riskDate } from '../risks/useRiskData';
import { useActionData } from './useActionData';
import {
  closureValidityLabels,
  closureReviewLabels,
  createDecision,
  decisionScope,
  uncertainDecisionMessage,
} from './technical-continuity';
import './TechnicalContinuity.css';

const blockers = {
  NO_TECHNICAL_CAPABILITY: 'É necessária a capacidade de decisões técnicas.',
  ACTION_NOT_IMPLEMENTED: 'Informe a implementação da ação antes do encerramento.',
  ORIGIN_INACTIVE: 'A origem precisa estar registrada e ativa.',
  NO_CURRENT_EFFECTIVE_OPINION: 'É necessário um parecer eficaz e vigente com provas válidas.',
  NO_CURRENT_REASSESSMENT: 'Reavalie o risco com a avaliação mais recente.',
  MEASURE_NOT_CONSIDERED: 'A reavaliação vigente deve considerar esta ação e o mesmo parecer.',
  ALREADY_CLOSED: 'A ação já possui encerramento técnico vigente.',
};
const fields = [
  { name: 'title', label: 'Título da medida', max: 160, min: 3 },
  { name: 'description', label: 'Descrição da medida', max: 2000, min: 10 },
  { name: 'responsibleName', label: 'Responsável nominal', max: 120, min: 3 },
  { name: 'dueDate', label: 'Prazo', max: 10, min: 10 },
  { name: 'expectedResult', label: 'Resultado esperado', max: 2000, min: 10 },
  { name: 'verificationCriterion', label: 'Critério de aferição', max: 2000, min: 10 },
] as const;
const emptyContent = {
  title: '',
  description: '',
  responsibleName: '',
  dueDate: '',
  expectedResult: '',
  verificationCriterion: '',
};
type Review =
  | { kind: 'closure'; input: CreateTechnicalClosureInput; context: TechnicalClosureContext }
  | { kind: 'corrective'; input: CreateCorrectiveActionInput; context: TechnicalClosureContext };

function ClosureReading({ item }: { item: TechnicalClosure }) {
  return (
    <article
      className="continuity-reading risk-stack"
      aria-label={`Decisão de encerramento ${item.sequence}`}
    >
      <h4>
        Encerramento {item.sequence} · {closureValidityLabels[item.validity]}
      </h4>
      <p>
        {item.author.name} · {riskDate(item.createdAt)}
      </p>
      {!!item.reviewReasons.length && (
        <ul>
          {item.reviewReasons.map((reason) => (
            <li key={reason}>{closureReviewLabels[reason]}</li>
          ))}
        </ul>
      )}
      <p>{item.rationale}</p>
      <dl className="risk-metadata">
        <div>
          <dt>Versões preservadas</dt>
          <dd>
            Ação {item.actionVersion} · risco {item.riskVersion}
          </dd>
        </div>
        <div>
          <dt>Reavaliação considerada</dt>
          <dd>{item.reassessmentId}</dd>
        </div>
        <div>
          <dt>Parecer considerado</dt>
          <dd>{item.opinionId}</dd>
        </div>
        {item.supersedesId && (
          <div>
            <dt>Decisão anterior substituída</dt>
            <dd>{item.supersedesId}</dd>
          </div>
        )}
      </dl>
      <details>
        <summary>Provas preservadas do encerramento</summary>
        {item.proofPackage.files.map((file) => (
          <div key={file.id}>
            <strong>{file.fileName}</strong>
            <p>{file.description}</p>
            <code>SHA-256 {file.sha256}</code>
          </div>
        ))}
        {item.proofPackage.texts.map((text) => (
          <div key={text.id}>
            <strong>{text.reference}</strong>
            <p>{text.description}</p>
            <p>{text.rationale}</p>
            <code>SHA-256 {text.sha256}</code>
          </div>
        ))}
      </details>
    </article>
  );
}

export function ActionTechnicalClosure({
  organizationId,
  action,
  refreshing,
  refreshKey,
  onExpire,
  onUnavailable,
  onContext,
  onChanged,
}: {
  organizationId: string;
  action: ActionWorkspace;
  refreshing: boolean;
  refreshKey: number;
  onExpire: () => void;
  onUnavailable: (status: number) => void;
  onContext: (context: TechnicalClosureContext | null) => void;
  onChanged: () => void;
}) {
  const path = `/organizations/${organizationId}/actions/${action.id}`;
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [correctivePage, setCorrectivePage] = useState(1);
  const [evaluationPage, setEvaluationPage] = useState(1);
  const [mode, setMode] = useState<'closure' | 'corrective' | null>(null);
  const [rationale, setRationale] = useState('');
  const [reason, setReason] = useState('');
  const [content, setContent] = useState(emptyContent);
  const [evaluationId, setEvaluationId] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [consulted, setConsulted] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createdActionId, setCreatedActionId] = useState<string | null>(null);
  const [opened, setOpened] = useState<{
    item: TechnicalClosure;
    context: TechnicalClosureContext;
  } | null>(null);
  const [privateRevoked, setPrivateRevoked] = useState(false);
  const controller = useRef(new AbortController());
  const inspectGeneration = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onContext, onUnavailable, onChanged, onExpire });
  useEffect(() => {
    callbacks.current = { onContext, onUnavailable, onChanged, onExpire };
  });
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (mode) editHeading.current?.focus();
  }, [review, mode]);
  const schemas = useMemo(
    () => ({
      context: decisionScope(technicalClosureContextSchema, organizationId, {
        actionId: action.id,
      }),
      history: decisionScope(technicalClosureListSchema, organizationId, { actionId: action.id }),
      corrective: decisionScope(correctiveActionListSchema, organizationId, {
        riskId: action.riskId,
        previousActionId: action.id,
      }),
      decision: decisionScope(technicalClosureSchema, organizationId, { actionId: action.id }),
    }),
    [organizationId, action.id, action.riskId],
  );
  const generation = attempt + refreshKey;
  const context = useActionData(
    `${path}/closure-context`,
    schemas.context,
    organizationId,
    onExpire,
    generation,
  );
  const history = useActionData(
    `${path}/technical-closures?page=${page}&pageSize=20`,
    schemas.history,
    organizationId,
    onExpire,
    generation,
  );
  const correctives = useActionData(
    `${path}/corrective-actions?page=${correctivePage}&pageSize=20`,
    schemas.corrective,
    organizationId,
    onExpire,
    generation,
  );
  const evaluations = useActionData(
    mode === 'corrective'
      ? `/organizations/${organizationId}/risks/${action.riskId}/evaluations?page=${evaluationPage}&pageSize=50`
      : null,
    preliminaryEvaluationListSchema,
    organizationId,
    onExpire,
    generation,
  );
  const deniedStatus = [context, history, correctives, evaluations]
    .map((item) => item.errorStatus)
    .find((status) => status && [401, 403, 404].includes(status));
  useEffect(() => {
    if (deniedStatus || privateRevoked) {
      controller.current.abort();
      callbacks.current.onContext(null);
      if (deniedStatus) callbacks.current.onUnavailable(deniedStatus);
    } else callbacks.current.onContext(context.data);
  }, [deniedStatus, privateRevoked, context.data]);
  const current = context.data;
  const disabled =
    refreshing ||
    pending ||
    context.loading ||
    history.loading ||
    correctives.loading ||
    !!context.error ||
    !!history.error ||
    !!correctives.error ||
    !!deniedStatus ||
    privateRevoked;
  // A review is tied to a successful consultation, never silently rebased after refresh.
  const activeReview = review?.context === current ? review : null;
  if (current && !current.permissions.hasTechnicalCapability && mode) {
    setMode(null);
    setReview(null);
    setRationale('');
    setReason('');
    setContent(emptyContent);
    setEvaluationId('');
  }
  function fail(failure: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    setReview(null);
    if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
      controller.current.abort();
      setPrivateRevoked(true);
      setMode(null);
      setOpened(null);
      setRationale('');
      setReason('');
      setContent(emptyContent);
      setEvaluationId('');
      setSuccess('');
      setCreatedActionId(null);
      callbacks.current.onContext(null);
      callbacks.current.onUnavailable(failure.status);
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
  function prepare() {
    if (!current || disabled || blocked || !mode) return;
    const common = {
      expectedVersion: current.efficacy.actionVersion,
      opinionId: current.efficacy.latest?.id,
      expectedContextFingerprint: current.efficacy.contextFingerprint,
    };
    if (mode === 'closure') {
      if (!current.permissions.canClose) return;
      const parsed = createTechnicalClosureSchema.safeParse({
        ...common,
        expectedRiskVersion: current.riskVersion,
        expectedLatestEvaluationId: current.latestEvaluation?.id,
        expectedLatestClosureId: current.latest?.id ?? null,
        reassessmentId: current.latestReassessment?.id,
        rationale,
      });
      if (!parsed.success) {
        setError(
          'Informe uma justificativa de encerramento entre 20 e 4.000 caracteres e consulte as precondições.',
        );
        return;
      }
      setReview({ kind: 'closure', input: parsed.data, context: current });
    } else {
      if (!current.permissions.canCreateCorrective || evaluations.loading || evaluations.error)
        return;
      const parsed = createCorrectiveActionSchema.safeParse({
        ...common,
        reason,
        action: {
          ...content,
          expectedRiskVersion: current.riskVersion,
          ...(evaluationId ? { evaluationId } : {}),
        },
      });
      if (!parsed.success) {
        setError(
          'Confira os dados da nova medida, data válida e motivo entre 20 e 4.000 caracteres.',
        );
        return;
      }
      setReview({ kind: 'corrective', input: parsed.data, context: current });
    }
    setError('');
  }
  async function confirm() {
    if (
      !activeReview ||
      !current ||
      disabled ||
      blocked ||
      !(activeReview.kind === 'closure'
        ? current.permissions.canClose
        : current.permissions.canCreateCorrective)
    )
      return;
    const signal = controller.current.signal;
    setPending(true);
    setError('');
    setSuccess('');
    setCreatedActionId(null);
    try {
      let newActionId: string | null = null;
      if (activeReview.kind === 'closure') {
        const saved = await createDecision(
          `${path}/technical-closures`,
          activeReview.input,
          schemas.decision,
          signal,
        );
        if (
          saved.riskId !== action.riskId ||
          saved.reassessmentId !== activeReview.input.reassessmentId ||
          saved.opinionId !== activeReview.input.opinionId
        )
          throw new RequestError(502);
      } else {
        const saved = await createDecision(
          `${path}/corrective-actions`,
          activeReview.input,
          correctiveActionCreatedSchema,
          signal,
        );
        if (
          saved.link.organizationId !== organizationId ||
          saved.link.previousActionId !== action.id ||
          saved.link.riskId !== action.riskId ||
          saved.action.id !== saved.link.newActionId ||
          saved.action.organizationId !== organizationId ||
          saved.action.riskId !== action.riskId ||
          saved.link.opinionId !== activeReview.input.opinionId
        )
          throw new RequestError(502);
        newActionId = saved.action.id;
      }
      // A validated publication remains successful even if a background query replaced its context.
      if (signal.aborted) return;
      setCreatedActionId(newActionId);
      setSuccess(
        activeReview.kind === 'closure'
          ? 'Encerramento técnico registrado e confirmado pelo serviço.'
          : 'Nova ação corretiva criada e vinculada. Consulte o vínculo no histórico abaixo.',
      );
      setMode(null);
      setReview(null);
      setRationale('');
      setReason('');
      setContent(emptyContent);
      setEvaluationId('');
      setOpened(null);
      setPage(1);
      setCorrectivePage(1);
      setAttempt((value) => value + 1);
      callbacks.current.onChanged();
    } catch (failure) {
      fail(failure, signal);
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  async function inspect(closureId: string) {
    if (!current || disabled) return;
    const turn = ++inspectGeneration.current;
    const signal = controller.current.signal;
    setOpened(null);
    try {
      const saved = await request(`${path}/technical-closures/${closureId}`, schemas.decision, {
        signal,
      });
      if (saved.id !== closureId) throw new RequestError(502);
      if (!signal.aborted && turn === inspectGeneration.current)
        setOpened({ item: saved, context: current });
    } catch (failure) {
      fail(failure, signal);
    }
  }
  if (deniedStatus || privateRevoked) return null;
  return (
    <section
      className="surface risk-stack technical-continuity"
      aria-label="Encerramento técnico e continuidade"
    >
      <header>
        <p className="panel-label">DECISÃO TÉCNICA</p>
        <h3>Encerramento técnico e continuidade</h3>
      </header>
      <p>Revise o parecer, a reavaliação e as provas antes de encerrar tecnicamente a medida.</p>
      {context.loading && <p role="status">Consultando requisitos de encerramento…</p>}
      {[context.error, history.error, correctives.error].filter(Boolean).map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      {current && (
        <>
          <h4>Requisitos para encerrar</h4>
          {current.blockingReasons.length ? (
            <ul>
              {current.blockingReasons.map((reason) => (
                <li key={reason}>{blockers[reason]}</li>
              ))}
            </ul>
          ) : (
            <p>
              Requisitos atendidos: implementação, origem ativa, parecer eficaz vigente e
              reavaliação com esta medida.
            </p>
          )}
          <p>
            <a href={`#/inventario/${action.riskId}`}>Consultar risco e reavaliações</a>
          </p>
          {current.latest ? (
            <ClosureReading item={current.latest} />
          ) : (
            <p>Sem encerramento técnico registrado.</p>
          )}
          {!current.permissions.canCreateCorrective && (
            <p className="field-hint">
              Criar corretiva exige administração operacional e capacidade de decisões técnicas, com
              ação implementada e parecer vigente.
            </p>
          )}
        </>
      )}
      {success && (
        <p role="status" className="feedback success">
          {success}
          {createdActionId && (
            <>
              {' '}
              <a href={`#/acoes/${createdActionId}`}>Abrir nova ação corretiva</a>
            </>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {(blocked || context.error || history.error || correctives.error) && (
        <Button
          variant="outline"
          disabled={
            pending || refreshing || context.loading || history.loading || correctives.loading
          }
          onClick={() => {
            setReview(null);
            setOpened(null);
            setAttempt((value) => value + 1);
            setConsulted(attempt + 1);
          }}
        >
          Consultar encerramento e vínculos atuais
        </Button>
      )}
      {blocked && consulted === attempt && current && !disabled && (
        <Button
          variant="outline"
          onClick={() => {
            setBlocked(false);
            setReview(null);
            setError('Revise o rascunho preservado antes de confirmar novamente.');
          }}
        >
          Revisar rascunho com contexto consultado
        </Button>
      )}
      {!mode && (
        <div className="record-actions">
          {current?.permissions.canClose && (
            <Button
              disabled={disabled}
              onClick={() => {
                setMode('closure');
                setSuccess('');
              }}
            >
              Preparar encerramento técnico
            </Button>
          )}
          {current?.permissions.canCreateCorrective && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setMode('corrective');
                setSuccess('');
              }}
            >
              Preparar nova ação corretiva
            </Button>
          )}
        </div>
      )}
      {mode && (
        <div className="risk-stack">
          <form
            hidden={!!activeReview}
            className="risk-form risk-stack"
            aria-label={mode === 'closure' ? 'Preparar encerramento' : 'Preparar ação corretiva'}
            onSubmit={(event) => {
              event.preventDefault();
              prepare();
            }}
            noValidate
          >
            <h4 ref={editHeading} tabIndex={-1}>
              {mode === 'closure' ? 'Fundamentar encerramento' : 'Nova ação corretiva'}
            </h4>
            <fieldset
              className="risk-fieldset risk-stack"
              disabled={disabled || blocked || !!activeReview}
            >
              <legend>
                {mode === 'closure' ? 'Justificativa da decisão' : 'Dados da nova medida'}
              </legend>
              {mode === 'closure' ? (
                <div>
                  <label htmlFor="closure-rationale">Justificativa do encerramento</label>
                  <textarea
                    id="closure-rationale"
                    value={rationale}
                    maxLength={4000}
                    onChange={(event) => setRationale(event.target.value)}
                  />
                  <p className="field-hint">20 a 4.000 caracteres.</p>
                </div>
              ) : (
                <>
                  <p>
                    A nova medida será vinculada à ação anterior, que permanece preservada.
                    Responsável nominal não concede acesso.
                  </p>
                  <label htmlFor="corrective-reason">Motivo da ação corretiva</label>
                  <textarea
                    id="corrective-reason"
                    value={reason}
                    maxLength={4000}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <p className="field-hint">20 a 4.000 caracteres.</p>
                  {fields.map((field) => (
                    <div key={field.name}>
                      <label htmlFor={`corrective-${field.name}`}>{field.label}</label>
                      {field.max === 2000 ? (
                        <textarea
                          id={`corrective-${field.name}`}
                          value={content[field.name]}
                          maxLength={field.max}
                          onChange={(event) =>
                            setContent({ ...content, [field.name]: event.target.value })
                          }
                        />
                      ) : (
                        <input
                          id={`corrective-${field.name}`}
                          type={field.name === 'dueDate' ? 'date' : 'text'}
                          value={content[field.name]}
                          maxLength={field.max}
                          onChange={(event) =>
                            setContent({ ...content, [field.name]: event.target.value })
                          }
                        />
                      )}
                      <p className="field-hint">
                        {field.name === 'dueDate'
                          ? 'Data civil válida.'
                          : `${field.min} a ${field.max} caracteres.`}
                      </p>
                    </div>
                  ))}
                  <label htmlFor="corrective-evaluation">
                    Ficha preliminar de referência (opcional)
                  </label>
                  <select
                    id="corrective-evaluation"
                    value={evaluationId}
                    onChange={(event) => setEvaluationId(event.target.value)}
                  >
                    <option value="">Sem ficha vinculada</option>
                    {evaluations.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        Ficha {item.sequence} · {item.methodReference}
                      </option>
                    ))}
                  </select>
                  {evaluations.loading && <p role="status">Consultando fichas preliminares…</p>}
                  {evaluations.error && <p role="alert">{evaluations.error}</p>}
                  {evaluations.data && (
                    <Pagination
                      label="Paginação de fichas da corretiva"
                      page={evaluationPage}
                      pageSize={evaluations.data.pageSize}
                      total={evaluations.data.total}
                      pending={evaluations.loading}
                      onPageChange={setEvaluationPage}
                    />
                  )}
                </>
              )}
            </fieldset>
            {!activeReview && (
              <Button
                type="submit"
                disabled={
                  disabled ||
                  blocked ||
                  (mode === 'closure'
                    ? !current?.permissions.canClose
                    : !current?.permissions.canCreateCorrective ||
                      evaluations.loading ||
                      !!evaluations.error)
                }
              >
                Revisar {mode === 'closure' ? 'encerramento' : 'nova ação corretiva'}
              </Button>
            )}
          </form>
          {activeReview && (
            <section
              className="continuity-review risk-stack"
              aria-label="Revisão da decisão técnica"
            >
              <h4 tabIndex={-1} ref={heading}>
                Revise antes de confirmar
              </h4>
              <p>
                Ação: {action.title} · versão {activeReview.input.expectedVersion}
              </p>
              <p>Parecer vigente: {activeReview.input.opinionId}</p>
              <p>Risco: versão {activeReview.context.riskVersion}</p>
              {activeReview.kind === 'closure' ? (
                <>
                  <p>Reavaliação: {activeReview.input.reassessmentId}</p>
                  <p>{activeReview.input.rationale}</p>
                  <p>
                    A confirmação registra um encerramento técnico com autoria e provas preservadas.
                  </p>
                </>
              ) : (
                <>
                  <p>{activeReview.input.reason}</p>
                  <dl className="risk-metadata">
                    {fields.map((field) => (
                      <div key={field.name}>
                        <dt>{field.label}</dt>
                        <dd>{activeReview.input.action[field.name]}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    A confirmação cria um novo registro e seu vínculo corretivo com a ação anterior.
                  </p>
                </>
              )}
              <div className="record-actions">
                <Button disabled={disabled || blocked} onClick={() => void confirm()}>
                  {pending
                    ? 'Registrando decisão…'
                    : activeReview.kind === 'closure'
                      ? 'Confirmar e registrar encerramento'
                      : 'Confirmar e criar ação corretiva'}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setReview(null)}>
                  Voltar à preparação
                </Button>
              </div>
            </section>
          )}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setMode(null);
              setReview(null);
            }}
          >
            Fechar preparação técnica
          </Button>
        </div>
      )}
      <section className="risk-stack">
        <h4>Histórico de encerramentos</h4>
        {history.loading && <p role="status">Consultando encerramentos…</p>}
        {history.data?.total === 0 && <p>Nenhuma decisão de encerramento registrada.</p>}
        <ol className="risk-timeline">
          {history.data?.items.map((item) => (
            <li key={item.id}>
              <strong>
                Encerramento {item.sequence} · {closureValidityLabels[item.validity]}
              </strong>
              <p>
                {item.author.name} · {riskDate(item.createdAt)}
              </p>
              {item.reviewReasons.map((reason) => (
                <p key={reason}>{closureReviewLabels[reason]}</p>
              ))}
              <Button variant="outline" disabled={disabled} onClick={() => void inspect(item.id)}>
                Consultar encerramento {item.sequence}
              </Button>
            </li>
          ))}
        </ol>
        {history.data && (
          <Pagination
            label="Paginação de encerramentos"
            page={page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            pending={history.loading || pending}
            onPageChange={setPage}
          />
        )}
        {opened?.context === current && <ClosureReading item={opened.item} />}
      </section>
      <section className="risk-stack">
        <h4>Ações corretivas vinculadas</h4>
        {correctives.loading && <p role="status">Consultando vínculos corretivos…</p>}
        {correctives.data?.total === 0 && <p>Nenhuma ação corretiva vinculada.</p>}
        <ol className="risk-timeline">
          {correctives.data?.items.map((link) => (
            <li key={link.id}>
              <a href={`#/acoes/${link.newActionId}`}>Consultar nova ação corretiva</a>
              <p>{link.reason}</p>
              <p>
                {link.author.name} · {riskDate(link.createdAt)}
              </p>
              <p>Parecer: {link.opinionId}</p>
            </li>
          ))}
        </ol>
        {correctives.data && (
          <Pagination
            label="Paginação de vínculos corretivos"
            page={correctivePage}
            pageSize={correctives.data.pageSize}
            total={correctives.data.total}
            pending={correctives.loading || pending}
            onPageChange={setCorrectivePage}
          />
        )}
      </section>
    </section>
  );
}
