import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionDetailSchema,
  actionRevisionListSchema,
  actionRevisionSchema,
  addActionNoteSchema,
  updateActionSchema,
  type ActionDetail as ActionDetailValue,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { riskDate, scrollToField } from '../risks/useRiskData';
import { ActionForm } from './ActionForm';
import { ActionEvidence } from './ActionEvidence';
import { actionLabels, civilDate, useActionData } from './useActionData';

const events = {
  CREATED: 'Criação',
  UPDATED: 'Edição',
  STARTED: 'Início da execução',
  IMPLEMENTED: 'Execução informada',
  CANCELLED: 'Cancelamento',
  NOTE: 'Anotação',
  EVIDENCE_ADDED: 'Evidência adicionada',
  EVIDENCE_ARCHIVED: 'Evidência arquivada',
};
export function ActionDetail({
  organizationId,
  id,
  canWrite,
  query,
  onExpire,
}: {
  organizationId: string;
  id: string;
  canWrite: boolean;
  query: string;
  onExpire: () => void;
}) {
  const path = `/organizations/${organizationId}/actions/${id}`;
  const [attempt, setAttempt] = useState(0);
  const [revisionPage, setRevisionPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'IN_PROGRESS' | 'IMPLEMENTED' | 'CANCELLED' | 'NOTE' | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState(false);
  const [success, setSuccess] = useState('');
  const controller = useRef(new AbortController());
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const detail = useActionData(path, actionDetailSchema, organizationId, onExpire, attempt);
  const history = useActionData(
    detail.data ? `${path}/revisions?page=${revisionPage}&pageSize=50` : null,
    actionRevisionListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [detail.data?.id, editing]);
  const [retained, setRetained] = useState<ActionDetailValue | null>(null);
  if (detail.data && detail.data !== retained) setRetained(detail.data);
  const item = detail.data ?? retained;
  const rawReturn = new URLSearchParams(query).get('returnTo') ?? '';
  const returnTo = /^#\/acoes(?:\?|$)/.test(rawReturn) ? rawReturn : '#/acoes';
  async function mutate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !mode || pending || blocked || detail.loading || detail.error) return;
    const parsed =
      mode === 'NOTE'
        ? addActionNoteSchema.safeParse({ expectedVersion: item.version, text })
        : updateActionSchema.safeParse({
            expectedVersion: item.version,
            changeReason: reason,
            status: mode,
            ...(mode === 'IMPLEMENTED' ? { implementationNote: text } : {}),
          });
    if (!parsed.success) {
      const next = Object.fromEntries(
        parsed.error.issues.map((entry) => [
          String(entry.path[0]),
          'Preencha com o contexto e o limite indicados.',
        ]),
      );
      setFieldErrors(next);
      scrollToField(form.current, Object.keys(next)[0] ?? 'changeReason');
      return;
    }
    setPending(true);
    setError('');
    setFieldErrors({});
    try {
      const options = {
        method: mode === 'NOTE' ? 'POST' : 'PATCH',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      };
      if (mode === 'NOTE') await request(`${path}/notes`, actionRevisionSchema, options);
      else await request(path, actionDetailSchema, options);
      if (controller.current.signal.aborted) return;
      setMode(null);
      setReason('');
      setText('');
      setSuccess('Acompanhamento registrado no histórico.');
      setAttempt((value) => value + 1);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && [0, 409, 502].includes(failure.status)) {
        setBlocked(true);
        setError(
          failure.status === 409
            ? 'A ação foi alterada. Seu texto foi preservado; consulte a versão atual antes de reaplicar.'
            : 'Resultado incerto. Seu texto foi preservado; consulte o histórico antes de decidir por outro envio.',
        );
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : 'Não foi possível registrar o acompanhamento.',
        );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  if (detail.loading && !item)
    return (
      <p className="surface" role="status">
        Carregando ação…
      </p>
    );
  if (!item)
    return (
      <div className="feedback error" role="alert">
        <p>{detail.error || 'Ação indisponível.'}</p>
        <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
          Atualizar ação
        </Button>
        <a href={returnTo}>Voltar às ações</a>
      </div>
    );
  if (editing)
    return (
      <ActionForm
        organizationId={organizationId}
        riskId={item.riskId}
        item={item}
        onExpire={onExpire}
        onSaved={() => {
          setEditing(false);
          setAttempt(attempt + 1);
          setSuccess('Ação atualizada.');
        }}
        onCancel={() => {
          setEditing(false);
          setAttempt(attempt + 1);
        }}
      />
    );
  const open = item.status === 'PLANNED' || item.status === 'IN_PROGRESS';
  const inactive =
    item.currentOrigin.riskStatus === 'ARCHIVED' ||
    !item.currentOrigin.organizationActive ||
    !item.currentOrigin.unitActive ||
    !item.currentOrigin.sectorActive;
  return (
    <div className="risk-stack actions-workspace">
      {detail.loading && <p role="status">Atualizando ação e referência de prazo…</p>}
      {detail.error && (
        <p role="alert" className="feedback error">
          {detail.error} Os dados exibidos são da última consulta. Atualize antes de gravar.
        </p>
      )}
      <a className="back-link" href={returnTo}>
        ← Voltar às ações
      </a>
      <header className="surface risk-detail-header">
        <div>
          <p className="panel-label">MEDIDA PREVENTIVA · VERSÃO {item.version}</p>
          <h2 ref={heading} tabIndex={-1}>
            {item.title}
          </h2>
          <span className="risk-status">{actionLabels[item.status]}</span>
          {item.isOverdue && <strong className="actions-overdue">Atrasada</strong>}
        </div>
        <div className="record-actions">
          {canWrite && open && (
            <Button
              variant="outline"
              disabled={detail.loading || !!detail.error}
              onClick={() => setEditing(true)}
            >
              Editar ação
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={() => setAttempt(attempt + 1)}>
            Atualizar ação
          </Button>
        </div>
      </header>
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {inactive && (
        <p className="feedback">
          Origem arquivada ou inativa. O acompanhamento desta ação permanece disponível; novas ações
          estão bloqueadas nessa origem.
        </p>
      )}
      <p className="risk-disclaimer">
        Execução informada e evidências não comprovam eficácia nem encerramento técnico. Responsável
        nominal não concede acesso.
      </p>
      <section className="surface risk-stack">
        <h3>Resumo da medida</h3>
        <p className="risk-long-text">{item.description}</p>
        <dl className="risk-metadata">
          <div>
            <dt>Responsável nominal</dt>
            <dd>{item.responsibleName}</dd>
          </div>
          <div>
            <dt>Prazo</dt>
            <dd>
              <time dateTime={item.dueDate}>{civilDate(item.dueDate)}</time>
            </dd>
          </div>
          <div>
            <dt>Referência de prazo</dt>
            <dd>
              {civilDate(item.referenceDate)} · {item.timeZone}
            </dd>
          </div>
          <div>
            <dt>Autoria</dt>
            <dd>
              {item.createdBy.name} · {riskDate(item.createdAt)}
            </dd>
          </div>
        </dl>
        <h4>Resultado esperado</h4>
        <p className="risk-long-text">{item.expectedResult}</p>
        <h4>Critério de aferição</h4>
        <p className="risk-long-text">{item.verificationCriterion}</p>
        {item.implementationNote && (
          <>
            <h4>Relato de implementação</h4>
            <p className="risk-long-text">{item.implementationNote}</p>
            {item.implementedAt && <p>{riskDate(item.implementedAt)}</p>}
          </>
        )}
      </section>
      <section className="surface risk-stack">
        <h3>Origem preservada na criação</h3>
        <p>
          <a href={`#/inventario/${item.riskId}`}>{item.contextSnapshot.factor}</a> · risco versão{' '}
          {item.sourceRiskVersion}
        </p>
        <p>
          {item.contextSnapshot.unit.name} / {item.contextSnapshot.sector.name}
        </p>
        <p>
          Estado atual do risco:{' '}
          {item.currentOrigin.riskStatus === 'ARCHIVED'
            ? 'Arquivado'
            : item.currentOrigin.riskStatus === 'REGISTERED'
              ? 'Registrado'
              : 'Rascunho'}
        </p>
        <dl className="risk-metadata">
          {[
            { label: 'Descrição', value: item.contextSnapshot.description },
            { label: 'Exposição', value: item.contextSnapshot.exposureDescription },
            { label: 'Grupo exposto', value: item.contextSnapshot.exposedGroupDescription },
            { label: 'Possíveis agravos', value: item.contextSnapshot.possibleHarms },
            { label: 'Controles existentes', value: item.contextSnapshot.existingControls },
            { label: 'Nota de origem', value: item.contextSnapshot.sourceNote },
          ].map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd className="risk-long-text">{entry.value}</dd>
            </div>
          ))}
        </dl>
        <p>
          {item.evaluationId ? (
            <>
              Ficha vinculada: {item.evaluationId}.{' '}
              <a href={`#/inventario/${item.riskId}?section=fichas`}>
                Consultar fichas preliminares
              </a>
            </>
          ) : (
            'Sem ficha preliminar vinculada.'
          )}
        </p>
      </section>
      {canWrite && (
        <section className="surface risk-stack">
          <h3>Acompanhamento</h3>
          <div className="record-actions">
            {item.status === 'PLANNED' && (
              <Button
                onClick={() => {
                  setMode('IN_PROGRESS');
                  setError('');
                }}
              >
                Iniciar execução
              </Button>
            )}
            {item.status === 'IN_PROGRESS' && (
              <Button
                onClick={() => {
                  setMode('IMPLEMENTED');
                  setError('');
                }}
              >
                Informar implementação
              </Button>
            )}
            {open && (
              <Button
                variant="outline"
                onClick={() => {
                  setMode('CANCELLED');
                  setError('');
                }}
              >
                Cancelar ação
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setMode('NOTE');
                setError('');
              }}
            >
              Adicionar anotação
            </Button>
          </div>
          {mode && (
            <form
              ref={form}
              className="risk-form risk-stack"
              onSubmit={(event) => void mutate(event)}
              noValidate
            >
              <h4>
                {mode === 'NOTE'
                  ? 'Anotação histórica'
                  : mode === 'IMPLEMENTED'
                    ? 'Registrar execução informada'
                    : mode === 'CANCELLED'
                      ? 'Confirmar cancelamento'
                      : 'Registrar início'}
              </h4>
              {error && (
                <div role="alert" className="feedback error">
                  <p>{error}</p>
                  {blocked && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAttempt(attempt + 1);
                        setBlocked(false);
                        setError(
                          'Consulte o histórico atualizado e revise o texto antes de reenviar.',
                        );
                      }}
                    >
                      Consultar ação e histórico atuais
                    </Button>
                  )}
                </div>
              )}
              <fieldset className="risk-fieldset" disabled={pending}>
                {mode !== 'NOTE' && (
                  <div>
                    <label htmlFor="transition-reason">
                      {mode === 'CANCELLED' ? 'Motivo do cancelamento' : 'Motivo da alteração'}
                    </label>
                    <textarea
                      id="transition-reason"
                      name="changeReason"
                      value={reason}
                      maxLength={1000}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <p className="field-hint">10 a 1.000 caracteres.</p>
                    {fieldErrors.changeReason && (
                      <p className="field-error">{fieldErrors.changeReason}</p>
                    )}
                  </div>
                )}
                {(mode === 'NOTE' || mode === 'IMPLEMENTED') && (
                  <div>
                    <label htmlFor="transition-text">
                      {mode === 'NOTE' ? 'Texto da anotação' : 'Relato de implementação'}
                    </label>
                    <textarea
                      id="transition-text"
                      name={mode === 'NOTE' ? 'text' : 'implementationNote'}
                      rows={4}
                      value={text}
                      maxLength={2000}
                      onChange={(event) => setText(event.target.value)}
                    />
                    <p className="field-hint">
                      {mode === 'NOTE' ? '10' : '20'} a 2.000 caracteres.
                    </p>
                    {(fieldErrors.text || fieldErrors.implementationNote) && (
                      <p className="field-error">
                        {fieldErrors.text || fieldErrors.implementationNote}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
              <div className="record-actions">
                <Button
                  type="submit"
                  disabled={pending || blocked || detail.loading || !!detail.error}
                >
                  {pending ? 'Registrando…' : 'Registrar acompanhamento'}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setMode(null)}>
                  Voltar sem registrar
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      <ActionEvidence
        key={id}
        organizationId={organizationId}
        action={item}
        canWrite={canWrite}
        onExpire={onExpire}
        onChanged={() => setAttempt(attempt + 1)}
      />
      <section className="surface risk-stack">
        <h3>Histórico de revisões</h3>
        {history.loading && <p role="status">Carregando histórico…</p>}
        {history.error && <p role="alert">{history.error}</p>}
        {history.data?.items.length === 0 && <p>Nenhuma revisão disponível nesta página.</p>}
        <ol className="risk-timeline">
          {history.data?.items.map((entry) => (
            <li key={entry.id}>
              <strong>
                Versão {entry.version} · {events[entry.event]}
              </strong>
              <p>
                {entry.author.name} · {riskDate(entry.createdAt)}
              </p>
              {entry.changeReason && <p className="risk-long-text">{entry.changeReason}</p>}
              {entry.text && <p className="risk-long-text">{entry.text}</p>}
              <details>
                <summary>Conteúdo nesta versão</summary>
                <p>
                  {entry.snapshot.title} · {actionLabels[entry.snapshot.status]} ·{' '}
                  {civilDate(entry.snapshot.dueDate)}
                </p>
                <p>{entry.snapshot.responsibleName}</p>
                <p className="risk-long-text">{entry.snapshot.description}</p>
                <p className="risk-long-text">{entry.snapshot.expectedResult}</p>
                <p className="risk-long-text">{entry.snapshot.verificationCriterion}</p>
                <p className="risk-long-text">{entry.snapshot.implementationNote}</p>
              </details>
            </li>
          ))}
        </ol>
        {history.data && history.data.total > 50 && (
          <nav className="pagination" aria-label="Paginação de revisões">
            <Button
              variant="outline"
              disabled={revisionPage === 1}
              onClick={() => setRevisionPage(revisionPage - 1)}
            >
              Revisões anteriores
            </Button>
            <Button
              variant="outline"
              disabled={revisionPage * 50 >= history.data.total}
              onClick={() => setRevisionPage(revisionPage + 1)}
            >
              Mais revisões
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}
