import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createEfficacyOpinionSchema,
  efficacyContextSchema,
  efficacyOpinionSchema,
  efficacyOpinionListSchema,
  evidenceListSchema,
  type ActionWorkspace,
  type CreateEfficacyOpinionInput,
  type EfficacyContext,
  type EfficacyOpinion,
  type EfficacyReviewReason,
  type EfficacyTextInput,
} from '@renr/contracts';
import { request, RequestError, send } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { riskDate } from '../risks/useRiskData';
import { civilDate, useActionData } from './useActionData';
import './ActionEfficacy.css';

const efficacyLabels = {
  EFFECTIVE: 'Eficaz',
  NOT_EFFECTIVE: 'Não eficaz',
  INCONCLUSIVE: 'Inconclusivo',
};
const validityLabels = {
  CURRENT: 'Vigente',
  SUPERSEDED: 'Substituído por parecer posterior',
  REVIEW_REQUIRED: 'Revisão necessária',
};
const reasons: Record<EfficacyReviewReason, string> = {
  ACTION_CONTENT_CHANGED: 'Conteúdo da ação alterado',
  RISK_CONTEXT_CHANGED: 'Contexto do risco alterado',
  ORIGIN_INACTIVE: 'Origem inativa',
  SELECTED_EVIDENCE_ARCHIVED: 'Prova selecionada arquivada',
  SELECTED_EVIDENCE_UNAVAILABLE: 'Prova selecionada indisponível',
  SELECTED_EVIDENCE_CHANGED: 'Prova selecionada alterada',
};
const emptyText = (): EfficacyTextInput => ({ reference: '', description: '', rationale: '' });

function scoped<T>(schema: { parse: (value: unknown) => T }, actionId: string) {
  return {
    parse(value: unknown) {
      const parsed = schema.parse(value);
      const check = (item: unknown) => {
        if (item && typeof item === 'object' && 'actionId' in item && item.actionId !== actionId)
          throw new RequestError(502);
      };
      check(parsed);
      if (parsed && typeof parsed === 'object' && 'items' in parsed && Array.isArray(parsed.items))
        parsed.items.forEach(check);
      return parsed;
    },
  };
}

function Opinion({ opinion }: { opinion: EfficacyOpinion }) {
  return (
    <article className="efficacy-opinion risk-stack">
      <h4>
        Parecer {opinion.sequence} · {efficacyLabels[opinion.result]}
      </h4>
      <p>
        <strong>{validityLabels[opinion.validity]}</strong> · {opinion.author.name} ·{' '}
        {riskDate(opinion.createdAt)}
      </p>
      {opinion.supersedesId && <p>Substitui o parecer {opinion.supersedesId}.</p>}
      {!!opinion.reviewReasons.length && (
        <ul>
          {opinion.reviewReasons.map((reason) => (
            <li key={reason}>{reasons[reason]}</li>
          ))}
        </ul>
      )}
      <dl className="risk-metadata">
        <div>
          <dt>Verificação</dt>
          <dd>{civilDate(opinion.verifiedOn)}</dd>
        </div>
        <div>
          <dt>Revisão operacional</dt>
          <dd>
            Versão {opinion.actionVersion} · {opinion.actionRevisionId}
          </dd>
        </div>
        <div>
          <dt>Critério preservado</dt>
          <dd>{opinion.criterionReference}</dd>
        </div>
        <div>
          <dt>Observação</dt>
          <dd>{opinion.observation}</dd>
        </div>
        <div>
          <dt>Justificativa</dt>
          <dd>{opinion.rationale}</dd>
        </div>
        {opinion.nextSteps && (
          <div>
            <dt>Próximos passos</dt>
            <dd>{opinion.nextSteps}</dd>
          </div>
        )}
      </dl>
      <details>
        <summary>Provas e contexto preservados</summary>
        <div className="risk-stack">
          {opinion.proofPackage.files.map((file) => (
            <div key={file.id}>
              <strong>{file.fileName}</strong>
              <p>{file.description}</p>
              <p>
                {file.mimeType} · {file.size} bytes
              </p>
              <code>SHA-256 {file.sha256}</code>
            </div>
          ))}
          {opinion.proofPackage.texts.map((text) => (
            <div key={text.id}>
              <strong>{text.reference}</strong>
              <p>{text.description}</p>
              <p>{text.rationale}</p>
              <code>SHA-256 {text.sha256}</code>
            </div>
          ))}
          <p>
            Ação: {opinion.actionSnapshot.title} · {opinion.actionSnapshot.description}
          </p>
          <p>Execução: {opinion.actionSnapshot.implementationNote ?? 'Sem relato'}</p>
          <p>
            Risco: {opinion.riskContextSnapshot.factor} · {opinion.riskContextSnapshot.description}
          </p>
          <code>Contexto SHA-256 {opinion.contextFingerprint}</code>
        </div>
      </details>
    </article>
  );
}

