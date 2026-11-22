import { useId, useState, type FormEvent } from 'react';
import {
  commercialDashboardQuerySchema,
  commercialDashboardSchema,
  type CommercialAlert,
  type CommercialAlertDomain,
  type CommercialAlertSeverity,
  type CommercialBillingStatus,
  type CommercialDashboard,
} from '@renr/contracts';
import { Button } from '../../ui/button';
import { StatusBadge } from '../../ui/status-badge';
import { StatusMessage } from '../../ui/status-message';
import { usePrivateQuery } from '../usePrivateQuery';
import {
  commercialDate,
  commercialDateTime,
  commercialPath,
  formatBrlCents,
  type CommercialAccessEvents,
} from './commercial-ui';

const dashboardPath = `${commercialPath}/dashboard`;

const severityMeta: Record<
  CommercialAlertSeverity,
  { label: string; tone: 'error' | 'warning' | 'info' }
> = {
  high: { label: 'Prioridade alta', tone: 'error' },
  medium: { label: 'Atenção', tone: 'warning' },
  info: { label: 'Informativo', tone: 'info' },
};

const domainLabels: Record<CommercialAlertDomain, string> = {
  catalog: 'Catálogo fiscal',
  contracts: 'Contratos',
  billing: 'Financeiro',
  access: 'Acesso contratual',
  support: 'Suporte',
};

type DashboardFilters = {
  competenceFrom: string;
  competenceTo: string;
  renewalWindowDays: string;
};

const defaultFilters: DashboardFilters = {
  competenceFrom: '',
  competenceTo: '',
  renewalWindowDays: '30',
};

function buildDashboardUrl(filters: DashboardFilters) {
  const params = new URLSearchParams();
  if (filters.competenceFrom) params.set('competenceFrom', filters.competenceFrom);
  if (filters.competenceTo) params.set('competenceTo', filters.competenceTo);
  if (filters.renewalWindowDays) params.set('renewalWindowDays', filters.renewalWindowDays);
  const query = params.toString();
  return query ? `${dashboardPath}?${query}` : dashboardPath;
}

