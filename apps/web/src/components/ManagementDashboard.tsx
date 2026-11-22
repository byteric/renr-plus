import { useCallback, useEffect, useRef, useState } from 'react';
import {
  managementIndicatorsSchema,
  nr01PendencyOriginSchema,
  nr01PendencyRuleSchema,
  nr01PendencyStatusSchema,
  type ManagementIndicators,
} from '@renr/contracts';
import { useActionData, civilDate } from './actions/useActionData';
import { Button } from './ui/button';
import { MetricCard } from './charts/MetricCard';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import { DashboardJourney } from './DashboardJourney';
import { DashboardHistory, RiskDistribution } from './DashboardCharts';
import { Nr01PendenciesPanel, type Nr01RouteFilters } from './Nr01PendenciesPanel';
import '../dashboard.css';

const areas = {
  geral: 'Visão geral',
  pendencias: 'Pendências NR-01',
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
  const statusParsed = nr01PendencyStatusSchema.safeParse(query.get('nrStatus'));
  const ruleParsed = nr01PendencyRuleSchema.safeParse(query.get('nrRule'));
  const originParsed = nr01PendencyOriginSchema.safeParse(query.get('nrOrigin'));
  const nrFilters: Nr01RouteFilters = {
    status: statusParsed.success ? statusParsed.data : '',
    rule: ruleParsed.success ? ruleParsed.data : '',
    origin: originParsed.success ? originParsed.data : '',
  };
  return {
    area,
    filters,
    nrFilters,
    days: days === 7 || days === 90 ? days : 30,
    page: Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1,
  };
}

