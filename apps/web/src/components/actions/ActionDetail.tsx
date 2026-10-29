import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionDetailSchema,
  actionWorkspaceSchema,
  actionWorkspaceHistoryListSchema,
  actionExecutionSchema,
  actionRevisionSchema,
  addActionNoteSchema,
  updateActionSchema,
  type ActionWorkspace,
  type EfficacyContext,
  type TechnicalClosureContext,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { riskDate, scrollToField } from '../risks/useRiskData';
import { ActionForm } from './ActionForm';
import { ActionEvidence } from './ActionEvidence';
import { actionLabels, civilDate, useActionData } from './useActionData';
import { ActionContext } from './ActionContext';
import { ActionAssignment } from './ActionAssignment';
import { ActionEfficacy } from './ActionEfficacy';
import { ActionTechnicalClosure } from './ActionTechnicalClosure';

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
  query,
  onExpire,
}: {
  organizationId: string;
  id: string;
  query: string;
  onExpire: () => void;
}) {
  const path = `/organizations/${organizationId}/actions/${id}`;
  const workspacePath = `/organizations/${organizationId}/action-workspaces/${id}`;
  const [attempt, setAttempt] = useState(0);
  const [closure, setClosure] = useState<TechnicalClosureContext | null>(null);
  const [efficacy, setEfficacy] = useState<EfficacyContext | null>(null);
  const previousOpinion = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!efficacy) return;
    const latestId = efficacy.latest?.id ?? null;
    if (previousOpinion.current !== undefined && previousOpinion.current !== latestId)
      setAttempt((value) => value + 1);
    previousOpinion.current = latestId;
  }, [efficacy]);
  const [unavailable, setUnavailable] = useState<{
    status: number;
    retryAttempt: number | null;
  } | null>(null);
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
  const [consultedAt, setConsultedAt] = useState<number | null>(null);
  const [success, setSuccess] = useState('');
  const controller = useRef(new AbortController());
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const detail = useActionData(
    workspacePath,
    actionWorkspaceSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const history = useActionData(
    detail.data ? `${workspacePath}/history?page=${revisionPage}&pageSize=50` : null,
    actionWorkspaceHistoryListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const [retained, setRetained] = useState<ActionWorkspace | null>(null);
  // A child's denial invalidates the cached successful parent response as well.
  // Only a successful response to an explicit later reload may restore the detail.
  const accessRestored =
    unavailable !== null && unavailable.retryAttempt === attempt && detail.data !== null;
  if (accessRestored) setUnavailable(null);
  const deniedStatus = unavailable && !accessRestored ? unavailable.status : detail.errorStatus;
  const denied = deniedStatus !== null && [401, 403, 404].includes(deniedStatus);
  if (denied && retained) {
    setRetained(null);
    setEfficacy(null);
    setClosure(null);
    setEditing(false);
    setMode(null);
    setReason('');
    setText('');
    setError('');
    setSuccess('');
    setFieldErrors({});
  }
  if (!denied && detail.data && detail.data !== retained) setRetained(detail.data);
  const item = denied ? null : (detail.data ?? retained);
  useEffect(() => {
    heading.current?.focus();
  }, [item?.id, editing]);
  const rawReturn = new URLSearchParams(query).get('returnTo') ?? '';
  const returnTo = /^#\/acoes(?:\?|$)/.test(rawReturn) ? rawReturn : '#/acoes';
  function reloadAction() {
    const nextAttempt = attempt + 1;
    if (unavailable) setUnavailable({ ...unavailable, retryAttempt: nextAttempt });
    setAttempt(nextAttempt);
  }
  async function mutate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !mode || pending || blocked || detail.loading || detail.error) return;
    if (
      mode === 'NOTE'
        ? !item.permissions.canNote
        : mode === 'CANCELLED'
          ? !item.permissions.canManage
          : !item.permissions.canExecute
    )
      return;
    const parsed =
      mode === 'NOTE'
        ? addActionNoteSchema.safeParse({ expectedVersion: item.version, text })
        : (mode === 'CANCELLED' ? updateActionSchema : actionExecutionSchema).safeParse({
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
      if (mode === 'NOTE') await request(`${workspacePath}/notes`, actionRevisionSchema, options);
      else
        await request(
          mode === 'CANCELLED' ? path : `${workspacePath}/execution`,
          actionDetailSchema,
          options,
        );
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
        setConsultedAt(null);
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
      <StatusMessage className="surface" tone="loading">
        Carregando ação…
      </StatusMessage>
    );
  if (!item)
    return (
      <StatusMessage className="feedback error" tone="error">
        <p>{detail.error || 'Ação indisponível.'}</p>
        <Button variant="outline" onClick={reloadAction}>
          Atualizar ação
        </Button>
        <a href={returnTo}>Voltar às ações</a>
      </StatusMessage>
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
      <a
        className="back-link"
        href={returnTo}
        onClick={() => sessionStorage.setItem('action-return-focus', id)}
      >
        ← Voltar às ações
      </a>
      <header className="surface risk-detail-header">
        <div>
          <p className="panel-label">MEDIDA PREVENTIVA · VERSÃO {item.version}</p>
          <h2 ref={heading} tabIndex={-1}>
            {item.title}
          </h2>
          <StatusBadge
            className="risk-status"
            label={actionLabels[item.status]}
            tone={item.status === 'IN_PROGRESS' ? 'info' : 'neutral'}
          />
          {item.isOverdue && <strong className="actions-overdue">Atrasada</strong>}
        </div>
        <div className="record-actions">
          {item.permissions.canManage && open && (
            <Button
              variant="outline"
              disabled={detail.loading || !!detail.error}
              onClick={() => setEditing(true)}
            >
              Editar ação
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={reloadAction}>
            Atualizar ação
          </Button>
        </div>
      </header>
      {success && (
        <StatusMessage tone="success" className="feedback success">
          {success}
        </StatusMessage>
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
      <div className="action-detail-layout">
        <div className="action-main risk-stack">
          <section className="surface risk-stack">
            <h3>Resumo da medida</h3>
            <p className="risk-long-text">{item.description}</p>
            <dl className="risk-metadata">
              <div>
                <dt>Membro atribuído</dt>
                <dd>
                  {item.assignedUser?.name ?? 'Sem atribuição'}
                  {item.assignedUser && !item.assignedUser.isActive && ' · Inativo'}
                </dd>
                {item.assignedUser && item.assignedUser.name !== item.assignedUser.currentName && (
                  <dd>Nome atual: {item.assignedUser.currentName}</dd>
                )}
              </div>
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
          {item.permissions.canManage && open && (
            <ActionAssignment
              item={item}
              organizationId={organizationId}
              onExpire={onExpire}
              onChanged={() => setAttempt((value) => value + 1)}
              onUnavailable={(status) => setUnavailable({ status, retryAttempt: null })}
            />
          )}
          <details className="surface risk-stack">
            <summary>Origem preservada na criação</summary>
            <section className="risk-stack">
              <p>
                <a href={`#/inventario/${item.riskId}`}>{item.contextSnapshot.factor}</a> · risco
                versão {item.sourceRiskVersion}
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
          </details>
          {(mode ||
            item.permissions.canExecute ||
            item.permissions.canNote ||
            item.permissions.canManage) && (
            <section className="surface risk-stack">
              <h3>Acompanhamento</h3>
              <div className="record-actions">
                {item.permissions.canExecute && item.status === 'PLANNED' && (
                  <Button
                    onClick={() => {
                      setMode('IN_PROGRESS');
                      setError('');
                    }}
                  >
                    Iniciar execução
                  </Button>
                )}
                {item.permissions.canExecute && item.status === 'IN_PROGRESS' && (
                  <Button
                    onClick={() => {
                      setMode('IMPLEMENTED');
                      setError('');
                    }}
                  >
                    Informar implementação
                  </Button>
                )}
                {item.permissions.canManage && open && (
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
                {item.permissions.canNote && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMode('NOTE');
                      setError('');
                    }}
                  >
                    Adicionar anotação
                  </Button>
                )}
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
                            setConsultedAt(attempt + 1);
                            setError(
                              'Consulte o histórico atualizado e revise o texto antes de reenviar.',
                            );
                          }}
                        >
                          Consultar ação e histórico atuais
                        </Button>
                      )}
                      {blocked &&
                        consultedAt === attempt &&
                        detail.data &&
                        !detail.loading &&
                        !detail.error &&
                        history.data &&
                        !history.loading &&
                        !history.error && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setBlocked(false);
                              setError('Revise o texto preservado antes de registrar novamente.');
                            }}
                          >
                            Revisar acompanhamento com a versão consultada
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
            canWrite={item.permissions.canUploadEvidence}
            canArchive={item.permissions.canArchiveEvidence}
            refreshing={pending || detail.loading || !!detail.error}
            onExpire={onExpire}
            onChanged={() => setAttempt(attempt + 1)}
          />
          <ActionEfficacy
            key={`${organizationId}-${id}`}
            organizationId={organizationId}
            action={item}
            refreshing={pending || detail.loading || !!detail.error}
            refreshKey={attempt + item.version}
            onExpire={onExpire}
            onUnavailable={(status) => setUnavailable({ status, retryAttempt: null })}
            onContext={setEfficacy}
          />
          <ActionTechnicalClosure
            key={`closure-${organizationId}-${id}`}
            organizationId={organizationId}
            action={item}
            refreshing={pending || detail.loading || !!detail.error}
            refreshKey={attempt + item.version}
            onExpire={onExpire}
            onUnavailable={(status) => setUnavailable({ status, retryAttempt: null })}
            onContext={setClosure}
            onChanged={() => setAttempt((value) => value + 1)}
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
                  {entry.assignmentChange && (
                    <p>
                      Membro atribuído: {entry.assignmentChange.previous?.name ?? 'Sem atribuição'}{' '}
                      → {entry.assignmentChange.next?.name ?? 'Sem atribuição'}
                    </p>
                  )}
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
              <Pagination
                label="Paginação de revisões"
                page={revisionPage}
                pageSize={history.data.pageSize}
                total={history.data.total}
                pending={history.loading}
                onPageChange={setRevisionPage}
                previousLabel="Revisões anteriores"
                nextLabel="Mais revisões"
              />
            )}
          </section>
        </div>
        <ActionContext
          item={item}
          efficacy={efficacy?.actionId === item.id ? efficacy : null}
          closure={closure?.actionId === item.id ? closure : null}
        />
      </div>
    </div>
  );
}
