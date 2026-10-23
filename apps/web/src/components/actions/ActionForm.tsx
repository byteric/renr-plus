import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionDetailSchema,
  createActionSchema,
  updateActionSchema,
  riskDetailSchema,
  preliminaryEvaluationListSchema,
  type ActionDetail,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { scrollToField } from '../risks/useRiskData';
import { actionLabels, useActionData } from './useActionData';

const fields = [
  { name: 'title', label: 'Título da medida', max: 160, min: 3 },
  { name: 'description', label: 'Descrição da medida', max: 2000, min: 10 },
  { name: 'responsibleName', label: 'Responsável nominal', max: 120, min: 3 },
  { name: 'dueDate', label: 'Prazo', max: 10, min: 10 },
  { name: 'expectedResult', label: 'Resultado esperado', max: 2000, min: 10 },
  { name: 'verificationCriterion', label: 'Critério de aferição', max: 2000, min: 10 },
] as const;
export function ActionForm({
  organizationId,
  riskId,
  item,
  onExpire,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  riskId: string;
  item?: ActionDetail;
  onExpire: () => void;
  onSaved: (value: ActionDetail) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState({
    title: item?.title ?? '',
    description: item?.description ?? '',
    responsibleName: item?.responsibleName ?? '',
    dueDate: item?.dueDate ?? '',
    expectedResult: item?.expectedResult ?? '',
    verificationCriterion: item?.verificationCriterion ?? '',
  });
  const [baseline, setBaseline] = useState(content);
  const [reason, setReason] = useState('');
  const [evaluationId, setEvaluationId] = useState('');
  const [evaluationPage, setEvaluationPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [expectedVersion, setExpectedVersion] = useState(item?.version ?? 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef(new AbortController());
  const risk = useActionData(
    !item && /^[0-9a-f-]{36}$/i.test(riskId)
      ? `/organizations/${organizationId}/risks/${riskId}`
      : null,
    riskDetailSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const evaluations = useActionData(
    !item && risk.data
      ? `/organizations/${organizationId}/risks/${riskId}/evaluations?page=${evaluationPage}&pageSize=50`
      : null,
    preliminaryEvaluationListSchema,
    organizationId,
    onExpire,
  );
  const currentAction = useActionData(
    item && blocked && consulting ? `/organizations/${organizationId}/actions/${item.id}` : null,
    actionDetailSchema,
    organizationId,
    onExpire,
    attempt,
  );
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    scrollToField(form.current, 'title');
    return () => current.abort();
  }, []);
  useEffect(() => {
    const field = Object.keys(errors)[0];
    if (!pending && field) scrollToField(form.current, field);
  }, [errors, pending]);
  const allowedOrigin =
    risk.data?.status === 'REGISTERED' && risk.data.unit.isActive && risk.data.sector.isActive;
  const terminal =
    !!item && !['PLANNED', 'IN_PROGRESS'].includes((currentAction.data ?? item).status);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked || uncertain || terminal) return;
    const parsed = item
      ? updateActionSchema.safeParse({ ...content, expectedVersion, changeReason: reason })
      : createActionSchema.safeParse({
          ...content,
          expectedRiskVersion: risk.data?.version,
          ...(evaluationId ? { evaluationId } : {}),
        });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        next[name] =
          name === 'dueDate'
            ? 'Informe uma data civil válida.'
            : 'Confira o limite e preencha este campo.';
      }
      setErrors(next);
      setError('Confira os campos destacados.');
      scrollToField(form.current, Object.keys(next)[0] ?? 'title');
      return;
    }
    if (!item && !allowedOrigin) {
      setError('A origem precisa estar registrada e ativa para criar uma ação.');
      return;
    }
    setPending(true);
    setError('');
    setErrors({});
    try {
      const saved = await request(
        item
          ? `/organizations/${organizationId}/actions/${item.id}`
          : `/organizations/${organizationId}/risks/${riskId}/actions`,
        actionDetailSchema,
        {
          method: item ? 'PATCH' : 'POST',
          body: JSON.stringify(parsed.data),
          signal: controller.current.signal,
        },
      );
      if (!controller.current.signal.aborted) onSaved(saved);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 409) {
        setBlocked(true);
        setConsulting(false);
        setError(
          'Esta ação ou sua origem foi alterada. Seu texto foi preservado; consulte a versão atual antes de reaplicar.',
        );
      } else if (failure instanceof RequestError && [0, 502].includes(failure.status)) {
        setUncertain(true);
        setError(
          'Resultado incerto: a gravação pode ter sido concluída. Seu texto foi preservado. Consulte as ações antes de decidir por um novo envio.',
        );
      } else
        setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a ação.');
      if (failure instanceof RequestError)
        setErrors(Object.fromEntries(failure.fields.map((entry) => [entry.field, entry.message])));
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <form
      ref={form}
      className="surface risk-form risk-stack"
      aria-label={item ? 'Editar ação' : 'Criar ação'}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <div className="risk-section-heading">
        <h2>{item ? 'Editar ação' : 'Nova ação'}</h2>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {!item && (
        <section>
          <h3>Origem da medida</h3>
          {risk.loading && <p role="status">Carregando origem…</p>}
          {risk.error && <p role="alert">{risk.error}</p>}
          {risk.data ? (
            <>
              <p>
                <a href={`#/inventario/${riskId}`}>{risk.data.factor}</a> · versão{' '}
                {risk.data.version}
              </p>
              <p>
                {risk.data.unit.name} / {risk.data.sector.name}
              </p>
              <p className="risk-long-text">{risk.data.description}</p>
              <details>
                <summary>Contexto completo da origem</summary>
                <dl className="risk-metadata">
                  {[
                    { label: 'Exposição', value: risk.data.exposureDescription },
                    { label: 'Grupo exposto', value: risk.data.exposedGroupDescription },
                    { label: 'Possíveis agravos', value: risk.data.possibleHarms },
                    { label: 'Controles existentes', value: risk.data.existingControls },
                    { label: 'Nota de origem', value: risk.data.sourceNote },
                  ].map((entry) => (
                    <div key={entry.label}>
                      <dt>{entry.label}</dt>
                      <dd className="risk-long-text">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              {!allowedOrigin && (
                <p role="alert">
                  Risco arquivado, rascunho ou contexto inativo: novas ações indisponíveis.
                </p>
              )}
            </>
          ) : (
            !risk.loading &&
            !risk.error && (
              <p role="alert">
                Selecione um risco registrado no inventário.{' '}
                <a href="#/inventario">Abrir inventário</a>
              </p>
            )
          )}
        </section>
      )}
      <p className="muted">
        Responsável nominal não concede acesso. Resultado esperado, relato e evidências não
        comprovam eficácia nem conformidade técnica.
      </p>
      {error && (
        <div role="alert" className="feedback error">
          <p>{error}</p>
          {blocked && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setConsulting(true);
                  setAttempt(attempt + 1);
                }}
              >
                Consultar versão atual
              </Button>
              {consulting && (item ? currentAction.data : risk.data) && (
                <>
                  <p>
                    Versão consultada: {item ? currentAction.data?.version : risk.data?.version}
                  </p>
                  {item && currentAction.data && (
                    <section aria-label="Versão atual consultada">
                      <h3>Dados atuais da medida</h3>
                      <dl className="risk-metadata">
                        {fields.map((field) => (
                          <div key={field.name}>
                            <dt>{field.label}</dt>
                            <dd className="risk-long-text">{currentAction.data![field.name]}</dd>
                          </div>
                        ))}
                        <div>
                          <dt>Estado</dt>
                          <dd>{actionLabels[currentAction.data.status]}</dd>
                        </div>
                      </dl>
                      <p>
                        Ao revisar, campos não modificados recebem os dados atuais. Suas alterações
                        são preservadas; confira diferenças no mesmo campo antes de salvar.
                      </p>
                    </section>
                  )}
                  {terminal && (
                    <p>A ação está em estado terminal. Consulte o detalhe e use anotações.</p>
                  )}
                  <Button
                    variant="outline"
                    disabled={terminal}
                    onClick={() => {
                      if (item && currentAction.data) {
                        if (terminal) return;
                        const current = currentAction.data;
                        const merged = { ...content };
                        const nextBaseline = { ...baseline };
                        for (const { name } of fields) {
                          if (content[name] === baseline[name]) merged[name] = current[name];
                          nextBaseline[name] = current[name];
                        }
                        setContent(merged);
                        setBaseline(nextBaseline);
                        setExpectedVersion(current.version);
                      }
                      setBlocked(false);
                      setError('Revise seu texto preservado antes de salvar novamente.');
                    }}
                  >
                    Revisar texto com a versão consultada
                  </Button>
                </>
              )}
            </>
          )}
          {uncertain && (
            <>
              <a href={`#/acoes?riskId=${riskId}`} target="_blank" rel="noreferrer">
                Consultar ações em outra aba
              </a>
              <Button
                variant="outline"
                onClick={() => {
                  setUncertain(false);
                  setError('Confira o resultado consultado antes de realizar outro envio.');
                }}
              >
                Já consultei, retomar revisão
              </Button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={pending || terminal} className="risk-fieldset">
        <legend>Dados da medida</legend>
        {fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={`action-${field.name}`}>{field.label}</label>
            {field.max === 2000 ? (
              <textarea
                rows={4}
                id={`action-${field.name}`}
                name={field.name}
                value={content[field.name]}
                maxLength={field.max}
                aria-invalid={!!errors[field.name]}
                aria-describedby={`hint-${field.name}`}
                onChange={(event) => setContent({ ...content, [field.name]: event.target.value })}
              />
            ) : (
              <input
                id={`action-${field.name}`}
                name={field.name}
                type={field.name === 'dueDate' ? 'date' : 'text'}
                value={content[field.name]}
                maxLength={field.max}
                aria-invalid={!!errors[field.name]}
                aria-describedby={`hint-${field.name}`}
                onChange={(event) => setContent({ ...content, [field.name]: event.target.value })}
              />
            )}
            <p
              id={`hint-${field.name}`}
              className={errors[field.name] ? 'field-error' : 'field-hint'}
            >
              {errors[field.name] ??
                (field.name === 'dueDate'
                  ? 'Data civil; um prazo passado pode nascer atrasado conforme referência da empresa.'
                  : `${field.min} a ${field.max} caracteres.`)}
            </p>
          </div>
        ))}
        {!item && (
          <div>
            <label htmlFor="action-evaluation">Ficha preliminar de referência (opcional)</label>
            <select
              id="action-evaluation"
              value={evaluationId}
              onChange={(event) => setEvaluationId(event.target.value)}
            >
              <option value="">Sem ficha vinculada</option>
              {evaluations.data?.items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  Ficha {entry.sequence} · {entry.methodReference}
                </option>
              ))}
            </select>
            {evaluations.error && <p role="alert">{evaluations.error}</p>}
            {evaluations.data && evaluations.data.total > 50 && (
              <div className="pagination">
                <Button
                  variant="outline"
                  disabled={evaluationPage === 1}
                  onClick={() => setEvaluationPage(evaluationPage - 1)}
                >
                  Fichas anteriores
                </Button>
                <Button
                  variant="outline"
                  disabled={evaluationPage * 50 >= evaluations.data.total}
                  onClick={() => setEvaluationPage(evaluationPage + 1)}
                >
                  Mais fichas
                </Button>
              </div>
            )}
          </div>
        )}
        {item && (
          <div>
            <label htmlFor="action-reason">Motivo da alteração</label>
            <textarea
              id="action-reason"
              name="changeReason"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={!!errors.changeReason}
            />
            <p className="field-hint">10 a 1.000 caracteres.</p>
            {errors.changeReason && <p className="field-error">{errors.changeReason}</p>}
          </div>
        )}
      </fieldset>
      <Button
        type="submit"
        disabled={pending || blocked || uncertain || terminal || (!item && !allowedOrigin)}
      >
        {pending ? 'Salvando…' : item ? 'Salvar alterações' : 'Criar ação'}
      </Button>
    </form>
  );
}
