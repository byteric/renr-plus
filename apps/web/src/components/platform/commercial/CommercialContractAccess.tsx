import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  commercialContractAccessClientListSchema,
  commercialContractAccessClientsQuerySchema,
  commercialContractAccessDetailSchema,
  commercialRecordContractAccessTransitionSchema,
  isContractAccessTransitionAllowed,
  type CommercialContractAccessClient,
  type CommercialContractAccessDetail,
  type CommercialContractAccessRule,
  type CommercialContractAccessStatus,
  type CommercialContractAccessTransitionKind,
  type CommercialContractSituation,
} from '@renr/contracts';
import { request, RequestError } from '../../../lib/api';
import { Button } from '../../ui/button';
import { Pagination } from '../../ui/pagination';
import { StatusBadge } from '../../ui/status-badge';
import { StatusMessage } from '../../ui/status-message';
import { usePrivateQuery } from '../usePrivateQuery';
import {
  commercialClassifications,
  commercialDate,
  commercialDateTime,
  commercialFiscalStates,
  contractAccessPath,
  todayInSaoPaulo,
  useCommercialAction,
  type CommercialAccessEvents,
} from './commercial-ui';

const PAGE_SIZE = 25;

const statusMeta: Record<
  CommercialContractAccessStatus,
  { label: string; tone: 'neutral' | 'success' | 'error' }
> = {
  UNRECORDED: { label: 'Sem decisão manual', tone: 'neutral' },
  ACTIVE: { label: 'Acesso ativo', tone: 'success' },
  SUSPENDED: { label: 'Acesso suspenso', tone: 'error' },
};

