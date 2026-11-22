import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  commercialBillingChargeDetailSchema,
  commercialBillingChargeListSchema,
  commercialBillingChargesQuerySchema,
  commercialBillingContractListSchema,
  commercialConfirmBillingPaymentSchema,
  commercialCorrectBillingChargeSchema,
  commercialCreateBillingChargeSchema,
  type CommercialBillingCharge,
  type CommercialBillingChargeDetail,
  type CommercialBillingContractRef,
  type CommercialBillingRevisionKind,
  type CommercialBillingStatus,
} from '@renr/contracts';
import { request, RequestError } from '../../../lib/api';
import { Button } from '../../ui/button';
import { Pagination } from '../../ui/pagination';
import { StatusBadge } from '../../ui/status-badge';
import { StatusMessage } from '../../ui/status-message';
import { usePrivateQuery } from '../usePrivateQuery';
import {
  billingPath,
  commercialDate,
  commercialDateTime,
  commercialPrice,
  currentCompetenceInSaoPaulo,
  formatBrlCents,
  formatBrlInput,
  parseBrlToCents,
  todayInSaoPaulo,
  useCommercialAction,
  type CommercialAccessEvents,
} from './commercial-ui';

const PAGE_SIZE = 25;

const statusMeta: Record<
  CommercialBillingStatus,
  { label: string; tone: 'info' | 'error' | 'success' }
> = {
  OPEN: { label: 'Em aberto', tone: 'info' },
  OVERDUE: { label: 'Vencida', tone: 'error' },
  PAID: { label: 'Paga', tone: 'success' },
};

const revisionKindLabels: Record<CommercialBillingRevisionKind, string> = {
  CREATED: 'Lançamento inicial',
  PAYMENT_CONFIRMED: 'Recebimento confirmado',
  CORRECTION: 'Correção registrada',
};

const contractRevisionKinds = {
  INITIAL: 'Inicial',
  RENEWAL: 'Renovação',
  AMENDMENT: 'Reajuste/alteração',
};

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
  organizationId: string;
  competenceFrom: string;
  competenceTo: string;
  status: '' | CommercialBillingStatus;
};

