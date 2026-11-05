import { useEffect, useRef, useState } from 'react';
import { managementIndicatorsSchema, type ManagementIndicators } from '@renr/contracts';
import { useActionData, civilDate } from './actions/useActionData';
import { Button } from './ui/button';
import { MetricCard } from './charts/MetricCard';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import { DashboardHistory, RiskDistribution } from './DashboardCharts';
import '../dashboard.css';

const areas = {
  geral: 'Visão geral',
  riscos: 'Riscos',
  acoes: 'Ações',
  estrutura: 'Estrutura',
} as const;
type Area = keyof typeof areas;

function readDashboard() {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const requested = query.get('area');
  const area = requested && Object.hasOwn(areas, requested) ? (requested as Area) : 'geral';
  const filters = new URLSearchParams();
  for (const key of ['unitId', 'sectorId']) {
    for (const value of query.getAll(key)) filters.append(key, value);
  }
  const days = Number(query.get('dias'));
  const page = Number(query.get('pagina'));
  return {
    area,
    filters,
    days: days === 7 || days === 90 ? days : 30,
    page: Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1,
  };
}

type DashboardRoute = ReturnType<typeof readDashboard>;
function dashboardHref({ area, filters, days, page }: DashboardRoute) {
  const query = new URLSearchParams(filters);
  if (area !== 'geral') query.set('area', area);
  if (days !== 30) query.set('dias', String(days));
  if (page !== 1) query.set('pagina', String(page));
  return '#/painel' + (query.size ? '?' + query : '');
}

function listHref(path: 'inventario' | 'acoes', filters: URLSearchParams, extra = {}) {
  const query = new URLSearchParams(filters);
  query.set('page', '1');
  for (const [key, value] of Object.entries(extra)) query.set(key, String(value));
  return '#/' + path + '?' + query;
}

export function ManagementDashboard({
  organizationId,
  onExpire,
  canReadEmployees = false,
}: {
  organizationId: string | null;
  onExpire: () => void;
  canReadEmployees?: boolean;
}) {
  if (!organizationId)
    return (
      <section className="surface empty-state">
        <h2>Selecione uma empresa</h2>
        <p>Escolha uma empresa para consultar seus riscos, ações e estrutura.</p>
        <a className="action-link" href="#/empresas">
          Ir para Empresas
        </a>
      </section>
    );
  return (
    <DashboardContent
      key={organizationId}
      organizationId={organizationId}
      onExpire={onExpire}
      canReadEmployees={canReadEmployees}
    />
  );
}