export function CommercialDashboard({
  revision,
  onOpenClients,
  onOpenBilling,
  onOpenAccess,
  ...events
}: CommercialAccessEvents & {
  revision: number;
  onOpenClients: (organizationId?: string | null) => void;
  onOpenBilling: (options?: {
    organizationId?: string | null;
    status?: '' | CommercialBillingStatus;
    competenceFrom?: string;
    competenceTo?: string;
  }) => void;
  onOpenAccess: (organizationId?: string | null) => void;
}) {
  const idPrefix = useId();
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);
  const [draft, setDraft] = useState<DashboardFilters>(defaultFilters);
  const [filterError, setFilterError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const dashboard = usePrivateQuery(
    buildDashboardUrl(filters),
    commercialDashboardSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
    undefined,
    true,
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = {
      ...(draft.competenceFrom ? { competenceFrom: draft.competenceFrom } : {}),
      ...(draft.competenceTo ? { competenceTo: draft.competenceTo } : {}),
      renewalWindowDays: draft.renewalWindowDays,
    };
    const parsed = commercialDashboardQuerySchema.safeParse(raw);
    if (!parsed.success) {
      setFilterError(
        parsed.error.issues[0]?.message ??
          'Confira o período de competência (AAAA-MM) e a janela de vencimento.',
      );
      return;
    }
    setFilterError('');
    setFilters(draft);
  }

  function clearFilters() {
    setDraft(defaultFilters);
    setFilters(defaultFilters);
    setFilterError('');
  }

  function triggerAlertAction(alert: CommercialAlert, data: CommercialDashboard) {
    if (alert.actionTarget === 'commercial-clients') {
      onOpenClients(alert.organizationId);
      return;
    }
    if (alert.actionTarget === 'commercial-billing') {
      onOpenBilling({
        organizationId: alert.organizationId,
        status: alert.billingStatusFilter ?? '',
        competenceFrom: data.period.competenceFrom ?? '',
        competenceTo: data.period.competenceTo ?? '',
      });
      return;
    }
    onOpenAccess(alert.organizationId);
  }

  const data = dashboard.data;

  return (
    <section
      className="commercial-section"
      aria-labelledby={`${idPrefix}-title`}
      aria-busy={dashboard.loading}
    >
      <header className="platform-heading">
        <div>
          <h2 id={`${idPrefix}-title`}>Painel comercial</h2>
          <p className="muted">
            Consolidação manual de contratos, vencimentos, cobranças e acesso contratual no mesmo
            recorte autorizado.
          </p>
        </div>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Atualizar painel
        </Button>
      </header>

      <search>
        <form
          className="surface commercial-fields"
          aria-labelledby={`${idPrefix}-filter-title`}
          onSubmit={applyFilters}
          noValidate
        >
          <h3 id={`${idPrefix}-filter-title`} className="sr-only">
            Filtros do período comercial
          </h3>
          <div className="commercial-field">
            <label htmlFor={`${idPrefix}-from`}>Competência inicial (AAAA-MM)</label>
            <input
              id={`${idPrefix}-from`}
              name="competenceFrom"
              type="month"
              value={draft.competenceFrom}
              onChange={(event) => setDraft({ ...draft, competenceFrom: event.target.value })}
            />
          </div>
          <div className="commercial-field">
            <label htmlFor={`${idPrefix}-to`}>Competência final (AAAA-MM)</label>
            <input
              id={`${idPrefix}-to`}
              name="competenceTo"
              type="month"
              value={draft.competenceTo}
              onChange={(event) => setDraft({ ...draft, competenceTo: event.target.value })}
            />
          </div>
          <div className="commercial-field">
            <label htmlFor={`${idPrefix}-window`}>Janela de renovação de contratos</label>
            <select
              id={`${idPrefix}-window`}
              name="renewalWindowDays"
              value={draft.renewalWindowDays}
              onChange={(event) => setDraft({ ...draft, renewalWindowDays: event.target.value })}
            >
              <option value="15">Próximos 15 dias</option>
              <option value="30">Próximos 30 dias</option>
              <option value="60">Próximos 60 dias</option>
              <option value="90">Próximos 90 dias</option>
            </select>
          </div>
          <div className="platform-areas commercial-billing-filter-actions">
            <Button type="submit">Aplicar recorte</Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              Limpar recorte
            </Button>
          </div>
          {filterError && (
            <div className="commercial-billing-filter-actions">
              <StatusMessage tone="error">{filterError}</StatusMessage>
            </div>
          )}
        </form>
      </search>

      {dashboard.loading && (
        <StatusMessage tone="loading">
          {data ? 'Atualizando painel comercial…' : 'Carregando painel comercial consolidado…'}
        </StatusMessage>
      )}
      {dashboard.error && (
        <StatusMessage
          tone="error"
          action={
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Tentar novamente
            </Button>
          }
        >
          {dashboard.error}
        </StatusMessage>
      )}

      {data && !dashboard.error && (
        <>
          <p className="muted commercial-billing-reference">
            Referência {commercialDate(data.referenceDate)} · {data.timeZone} · conferido em{' '}
            {commercialDateTime(data.reconciliation.checkedAt)} · janela de renovação:{' '}
            {data.period.renewalWindowDays} dias
            {data.period.competenceFrom || data.period.competenceTo
              ? ` · competência ${data.period.competenceFrom ?? 'início'} a ${data.period.competenceTo ?? 'atual'}`
              : ' · todas as competências'}
          </p>

          <section className="surface commercial-section" aria-labelledby={`${idPrefix}-actions`}>
            <h3 id={`${idPrefix}-actions`}>Ações rápidas autorizadas</h3>
            <div className="platform-areas">
              {data.scope.canManageClients && (
                <a className="platform-action-link" href="#/plataforma?action=new-client">
                  Cadastrar empresa (CNPJ)
                </a>
              )}
              {data.scope.canReadCatalog && (
                <Button variant="outline" onClick={() => onOpenClients(null)}>
                  {data.scope.canManageCatalog
                    ? 'Consultar e gerir contratos'
                    : 'Consultar contratos'}
                </Button>
              )}
              {data.scope.canReadBilling && (
                <Button
                  variant="outline"
                  onClick={() =>
                    onOpenBilling({
                      organizationId: null,
                      competenceFrom: data.period.competenceFrom ?? '',
                      competenceTo: data.period.competenceTo ?? '',
                    })
                  }
                >
                  {data.scope.canManageBilling
                    ? 'Registrar cobrança ou pagamento'
                    : 'Consultar cobranças'}
                </Button>
              )}
              {data.scope.canReadContractAccess && (
                <Button variant="outline" onClick={() => onOpenAccess(null)}>
                  {data.scope.canManageContractAccess
                    ? 'Gerir acesso contratual'
                    : 'Consultar acesso contratual'}
                </Button>
              )}
            </div>
            {data.supportTickets && (
              <a className="platform-action-link" href="#/plataforma/chamados">
                Abrir fila de chamados
              </a>
            )}
          </section>

          <section className="surface commercial-section" aria-labelledby={`${idPrefix}-alerts`}>
            <div className="platform-heading">
              <div>
                <h3 id={`${idPrefix}-alerts`}>Alertas internos</h3>
                <p className="muted">
                  Avisos deduplicados por empresa e origem, gerados diretamente das datas e estados
                  registrados.
                </p>
              </div>
              <StatusBadge
                label={
                  data.alerts.length === 0
                    ? 'Sem pendências'
                    : `${data.alerts.length} ${data.alerts.length === 1 ? 'alerta ativo' : 'alertas ativos'}`
                }
                tone={data.alerts.length === 0 ? 'success' : 'warning'}
              />
            </div>

            {data.alerts.length === 0 ? (
              <StatusMessage tone="success">
                Nenhum alerta comercial pendente neste recorte.
              </StatusMessage>
            ) : (
              <ul className="commercial-records" aria-label="Lista de alertas comerciais">
                {data.alerts.map((alert) => {
                  const severity = severityMeta[alert.severity];
                  const actionLabel =
                    alert.actionTarget === 'platform-catalog'
                      ? 'Regularizar CNPJ no catálogo'
                      : alert.actionTarget === 'commercial-clients'
                        ? 'Abrir contrato'
                        : alert.actionTarget === 'commercial-billing'
                          ? 'Abrir cobranças'
                          : alert.actionTarget === 'platform-support'
                            ? 'Abrir chamado'
                            : 'Abrir acesso contratual';
                  return (
                    <li key={alert.id} className="commercial-alert-item">
                      <div className="commercial-alert-body">
                        <div className="commercial-alert-badges">
                          <StatusBadge label={severity.label} tone={severity.tone} />
                          <span className="muted">{domainLabels[alert.domain]}</span>
                          {alert.referenceDate && (
                            <span className="muted">
                              Data ref.: {commercialDate(alert.referenceDate)}
                            </span>
                          )}
                        </div>
                        <strong>
                          {alert.title} — {alert.organizationName}
                        </strong>
                        <p className="muted">{alert.description}</p>
                        {alert.amountCents !== null && (
                          <p className="commercial-billing-num">
                            Total relacionado: <strong>{formatBrlCents(alert.amountCents)}</strong>
                            {alert.itemCount !== null ? ` (${alert.itemCount} registros)` : ''}
                          </p>
                        )}
                      </div>
                      {alert.actionTarget === 'platform-catalog' ? (
                        <a
                          className="platform-action-link"
                          aria-label={`${actionLabel} de ${alert.organizationName}`}
                          href={`#/plataforma?search=${encodeURIComponent(alert.organizationName)}&classification=${alert.clientClassification ?? 'CLIENT'}&fiscalState=ALL`}
                        >
                          {actionLabel}
                        </a>
                      ) : alert.actionTarget === 'platform-support' ? (
                        <a
                          className="platform-action-link"
                          aria-label={`${actionLabel} de ${alert.organizationName}`}
                          href={`#/plataforma/chamados/${alert.sourceId}`}
                        >
                          {actionLabel}
                        </a>
                      ) : (
                        <Button
                          variant="outline"
                          aria-label={`${actionLabel} de ${alert.organizationName}`}
                          onClick={() => triggerAlertAction(alert, data)}
                        >
                          {actionLabel}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby={`${idPrefix}-reconcile-caption`}
            className="commercial-billing-table-wrap surface"
          >
            <table className="commercial-billing-table">
              <caption id={`${idPrefix}-reconcile-caption`} className="commercial-table-caption">
                Resumo consolidado e reconciliação por domínio ({commercialDate(data.referenceDate)}
                )
              </caption>
              <thead>
                <tr>
                  <th scope="col">Domínio</th>
                  <th scope="col">Indicadores consolidados</th>
                  <th scope="col">Situação de acesso</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Contratos e vigências</th>
                  <td data-label="Indicadores consolidados">
                    {data.contracts ? (
                      <>
                        <span className="commercial-billing-num">
                          {data.contracts.total} contratos ({data.contracts.active} ativos ·{' '}
                          {data.contracts.expiringSoon} vencem em {data.period.renewalWindowDays}d ·{' '}
                          {data.contracts.expired} vencidos · {data.contracts.scheduled} agendados ·{' '}
                          {data.contracts.cancelled} cancelados)
                        </span>
                        <span className="commercial-billing-subline">
                          {data.contracts.withoutContractActiveClients} clientes ativos sem contrato
                          · {data.contracts.pendingDocumentCount} com documento pendente
                        </span>
                      </>
                    ) : (
                      'Restrito a perfis com permissão comercial (contratos).'
                    )}
                  </td>
                  <td data-label="Situação de acesso">
                    {data.contracts ? 'Reconciliado' : 'Sem permissão'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Cobranças e recebimentos manuais</th>
                  <td data-label="Indicadores consolidados">
                    {data.billing ? (
                      <>
                        <span className="commercial-billing-num">
                          {data.billing.counts.total} cobranças · Total{' '}
                          {formatBrlCents(data.billing.billedCents)}
                        </span>
                        <span className="commercial-billing-subline commercial-billing-num">
                          Em aberto: {data.billing.counts.open} (
                          {formatBrlCents(data.billing.openCents)}) · Vencidas:{' '}
                          {data.billing.counts.overdue} ({formatBrlCents(data.billing.overdueCents)}
                          ) · Pagas: {data.billing.counts.paid} (
                          {formatBrlCents(data.billing.receivedCents)})
                        </span>
                      </>
                    ) : (
                      'Restrito aos perfis financeiros concedidos.'
                    )}
                  </td>
                  <td data-label="Situação de acesso">
                    {data.billing ? 'Reconciliado' : 'Restrito (Financeiro)'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Acesso contratual</th>
                  <td data-label="Indicadores consolidados">
                    {data.contractAccess ? (
                      <span className="commercial-billing-num">
                        {data.contractAccess.totalClients} organizações (
                        {data.contractAccess.active} ativas · {data.contractAccess.suspended}{' '}
                        suspensas · {data.contractAccess.unrecorded} sem registro)
                      </span>
                    ) : (
                      'Restrito a perfis com permissão de acesso contratual.'
                    )}
                  </td>
                  <td data-label="Situação de acesso">
                    {data.contractAccess ? 'Reconciliado' : 'Sem permissão'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Catálogo de organizações</th>
                  <td data-label="Indicadores consolidados">
                    {data.catalog ? (
                      <span className="commercial-billing-num">
                        {data.catalog.totalOrganizations} organizações ({data.catalog.activeClients}{' '}
                        clientes ativos · {data.catalog.inactiveClients} inativos ·{' '}
                        {data.catalog.demonstrations} demonstrações · {data.catalog.unclassified}{' '}
                        não classificadas · {data.catalog.pendingFiscal} pendências fiscais)
                      </span>
                    ) : (
                      'Restrito a perfis de catálogo ou visão global.'
                    )}
                  </td>
                  <td data-label="Situação de acesso">
                    {data.catalog ? 'Reconciliado' : 'Sem permissão'}
                  </td>
                </tr>
                {data.supportTickets && (
                  <tr>
                    <th scope="row">Chamados de suporte</th>
                    <td data-label="Indicadores consolidados">
                      {data.supportTickets.pending} pendentes · {data.supportTickets.dueSoon} com
                      prazo nos próximos 7 dias · {data.supportTickets.overdue} vencidos
                    </td>
                    <td data-label="Situação de acesso">Reconciliado</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
