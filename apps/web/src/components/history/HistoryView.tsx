import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  auditEventListSchema,
  auditHistoryQuerySchema,
  auditListQuerySchema,
  auditRecordSchema,
  auditTargetKindSchema,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { useRiskData } from '../risks/useRiskData';
import { RequestError } from '../../lib/api';
import './history.css';

const fields = ['from', 'to', 'resourceType', 'resourceId', 'operation', 'actorId'] as const;
const resources = [
  ['risk', 'Riscos'],
  ['action', 'Ações'],
  ['access', 'Acessos'],
  ['instrument-version', 'Versões de instrumento'],
  ['instrument', 'Instrumentos'],
  ['assessment-cycle', 'Coletas'],
  ['diagnostic-cycle', 'Diagnósticos'],
  ['evaluation-method', 'Métodos de avaliação'],
  ['organization', 'Empresa'],
  ['unit', 'Unidades'],
  ['sector', 'Setores'],
  ['assessment-group', 'Grupos'],
  ['employee', 'Colaboradores'],
  ['assessment-policy', 'Políticas de consolidação'],
  ['assessment-source', 'Fontes complementares'],
  ['corrective-action', 'Ações corretivas'],
  ['preliminary-evaluation', 'Avaliações preliminares'],
  ['technical-evaluation', 'Avaliações técnicas'],
  ['efficacy-opinion', 'Pareceres de eficácia'],
  ['reassessment', 'Reavaliações'],
  ['technical-closure', 'Encerramentos técnicos'],
];
function organizationDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function useHistoryLocation() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return hash;
}