const situationLabels: Record<CommercialContractSituation, string> = {
  SCHEDULED: 'Agendado',
  ACTIVE: 'Vigente',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

const transitionKindLabels: Record<CommercialContractAccessTransitionKind, string> = {
  ACTIVATION: 'Ativação contratual',
  SUSPENSION: 'Suspensão contratual',
  REACTIVATION: 'Reativação contratual',
};

const ruleLabels: Record<CommercialContractAccessRule, string> = {
  MANUAL_CONTRACT_ACTIVATION: 'Ativação manual pelo operador autorizado',
  MANUAL_CONTRACT_SUSPENSION: 'Suspensão manual com preservação de dados e vínculos',
  MANUAL_CONTRACT_REACTIVATION: 'Reativação manual restrita aos vínculos válidos',
};

const allKinds: readonly CommercialContractAccessTransitionKind[] = [
  'ACTIVATION',
  'SUSPENSION',
  'REACTIVATION',
];

function createKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Filters = {
  search: string;
  status: '' | CommercialContractAccessStatus;
  classification: '' | 'CLIENT' | 'DEMONSTRATION' | 'UNCLASSIFIED';
};

export function CommercialContractAccess({
  canEdit,
  revision,
  initialOrganizationId,
  ...events
}: CommercialAccessEvents & {
  canEdit: boolean;
  revision: number;
  initialOrganizationId?: string | null;
}) {
  const emptyFilters: Filters = { search: '', status: '', classification: '' };
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(initialOrganizationId ?? null);
  const [filterError, setFilterError] = useState('');
  const [notice, setNotice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const tableCaptionId = useId();

  const queryParams = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) queryParams.set('search', filters.search);
  if (filters.status) queryParams.set('status', filters.status);
  if (filters.classification) queryParams.set('classification', filters.classification);

  const clientsQuery = usePrivateQuery(
    `${contractAccessPath}/clients?${queryParams}`,
    commercialContractAccessClientListSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned: Filters = { ...draft, search: draft.search.trim() };
    const candidate = Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value));
    if (
      !commercialContractAccessClientsQuerySchema.safeParse({
        ...candidate,
        page: '1',
        pageSize: String(PAGE_SIZE),
      }).success
    ) {
      setFilterError('Confira os filtros informados antes de consultar.');
      return;
    }
    setFilterError('');
    setFilters(cleaned);
    setPage(1);
  }

  function clearFilters() {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setFilterError('');
    setPage(1);
  }

  function closeDetail() {
    setSelectedOrgId(null);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  if (selectedOrgId) {
    return (
      <ContractAccessDetailPanel
        key={selectedOrgId}
        organizationId={selectedOrgId}
        canEdit={canEdit}
        revision={revision + attempt}
        onBack={closeDetail}
        onUpdated={(message) => {
          setNotice(message);
          setAttempt((value) => value + 1);
        }}
        {...events}
      />
    );
  }

  const summary = clientsQuery.data?.summary;

  return (
    <section className="commercial-section" aria-labelledby={headingId}>
      <div className="platform-heading">
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            Acesso contratual
          </h2>
          <p className="muted">
            Controle manual de ativação, suspensão e reativação por contrato. A situação de acesso
            contratual é independente do cadastro fiscal da empresa e dos vínculos individuais.
          </p>
        </div>
      </div>

      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}

      {summary && (
        <dl className="platform-metrics" aria-label="Resumo de acesso contratual">
          <div className="surface">
            <dt>Empresas contratadas</dt>
            <dd className="commercial-billing-num">{summary.counts.total}</dd>
          </div>
          <div className="surface">
            <dt>Acesso ativo</dt>
            <dd className="commercial-billing-num">{summary.counts.active}</dd>
          </div>
          <div className="surface">
            <dt>Acesso suspenso</dt>
            <dd className="commercial-billing-num">{summary.counts.suspended}</dd>
          </div>
          <div className="surface">
            <dt>Sem decisão manual</dt>
            <dd className="commercial-billing-num">{summary.counts.unrecorded}</dd>
          </div>
        </dl>
      )}

      <form
        className="platform-filters"
        aria-label="Filtrar acesso contratual"
        onSubmit={applyFilters}
      >
        <label className="commercial-field">
          Empresa ou CNPJ
          <input
            type="search"
            maxLength={160}
            value={draft.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <label className="commercial-field">
          Acesso contratual
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft({
                ...draft,
                status: event.target.value as Filters['status'],
              })
            }
          >
            <option value="">Todas as situações</option>
            <option value="ACTIVE">Acesso ativo</option>
            <option value="SUSPENDED">Acesso suspenso</option>
            <option value="UNRECORDED">Sem decisão manual</option>
          </select>
        </label>
        <label className="commercial-field">
          Classificação cadastral
          <select
            value={draft.classification}
            onChange={(event) =>
              setDraft({
                ...draft,
                classification: event.target.value as Filters['classification'],
              })
            }
          >
            <option value="">Todas as classificações</option>
            {Object.entries(commercialClassifications).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="platform-areas commercial-billing-filter-actions">
          <Button type="submit">Aplicar filtros</Button>
          {(filters.search || filters.status || filters.classification) && (
            <Button variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          )}
        </div>
      </form>

      {filterError && <StatusMessage tone="error">{filterError}</StatusMessage>}
      {clientsQuery.loading && !clientsQuery.data && (
        <StatusMessage tone="loading">Carregando contratos…</StatusMessage>
      )}
      {clientsQuery.error && (
        <StatusMessage
          tone="error"
          action={
            <Button onClick={() => setAttempt((value) => value + 1)}>Recarregar lista</Button>
          }
        >
          {clientsQuery.error}
        </StatusMessage>
      )}

      {clientsQuery.data && clientsQuery.data.items.length === 0 && (
        <StatusMessage>Nenhuma empresa contratada encontrada para os filtros atuais.</StatusMessage>
      )}

      {clientsQuery.data && clientsQuery.data.items.length > 0 && (
        <>
          <div className="surface commercial-billing-table-wrap">
            <table className="commercial-billing-table" aria-labelledby={tableCaptionId}>
              <caption id={tableCaptionId} className="sr-only">
                Lista de acesso contratual das empresas
              </caption>
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Cadastro da empresa</th>
                  <th scope="col">Contrato</th>
                  <th scope="col">Acesso contratual</th>
                  <th scope="col">Última decisão</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {clientsQuery.data.items.map((item: CommercialContractAccessClient) => {
                  const badge = statusMeta[item.access.status];
                  return (
                    <tr key={item.organizationId}>
                      <th scope="row">
                        {item.organizationName}
                        <span className="commercial-billing-subline">
                          Versão {item.access.version}
                        </span>
                      </th>
                      <td data-label="Cadastro da empresa">
                        <span>
                          {item.isActive ? 'Ativo' : 'Inativo'} ·{' '}
                          {commercialClassifications[item.clientClassification]}
                          <span className="commercial-billing-subline">
                            {commercialFiscalStates[item.fiscalState]}
                          </span>
                        </span>
                      </td>
                      <td data-label="Contrato">{situationLabels[item.contract.situation]}</td>
                      <td data-label="Acesso contratual">
                        <StatusBadge tone={badge.tone} label={badge.label} />
                      </td>
                      <td data-label="Última decisão">
                        {item.access.lastEffectiveOn ? (
                          <span>
                            {commercialDate(item.access.lastEffectiveOn)}
                            {item.access.lastActor && (
                              <span className="commercial-billing-subline">
                                {item.access.lastActor.name}
                              </span>
                            )}
                          </span>
                        ) : (
                          'Nenhuma transição'
                        )}
                      </td>
                      <td data-label="Ação">
                        <Button
                          variant="outline"
                          aria-label={
                            canEdit
                              ? `Gerenciar acesso de ${item.organizationName}`
                              : `Consultar acesso de ${item.organizationName}`
                          }
                          onClick={() => {
                            setNotice('');
                            setSelectedOrgId(item.organizationId);
                          }}
                        >
                          {canEdit ? 'Gerenciar acesso' : 'Ver histórico'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            label="Páginas de acesso contratual"
            page={clientsQuery.data.page}
            pageSize={clientsQuery.data.pageSize}
            total={clientsQuery.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}

function ContractAccessDetailPanel({
  organizationId,
  canEdit,
  revision,
  onBack,
  onUpdated,
  ...events
}: CommercialAccessEvents & {
  organizationId: string;
  canEdit: boolean;
  revision: number;
  onBack: () => void;
  onUpdated: (message: string) => void;
}) {
  const [localAttempt, setLocalAttempt] = useState(0);
  const [loadedDetail, setLoadedDetail] = useState<CommercialContractAccessDetail | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reloadController = useRef<AbortController | null>(null);
  const headingId = useId();

  const detailQuery = usePrivateQuery(
    `${contractAccessPath}/clients/${organizationId}`,
    commercialContractAccessDetailSchema,
    revision + localAttempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );

  const detail =
    loadedDetail &&
    (!detailQuery.data || loadedDetail.access.version >= detailQuery.data.access.version)
      ? loadedDetail
      : detailQuery.data;

  useEffect(() => {
    headingRef.current?.focus();
    return () => reloadController.current?.abort();
  }, []);

  async function reloadLatest() {
    reloadController.current?.abort();
    const controller = new AbortController();
    reloadController.current = controller;
    const latest = await request(
      `${contractAccessPath}/clients/${organizationId}`,
      commercialContractAccessDetailSchema,
      { signal: controller.signal },
    );
    if (!controller.signal.aborted) {
      setLoadedDetail(latest);
    }
    return latest;
  }

  return (
    <section className="commercial-section" aria-labelledby={headingId}>
      <div>
        <Button variant="outline" onClick={onBack}>
          Voltar à lista de contratos
        </Button>
      </div>

      {detailQuery.loading && !detail && (
        <StatusMessage tone="loading">Carregando situação contratual…</StatusMessage>
      )}
      {detailQuery.error && !detail && (
        <StatusMessage
          tone="error"
          action={
            <Button onClick={() => setLocalAttempt((value) => value + 1)}>Tentar novamente</Button>
          }
        >
          {detailQuery.error}
        </StatusMessage>
      )}

      {detail && (
        <>
          <article className="surface commercial-record">
            <div className="platform-heading">
              <div>
                <h2 id={headingId} ref={headingRef} tabIndex={-1}>
                  {detail.organizationName}
                </h2>
                <p className="muted">
                  Controle manual de acesso contratual · versão {detail.access.version}
                </p>
              </div>
              <StatusBadge
                tone={statusMeta[detail.access.status].tone}
                label={statusMeta[detail.access.status].label}
              />
            </div>

            {successMessage && <StatusMessage tone="success">{successMessage}</StatusMessage>}

            <div className="commercial-access-separation">
              <div className="commercial-billing-fieldset">
                <h3>Situação cadastral e fiscal (independente)</h3>
                <dl className="commercial-facts">
                  <div>
                    <dt>Cadastro da empresa</dt>
                    <dd>{detail.isActive ? 'Ativo' : 'Inativo'}</dd>
                  </div>
                  <div>
                    <dt>Classificação</dt>
                    <dd>{commercialClassifications[detail.clientClassification]}</dd>
                  </div>
                  <div>
                    <dt>Situação fiscal</dt>
                    <dd>{commercialFiscalStates[detail.fiscalState]}</dd>
                  </div>
                  <div>
                    <dt>Vigência do contrato</dt>
                    <dd>{situationLabels[detail.contract.situation]}</dd>
                  </div>
                </dl>
              </div>

              <div className="commercial-billing-fieldset">
                <h3>Situação de acesso contratual (aplicada no servidor)</h3>
                <dl className="commercial-facts">
                  <div>
                    <dt>Estado atual</dt>
                    <dd>{statusMeta[detail.access.status].label}</dd>
                  </div>
                  <div>
                    <dt>Versão de controle</dt>
                    <dd className="commercial-billing-num">{detail.access.version}</dd>
                  </div>
                  <div>
                    <dt>Regra aplicada</dt>
                    <dd>
                      {detail.access.lastRule
                        ? ruleLabels[detail.access.lastRule]
                        : 'Nenhuma regra registrada'}
                    </dd>
                  </div>
                  <div>
                    <dt>Origem</dt>
                    <dd>
                      {detail.access.lastOrigin === 'MANUAL_OPERATION'
                        ? 'Operação manual'
                        : 'Sem registro'}
                    </dd>
                  </div>
                  <div>
                    <dt>Vigência da última decisão</dt>
                    <dd>{commercialDate(detail.access.lastEffectiveOn)}</dd>
                  </div>
                  <div>
                    <dt>Autor da última decisão</dt>
                    <dd>{detail.access.lastActor?.name ?? '—'}</dd>
                  </div>
                </dl>
                {detail.access.lastReason && (
                  <p className="commercial-text">
                    <strong>Motivo atual:</strong> {detail.access.lastReason}
                  </p>
                )}
                {detail.access.lastNextStep && (
                  <p className="commercial-text">
                    <strong>Próximo passo orientado (restrito a perfis autorizados):</strong>{' '}
                    {detail.access.lastNextStep}
                  </p>
                )}
              </div>
            </div>

            {canEdit && (
              <TransitionForm
                detail={detail}
                onReloadLatest={reloadLatest}
                onSaved={(updated) => {
                  setLoadedDetail(updated);
                  const msg = `Transição registrada com histórico (versão ${updated.access.version}).`;
                  setSuccessMessage(msg);
                  onUpdated(msg);
                }}
                {...events}
              />
            )}
          </article>

          <section className="surface commercial-record" aria-label="Histórico de transições">
            <h3>Histórico imutável de transições ({detail.transitions.length})</h3>
            {detail.transitions.length === 0 ? (
              <p className="muted">Nenhuma transição contratual registrada até o momento.</p>
            ) : (
              <ol className="commercial-history">
                {[...detail.transitions].reverse().map((entry) => (
                  <li key={entry.id}>
                    <div className="platform-heading">
                      <strong>
                        #{entry.ordinal} · {transitionKindLabels[entry.kind]}
                      </strong>
                      <StatusBadge
                        tone={statusMeta[entry.toStatus].tone}
                        label={`${statusMeta[entry.fromStatus].label} → ${statusMeta[entry.toStatus].label}`}
                      />
                    </div>
                    <dl className="commercial-facts">
                      <div>
                        <dt>Autor</dt>
                        <dd>{entry.actor.name}</dd>
                      </div>
                      <div>
                        <dt>Data de vigência</dt>
                        <dd>{commercialDate(entry.effectiveOn)}</dd>
                      </div>
                      <div>
                        <dt>Registrado em</dt>
                        <dd>{commercialDateTime(entry.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Origem</dt>
                        <dd>Operação manual</dd>
                      </div>
                      <div>
                        <dt>Regra</dt>
                        <dd>{ruleLabels[entry.rule]}</dd>
                      </div>
                    </dl>
                    <p className="commercial-text">
                      <strong>Motivo:</strong> {entry.reason}
                    </p>
                    <p className="commercial-text">
                      <strong>Próximo passo:</strong> {entry.nextStep}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function TransitionForm({
  detail,
  onReloadLatest,
  onSaved,
  ...events
}: CommercialAccessEvents & {
  detail: CommercialContractAccessDetail;
  onReloadLatest: () => Promise<CommercialContractAccessDetail>;
  onSaved: (updated: CommercialContractAccessDetail) => void;
}) {
  const allowedKinds = allKinds.filter((candidate) =>
    isContractAccessTransitionAllowed(detail.access.status, candidate, detail.contract.situation),
  );
  const [baseVersion, setBaseVersion] = useState(detail.access.version);
  const [kind, setKind] = useState<CommercialContractAccessTransitionKind>(
    allowedKinds[0] ?? 'SUSPENSION',
  );
  const [effectiveOn, setEffectiveOn] = useState(todayInSaoPaulo());
  const [reason, setReason] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createKey);
  const [reloading, setReloading] = useState(false);
  const [reloadHint, setReloadHint] = useState('');
  const mutation = useCommercialAction(events);

  const kindId = useId();
  const dateId = useId();
  const reasonId = useId();
  const nextStepId = useId();
  const confirmId = useId();
  const formHeadingId = useId();

  const staleByRefresh = detail.access.version !== baseVersion;
  const hasConflict = mutation.conflict || staleByRefresh;
  const effectiveKind = allowedKinds.includes(kind) ? kind : (allowedKinds[0] ?? 'SUSPENSION');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasConflict) return;
    const parsed = commercialRecordContractAccessTransitionSchema.safeParse({
      expectedVersion: baseVersion,
      kind: effectiveKind,
      effectiveOn,
      reason,
      nextStep,
      confirmed,
      idempotencyKey,
    });
    if (!parsed.success) {
      mutation.setError(
        !confirmed
          ? 'Marque a confirmação explícita da decisão manual antes de registrar.'
          : 'Confira a data de vigência, o motivo (mínimo de 3 caracteres) e o próximo passo orientado.',
      );
      return;
    }
    const saved = await mutation.run((signal) =>
      request(
        `${contractAccessPath}/clients/${detail.organizationId}/transitions`,
        commercialContractAccessDetailSchema,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(parsed.data),
          signal,
        },
      ),
    );
    if (saved) {
      setBaseVersion(saved.access.version);
      setReason('');
      setNextStep('');
      setConfirmed(false);
      setReloadHint('');
      setIdempotencyKey(createKey());
      onSaved(saved);
    }
  }

  async function handleReloadAfterConflict() {
    setReloading(true);
    try {
      const latest = await onReloadLatest();
      const nextAllowed = allKinds.filter((candidate) =>
        isContractAccessTransitionAllowed(
          latest.access.status,
          candidate,
          latest.contract.situation,
        ),
      );
      setBaseVersion(latest.access.version);
      setConfirmed(false);
      if (nextAllowed.length > 0 && !nextAllowed.includes(effectiveKind)) {
        const replacement = nextAllowed[0]!;
        setKind(replacement);
        setReloadHint(
          `A situação mudou e a transição disponível passou a ser "${transitionKindLabels[replacement]}". Revise seu rascunho e confirme novamente.`,
        );
      } else {
        setReloadHint(
          'Situação atual recarregada. Revise a versão atual e marque a confirmação antes de reenviar.',
        );
      }
      setIdempotencyKey(createKey());
      mutation.resetConflict();
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401) {
        events.onExpire();
      } else if (failure instanceof RequestError && failure.status === 403) {
        events.onDenied();
      } else {
        mutation.setError('Não foi possível recarregar a situação atual. Tente novamente.');
      }
    } finally {
      setReloading(false);
    }
  }

  if (allowedKinds.length === 0) {
    return (
      <StatusMessage>
        Nenhuma transição de acesso contratual está disponível para o estado atual deste contrato.
      </StatusMessage>
    );
  }

  return (
    <form
      className="platform-editor commercial-editor"
      aria-labelledby={formHeadingId}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h3 id={formHeadingId}>Registrar decisão manual de acesso</h3>
      <p className="muted">
        Dados, anexos, histórico e vínculos individuais são preservados. Na reativação, apenas
        vínculos ativos voltam a operar; vínculos revogados permanecem revogados.
      </p>

      <div className="commercial-fields">
        <label className="commercial-field" htmlFor={kindId}>
          Transição contratual
          <select
            id={kindId}
            value={effectiveKind}
            disabled={mutation.pending || reloading}
            onChange={(event) =>
              setKind(event.target.value as CommercialContractAccessTransitionKind)
            }
          >
            {allowedKinds.map((option) => (
              <option key={option} value={option}>
                {transitionKindLabels[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="commercial-field" htmlFor={dateId}>
          Data de vigência
          <input
            id={dateId}
            type="date"
            required
            max={todayInSaoPaulo()}
            value={effectiveOn}
            disabled={mutation.pending || reloading}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
        </label>
      </div>

      <label className="commercial-field" htmlFor={reasonId}>
        Motivo da decisão
        <textarea
          id={reasonId}
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          value={reason}
          disabled={mutation.pending || reloading}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <label className="commercial-field" htmlFor={nextStepId}>
        Próximo passo orientado (exibido somente aos perfis autorizados)
        <textarea
          id={nextStepId}
          required
          minLength={3}
          maxLength={500}
          rows={2}
          value={nextStep}
          disabled={mutation.pending || reloading}
          onChange={(event) => setNextStep(event.target.value)}
        />
      </label>

      <label className="platform-check commercial-access-confirm" htmlFor={confirmId}>
        <input
          id={confirmId}
          type="checkbox"
          checked={confirmed}
          disabled={mutation.pending || reloading}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>Confirmo esta decisão manual de acesso contratual (versão atual {baseVersion}).</span>
      </label>

      {reloadHint && !hasConflict && <StatusMessage>{reloadHint}</StatusMessage>}

      {(mutation.error || staleByRefresh) && (
        <StatusMessage
          tone="error"
          action={
            hasConflict ? (
              <Button
                variant="outline"
                disabled={reloading}
                onClick={() => void handleReloadAfterConflict()}
              >
                {reloading ? 'Recarregando…' : 'Recarregar situação atual'}
              </Button>
            ) : undefined
          }
        >
          {hasConflict
            ? 'A situação contratual mudou em outra sessão. Seu rascunho foi preservado; recarregue a situação atual antes de confirmar novamente.'
            : mutation.error}
        </StatusMessage>
      )}

      <div className="platform-areas">
        <Button type="submit" disabled={mutation.pending || hasConflict || reloading}>
          {mutation.pending ? 'Registrando…' : 'Confirmar transição'}
        </Button>
      </div>
    </form>
  );
}