export function CommercialBilling({
  canEdit,
  revision,
  initialOrganizationId,
  initialStatus = '',
  initialCompetenceFrom = '',
  initialCompetenceTo = '',
  ...events
}: CommercialAccessEvents & {
  canEdit: boolean;
  revision: number;
  initialOrganizationId?: string | null;
  initialStatus?: '' | CommercialBillingStatus;
  initialCompetenceFrom?: string;
  initialCompetenceTo?: string;
}) {
  const initialFilters: Filters = {
    organizationId: initialOrganizationId ?? '',
    competenceFrom: initialCompetenceFrom,
    competenceTo: initialCompetenceTo,
    status: initialStatus,
  };
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [filterError, setFilterError] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<{
    organizationId: string;
    chargeId: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const tableCaptionId = useId();
  const headingId = useId();
  const filterOrgId = useId();
  const filterStatusId = useId();

  const contractsQuery = usePrivateQuery(
    `${billingPath}/contracts?page=1&pageSize=100`,
    commercialBillingContractListSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );

  const focusedOrgId = selectedCharge?.organizationId ?? initialOrganizationId ?? null;
  const listedContracts = contractsQuery.data?.items ?? [];
  const missingFocusedContract = Boolean(
    focusedOrgId &&
    contractsQuery.data &&
    !listedContracts.some((item) => item.organizationId === focusedOrgId),
  );
  const focusedContractQuery = usePrivateQuery(
    missingFocusedContract && focusedOrgId
      ? `${billingPath}/contracts?organizationId=${focusedOrgId}&page=1&pageSize=1`
      : null,
    commercialBillingContractListSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );
  const contracts = [
    ...listedContracts,
    ...(focusedContractQuery.data?.items.filter(
      (extra) => !listedContracts.some((item) => item.organizationId === extra.organizationId),
    ) ?? []),
  ];

  const chargeParams = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (filters.organizationId) chargeParams.set('organizationId', filters.organizationId);
  if (filters.competenceFrom) chargeParams.set('competenceFrom', filters.competenceFrom);
  if (filters.competenceTo) chargeParams.set('competenceTo', filters.competenceTo);
  if (filters.status) chargeParams.set('status', filters.status);

  const chargesQuery = usePrivateQuery(
    `${billingPath}/charges?${chargeParams}`,
    commercialBillingChargeListSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );

  const reload = () => setAttempt((value) => value + 1);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned: Filters = {
      organizationId: draft.organizationId,
      competenceFrom: draft.competenceFrom.trim(),
      competenceTo: draft.competenceTo.trim(),
      status: draft.status,
    };
    const payload = Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value));
    const parsed = commercialBillingChargesQuerySchema.safeParse({
      ...payload,
      page: '1',
      pageSize: String(PAGE_SIZE),
    });
    if (!parsed.success) {
      setFilterError('Confira o intervalo de competências (AAAA-MM) e os filtros informados.');
      return;
    }
    setFilterError('');
    setFilters(cleaned);
    setPage(1);
    setSelectedCharge(null);
  }

  function clearFilters() {
    const empty: Filters = {
      organizationId: '',
      competenceFrom: '',
      competenceTo: '',
      status: '',
    };
    setFilterError('');
    setDraft(empty);
    setFilters(empty);
    setPage(1);
    setSelectedCharge(null);
  }

  const selectedContract = selectedCharge
    ? contracts.find((item) => item.organizationId === selectedCharge.organizationId)
    : undefined;

  if (selectedCharge) {
    return (
      <section className="commercial-section" aria-label="Detalhe da cobrança">
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedCharge(null);
              window.requestAnimationFrame(() => headingRef.current?.focus());
            }}
          >
            Voltar às cobranças
          </Button>
        </div>
        <BillingChargeDetailPanel
          key={selectedCharge.chargeId}
          organizationId={selectedCharge.organizationId}
          chargeId={selectedCharge.chargeId}
          contractRef={selectedContract}
          canEdit={canEdit}
          revision={revision + attempt}
          onChanged={reload}
          {...events}
        />
      </section>
    );
  }

  const summary = chargesQuery.data?.summary;
  const items = chargesQuery.data?.items ?? [];

  return (
    <section className="commercial-section" aria-labelledby={headingId}>
      <div className="platform-heading">
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            Cobranças e pagamentos
          </h2>
          <p className="muted">
            Registro manual de competências, vencimentos, recebimentos e correções com histórico.
          </p>
        </div>
        {canEdit && (
          <Button
            ref={createTrigger}
            disabled={contracts.length === 0}
            onClick={() => {
              setNotice('');
              setCreating((open) => !open);
            }}
          >
            {creating ? 'Fechar lançamento' : 'Registrar cobrança'}
          </Button>
        )}
      </div>

      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}

      {contractsQuery.error && (
        <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar contratos</Button>}>
          {contractsQuery.error}
        </StatusMessage>
      )}

      {canEdit && contractsQuery.data && contracts.length === 0 && (
        <StatusMessage>
          Nenhum contrato comercial cadastrado ainda. Registre um contrato antes de lançar
          cobranças.
        </StatusMessage>
      )}

      {canEdit && creating && contracts.length > 0 && (
        <BillingChargeCreateForm
          contracts={contracts}
          defaultOrganizationId={filters.organizationId}
          onCancel={() => {
            setCreating(false);
            createTrigger.current?.focus();
          }}
          onCreated={(created) => {
            setCreating(false);
            setNotice(
              `Cobrança ${created.competence} registrada para ${created.organizationName}.`,
            );
            reload();
            headingRef.current?.focus();
          }}
          onReload={reload}
          {...events}
        />
      )}

      {summary && (
        <>
          <div className="platform-metrics" aria-label="Resumo financeiro do período">
            <article>
              <h3>Total cobrado</h3>
              <strong>{formatBrlCents(summary.billedCents)}</strong>
              <p className="muted">
                {summary.counts.total} {summary.counts.total === 1 ? 'cobrança' : 'cobranças'}
              </p>
            </article>
            <article>
              <h3>Em aberto</h3>
              <strong>{formatBrlCents(summary.openCents)}</strong>
              <p className="muted">
                {summary.counts.open} a vencer ({commercialDate(summary.referenceDate)} em diante)
              </p>
            </article>
            <article>
              <h3>Vencido</h3>
              <strong>{formatBrlCents(summary.overdueCents)}</strong>
              <p className="muted">
                {summary.counts.overdue} {summary.counts.overdue === 1 ? 'em atraso' : 'em atraso'}
              </p>
            </article>
            <article>
              <h3>Recebido</h3>
              <strong>{formatBrlCents(summary.receivedCents)}</strong>
              <p className="muted">
                {summary.counts.paid} {summary.counts.paid === 1 ? 'paga' : 'pagas'}
              </p>
            </article>
          </div>
          <p className="muted commercial-billing-reference">
            Referência de vencimento: {commercialDate(summary.referenceDate)} (horário de São
            Paulo). Os totais reconciliam cobranças em aberto, vencidas e pagas no recorte atual.
          </p>
        </>
      )}

      <div role="search">
        <form
          aria-label="Filtrar cobranças"
          className="platform-filters"
          onSubmit={applyFilters}
          noValidate
        >
          <div className="commercial-field">
            <label htmlFor={filterOrgId}>Empresa</label>
            <select
              id={filterOrgId}
              value={draft.organizationId}
              onChange={(event) => setDraft({ ...draft, organizationId: event.target.value })}
            >
              <option value="">Todas as empresas</option>
              {contracts.map((item) => (
                <option key={item.organizationId} value={item.organizationId}>
                  {item.organizationName}
                </option>
              ))}
            </select>
          </div>
          <label>
            Competência inicial
            <input
              type="text"
              inputMode="numeric"
              placeholder="2026-01"
              maxLength={7}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={draft.competenceFrom}
              onChange={(event) => setDraft({ ...draft, competenceFrom: event.target.value })}
            />
          </label>
          <label>
            Competência final
            <input
              type="text"
              inputMode="numeric"
              placeholder="2026-12"
              maxLength={7}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={draft.competenceTo}
              onChange={(event) => setDraft({ ...draft, competenceTo: event.target.value })}
            />
          </label>
          <div className="commercial-field">
            <label htmlFor={filterStatusId}>Situação</label>
            <select
              id={filterStatusId}
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as Filters['status'],
                })
              }
            >
              <option value="">Todas as situações</option>
              <option value="OPEN">Em aberto</option>
              <option value="OVERDUE">Vencidas</option>
              <option value="PAID">Pagas</option>
            </select>
          </div>
          <div className="platform-areas commercial-billing-filter-actions">
            <Button type="submit">Aplicar filtros</Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </div>
        </form>
      </div>

      {filterError && <StatusMessage tone="error">{filterError}</StatusMessage>}

      {chargesQuery.error ? (
        <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar cobranças</Button>}>
          {chargesQuery.error}
        </StatusMessage>
      ) : !chargesQuery.data ? (
        <StatusMessage tone="loading">Carregando cobranças…</StatusMessage>
      ) : items.length === 0 ? (
        <StatusMessage>Nenhuma cobrança encontrada para os filtros aplicados.</StatusMessage>
      ) : (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={tableCaptionId}
            aria-busy={chargesQuery.loading || undefined}
            className="commercial-billing-table-wrap surface"
          >
            <table className="commercial-billing-table" role="table">
              <caption id={tableCaptionId} className="sr-only">
                Cobranças registradas no período selecionado
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Empresa e plano
                  </th>
                  <th scope="col" role="columnheader">
                    Competência
                  </th>
                  <th scope="col" role="columnheader">
                    Vencimento
                  </th>
                  <th scope="col" role="columnheader">
                    Valor
                  </th>
                  <th scope="col" role="columnheader">
                    Situação
                  </th>
                  <th scope="col" role="columnheader">
                    Recebimento
                  </th>
                  <th scope="col" role="columnheader">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {items.map((charge) => (
                  <ChargeTableRow
                    key={charge.id}
                    charge={charge}
                    onOpen={() =>
                      setSelectedCharge({
                        organizationId: charge.organizationId,
                        chargeId: charge.id,
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={chargesQuery.data.pageSize}
            total={chargesQuery.data.total}
            onPageChange={setPage}
            label="Páginas de cobranças"
            pending={chargesQuery.loading}
          />
        </>
      )}
    </section>
  );
}

function ChargeTableRow({
  charge,
  onOpen,
}: {
  charge: CommercialBillingCharge;
  onOpen: () => void;
}) {
  const badge = statusMeta[charge.status];
  return (
    <tr role="row">
      <th scope="row" role="rowheader">
        <strong>{charge.organizationName}</strong>
        <span className="commercial-billing-subline">
          {charge.plan.name} · v{charge.planVersion.ordinal} · Revisão #
          {charge.contractRevisionOrdinal}
        </span>
      </th>
      <td role="cell" data-label="Competência" className="commercial-billing-num">
        {charge.competence}
      </td>
      <td role="cell" data-label="Vencimento" className="commercial-billing-num">
        {commercialDate(charge.dueOn)}
      </td>
      <td role="cell" data-label="Valor" className="commercial-billing-num">
        <strong>{formatBrlCents(charge.amountCents)}</strong>
      </td>
      <td role="cell" data-label="Situação">
        <StatusBadge label={badge.label} tone={badge.tone} />
      </td>
      <td role="cell" data-label="Recebimento">
        {charge.paidOn ? (
          <>
            <span className="commercial-billing-num">{commercialDate(charge.paidOn)}</span>
            {charge.receiptReference && (
              <span className="commercial-billing-subline">{charge.receiptReference}</span>
            )}
          </>
        ) : (
          <span className="muted">Pendente</span>
        )}
      </td>
      <td role="cell" data-label="Ações">
        <Button
          type="button"
          variant="outline"
          aria-label={`Detalhes da cobrança ${charge.competence} de ${charge.organizationName}`}
          onClick={onOpen}
        >
          Detalhes
        </Button>
      </td>
    </tr>
  );
}

function BillingChargeCreateForm({
  contracts,
  defaultOrganizationId,
  onCancel,
  onCreated,
  onReload,
  ...events
}: CommercialAccessEvents & {
  contracts: CommercialBillingContractRef[];
  defaultOrganizationId: string;
  onCancel: () => void;
  onCreated: (charge: CommercialBillingChargeDetail) => void;
  onReload: () => void;
}) {
  const initialOrg =
    contracts.find((item) => item.organizationId === defaultOrganizationId)?.organizationId ??
    (contracts.length === 1 ? contracts[0]!.organizationId : '');
  const [organizationId, setOrganizationId] = useState(initialOrg);
  const selectedContract = contracts.find((item) => item.organizationId === organizationId);
  const eligibleRevisions = selectedContract?.contract.revisions ?? [];
  const [contractRevisionId, setContractRevisionId] = useState(eligibleRevisions.at(-1)?.id ?? '');
  const [competence, setCompetence] = useState(currentCompetenceInSaoPaulo());
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(createKey);
  const mutation = useCommercialAction(events);
  const headingId = useId();
  const orgSelectId = useId();
  const revSelectId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  function handleOrganizationChange(nextOrgId: string) {
    setOrganizationId(nextOrgId);
    const nextContract = contracts.find((item) => item.organizationId === nextOrgId);
    setContractRevisionId(nextContract?.contract.revisions.at(-1)?.id ?? '');
  }

  const parsedAmount = parseBrlToCents(amount);
  const competenceValid = /^20\d{2}-(0[1-9]|1[0-2])$/.test(competence.trim());
  const paidOnFuture = Boolean(paidOn && paidOn > todayInSaoPaulo());
  const amountInvalid = Boolean(touched.amount) && parsedAmount === null;
  const competenceInvalid = Boolean(touched.competence) && !competenceValid;
  const paidOnInvalid = Boolean(touched.paidOn) && paidOnFuture;
  const receiptInvalid =
    Boolean(touched.receiptReference) && !paidOn && Boolean(receiptReference.trim());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({
      organizationId: true,
      contractRevisionId: true,
      competence: true,
      amount: true,
      dueOn: true,
      paidOn: true,
      receiptReference: true,
      reason: true,
    });
    if (!selectedContract) {
      mutation.setError('Selecione uma empresa com contrato cadastrado.');
      return;
    }
    if (paidOnFuture) {
      mutation.setError('A data de recebimento não pode ser posterior à data atual.');
      return;
    }
    const effectiveRevisionId = contractRevisionId || eligibleRevisions.at(-1)?.id || '';
    const parsed = commercialCreateBillingChargeSchema.safeParse({
      contractRevisionId: effectiveRevisionId,
      competence: competence.trim(),
      amountCents: parsedAmount ?? undefined,
      dueOn,
      paidOn: paidOn || null,
      receiptReference: receiptReference.trim() || null,
      reason,
      idempotencyKey,
    });
    if (!parsed.success) {
      mutation.setError(
        parsed.error.issues[0]?.message ??
          'Confira contrato, competência (AAAA-MM), valor, vencimento e motivo.',
      );
      return;
    }
    const created = await mutation.run(async (signal) => {
      const result = await request(
        `${billingPath}/clients/${selectedContract.organizationId}/contracts/${selectedContract.contract.id}/charges`,
        commercialBillingChargeDetailSchema,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(parsed.data),
          signal,
        },
      );
      if (result.organizationId !== selectedContract.organizationId) throw new RequestError(502);
      return result;
    });
    if (created) onCreated(created);
  }

  return (
    <section className="surface commercial-record" aria-labelledby={headingId}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        Nova cobrança manual
      </h3>
      <form className="platform-editor" onSubmit={(event) => void submit(event)} noValidate>
        <div className="commercial-fields">
          <div className="commercial-field">
            <label htmlFor={orgSelectId}>Empresa e contrato</label>
            <select
              id={orgSelectId}
              name="organizationId"
              required
              aria-invalid={Boolean(touched.organizationId) && !organizationId ? 'true' : 'false'}
              value={organizationId}
              onBlur={() => setTouched((prev) => ({ ...prev, organizationId: true }))}
              onChange={(event) => handleOrganizationChange(event.target.value)}
            >
              <option value="">Selecione a empresa</option>
              {contracts.map((item) => (
                <option key={item.organizationId} value={item.organizationId}>
                  {item.organizationName}
                </option>
              ))}
            </select>
          </div>
          <div className="commercial-field">
            <label htmlFor={revSelectId}>Termo contratual e versão do plano</label>
            <select
              id={revSelectId}
              name="contractRevisionId"
              required
              disabled={eligibleRevisions.length === 0}
              aria-invalid={
                Boolean(touched.contractRevisionId) && !contractRevisionId ? 'true' : 'false'
              }
              value={contractRevisionId}
              onBlur={() => setTouched((prev) => ({ ...prev, contractRevisionId: true }))}
              onChange={(event) => setContractRevisionId(event.target.value)}
            >
              <option value="">Selecione o termo</option>
              {eligibleRevisions.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  Revisão #{rev.ordinal} ({contractRevisionKinds[rev.kind]}) · {rev.plan.name} v
                  {rev.planVersion.ordinal} · {commercialDate(rev.startsOn)} a{' '}
                  {commercialDate(rev.endsOn)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedContract && contractRevisionId && (
          <p className="muted">
            {(() => {
              const rev = eligibleRevisions.find((item) => item.id === contractRevisionId);
              if (!rev) return null;
              return `Referência do plano contratado: ${rev.plan.name} v${rev.planVersion.ordinal} (${commercialPrice(rev.planVersion)}).`;
            })()}
          </p>
        )}

        <div className="commercial-fields">
          <label>
            Competência (AAAA-MM)
            <input
              name="competence"
              type="text"
              inputMode="numeric"
              required
              maxLength={7}
              placeholder="2026-11"
              pattern="20[0-9]{2}-(0[1-9]|1[0-2])"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={competenceInvalid ? 'true' : 'false'}
              value={competence}
              onBlur={() => setTouched((prev) => ({ ...prev, competence: true }))}
              onChange={(event) => setCompetence(event.target.value)}
            />
          </label>
          <label>
            Valor em reais
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              required
              placeholder="1.290,00"
              maxLength={18}
              autoComplete="off"
              aria-invalid={amountInvalid ? 'true' : 'false'}
              value={amount}
              onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            Vencimento
            <input
              name="dueOn"
              type="date"
              required
              aria-invalid={Boolean(touched.dueOn) && !dueOn ? 'true' : 'false'}
              value={dueOn}
              onBlur={() => setTouched((prev) => ({ ...prev, dueOn: true }))}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </label>
        </div>

        <fieldset className="commercial-billing-fieldset">
          <legend>Recebimento imediato (opcional)</legend>
          <div className="commercial-fields">
            <label>
              Data de recebimento (opcional)
              <input
                name="paidOn"
                type="date"
                max={todayInSaoPaulo()}
                aria-invalid={paidOnInvalid ? 'true' : 'false'}
                value={paidOn}
                onBlur={() => setTouched((prev) => ({ ...prev, paidOn: true }))}
                onChange={(event) => {
                  const next = event.target.value;
                  setPaidOn(next);
                  if (!next) setReceiptReference('');
                }}
              />
            </label>
            <label>
              Referência do comprovante (opcional)
              <input
                name="receiptReference"
                type="text"
                maxLength={240}
                placeholder="Ex.: PIX-E2E-001 ou protocolo bancário"
                disabled={!paidOn}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={receiptInvalid ? 'true' : 'false'}
                value={receiptReference}
                onBlur={() => setTouched((prev) => ({ ...prev, receiptReference: true }))}
                onChange={(event) => setReceiptReference(event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <label>
          Motivo do registro
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            rows={2}
            aria-invalid={Boolean(touched.reason) && reason.trim().length < 3 ? 'true' : 'false'}
            value={reason}
            onBlur={() => setTouched((prev) => ({ ...prev, reason: true }))}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {mutation.error && (
          <StatusMessage
            tone="error"
            action={
              mutation.conflict ? (
                <Button
                  type="button"
                  onClick={() => {
                    mutation.resetConflict();
                    setIdempotencyKey(createKey());
                    onReload();
                  }}
                >
                  Atualizar cobranças
                </Button>
              ) : undefined
            }
          >
            {mutation.error}
          </StatusMessage>
        )}

        <div className="platform-areas">
          <Button type="submit" disabled={mutation.pending || mutation.conflict}>
            {mutation.pending ? 'Salvando…' : 'Salvar cobrança'}
          </Button>
          <Button type="button" variant="outline" disabled={mutation.pending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}

function BillingChargeDetailPanel({
  organizationId,
  chargeId,
  contractRef,
  canEdit,
  revision,
  onChanged,
  ...events
}: CommercialAccessEvents & {
  organizationId: string;
  chargeId: string;
  contractRef: CommercialBillingContractRef | undefined;
  canEdit: boolean;
  revision: number;
  onChanged: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'none' | 'payment' | 'correction'>('none');
  const [notice, setNotice] = useState('');
  const [override, setOverride] = useState<CommercialBillingChargeDetail | null>(null);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const detailPath = `${billingPath}/clients/${organizationId}/charges/${chargeId}`;
  const query = usePrivateQuery(
    detailPath,
    commercialBillingChargeDetailSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    organizationId,
  );

  const reload = () => {
    setOverride(null);
    setAttempt((value) => value + 1);
  };

  const charge =
    override && override.id === chargeId && (!query.data || override.version > query.data.version)
      ? override
      : query.data;
  const loadedId = charge?.id;

  useEffect(() => {
    if (loadedId) headingRef.current?.focus();
  }, [loadedId]);

  if (query.error) {
    return (
      <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar cobrança</Button>}>
        {query.error}
      </StatusMessage>
    );
  }
  if (!charge) {
    return <StatusMessage tone="loading">Carregando detalhes da cobrança…</StatusMessage>;
  }

  const badge = statusMeta[charge.status];
  const history = [...charge.revisions].sort((left, right) => right.ordinal - left.ordinal);

  function handleSaved(updated: CommercialBillingChargeDetail, message: string) {
    setOverride(updated);
    setMode('none');
    setNotice(message);
    onChanged();
    headingRef.current?.focus();
  }

  return (
    <section className="surface commercial-record" aria-labelledby={headingId}>
      <div className="platform-heading">
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {charge.organizationName} · Competência {charge.competence}
          </h2>
          <p className="muted">
            {charge.plan.name} · versão {charge.planVersion.ordinal} · Revisão contratual #
            {charge.contractRevisionOrdinal} · versão da cobrança {charge.version}
          </p>
        </div>
        <div className="platform-areas">
          <StatusBadge label={badge.label} tone={badge.tone} />
          <Button type="button" variant="outline" onClick={reload}>
            Atualizar cobrança
          </Button>
        </div>
      </div>

      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}

      <dl className="commercial-facts">
        <div>
          <dt>Valor conferido</dt>
          <dd className="commercial-billing-num">{formatBrlCents(charge.amountCents)}</dd>
        </div>
        <div>
          <dt>Vencimento</dt>
          <dd className="commercial-billing-num">{commercialDate(charge.dueOn)}</dd>
        </div>
        <div>
          <dt>Recebimento</dt>
          <dd className="commercial-billing-num">
            {charge.paidOn ? commercialDate(charge.paidOn) : 'Ainda não recebido'}
          </dd>
        </div>
        <div>
          <dt>Referência do comprovante</dt>
          <dd>{charge.receiptReference ?? 'Não informada'}</dd>
        </div>
        <div>
          <dt>Plano de referência</dt>
          <dd>
            {charge.plan.name} v{charge.planVersion.ordinal} · {commercialPrice(charge.planVersion)}
          </dd>
        </div>
      </dl>

      {canEdit && (
        <div className="platform-areas">
          {charge.paidOn === null && (
            <Button
              type="button"
              onClick={() => {
                setNotice('');
                setMode(mode === 'payment' ? 'none' : 'payment');
              }}
            >
              Confirmar recebimento
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setNotice('');
              setMode(mode === 'correction' ? 'none' : 'correction');
            }}
          >
            Registrar correção
          </Button>
        </div>
      )}

      {canEdit && mode === 'payment' && charge.paidOn === null && (
        <PaymentConfirmForm
          key={`pay-${charge.id}`}
          charge={charge}
          onCancel={() => setMode('none')}
          onReload={reload}
          onSaved={(updated) =>
            handleSaved(updated, 'Recebimento confirmado e registrado no histórico.')
          }
          {...events}
        />
      )}

      {canEdit && mode === 'correction' && (
        <ChargeCorrectionForm
          key={`corr-${charge.id}`}
          charge={charge}
          contractRef={contractRef}
          onCancel={() => setMode('none')}
          onReload={reload}
          onSaved={(updated) =>
            handleSaved(updated, 'Correção salva. As revisões anteriores foram preservadas.')
          }
          {...events}
        />
      )}

      <div className="commercial-section">
        <h3>Histórico da cobrança ({history.length})</h3>
        <ol className="commercial-history" aria-label="Histórico da cobrança">
          {history.map((item) => (
            <li key={item.id}>
              <div className="commercial-revision">
                <h4>
                  Revisão {item.ordinal} · {revisionKindLabels[item.kind]}
                </h4>
                <p className="muted">
                  {commercialDateTime(item.createdAt)} · por {item.actor.name}
                </p>
                <p className="commercial-billing-num">
                  Competência {item.competence} · {formatBrlCents(item.amountCents)} · vencimento{' '}
                  {commercialDate(item.dueOn)} ·{' '}
                  {item.paidOn ? `recebido em ${commercialDate(item.paidOn)}` : 'sem recebimento'}
                  {item.receiptReference ? ` · comprovante ${item.receiptReference}` : ''}
                </p>
                <p className="muted">
                  Plano {item.plan.name} v{item.planVersion.ordinal} · termo contratual #
                  {item.contractRevisionOrdinal}
                </p>
                <p>
                  <strong>Motivo</strong> · {item.reason}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PaymentConfirmForm({
  charge,
  onCancel,
  onReload,
  onSaved,
  ...events
}: CommercialAccessEvents & {
  charge: CommercialBillingChargeDetail;
  onCancel: () => void;
  onReload: () => void;
  onSaved: (updated: CommercialBillingChargeDetail) => void;
}) {
  const [paidOn, setPaidOn] = useState(todayInSaoPaulo());
  const [receiptReference, setReceiptReference] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(createKey);
  const [paidOnTouched, setPaidOnTouched] = useState(false);
  const mutation = useCommercialAction(events);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const paidOnFuture = Boolean(paidOn && paidOn > todayInSaoPaulo());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaidOnTouched(true);
    if (paidOnFuture) {
      mutation.setError('A data de recebimento não pode ser posterior à data atual.');
      return;
    }
    const parsed = commercialConfirmBillingPaymentSchema.safeParse({
      expectedVersion: charge.version,
      paidOn,
      receiptReference: receiptReference.trim() || null,
      reason,
      idempotencyKey,
    });
    if (!parsed.success) {
      mutation.setError(
        parsed.error.issues[0]?.message ??
          'Confira a data de recebimento e o motivo da confirmação.',
      );
      return;
    }
    const updated = await mutation.run(async (signal) => {
      const result = await request(
        `${billingPath}/clients/${charge.organizationId}/charges/${charge.id}/payment`,
        commercialBillingChargeDetailSchema,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(parsed.data),
          signal,
        },
      );
      if (result.id !== charge.id) throw new RequestError(502);
      return result;
    });
    if (updated) onSaved(updated);
  }

  return (
    <form
      className="platform-editor commercial-editor"
      aria-labelledby={headingId}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        Confirmar recebimento
      </h3>
      <div className="commercial-fields">
        <label>
          Data de recebimento
          <input
            type="date"
            required
            max={todayInSaoPaulo()}
            aria-invalid={paidOnTouched && (!paidOn || paidOnFuture) ? 'true' : 'false'}
            value={paidOn}
            onBlur={() => setPaidOnTouched(true)}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </label>
        <label>
          Referência do comprovante (opcional)
          <input
            type="text"
            maxLength={240}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Ex.: PIX-E2E-001 ou número do comprovante"
            value={receiptReference}
            onChange={(event) => setReceiptReference(event.target.value)}
          />
        </label>
      </div>
      <label>
        Motivo da confirmação
        <textarea
          required
          minLength={3}
          maxLength={1000}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {mutation.error && (
        <StatusMessage
          tone="error"
          action={
            mutation.conflict ? (
              <Button
                type="button"
                onClick={() => {
                  mutation.resetConflict();
                  setIdempotencyKey(createKey());
                  onReload();
                }}
              >
                Atualizar cobrança
              </Button>
            ) : undefined
          }
        >
          {mutation.error}
        </StatusMessage>
      )}
      <div className="platform-areas">
        <Button type="submit" disabled={mutation.pending || mutation.conflict}>
          {mutation.pending ? 'Confirmando…' : 'Salvar recebimento'}
        </Button>
        <Button type="button" variant="outline" disabled={mutation.pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ChargeCorrectionForm({
  charge,
  contractRef,
  onCancel,
  onReload,
  onSaved,
  ...events
}: CommercialAccessEvents & {
  charge: CommercialBillingChargeDetail;
  contractRef: CommercialBillingContractRef | undefined;
  onCancel: () => void;
  onReload: () => void;
  onSaved: (updated: CommercialBillingChargeDetail) => void;
}) {
  const revisions = contractRef?.contract.revisions ?? [
    {
      id: charge.contractRevisionId,
      ordinal: charge.contractRevisionOrdinal,
      kind: 'INITIAL' as const,
      startsOn: charge.planVersion.effectiveOn,
      endsOn: charge.dueOn,
      plan: charge.plan,
      planVersion: charge.planVersion,
    },
  ];
  const [expectedVersion, setExpectedVersion] = useState(charge.version);
  const [contractRevisionId, setContractRevisionId] = useState(charge.contractRevisionId);
  const [competence, setCompetence] = useState(charge.competence);
  const [amount, setAmount] = useState(formatBrlInput(charge.amountCents));
  const [dueOn, setDueOn] = useState(charge.dueOn);
  const [paidOn, setPaidOn] = useState(charge.paidOn ?? '');
  const [receiptReference, setReceiptReference] = useState(charge.receiptReference ?? '');
  const [reason, setReason] = useState('');
  const [paidOnTouched, setPaidOnTouched] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createKey);
  const mutation = useCommercialAction(events);
  const headingId = useId();
  const revSelectId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const paidOnFuture = Boolean(paidOn && paidOn > todayInSaoPaulo());
  const versionAdvanced = charge.version > expectedVersion;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaidOnTouched(true);
    if (paidOnFuture) {
      mutation.setError('A data de recebimento não pode ser posterior à data atual.');
      return;
    }
    const parsedCents = parseBrlToCents(amount);
    const normalizedPaidOn = paidOn || null;
    const normalizedReceipt = normalizedPaidOn ? receiptReference.trim() || null : null;
    const trimmedCompetence = competence.trim();
    const unchanged =
      contractRevisionId === charge.contractRevisionId &&
      trimmedCompetence === charge.competence &&
      parsedCents === charge.amountCents &&
      dueOn === charge.dueOn &&
      normalizedPaidOn === charge.paidOn &&
      normalizedReceipt === charge.receiptReference;
    if (unchanged) {
      mutation.setError('Informe ao menos uma alteração para registrar a correção.');
      return;
    }
    const parsed = commercialCorrectBillingChargeSchema.safeParse({
      expectedVersion,
      contractRevisionId,
      competence: trimmedCompetence,
      amountCents: parsedCents ?? undefined,
      dueOn,
      paidOn: normalizedPaidOn,
      receiptReference: normalizedReceipt,
      reason,
      idempotencyKey,
    });
    if (!parsed.success) {
      mutation.setError(
        parsed.error.issues[0]?.message ?? 'Confira os campos corrigidos e o motivo da correção.',
      );
      return;
    }
    const updated = await mutation.run(async (signal) => {
      const result = await request(
        `${billingPath}/clients/${charge.organizationId}/charges/${charge.id}/corrections`,
        commercialBillingChargeDetailSchema,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(parsed.data),
          signal,
        },
      );
      if (result.id !== charge.id) throw new RequestError(502);
      return result;
    });
    if (updated) onSaved(updated);
  }

  return (
    <form
      className="platform-editor commercial-editor"
      aria-labelledby={headingId}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        Registrar correção com histórico
      </h3>
      <p className="muted">
        A revisão anterior permanece preservada na trilha (versão em edição {expectedVersion}).
        Limpe a data de recebimento para estornar uma baixa registrada por engano.
      </p>
      {versionAdvanced && (
        <StatusMessage
          tone="warning"
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setExpectedVersion(charge.version);
                setIdempotencyKey(createKey());
                mutation.resetConflict();
              }}
            >
              Adotar versão {charge.version} mantendo rascunho
            </Button>
          }
        >
          A cobrança avançou para a versão {charge.version} enquanto você editava. Seu rascunho foi
          preservado; revise o histórico acima antes de confirmar.
        </StatusMessage>
      )}
      <div className="commercial-fields">
        <div className="commercial-field">
          <label htmlFor={revSelectId}>Termo contratual</label>
          <select
            id={revSelectId}
            value={contractRevisionId}
            onChange={(event) => setContractRevisionId(event.target.value)}
          >
            {revisions.map((rev) => (
              <option key={rev.id} value={rev.id}>
                Revisão #{rev.ordinal} · {rev.plan.name} v{rev.planVersion.ordinal}
              </option>
            ))}
          </select>
        </div>
        <label>
          Competência (AAAA-MM)
          <input
            type="text"
            inputMode="numeric"
            required
            maxLength={7}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={competence}
            onChange={(event) => setCompetence(event.target.value)}
          />
        </label>
        <label>
          Valor em reais
          <input
            type="text"
            inputMode="decimal"
            required
            maxLength={18}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Vencimento
          <input
            type="date"
            required
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
        <label>
          Data de recebimento (opcional)
          <input
            type="date"
            max={todayInSaoPaulo()}
            aria-invalid={paidOnTouched && paidOnFuture ? 'true' : 'false'}
            value={paidOn}
            onBlur={() => setPaidOnTouched(true)}
            onChange={(event) => {
              const next = event.target.value;
              setPaidOn(next);
              if (!next) setReceiptReference('');
            }}
          />
        </label>
        <label>
          Referência do comprovante (opcional)
          <input
            type="text"
            maxLength={240}
            disabled={!paidOn}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={receiptReference}
            onChange={(event) => setReceiptReference(event.target.value)}
          />
        </label>
      </div>
      <label>
        Motivo da correção
        <textarea
          required
          minLength={3}
          maxLength={1000}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {mutation.error && (
        <StatusMessage
          tone="error"
          action={
            mutation.conflict ? (
              <Button
                type="button"
                onClick={() => {
                  mutation.resetConflict();
                  setIdempotencyKey(createKey());
                  onReload();
                }}
              >
                Atualizar cobrança
              </Button>
            ) : undefined
          }
        >
          {mutation.error}
        </StatusMessage>
      )}
      <div className="platform-areas">
        <Button type="submit" disabled={mutation.pending || mutation.conflict || versionAdvanced}>
          {mutation.pending ? 'Salvando…' : 'Salvar correção'}
        </Button>
        <Button type="button" variant="outline" disabled={mutation.pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
