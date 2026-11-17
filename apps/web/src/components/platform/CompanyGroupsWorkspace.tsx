import { useEffect, useRef, useState } from 'react';
import { companyGroupListSchema, companyGroupOverviewSchema } from '@renr/contracts';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { useAccessRefresh, usePrivateQuery } from './usePrivateQuery';
import './company-groups.css';

type Metrics = ReturnType<typeof companyGroupOverviewSchema.parse>['totals'];
const count = new Intl.NumberFormat('pt-BR');
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const delta = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const ignoreDenial = () => {};

function unavailable(status: 'PROTECTED' | 'UNAVAILABLE') {
  return status === 'PROTECTED' ? 'Dados protegidos' : 'Sem base disponível';
}

function GroupMetrics({ metrics }: { metrics: Metrics }) {
  const { participation, evolution, actions } = metrics;
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
        <dt>Plano de ação</dt>
        <dd>{count.format(actions.pending + actions.inProgress)} em aberto</dd>
        <dd className="muted company-group-detail">
          {count.format(actions.pending)} pendentes · {count.format(actions.inProgress)} em
          andamento · {count.format(actions.done)} concluídas · {count.format(actions.cancelled)}{' '}
          canceladas
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
            {count.format(participation.responses)} respostas de{' '}
            {count.format(participation.eligible)} elegíveis
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
    base,
    companyGroupOverviewSchema,
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
    companyId ? `${base}?${new URLSearchParams({ organizationId: companyId })}` : null,
    companyGroupOverviewSchema,
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
          {!companyId && (
            <section
              className="surface company-group-summary"
              aria-labelledby="company-group-summary"
            >
              <h2 id="company-group-summary">{data.group.name}</h2>
              <p className="muted">
                {count.format(data.companies.length)} empresas no recorte autorizado
              </p>
              <GroupMetrics metrics={data.totals} />
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
                  {company.fiscalIdentifier && (
                    <p className="muted">CNPJ {company.fiscalIdentifier}</p>
                  )}
                  <GroupMetrics metrics={company.metrics} />
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