export function ActionEfficacy({
  organizationId,
  action,
  refreshing,
  refreshKey,
  onExpire,
  onUnavailable,
  onContext,
}: {
  organizationId: string;
  action: ActionWorkspace;
  refreshing: boolean;
  refreshKey: number;
  onExpire: () => void;
  onUnavailable: (status: number) => void;
  onContext: (context: EfficacyContext | null) => void;
}) {
  const path = `/organizations/${organizationId}/actions/${action.id}`;
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<CreateEfficacyOpinionInput['result']>('INCONCLUSIVE');
  const [verifiedOn, setVerifiedOn] = useState('');
  const [observation, setObservation] = useState('');
  const [rationale, setRationale] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [texts, setTexts] = useState<EfficacyTextInput[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [review, setReview] = useState<CreateEfficacyOpinionInput | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [consulted, setConsulted] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [opened, setOpened] = useState<{
    opinion: EfficacyOpinion;
    context: EfficacyContext;
  } | null>(null);
  const controller = useRef(new AbortController());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);
  const callbacks = useRef({ onUnavailable, onContext });
  useEffect(() => {
    callbacks.current = { onUnavailable, onContext };
  });
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const generation = attempt + refreshKey;
  const schemas = useMemo(
    () => ({
      context: scoped(efficacyContextSchema, action.id),
      history: scoped(efficacyOpinionListSchema, action.id),
      files: scoped(evidenceListSchema, action.id),
    }),
    [action.id],
  );
  const context = useActionData(
    `${path}/efficacy`,
    schemas.context,
    organizationId,
    onExpire,
    generation,
  );
  const history = useActionData(
    `${path}/efficacy-opinions?page=${page}&pageSize=20`,
    schemas.history,
    organizationId,
    onExpire,
    generation,
  );
  const files = useActionData(
    editing ? `${path}/evidence?page=${filePage}&pageSize=50` : null,
    schemas.files,
    organizationId,
    onExpire,
    generation,
  );
  const deniedStatus = [context, history, files]
    .map((item) => item.errorStatus)
    .find((status) => status !== null && [401, 403, 404].includes(status));
  useEffect(() => {
    if (deniedStatus) {
      callbacks.current.onContext(null);
      callbacks.current.onUnavailable(deniedStatus);
    } else callbacks.current.onContext(context.data);
  }, [context.data, deniedStatus]);
  const current = context.data;
  const disabled =
    refreshing ||
    pending ||
    context.loading ||
    !!context.error ||
    history.loading ||
    !!history.error ||
    !!deniedStatus;
  const technical = current?.permissions.hasTechnicalCapability ?? false;
  const canRecord = current?.permissions.canRecord ?? false;
  if (
    current &&
    !current.permissions.hasTechnicalCapability &&
    (editing ||
      review ||
      observation ||
      rationale ||
      nextSteps ||
      texts.length ||
      Object.keys(selected).length ||
      verifiedOn)
  ) {
    setEditing(false);
    setReview(null);
    setObservation('');
    setRationale('');
    setNextSteps('');
    setTexts([]);
    setSelected({});
    setVerifiedOn('');
  }
  function fail(failure: unknown) {
    if (controller.current.signal.aborted) return;
    setReview(null);
    if (failure instanceof RequestError && [401, 403, 404].includes(failure.status)) {
      setEditing(false);
      setObservation('');
      setRationale('');
      setNextSteps('');
      setTexts([]);
      setSelected({});
      setVerifiedOn('');
      setOpened(null);
      callbacks.current.onContext(null);
      callbacks.current.onUnavailable(failure.status);
      if (failure.status === 401) onExpire();
      return;
    }
    if (failure instanceof RequestError && [0, 409, 502].includes(failure.status)) {
      setBlocked(true);
      setConsulted(null);
      setError(
        'Resultado incerto ou contexto alterado. Rascunho preservado. Consulte o contexto e histórico atuais antes de revisar e confirmar outro envio.',
      );
    } else
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível registrar. Rascunho preservado.',
      );
  }
  function prepareReview() {
    if (!current || disabled || blocked || !technical) return;
    const parsed = createEfficacyOpinionSchema.safeParse({
      expectedVersion: current.actionVersion,
      expectedLatestOpinionId: current.latest?.id ?? null,
      expectedContextFingerprint: current.contextFingerprint,
      result,
      verifiedOn,
      observation,
      rationale,
      evidenceIds: Object.keys(selected),
      textualEvidence: texts,
      ...(nextSteps.trim() ? { nextSteps } : {}),
    });
    if (!parsed.success || verifiedOn > current.referenceDate) {
      setError(
        'Confira data não futura, observação e justificativa (20 a 4.000 caracteres), provas e próximos passos (10 a 2.000 caracteres quando não eficaz ou inconclusivo).',
      );
      return;
    }
    setError('');
    setReview(parsed.data);
  }
  async function confirm() {
    if (
      !review ||
      !current ||
      disabled ||
      blocked ||
      !canRecord ||
      review.expectedVersion !== current.actionVersion ||
      review.expectedLatestOpinionId !== (current.latest?.id ?? null) ||
      review.expectedContextFingerprint !== current.contextFingerprint
    ) {
      setReview(null);
      return;
    }
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const response = await send(`${path}/efficacy-opinions`, {
        method: 'POST',
        body: JSON.stringify(review),
        signal: controller.current.signal,
      });
      if (response.status !== 201) throw new RequestError(502);
      let opinion: EfficacyOpinion;
      try {
        opinion = efficacyOpinionSchema.parse(await response.json());
      } catch {
        throw new RequestError(502);
      }
      if (opinion.organizationId !== organizationId || opinion.actionId !== action.id)
        throw new RequestError(502);
      if (controller.current.signal.aborted) return;
      setEditing(false);
      setReview(null);
      setOpened(null);
      setObservation('');
      setRationale('');
      setNextSteps('');
      setTexts([]);
      setSelected({});
      setVerifiedOn('');
      setSuccess(
        'Parecer de eficácia registrado. O acompanhamento continua; este registro não encerra a ação.',
      );
      setPage(1);
      setAttempt((value) => value + 1);
    } catch (failure) {
      fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function inspect(opinionId: string) {
    if (!current) return;
    setOpened(null);
    setError('');
    try {
      const opinion = await request(
        `${path}/efficacy-opinions/${opinionId}`,
        efficacyOpinionSchema,
        { signal: controller.current.signal },
      );
      if (
        opinion.organizationId !== organizationId ||
        opinion.actionId !== action.id ||
        opinion.id !== opinionId
      )
        throw new RequestError(502);
      if (!controller.current.signal.aborted) setOpened({ opinion, context: current });
    } catch (failure) {
      fail(failure);
    }
  }
  if (deniedStatus) return null;
  return (
    <section className="surface risk-stack action-efficacy" aria-label="Análise de eficácia">
      <header>
        <p className="panel-label">VERIFICAÇÃO TÉCNICA</p>
        <h3>Análise de eficácia</h3>
      </header>
      <p>
        Compare o resultado observado com o critério e selecione as provas que sustentam o parecer.
      </p>
      <dl className="risk-metadata">
        <div>
          <dt>Critério de aferição</dt>
          <dd>{action.verificationCriterion}</dd>
        </div>
        <div>
          <dt>Execução informada</dt>
          <dd>{action.implementationNote ?? 'Execução ainda não informada.'}</dd>
        </div>
      </dl>
      {context.loading && <p role="status">Consultando contexto de eficácia…</p>}
      {context.error && <p role="alert">{context.error}</p>}
      {current?.state === 'ABSENT' && <p>Nenhum parecer técnico registrado.</p>}
      {current?.latest && <Opinion opinion={current.latest} />}
      {current && !technical && (
        <p>Consulta disponível. A preparação exige capacidade de decisões técnicas.</p>
      )}
      {technical && !canRecord && (
        <p className="feedback">
          {current?.blockingReasons.includes('ACTION_NOT_IMPLEMENTED')
            ? 'Você pode preparar a análise. Para registrar, informe primeiro a implementação da ação.'
            : 'Você pode preparar a análise. A origem precisa estar ativa para registrar.'}
        </p>
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
      {(context.error || history.error || blocked) && (
        <Button
          variant="outline"
          disabled={pending || refreshing || context.loading || history.loading}
          onClick={() => {
            setReview(null);
            setOpened(null);
            setAttempt((value) => value + 1);
            setConsulted(attempt + 1);
          }}
        >
          Consultar contexto e histórico atuais
        </Button>
      )}
      {blocked && consulted === attempt && current && !disabled && (
        <Button
          variant="outline"
          onClick={() => {
            setBlocked(false);
            setReview(null);
            setError('Revise o rascunho preservado e confirme novamente.');
          }}
        >
          Revisar rascunho com contexto consultado
        </Button>
      )}
      {technical && !editing && (
        <Button
          disabled={disabled}
          onClick={() => {
            setEditing(true);
            setVerifiedOn(current?.referenceDate ?? '');
            setSuccess('');
          }}
        >
          Preparar análise de eficácia
        </Button>
      )}
      {editing && (
        <div className="risk-stack">
          <form
            className="risk-form risk-stack"
            onSubmit={(event) => {
              event.preventDefault();
              prepareReview();
            }}
          >
            <fieldset
              className="risk-fieldset risk-stack"
              disabled={disabled || !!review || blocked}
            >
              <legend>Preparação local do parecer</legend>
              <label htmlFor="efficacy-result">Conclusão</label>
              <select
                id="efficacy-result"
                value={result}
                onChange={(event) => setResult(event.target.value as typeof result)}
              >
                {Object.entries(efficacyLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label htmlFor="efficacy-date">Data da verificação</label>
              <input
                id="efficacy-date"
                type="date"
                max={current?.referenceDate}
                value={verifiedOn}
                onChange={(event) => setVerifiedOn(event.target.value)}
              />
              <label htmlFor="efficacy-observation">Observação técnica</label>
              <textarea
                id="efficacy-observation"
                maxLength={4000}
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
              />
              <p className="field-hint">20 a 4.000 caracteres.</p>
              <label htmlFor="efficacy-rationale">Justificativa do parecer</label>
              <textarea
                id="efficacy-rationale"
                maxLength={4000}
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
              />
              <p className="field-hint">20 a 4.000 caracteres.</p>
              <label htmlFor="efficacy-next">
                Próximos passos{result !== 'EFFECTIVE' && ' (obrigatório)'}
              </label>
              <textarea
                id="efficacy-next"
                maxLength={2000}
                value={nextSteps}
                onChange={(event) => setNextSteps(event.target.value)}
              />
              <p className="field-hint">
                Não eficaz ou inconclusivo exige continuidade do acompanhamento. Eficaz não encerra
                a ação.
              </p>
              <h4>Arquivos de prova</h4>
              {files.loading && <p role="status">Consultando arquivos…</p>}
              {files.error && <p role="alert">{files.error}</p>}
              {files.data?.items
                .filter((file) => !file.archivedAt)
                .map((file) => (
                  <label className="efficacy-file" key={file.id}>
                    <input
                      type="checkbox"
                      checked={file.id in selected}
                      onChange={(event) =>
                        setSelected((value) => {
                          const next = { ...value };
                          if (event.target.checked) next[file.id] = file.fileName;
                          else delete next[file.id];
                          return next;
                        })
                      }
                    />
                    {file.fileName} · {file.description}
                  </label>
                ))}
              {files.data && !files.data.items.some((file) => !file.archivedAt) && (
                <p>Nenhum arquivo ativo nesta página.</p>
              )}
              {files.data && (
                <Pagination
                  label="Paginação de provas"
                  page={filePage}
                  pageSize={files.data.pageSize}
                  total={files.data.total}
                  pending={files.loading}
                  onPageChange={setFilePage}
                />
              )}
              {!!Object.keys(selected).length && (
                <div className="risk-stack">
                  <p>Selecionados: {Object.values(selected).join(', ')}</p>
                  <p className="field-hint">
                    As seleções são preservadas entre páginas. Remova explicitamente qualquer
                    arquivo que não deva integrar o parecer, inclusive se foi arquivado ou ficou
                    indisponível.
                  </p>
                  <ul className="risk-stack">
                    {Object.entries(selected).map(([id, name]) => (
                      <li key={id}>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setSelected((value) => {
                              const next = { ...value };
                              delete next[id];
                              return next;
                            })
                          }
                        >
                          Remover seleção de {name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {texts.map((text, index) => (
                <fieldset className="risk-fieldset risk-stack" key={index}>
                  <legend>Prova textual {index + 1}</legend>
                  {(['reference', 'description', 'rationale'] as const).map((field) => (
                    <div key={field}>
                      <label htmlFor={`proof-${index}-${field}`}>
                        {field === 'reference'
                          ? 'Referência identificada'
                          : field === 'description'
                            ? 'Descrição da prova'
                            : 'Justificativa da prova'}{' '}
                        {index + 1}
                      </label>
                      <textarea
                        id={`proof-${index}-${field}`}
                        maxLength={
                          field === 'reference' ? 200 : field === 'description' ? 4000 : 2000
                        }
                        value={text[field]}
                        onChange={(event) =>
                          setTexts((values) =>
                            values.map((value, position) =>
                              position === index
                                ? { ...value, [field]: event.target.value }
                                : value,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <p className="field-hint">
                    Referência: 5–200; descrição: 20–4.000; justificativa: 10–2.000 caracteres.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setTexts((values) => values.filter((_, position) => position !== index))
                    }
                  >
                    Remover prova textual {index + 1}
                  </Button>
                </fieldset>
              ))}
              <Button
                variant="outline"
                disabled={texts.length >= 10}
                onClick={() => setTexts((values) => [...values, emptyText()])}
              >
                Adicionar prova textual
              </Button>
            </fieldset>
            {!review && (
              <Button
                type="submit"
                disabled={disabled || blocked || files.loading || !!files.error}
              >
                Revisar resumo do parecer
              </Button>
            )}
          </form>
          {review && (
            <section className="efficacy-review risk-stack" aria-label="Revisão do parecer">
              <h4 ref={reviewHeading} tabIndex={-1}>
                Revise antes de confirmar
              </h4>
              <p>
                {efficacyLabels[review.result]} · {civilDate(review.verifiedOn)}
              </p>
              <p>Critério: {current?.actionSnapshot.verificationCriterion}</p>
              <p>Revisão operacional: versão {review.expectedVersion}</p>
              <p>{review.observation}</p>
              <p>{review.rationale}</p>
              <p>{review.nextSteps}</p>
              <ul>
                {Object.entries(selected).map(([id, name]) => (
                  <li key={id}>{name}</li>
                ))}
                {review.textualEvidence.map((text) => (
                  <li key={text.reference}>
                    <strong>{text.reference}</strong>
                    <p>{text.description}</p>
                    <p>{text.rationale}</p>
                  </li>
                ))}
              </ul>
              <p>A confirmação registra um parecer técnico com autoria e provas preservadas.</p>
              <div className="record-actions">
                <Button disabled={disabled || blocked || !canRecord} onClick={() => void confirm()}>
                  {pending ? 'Registrando parecer…' : 'Confirmar e registrar parecer'}
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
              setEditing(false);
              setReview(null);
            }}
          >
            Fechar preparação
          </Button>
        </div>
      )}
      <section className="risk-stack">
        <h4>Histórico de pareceres</h4>
        {history.loading && <p role="status">Consultando pareceres…</p>}
        {history.error && <p role="alert">{history.error}</p>}
        {history.data?.items.length === 0 && <p>Nenhum parecer nesta página.</p>}
        <ol className="risk-timeline">
          {history.data?.items.map((opinion) => (
            <li key={opinion.id}>
              <div className="efficacy-opinion risk-stack">
                <h5>
                  Parecer {opinion.sequence} · {efficacyLabels[opinion.result]}
                </h5>
                <p>
                  <strong>{validityLabels[opinion.validity]}</strong> · {opinion.author.name} ·{' '}
                  {riskDate(opinion.createdAt)}
                </p>
                {!!opinion.reviewReasons.length && (
                  <ul>
                    {opinion.reviewReasons.map((reason) => (
                      <li key={reason}>{reasons[reason]}</li>
                    ))}
                  </ul>
                )}
                <p className="field-hint">
                  Revisão operacional: versão {opinion.actionVersion} · {opinion.actionRevisionId}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={pending || refreshing}
                onClick={() => void inspect(opinion.id)}
              >
                Consultar parecer {opinion.sequence}
              </Button>
            </li>
          ))}
        </ol>
        {history.data && (
          <Pagination
            label="Paginação de pareceres"
            page={page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            pending={history.loading || pending}
            onPageChange={setPage}
          />
        )}
        {opened?.context === current && <Opinion opinion={opened.opinion} />}
      </section>
    </section>
  );
}
