import { useEffect, useRef, useState } from 'react';
import {
  companyGroupListSchema,
  companyGroupOperationalOverviewSchema,
  type CompanyGroupOperationalMetrics,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { useAccessRefresh, usePrivateQuery } from './usePrivateQuery';
import './company-groups.css';

type Overview = ReturnType<typeof companyGroupOperationalOverviewSchema.parse>;
type Metrics = Overview['totals'];
const count = new Intl.NumberFormat('pt-BR');
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const localDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const delta = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const ignoreDenial = () => {};

function unavailable(status: 'PROTECTED' | 'UNAVAILABLE') {
  return status === 'PROTECTED' ? 'Dados protegidos' : 'Sem base disponível';
}

function quantity(value: number, singular: string, plural: string) {
  return `${count.format(value)} ${value === 1 ? singular : plural}`;
}

function civilDate(date: string) {
  return <time dateTime={date}>{localDate.format(new Date(`${date}T00:00:00.000Z`))}</time>;
}

function GroupMetrics({
  metrics,
  operational,
}: {
  metrics: Metrics;
  operational: CompanyGroupOperationalMetrics;
}) {
  const { participation, evolution, actions } = metrics;
  const { collections, evaluations, overdueActions, lastActivity } = operational;
  return (
    <dl className="company-group-metrics">
      <div>
        <dt>Colaboradores ativos</dt>
        <dd>{count.format(metrics.employees)}</dd>
      </div>
      <div>
        <dt>Riscos abertos</dt>
        <dd>{count.format(metrics.openRisks)}</dd>
      </div>
      <div>
        <dt>Coletas</dt>
        <dd>{count.format(collections.inProgress)} em andamento</dd>
        <dd className="muted company-group-detail">
          {quantity(collections.pending, 'pendente', 'pendentes')} ·{' '}
          {quantity(collections.completed, 'concluída', 'concluídas')}
        </dd>
      </div>
      <div>
        <dt>Avaliações</dt>
        <dd>{quantity(evaluations.records, 'registrada', 'registradas')}</dd>
        <dd className="muted company-group-detail">
          {quantity(evaluations.completed, 'risco avaliado', 'riscos avaliados')} ·{' '}
          {quantity(evaluations.pending, 'pendente', 'pendentes')}
        </dd>
      </div>
      <div>
        <dt>Plano de ação</dt>
        <dd>{count.format(overdueActions)} em atraso</dd>
        <dd className="muted company-group-detail">
          {count.format(actions.pending + actions.inProgress)} em aberto
        </dd>
        <dd className="muted company-group-detail">
          {quantity(actions.pending, 'pendente', 'pendentes')} · {count.format(actions.inProgress)}{' '}
          em andamento · {quantity(actions.done, 'concluída', 'concluídas')} ·{' '}
          {quantity(actions.cancelled, 'cancelada', 'canceladas')}
        </dd>
      </div>
      <div>
        <dt>Última atividade auditada</dt>
        <dd>
          {lastActivity.status === 'AVAILABLE'
            ? civilDate(lastActivity.date)
            : 'Sem registro auditado'}
        </dd>
      </div>
      <div>
        <dt>Adesão</dt>
        <dd>
          {participation.status === 'AVAILABLE'
            ? `${percent.format(participation.ratePercent)}%`
            : unavailable(participation.status)}
        </dd>
        {participation.status === 'AVAILABLE' && (
          <dd className="muted company-group-detail">
            {quantity(participation.responses, 'resposta', 'respostas')} de{' '}
            {quantity(participation.eligible, 'elegível', 'elegíveis')}
          </dd>
        )}
      </div>
      <div>
        <dt>Evolução da adesão</dt>
        <dd>
          {evolution.status === 'AVAILABLE'
            ? `${delta.format(evolution.deltaPoints)} p.p.`
            : unavailable(evolution.status)}
        </dd>
        {evolution.status === 'AVAILABLE' && (
          <dd className="muted company-group-detail">
            De {percent.format(evolution.referencePercent)}% para{' '}
            {percent.format(evolution.currentPercent)}%
          </dd>
        )}
      </div>
    </dl>
  );
}

function PortfolioSummary({ portfolio }: { portfolio: Overview['portfolio'] }) {
  return (
    <dl className="company-group-portfolio">
      <div>
        <dt>Empresas ativas</dt>
        <dd>{count.format(portfolio.active)}</dd>
        <dd className="muted company-group-detail">
          {count.format(portfolio.activeDemonstrations)} de demonstração
        </dd>
      </div>
      <div>
        <dt>Empresas inativas</dt>
        <dd>{count.format(portfolio.inactive)}</dd>
        <dd className="muted company-group-detail">
          {count.format(portfolio.inactiveDemonstrations)} de demonstração
        </dd>
      </div>
    </dl>
  );
}

export function CompanyGroupsWorkspace({ onExpire }: { onExpire: () => void }) {
  const { revision, refresh } = useAccessRefresh();
  const [periodic, setPeriodic] = useState(0);
  const [selected, setSelected] = useState('');
  const generation = revision + periodic;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setPeriodic((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const groups = usePrivateQuery(
    '/company-groups',
    companyGroupListSchema,
    generation,
    onExpire,
    ignoreDenial,
    undefined,
    true,
  );
  const groupId =
    groups.data?.items.find(({ id }) => id === selected)?.id ?? groups.data?.items[0]?.id;

  if (groups.error)
    return (
      <StatusMessage tone="error" action={<Button onClick={refresh}>Tentar novamente</Button>}>
        {groups.error}
      </StatusMessage>
    );
  if (!groups.data && groups.loading)
    return <StatusMessage tone="loading">Verificando seus grupos de empresas…</StatusMessage>;
  if (!groupId) return <StatusMessage>Você está sem acesso a grupos de empresas.</StatusMessage>;

  return (
    <div className="company-group-view">
      {groups.data && groups.data.items.length > 1 && (
        <div className="company-group-field">
          <label htmlFor="company-group">Grupo de empresas</label>
          <select
            id="company-group"
            value={groupId}
            onChange={(event) => setSelected(event.target.value)}
          >
            {groups.data.items.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <CompanyGroupOverview
        key={groupId}
        groupId={groupId}
        generation={generation}
        onExpire={onExpire}
      />
    </div>
  );
}

function CompanyGroupOverview({
  groupId,
  generation,
  onExpire,
}: {
  groupId: string;
  generation: number;
  onExpire: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  const companySelect = useRef<HTMLSelectElement>(null);
  const base = `/company-groups/${encodeURIComponent(groupId)}`;
  const retry = () => setAttempt((value) => value + 1);
  const overview = usePrivateQuery(
    `${base}?view=operational`,
    companyGroupOperationalOverviewSchema,
    generation + attempt,
    onExpire,
    ignoreDenial,
    undefined,
    true,
  );
  const authorized = overview.data?.group.id === groupId;
  const companyId = authorized
    ? overview.data?.companies.find(({ id }) => id === selected)?.id
    : undefined;
  const detail = usePrivateQuery(
    companyId
      ? `${base}?${new URLSearchParams({ view: 'operational', organizationId: companyId })}`
      : null,
    companyGroupOperationalOverviewSchema,
    generation + attempt,
    onExpire,
    ignoreDenial,
    undefined,
    true,
  );
  if (overview.error || (overview.data && !authorized))
    return (
      <StatusMessage tone="error" action={<Button onClick={retry}>Revalidar consolidado</Button>}>
        {overview.error || 'O grupo selecionado não está disponível.'}
      </StatusMessage>
    );
  if (!overview.data) return <StatusMessage tone="loading">Carregando consolidado…</StatusMessage>;

  const data = companyId ? detail.data : overview.data;
  const matched =
    data?.group.id === groupId &&
    (!companyId || (data.companies.length === 1 && data.companies[0]?.id === companyId));

  return (
    <>
      <div className="company-group-field">
        <label htmlFor="company-group-company">Empresa no consolidado</label>
        <select
          id="company-group-company"
          ref={companySelect}
          value={companyId ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Todas as empresas do grupo</option>
          {overview.data.companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>
      {detail.error ? (
        <StatusMessage tone="error" action={<Button onClick={retry}>Revalidar empresa</Button>}>
          {detail.error}
        </StatusMessage>
      ) : !data ? (
        <StatusMessage tone="loading">Carregando indicadores da empresa…</StatusMessage>
      ) : !matched ? (
        <StatusMessage tone="error">O recorte solicitado não está disponível.</StatusMessage>
      ) : (
        <>
          <p className="muted company-group-reference">
            Referência de {civilDate(data.referenceDate)} no horário de São Paulo. Indicadores das
            empresas ativas.
          </p>
          {!companyId && (
            <section
              className="surface company-group-summary"
              aria-labelledby="company-group-summary"
            >
              <h2 id="company-group-summary">{data.group.name}</h2>
              <PortfolioSummary portfolio={data.portfolio} />
              <GroupMetrics metrics={data.totals} operational={data.operational} />
            </section>
          )}
          {data.companies.length === 0 && (
            <StatusMessage>Nenhuma empresa disponível neste grupo.</StatusMessage>
          )}
          {companyId
            ? data.companies.map((company) => (
                <section
                  className="surface company-group-company"
                  aria-labelledby={`company-group-${company.id}`}
                  key={company.id}
                >
                  <h2 id={`company-group-${company.id}`}>{company.name}</h2>
                  {company.classification === 'DEMONSTRATION' && (
                    <p className="muted">Empresa de demonstração</p>
                  )}
                  {company.fiscalIdentifier && (
                    <p className="muted">CNPJ {company.fiscalIdentifier}</p>
                  )}
                  <GroupMetrics metrics={company.metrics} operational={company.operational} />
                </section>
              ))
            : data.companies.length > 0 && (
                <div className="surface company-group-directory">
                  <h2>Empresas do grupo</h2>
                  <ul aria-label="Empresas do grupo">
                    {data.companies.map((company) => (
                      <li key={company.id}>
                        <div>
                          <h3>{company.name}</h3>
                          {company.fiscalIdentifier && (
                            <p className="muted">CNPJ {company.fiscalIdentifier}</p>
                          )}
                          <p className="muted">
                            {quantity(
                              company.metrics.employees,
                              'colaborador ativo',
                              'colaboradores ativos',
                            )}
                            {company.classification === 'DEMONSTRATION' && ' · Demonstração'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          aria-label={`Ver indicadores de ${company.name}`}
                          onClick={() => {
                            setSelected(company.id);
                            companySelect.current?.focus();
                          }}
                        >
                          Ver indicadores
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
        </>
      )}
    </>
  );
}
