import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  commercialClientListSchema,
  commercialClientSchema,
  commercialUpdateClientSchema,
  platformQuerySchema,
  type CommercialClient,
  type CommercialPlan,
} from '@renr/contracts';
import { request, RequestError } from '../../../lib/api';
import { Button } from '../../ui/button';
import { Pagination } from '../../ui/pagination';
import { StatusMessage } from '../../ui/status-message';
import { usePrivateQuery } from '../usePrivateQuery';
import { CommercialContract } from './CommercialContract';
import {
  commercialClassifications,
  commercialDate,
  commercialFiscalStates,
  commercialPath,
  useCommercialAction,
  type CommercialAccessEvents,
} from './commercial-ui';

const emptyFilters = { search: '', classification: '', fiscalState: '' };
const PAGE_SIZE = 25;

function ClientClassification({ client }: { client: CommercialClient }) {
  return (
    <p className="muted">
      {commercialClassifications[client.clientClassification]} ·{' '}
      {commercialFiscalStates[client.fiscalState]} · {client.isActive ? 'Ativo' : 'Inativo'}
    </p>
  );
}

export function CommercialClients({
  canEdit,
  canReadBilling = false,
  canReadContractAccess = false,
  initialOrganizationId = null,
  plans,
  plansError,
  revision,
  onReloadPlans,
  onOpenBilling,
  onOpenContractAccess,
  ...events
}: CommercialAccessEvents & {
  canEdit: boolean;
  canReadBilling?: boolean;
  canReadContractAccess?: boolean;
  initialOrganizationId?: string | null;
  plans: CommercialPlan[] | undefined;
  plansError: string;
  revision: number;
  onReloadPlans: () => void;
  onOpenBilling?: (organizationId: string) => void;
  onOpenContractAccess?: (organizationId: string) => void;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialOrganizationId);
  const [filterError, setFilterError] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
  const clients = usePrivateQuery(
    `${commercialPath}/clients?${query}`,
    commercialClientListSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );
  const selected = clients.data?.items.find((item) => item.organizationId === selectedId);
  const reload = () => setAttempt((value) => value + 1);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filtered = { ...draft, search: draft.search.trim() };
    const nonEmptyFields = Object.fromEntries(
      Object.entries(filtered).filter(([, value]) => value),
    );
    if (
      !platformQuerySchema.safeParse({ ...nonEmptyFields, page: '1', pageSize: String(PAGE_SIZE) })
        .success
    ) {
      setFilterError('Confira os filtros da consulta.');
      return;
    }
    setFilterError('');
    setFilters(filtered);
    setSelectedId(null);
    setPage(1);
  }

  function closeDetails() {
    setSelectedId(null);
    window.requestAnimationFrame(() => resultHeading.current?.focus());
  }

  if (selected)
    return (
      <>
        <div>
          <Button variant="outline" onClick={closeDetails}>
            Voltar aos clientes
          </Button>
        </div>
        <ClientDetails
          key={selected.organizationId}
          client={selected}
          canEdit={canEdit}
          canReadBilling={canReadBilling}
          canReadContractAccess={canReadContractAccess}
          plans={plans}
          plansError={plansError}
          revision={revision}
          onReloadPlans={onReloadPlans}
          onClientChanged={reload}
          onOpenBilling={onOpenBilling}
          onOpenContractAccess={onOpenContractAccess}
          {...events}
        />
      </>
    );

  return (
    <section className="commercial-section" aria-labelledby="commercial-clients-heading">
      <div>
        <h2 id="commercial-clients-heading" ref={resultHeading} tabIndex={-1}>
          Clientes e contratos
        </h2>
        <p className="muted">
          Encontre uma empresa para consultar o cadastro comercial e o contrato.
        </p>
      </div>
      <form aria-label="Filtrar clientes" className="platform-filters" onSubmit={apply}>
        <label>
          Empresa ou CNPJ
          <input
            maxLength={160}
            value={draft.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <label>
          Classificação
          <select
            value={draft.classification}
            onChange={(event) => setDraft({ ...draft, classification: event.target.value })}
          >
            <option value="">Todas as classificações</option>
            {Object.entries(commercialClassifications).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Situação fiscal
          <select
            value={draft.fiscalState}
            onChange={(event) => setDraft({ ...draft, fiscalState: event.target.value })}
          >
            <option value="">Todas as situações</option>
            {Object.entries(commercialFiscalStates).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Aplicar filtros</Button>
      </form>
      {filterError && <StatusMessage tone="error">{filterError}</StatusMessage>}
      {clients.error ? (
        <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar clientes</Button>}>
          {clients.error}
        </StatusMessage>
      ) : !clients.data ? (
        <StatusMessage tone="loading">Buscando clientes…</StatusMessage>
      ) : clients.data.items.length ? (
        <>
          <ul className="platform-records" aria-label="Resultados de clientes">
            {clients.data.items.map((value) => (
              <li key={value.organizationId}>
                <div>
                  <h3>{value.name}</h3>
                  <ClientClassification client={value} />
                  <p>
                    {value.activePlan
                      ? `Plano vigente: ${value.activePlan.name} · v${value.activePlan.ordinal}`
                      : 'Sem plano vigente'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`Abrir cadastro comercial de ${value.name}`}
                  onClick={() => setSelectedId(value.organizationId)}
                >
                  Abrir cadastro
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={clients.data.pageSize}
            total={clients.data.total}
            onPageChange={setPage}
            label="Páginas de clientes"
            pending={clients.loading}
          />
        </>
      ) : (
        <StatusMessage>Nenhum cliente corresponde aos filtros.</StatusMessage>
      )}
    </section>
  );
}

function ClientDetails({
  client,
  canEdit,
  canReadBilling,
  canReadContractAccess,
  plans,
  plansError,
  revision,
  onClientChanged,
  onReloadPlans,
  onOpenBilling,
  onOpenContractAccess,
  ...events
}: CommercialAccessEvents & {
  client: CommercialClient;
  canEdit: boolean;
  canReadBilling: boolean;
  canReadContractAccess: boolean;
  plans: CommercialPlan[] | undefined;
  plansError: string;
  revision: number;
  onClientChanged: () => void;
  onReloadPlans: () => void;
  onOpenBilling?: (organizationId: string) => void;
  onOpenContractAccess?: (organizationId: string) => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => heading.current?.focus(), []);
  const close = () => {
    setEditing(false);
    editTrigger.current?.focus();
  };

  return (
    <>
      <section className="surface commercial-record" aria-labelledby={headingId}>
        <div className="platform-heading">
          <div>
            <h2 id={headingId} tabIndex={-1} ref={heading}>
              {client.name}
            </h2>
            <ClientClassification client={client} />
          </div>
          <div className="platform-areas">
            {canReadBilling && onOpenBilling && (
              <Button variant="outline" onClick={() => onOpenBilling(client.organizationId)}>
                Abrir cobranças da empresa
              </Button>
            )}
            {canReadContractAccess && onOpenContractAccess && (
              <Button variant="outline" onClick={() => onOpenContractAccess(client.organizationId)}>
                Abrir acesso contratual
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                ref={editTrigger}
                onClick={() => {
                  setNotice('');
                  setEditing(true);
                }}
              >
                Editar dados comerciais
              </Button>
            )}
          </div>
        </div>
        {client.fiscalIdentifier && <p>CNPJ {client.fiscalIdentifier}</p>}
        <dl className="commercial-facts">
          <div>
            <dt>Responsável comercial</dt>
            <dd>{client.contactName || 'Não informado'}</dd>
          </div>
          <div>
            <dt>E-mail comercial</dt>
            <dd>{client.contactEmail || 'Não informado'}</dd>
          </div>
          <div>
            <dt>Data de adesão</dt>
            <dd>{commercialDate(client.adoptedOn)}</dd>
          </div>
          <div>
            <dt>Plano contratado vigente</dt>
            <dd>
              {client.activePlan
                ? `${client.activePlan.name} · versão ${client.activePlan.ordinal}`
                : 'Sem plano vigente'}
            </dd>
          </div>
        </dl>
        {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
        {editing && canEdit && (
          <ClientEditor
            client={client}
            onCancel={close}
            onReload={() => {
              close();
              onClientChanged();
            }}
            onSaved={() => {
              close();
              onClientChanged();
              setNotice('Dados comerciais atualizados.');
            }}
            {...events}
          />
        )}
      </section>
      <CommercialContract
        organizationId={client.organizationId}
        canEdit={canEdit}
        plans={plans}
        plansError={plansError}
        revision={revision}
        onReloadPlans={onReloadPlans}
        onClientChanged={onClientChanged}
        {...events}
      />
    </>
  );
}

function ClientEditor({
  client,
  onSaved,
  onReload,
  onCancel,
  ...events
}: CommercialAccessEvents & {
  client: CommercialClient;
  onSaved: () => void;
  onReload: () => void;
  onCancel: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [expectedVersion] = useState(client.version);
  const [contactName, setContactName] = useState(client.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(client.contactEmail ?? '');
  const [adoptedOn, setAdoptedOn] = useState(client.adoptedOn ?? '');
  const [reason, setReason] = useState('');
  const mutation = useCommercialAction(events);
  useEffect(() => heading.current?.focus(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = commercialUpdateClientSchema.safeParse({
      expectedVersion,
      contactName: contactName.trim() || null,
      contactEmail: contactEmail.trim() || null,
      adoptedOn: adoptedOn || null,
      reason,
    });
    if (!parsed.success) {
      mutation.setError('Confira o responsável, o e-mail e o motivo do registro.');
      return;
    }
    const result = await mutation.run(async (signal) => {
      const saved = await request(
        `${commercialPath}/clients/${client.organizationId}`,
        commercialClientSchema,
        {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
          signal,
        },
      );
      if (saved.organizationId !== client.organizationId) throw new RequestError(502);
      return saved;
    });
    if (result) onSaved();
  }

  return (
    <form
      className="platform-editor commercial-editor"
      aria-labelledby={headingId}
      onSubmit={(event) => void save(event)}
    >
      <h3 id={headingId} ref={heading} tabIndex={-1}>
        Dados comerciais
      </h3>
      <div className="commercial-fields">
        <label>
          Responsável comercial
          <input
            maxLength={160}
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
        </label>
        <label>
          E-mail comercial
          <input
            type="email"
            maxLength={254}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
        </label>
        <label>
          Data de adesão
          <input
            type="date"
            value={adoptedOn}
            onChange={(event) => setAdoptedOn(event.target.value)}
          />
        </label>
      </div>
      <label>
        Motivo do registro
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
            mutation.conflict ? <Button onClick={onReload}>Atualizar cadastro</Button> : undefined
          }
        >
          {mutation.error}
        </StatusMessage>
      )}
      <div className="platform-areas">
        <Button type="submit" disabled={mutation.pending || mutation.conflict}>
          {mutation.pending ? 'Salvando…' : 'Salvar cadastro comercial'}
        </Button>
        <Button variant="outline" disabled={mutation.pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