/** Query state belongs to the URL so a record, back navigation and reload retain the same context. */
export function HistoryView({
  organizationId,
  resource,
  onExpire,
  refreshKey = 0,
  onUnavailable,
}: {
  organizationId: string;
  resource?: { kind: 'risk' | 'action'; id: string };
  onExpire: () => void;
  refreshKey?: number;
  onUnavailable?: (status: number) => void;
}) {
  const hash = useHistoryLocation();
  const [route = '', raw = ''] = hash.split('?');
  const params = new URLSearchParams(raw);
  const prefix = resource ? 'history' : '';
  const keyFor = (key: string) =>
    prefix ? `${prefix}${key[0]?.toUpperCase()}${key.slice(1)}` : key;
  const input: Record<string, string> = {};
  for (const field of resource ? ['from', 'to', 'page'] : [...fields, 'page']) {
    const value = params.get(keyFor(field));
    if (value) input[field] = value;
  }
  const schema = resource ? auditHistoryQuerySchema : auditListQuerySchema;
  const parsed = schema.safeParse({ ...input, pageSize: 20 });
  const query = new URLSearchParams(
    parsed.success ? Object.entries(parsed.data).map(([key, value]) => [key, String(value)]) : [],
  );
  const path = !parsed.success
    ? null
    : resource
      ? `/organizations/${organizationId}/${resource.kind === 'risk' ? 'risks' : 'actions'}/${resource.id}/history?${query}`
      : `/organizations/${organizationId}/audit-events?${query}`;
  const [attempt, setAttempt] = useState(0);
  const [recordFailure, setRecordFailure] = useState<number | null>(null);
  const state = useRiskData(path, auditEventListSchema, onExpire, attempt + refreshKey);
  const data = recordFailure ? null : state.data;
  const unavailableCallback = useRef(onUnavailable);
  useEffect(() => {
    unavailableCallback.current = onUnavailable;
  });
  useEffect(() => {
    const status = recordFailure ?? state.errorStatus;
    if (status && [401, 403, 404].includes(status)) unavailableCallback.current?.(status);
  }, [recordFailure, state.errorStatus]);
  const [formError, setFormError] = useState('');
  const focusReturn = useRef<HTMLButtonElement | null>(null);
  const kindValue = params.get(keyFor('recordKind'));
  const idValue = params.get(keyFor('recordId'));
  const kind = auditTargetKindSchema.safeParse(kindValue);
  const selected =
    kind.success && idValue && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(idValue)
      ? { kind: kind.data, id: idValue }
      : null;
  function navigate(changes: Record<string, string | null>) {
    // Two quick actions may precede React's hashchange render; merge the latest URL.
    const [currentRoute = '', currentRaw = ''] = window.location.hash.split('?');
    if (currentRoute !== route) return;
    const next = new URLSearchParams(currentRaw);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(keyFor(key), value);
      else next.delete(keyFor(key));
    }
    const suffix = next.toString();
    window.location.hash = `${route.replace(/^#/, '')}${suffix ? `?${suffix}` : ''}`;
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = Object.fromEntries(
      (resource ? ['from', 'to'] : fields).map((key) => [
        key,
        String(values.get(key) || '').trim(),
      ]),
    );
    const validated = schema.safeParse(
      Object.fromEntries(Object.entries(next).filter(([, value]) => value)),
    );
    if (!validated.success) {
      setFormError(
        'Confira o período e os filtros. A data inicial deve ser anterior ou igual à final; identificadores devem ser válidos.',
      );
      return;
    }
    setFormError('');
    navigate({ ...next, page: null, recordKind: null, recordId: null });
  }
  function close() {
    navigate({ recordKind: null, recordId: null });
  }
  const headingId = resource ? `${resource.kind}-unified-history` : 'audit-history-heading';
  return (
    <section className="surface history-workspace" aria-labelledby={headingId}>
      <header className="history-heading">
        <div>
          <p className="panel-label">
            {resource ? 'CONTINUIDADE DO REGISTRO' : 'CONSULTA ADMINISTRATIVA'}
          </p>
          <h3 id={headingId}>{resource ? 'Histórico unificado' : 'Eventos da empresa'}</h3>
          <p className="muted">
            {resource
              ? 'Acompanhe decisões e abra os registros preservados, do mais recente ao mais antigo.'
              : 'Publicações, decisões e alterações de acesso da empresa ativa.'}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setRecordFailure(null);
            setAttempt((value) => value + 1);
          }}
          disabled={state.loading}
        >
          Atualizar histórico
        </Button>
      </header>
      <form
        key={`${organizationId}-${path}`}
        className="history-filter-form"
        onSubmit={apply}
        noValidate
        aria-label={resource ? 'Filtros do histórico' : 'Filtros da auditoria'}
      >
        <fieldset disabled={state.loading}>
          <legend>Filtrar registros</legend>
          <div className="history-filters">
            <label>
              De
              <input name="from" type="date" defaultValue={input.from ?? ''} />
            </label>
            <label>
              Até
              <input name="to" type="date" defaultValue={input.to ?? ''} />
            </label>
            {!resource && (
              <>
                <label>
                  Recurso
                  <select name="resourceType" defaultValue={input.resourceType ?? ''}>
                    <option value="">Todos os recursos</option>
                    {resources.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Operação
                  <input
                    name="operation"
                    defaultValue={input.operation ?? ''}
                    maxLength={80}
                    placeholder="Ex.: ACTION_UPDATED"
                  />
                </label>
                <label>
                  Identificador do recurso
                  <input
                    name="resourceId"
                    defaultValue={input.resourceId ?? ''}
                    placeholder="UUID do registro"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Autor (ID)
                  <input
                    name="actorId"
                    defaultValue={input.actorId ?? ''}
                    placeholder="UUID ou use o autor de um evento"
                    spellCheck={false}
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>
        {formError && <StatusMessage tone="error">{formError}</StatusMessage>}
        <div className="record-actions">
          <Button type="submit" disabled={state.loading}>
            Aplicar filtros
          </Button>
          <Button
            variant="outline"
            disabled={state.loading}
            onClick={() => {
              setFormError('');
              navigate(
                Object.fromEntries(
                  [...fields, 'page', 'recordKind', 'recordId'].map((key) => [key, null]),
                ),
              );
            }}
          >
            Limpar filtros
          </Button>
        </div>
      </form>
      {!parsed.success && (
        <StatusMessage tone="error">
          Os filtros deste endereço são inválidos. Limpe os filtros para consultar novamente.
        </StatusMessage>
      )}
      {state.loading && <StatusMessage tone="loading">Consultando registros…</StatusMessage>}
      {(state.error || recordFailure) && (
        <StatusMessage tone="error">
          {state.error || new RequestError(recordFailure!).message}
        </StatusMessage>
      )}
      {data && (
        <>
          <p className="history-summary">
            {data.total} {data.total === 1 ? 'registro' : 'registros'} · Datas no fuso{' '}
            {data.timeZone} · Mais recentes primeiro
          </p>
          {data.items.length === 0 && (
            <p className="empty-state">Nenhum registro encontrado neste período e recorte.</p>
          )}
          <ol className="history-timeline">
            {data.items.map((entry) => (
              <li key={entry.id}>
                <div className="history-event-top">
                  <h4>{entry.label}</h4>
                  <time dateTime={entry.createdAt}>
                    {organizationDate(entry.createdAt, data.timeZone)}
                  </time>
                </div>
                <p className="history-resource">{entry.resource.label}</p>
                <p className="history-byline">
                  {entry.actor?.name ?? 'Sistema / autoria não disponível'}
                </p>
                {entry.reason ? (
                  <p className="history-reason">{entry.reason}</p>
                ) : (
                  <p className="muted">Justificativa não registrada neste evento.</p>
                )}
                <div className="history-event-actions">
                  {entry.target ? (
                    <Button
                      variant="outline"
                      aria-label={`Abrir registro · ${entry.label}`}
                      onClick={(event) => {
                        focusReturn.current = event.currentTarget;
                        navigate({ recordKind: entry.target!.kind, recordId: entry.target!.id });
                      }}
                    >
                      Abrir registro
                      {'revision' in entry.target && entry.target.revision
                        ? ` · revisão ${entry.target.revision}`
                        : ''}
                    </Button>
                  ) : (
                    <span className="field-hint">
                      Sem referência exata de revisão neste evento.
                    </span>
                  )}
                  {!resource && entry.actor && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate({
                          actorId: entry.actor!.id,
                          page: null,
                          recordKind: null,
                          recordId: null,
                        })
                      }
                    >
                      Filtrar por este autor<span className="sr-only"> · {entry.actor.name}</span>
                    </Button>
                  )}
                </div>
                {!resource && (
                  <details className="history-technical">
                    <summary>Identificadores de consulta</summary>
                    <dl>
                      <dt>Operação</dt>
                      <dd>{entry.operation}</dd>
                      <dt>Registro</dt>
                      <dd>{entry.resource.id}</dd>
                      <dt>Autor</dt>
                      <dd>{entry.actor?.id ?? 'Não disponível'}</dd>
                    </dl>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <Pagination
            label={resource ? 'Paginação do histórico unificado' : 'Paginação da auditoria'}
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            pending={state.loading}
            onPageChange={(page) =>
              navigate({ page: String(page), recordKind: null, recordId: null })
            }
          />
        </>
      )}
      {(kindValue || idValue) && !selected && (
        <StatusMessage tone="error">
          A referência do registro neste endereço é inválida.{' '}
          <Button variant="outline" onClick={close}>
            Voltar ao histórico
          </Button>
        </StatusMessage>
      )}
      {selected && !state.loading && !state.error && data && (
        <HistoryRecord
          key={`${organizationId}-${selected.kind}-${selected.id}`}
          organizationId={organizationId}
          selected={selected}
          onExpire={onExpire}
          onClose={close}
          onUnavailable={(status) => {
            setRecordFailure(status);
            close();
          }}
          onFocusReturn={() => focusReturn.current?.isConnected && focusReturn.current.focus()}
        />
      )}
    </section>
  );
}

function HistoryRecord({
  organizationId,
  selected,
  onExpire,
  onClose,
  onFocusReturn,
  onUnavailable,
}: {
  organizationId: string;
  selected: { kind: string; id: string };
  onExpire: () => void;
  onClose: () => void;
  onFocusReturn: () => void;
  onUnavailable: (status: number) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const schema = useMemo(
    () => ({
      parse(value: unknown) {
        const record = auditRecordSchema.parse(value);
        if (record.event.target?.kind !== selected.kind || record.event.target.id !== selected.id)
          throw new Error('Registro diferente do solicitado');
        return record;
      },
    }),
    [selected.kind, selected.id],
  );
  const state = useRiskData(
    `/organizations/${organizationId}/history-records/${selected.kind}/${selected.id}`,
    schema,
    onExpire,
    attempt,
  );
  const unavailableCallback = useRef(onUnavailable);
  useEffect(() => {
    unavailableCallback.current = onUnavailable;
  });
  useEffect(() => {
    if (state.errorStatus && [401, 403, 404].includes(state.errorStatus))
      unavailableCallback.current(state.errorStatus);
  }, [state.errorStatus]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="history-record-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onFocusReturn();
          }}
        >
          <Dialog.Title>Registro correspondente</Dialog.Title>
          <Dialog.Description>
            {['risk', 'action'].includes(selected.kind)
              ? 'Estado atual do registro relacionado. Este evento não contém uma cópia histórica completa.'
              : 'Conteúdo correspondente à referência selecionada. Não altera o registro atual.'}
          </Dialog.Description>
          <Dialog.Close asChild>
            <Button variant="outline" className="history-dialog-close">
              Voltar ao histórico
            </Button>
          </Dialog.Close>
          {state.loading && <StatusMessage tone="loading">Carregando registro…</StatusMessage>}
          {state.error && (
            <StatusMessage tone="error">
              {state.error}
              <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                Consultar novamente
              </Button>
            </StatusMessage>
          )}
          {state.data && (
            <>
              <h3>{state.data.event.label}</h3>
              <p>
                {state.data.event.actor?.name ?? 'Sistema / autoria não disponível'} ·{' '}
                <time dateTime={state.data.event.createdAt}>
                  {organizationDate(state.data.event.createdAt, state.data.timeZone)}
                </time>{' '}
                · {state.data.timeZone}
              </p>
              {state.data.event.reason && (
                <p className="history-reason">{state.data.event.reason}</p>
              )}
              <dl className="history-record-fields">
                {state.data.details.map((field, index) => (
                  <div key={`${field.label}-${index}`}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