function DashboardContent({
  organizationId,
  onExpire,
  canReadEmployees,
}: {
  organizationId: string;
  onExpire: () => void;
  canReadEmployees: boolean;
}) {
  const [route, setRoute] = useState(readDashboard);
  const [attempt, setAttempt] = useState(0);
  const { area, filters, days, page } = route;
  const root = '/organizations/' + organizationId + '/management-indicators';
  const query = new URLSearchParams(filters);
  query.set('page', String(area === 'geral' || area === 'acoes' ? page : 1));
  const result = useActionData(
    root + '?' + query,
    managementIndicatorsSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const data = result.data;
  const [lastContext, setLastContext] = useState<Pick<
    ManagementIndicators,
    'organization' | 'options'
  > | null>(null);
  if (data && data.options !== lastContext?.options)
    setLastContext({ organization: data.organization, options: data.options });
  if (result.error && lastContext) setLastContext(null);
  const context = data ?? (result.loading ? lastContext : null);
  const scope = useRef<HTMLDivElement>(null);
  usePresentationMotion(scope, data ? area + data.generatedAt : null);

  useEffect(() => {
    const update = () => setRoute(readDashboard());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  function filter(key: 'unitId' | 'sectorId', value: string) {
    const next = new URLSearchParams(filters);
    if (key === 'unitId') next.delete('sectorId');
    if (key === 'sectorId' && value && !next.has('unitId')) {
      const unit = context?.options.sectors.find((sector) => sector.id === value)?.unitId;
      if (unit) next.set('unitId', unit);
    }
    if (value) next.set(key, value);
    else next.delete(key);
    window.location.hash = dashboardHref({ ...route, filters: next, page: 1 });
  }

  const applied = new URLSearchParams(filters);
  if (data?.filters.unitId) applied.set('unitId', data.filters.unitId);
  const riskLink = listHref('inventario', applied);
  const overdueLink = listHref('acoes', applied, { overdue: true });
  const unitId = applied.get('unitId') ?? '';
  const sectorId = filters.get('sectorId') ?? '';
  const unitName = context?.options.units.find((unit) => unit.id === unitId)?.name;
  const sectorName = context?.options.sectors.find((sector) => sector.id === sectorId)?.name;
  return (
    <div className="management-dashboard dashboard-percurso">
      <nav className="dashboard-area-nav" aria-label="Áreas do painel">
        {(Object.entries(areas) as [Area, string][]).map(([key, label]) => (
          <a
            key={key}
            href={dashboardHref({ ...route, area: key, page: key === area ? page : 1 })}
            aria-current={key === area ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {result.loading && (
        <p className="surface" role="status">
          Carregando indicadores…
        </p>
      )}
      {result.error && (
        <div className="feedback error" role="alert">
          <p>{result.error}</p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Tentar novamente
          </Button>
          {filters.size > 0 && (
            <a
              className="action-link"
              href={dashboardHref({ ...route, filters: new URLSearchParams(), page: 1 })}
            >
              Limpar filtros
            </a>
          )}
        </div>
      )}
      {context && (
        <section className="surface dashboard-scope-card" aria-labelledby="dashboard-company">
          <div className="dashboard-scope-title">
            <p className="panel-label">EMPRESA EM FOCO</p>
            <h2 id="dashboard-company">{context.organization.name}</h2>
            {data && (
              <p className="chart-note">
                Referência {civilDate(data.referenceDate)} · {data.timeZone}
              </p>
            )}
          </div>
          <div className="dashboard-filters" aria-label="Filtros do painel">
            <div>
              <label htmlFor="dashboard-unit">Unidade</label>
              <select
                id="dashboard-unit"
                value={unitId}
                title={unitName}
                onChange={(event) => filter('unitId', event.target.value)}
              >
                <option value="">Todas</option>
                {context.options.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              {unitName && unitName.length > 24 && <p className="chart-note">{unitName}</p>}
            </div>
            <div>
              <label htmlFor="dashboard-sector">Setor</label>
              <select
                id="dashboard-sector"
                value={sectorId}
                title={sectorName}
                onChange={(event) => filter('sectorId', event.target.value)}
              >
                <option value="">Todos</option>
                {context.options.sectors
                  .filter((sector) => !unitId || sector.unitId === unitId)
                  .map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.name}
                    </option>
                  ))}
              </select>
              {sectorName && sectorName.length > 24 && <p className="chart-note">{sectorName}</p>}
            </div>
          </div>
          <div className="dashboard-refresh">
            {data && (
              <p className="chart-note">
                Atualizado em{' '}
                <time dateTime={data.generatedAt}>
                  {new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: data.timeZone,
                  }).format(new Date(data.generatedAt))}
                </time>
              </p>
            )}
            <Button
              variant="outline"
              aria-disabled={result.loading}
              onClick={() => {
                if (!result.loading) setAttempt(attempt + 1);
              }}
            >
              Atualizar painel
            </Button>
          </div>
        </section>
      )}
      {data && (
        <div ref={scope} className="dashboard-area-content">
          {area === 'geral' && (
            <section aria-label="Síntese do recorte">
              <ul className="dashboard-metrics" aria-label="Indicadores principais">
                <MetricCard
                  label="Riscos no inventário"
                  value={data.risks.total}
                  detail="Consultar registros não arquivados"
                  href={riskLink}
                  accent
                />
                <MetricCard
                  label="Sem classificação"
                  value={data.risks.unclassified}
                  detail="Consultar riscos sem nível vigente"
                  href={listHref('inventario', applied, { classification: 'UNCLASSIFIED' })}
                />
                <MetricCard
                  label="Ações abertas"
                  value={data.actions.open}
                  detail="Planejadas ou em execução"
                  href={listHref('acoes', applied, { openOnly: true })}
                />
                <MetricCard
                  label="Ações atrasadas"
                  value={data.actions.overdue}
                  detail="Consultar ações abertas fora do prazo"
                  href={overdueLink}
                />
              </ul>
            </section>
          )}
          {area === 'riscos' && (
            <>
              <RiskDistribution data={data.risks} filters={applied} listHref={listHref} />
              <p className="chart-note">
                Resultados de questionários seguem as regras de privacidade em Coletas.
              </p>
            </>
          )}
          {area === 'acoes' && (
            <>
              <section
                className="surface dashboard-action-summary"
                aria-labelledby="action-summary-heading"
              >
                <div className="dashboard-reflow-heading">
                  <h2 id="action-summary-heading">Ações preventivas</h2>
                  <p className="chart-note">
                    Situação em {civilDate(data.referenceDate)} · {data.timeZone}
                  </p>
                  <a className="action-link" href={listHref('acoes', applied)}>
                    Consultar ações
                  </a>
                </div>
                <dl className="dashboard-counts">
                  <div>
                    <dt>Planejadas</dt>
                    <dd>{data.actions.planned}</dd>
                  </div>
                  <div>
                    <dt>Em execução</dt>
                    <dd>{data.actions.inProgress}</dd>
                  </div>
                  <div>
                    <dt>Execução informada</dt>
                    <dd>{data.actions.implemented}</dd>
                  </div>
                  <div>
                    <dt>Canceladas</dt>
                    <dd>{data.actions.cancelled}</dd>
                  </div>
                  <div>
                    <dt>
                      <a href={overdueLink}>Atrasadas</a>
                    </dt>
                    <dd>{data.actions.overdue}</dd>
                  </div>
                  <div>
                    <dt>Pendências técnicas</dt>
                    <dd>{data.actions.technicalPending}</dd>
                  </div>
                  <div>
                    <dt>Eficácia confirmada</dt>
                    <dd>{data.actions.effective}</dd>
                  </div>
                  <div>
                    <dt>Encerramentos válidos</dt>
                    <dd>{data.actions.closed}</dd>
                  </div>
                </dl>
                <p className="chart-note">
                  Pendências técnicas contam ações implementadas sem encerramento vigente. Ações de
                  riscos arquivados permanecem no acompanhamento operacional.
                </p>
              </section>
            </>
          )}
          {(area === 'geral' || area === 'acoes') && <Priorities data={data} route={route} />}
          {(area === 'riscos' || area === 'acoes') && (
            <DashboardHistory
              key={area}
              root={root}
              organizationId={organizationId}
              onExpire={onExpire}
              filters={applied}
              referenceDate={data.referenceDate}
              days={days}
              area={area}
              onDays={(value) => {
                window.location.hash = dashboardHref({ ...route, days: value });
              }}
            />
          )}
          {area === 'estrutura' && (
            <section className="surface dashboard-structure" aria-labelledby="structure-summary">
              <h2 id="structure-summary">Estrutura cadastrada</h2>
              <dl className="dashboard-counts">
                <div>
                  <dt>Unidades</dt>
                  <dd>{data.structure.units.total}</dd>
                </div>
                <div>
                  <dt>Setores</dt>
                  <dd>{data.structure.sectors.total}</dd>
                </div>
                {canReadEmployees && data.structure.employees && (
                  <div>
                    <dt>Colaboradores</dt>
                    <dd>{data.structure.employees.total}</dd>
                  </div>
                )}
              </dl>
              <div className="dashboard-structure-links">
                <a className="action-link" href="#/empresas">
                  Empresas
                </a>
                <a className="action-link" href="#/unidades">
                  Unidades
                </a>
                {canReadEmployees && (
                  <a
                    className="action-link"
                    href={'#/colaboradores' + (applied.size ? '?' + applied : '')}
                  >
                    Colaboradores
                  </a>
                )}
              </div>
              <details className="chart-values">
                <summary>Consultar setores por unidade</summary>
                <ul>
                  {data.options.units
                    .filter((unit) => !unitId || unit.id === unitId)
                    .map((unit) => (
                      <li key={unit.id}>
                        <a href={'#/setores/' + unit.id}>{unit.name}</a>
                      </li>
                    ))}
                </ul>
              </details>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Priorities({ data, route }: { data: ManagementIndicators; route: DashboardRoute }) {
  const { items, page, pageSize, total } = data.priorities;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="surface dashboard-priorities" aria-labelledby="dashboard-priorities">
      <h2 id="dashboard-priorities">Prioridades de acompanhamento</h2>
      <p className="chart-note">
        Ações atrasadas e ações com pendências técnicas no recorte atual.
      </p>
      {total === 0 && <p>Nenhuma prioridade neste recorte.</p>}
      {items.length > 0 && (
        <table className="chart-table dashboard-priority-table">
          <caption className="sr-only">Ações prioritárias</caption>
          <thead>
            <tr>
              <th scope="col">Ação</th>
              <th scope="col">Situação</th>
              <th scope="col">Prazo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.actionId}>
                <th scope="row">
                  <a
                    href={
                      '#/acoes/' +
                      item.actionId +
                      '?' +
                      new URLSearchParams({ returnTo: dashboardHref(route) })
                    }
                  >
                    {item.title}
                  </a>
                </th>
                <td>{item.kind === 'OVERDUE' ? 'Atrasada' : 'Pendência técnica'}</td>
                <td>{item.dueDate ? civilDate(item.dueDate) : 'Sem prazo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > 0 && (
        <nav className="dashboard-pagination" aria-label="Paginação de prioridades">
          {page > 1 && (
            <a href={dashboardHref({ ...route, page: Math.min(pages, page - 1) })}>Anterior</a>
          )}
          <span>
            Página {page} de {pages} · {total} {total === 1 ? 'ação' : 'ações'}
          </span>
          {page < pages && <a href={dashboardHref({ ...route, page: page + 1 })}>Próxima</a>}
        </nav>
      )}
    </section>
  );
}