type DashboardRoute = ReturnType<typeof readDashboard>;
function dashboardHref({ area, filters, nrFilters, days, page }: DashboardRoute) {
  const query = new URLSearchParams(filters);
  if (area !== 'geral') query.set('area', area);
  if (area === 'pendencias') {
    if (nrFilters.status) query.set('nrStatus', nrFilters.status);
    if (nrFilters.rule) query.set('nrRule', nrFilters.rule);
    if (nrFilters.origin) query.set('nrOrigin', nrFilters.origin);
  }
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
  const { area, filters, nrFilters, days, page } = route;
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
  const [deniedAtAttempt, setDeniedAtAttempt] = useState<number | null>(null);
  const accessDenied = deniedAtAttempt === attempt;
  if (data && !accessDenied && data.options !== lastContext?.options)
    setLastContext({ organization: data.organization, options: data.options });
  if ((result.error || accessDenied) && lastContext) setLastContext(null);
  const context = accessDenied ? null : (data ?? (result.loading ? lastContext : null));
  const visibleData = accessDenied ? null : data;
  const handlePendenciesUnavailable = useCallback(() => {
    setDeniedAtAttempt(attempt);
    setLastContext(null);
  }, [attempt]);
  const scope = useRef<HTMLDivElement>(null);
  usePresentationMotion(scope, visibleData ? area + visibleData.generatedAt : null);

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
  const closedCollections = new URLSearchParams(applied);
  closedCollections.set('status', 'CLOSED');
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
      {area === 'geral' && context && (
        <DashboardJourney key={attempt} organizationId={organizationId} onExpire={onExpire} />
      )}
      {area === 'pendencias' && !result.error && (
        <div ref={scope} className="dashboard-area-content">
          <Nr01PendenciesPanel
            organizationId={organizationId}
            scopeFilters={applied}
            nrFilters={nrFilters}
            page={page}
            attempt={attempt}
            returnTo={dashboardHref(route)}
            onExpire={onExpire}
            onUnavailable={handlePendenciesUnavailable}
            onChangeFilters={(next) => {
              window.location.hash = dashboardHref({
                ...route,
                area: 'pendencias',
                nrFilters: next,
                page: 1,
              });
            }}
            onPageHref={(nextPage) =>
              dashboardHref({ ...route, area: 'pendencias', page: nextPage })
            }
          />
        </div>
      )}
      {visibleData && area !== 'pendencias' && (
        <div ref={scope} className="dashboard-area-content">
          {area === 'geral' && (
            <section aria-label="Síntese do recorte">
              <ul className="dashboard-metrics" aria-label="Indicadores principais">
                <MetricCard
                  label="Riscos no inventário"
                  value={visibleData.risks.total}
                  detail="Consultar registros não arquivados"
                  href={riskLink}
                  accent
                />
                <MetricCard
                  label="Sem classificação"
                  value={visibleData.risks.unclassified}
                  detail="Consultar riscos sem nível vigente"
                  href={listHref('inventario', applied, { classification: 'UNCLASSIFIED' })}
                />
                <MetricCard
                  label="Ações abertas"
                  value={visibleData.actions.open}
                  detail="Planejadas ou em execução"
                  href={listHref('acoes', applied, { openOnly: true })}
                />
                <MetricCard
                  label="Ações atrasadas"
                  value={visibleData.actions.overdue}
                  detail="Consultar ações abertas fora do prazo"
                  href={overdueLink}
                />
              </ul>
            </section>
          )}
          {area === 'riscos' && (
            <>
              <RiskDistribution data={visibleData.risks} filters={applied} listHref={listHref} />
              <p className="chart-note">
                <a className="underline" href={`#/coletas?${closedCollections}`}>
                  Consultar resultados por coleta
                </a>
                . A exibição segue as regras de privacidade em Coletas.
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
                    Situação em {civilDate(visibleData.referenceDate)} · {visibleData.timeZone}
                  </p>
                  <a className="action-link" href={listHref('acoes', applied)}>
                    Consultar ações
                  </a>
                </div>
                <dl className="dashboard-counts">
                  <div>
                    <dt>Planejadas</dt>
                    <dd>{visibleData.actions.planned}</dd>
                  </div>
                  <div>
                    <dt>Em execução</dt>
                    <dd>{visibleData.actions.inProgress}</dd>
                  </div>
                  <div>
                    <dt>Execução informada</dt>
                    <dd>{visibleData.actions.implemented}</dd>
                  </div>
                  <div>
                    <dt>Canceladas</dt>
                    <dd>{visibleData.actions.cancelled}</dd>
                  </div>
                  <div>
                    <dt>
                      <a href={overdueLink}>Atrasadas</a>
                    </dt>
                    <dd>{visibleData.actions.overdue}</dd>
                  </div>
                  <div>
                    <dt>Pendências técnicas</dt>
                    <dd>{visibleData.actions.technicalPending}</dd>
                  </div>
                  <div>
                    <dt>Eficácia confirmada</dt>
                    <dd>{visibleData.actions.effective}</dd>
                  </div>
                  <div>
                    <dt>Encerramentos válidos</dt>
                    <dd>{visibleData.actions.closed}</dd>
                  </div>
                </dl>
                <p className="chart-note">
                  Pendências técnicas contam ações implementadas sem encerramento vigente. Ações de
                  riscos arquivados permanecem no acompanhamento operacional.
                </p>
              </section>
            </>
          )}
          {(area === 'geral' || area === 'acoes') && (
            <Priorities data={visibleData} route={route} />
          )}
          {(area === 'riscos' || area === 'acoes') && (
            <DashboardHistory
              key={area}
              root={root}
              organizationId={organizationId}
              onExpire={onExpire}
              filters={applied}
              referenceDate={visibleData.referenceDate}
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
                  <dd>{visibleData.structure.units.total}</dd>
                </div>
                <div>
                  <dt>Setores</dt>
                  <dd>{visibleData.structure.sectors.total}</dd>
                </div>
                {canReadEmployees && visibleData.structure.employees && (
                  <div>
                    <dt>Colaboradores</dt>
                    <dd>{visibleData.structure.employees.total}</dd>
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
                  {visibleData.options.units
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
  const pendenciesLink = dashboardHref({
    ...route,
    area: 'pendencias',
    nrFilters: { status: '', rule: '', origin: '' },
    page: 1,
  });
  return (
    <section className="surface dashboard-priorities" aria-labelledby="dashboard-priorities">
      <div className="dashboard-priorities-header">
        <h2 id="dashboard-priorities">Prioridades de acompanhamento</h2>
        <a className="action-link" href={pendenciesLink}>
          Ver pendências NR-01
        </a>
      </div>
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
