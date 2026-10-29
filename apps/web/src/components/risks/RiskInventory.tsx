import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  riskListQuerySchema,
  riskWorkspaceListSchema,
  sectorListSchema,
  unitListSchema,
  type RiskListQuery,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { useRiskData, statusLabels, riskDate } from './useRiskData';
import { RiskMatrix } from './RiskMatrix';
import { technicalStateLabel, pendingLabels } from './technical-labels';

export function RiskInventory({
  organizationId,
  canWrite,
  query,
  restoreScrollY,
  onOpenDetail,
  onExpire,
  selectedId,
  revision = 0,
}: {
  organizationId: string;
  canWrite: boolean;
  query: string;
  restoreScrollY?: number;
  onOpenDetail: () => void;
  onExpire: () => void;
  selectedId?: string;
  revision?: number;
}) {
  const params = new URLSearchParams(query);
  const keys = [...params.keys()];
  const parsed = riskListQuerySchema.safeParse(
    new Set(keys).size === keys.length
      ? Object.fromEntries(
          [...params].filter(([key]) => !['view', 'methodVersionId'].includes(key)),
        )
      : null,
  );
  const [attempt, setAttempt] = useState(0);
  const [unitPage, setUnitPage] = useState(1);
  const [sectorPage, setSectorPage] = useState(1);
  const [unitId, setUnitId] = useState(params.get('unitId') ?? '');
  const [sectorId, setSectorId] = useState(params.get('sectorId') ?? '');
  const units = useRiskData(
    `/organizations/${organizationId}/units?page=${unitPage}&pageSize=50`,
    unitListSchema,
    onExpire,
  );
  const sectors = useRiskData(
    unitId ? `/units/${unitId}/sectors?page=${sectorPage}&pageSize=50` : null,
    sectorListSchema,
    onExpire,
  );
  const encoded = parsed.success
    ? new URLSearchParams(
        Object.entries(parsed.data).map(([key, value]) => [key, String(value)]),
      ).toString()
    : '';
  const list = useRiskData(
    parsed.success ? `/organizations/${organizationId}/risk-workspaces?${encoded}` : null,
    riskWorkspaceListSchema,
    onExpire,
    attempt + revision,
  );
  const restored = useRef(false);
  useEffect(() => {
    if (!list.data || restored.current || restoreScrollY === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScrollY, behavior: 'instant' });
      restored.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [list.data, restoreScrollY]);
  function href(page: number) {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `#/inventario?${next}`;
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    });
    next.set('page', '1');
    if (params.get('view') === 'matrix') next.set('view', 'matrix');
    if (params.get('methodVersionId')) next.set('methodVersionId', params.get('methodVersionId')!);
    window.location.assign(`#/inventario?${next}`);
  }
  const data = list.data;
  const filters: RiskListQuery | null = parsed.success ? parsed.data : null;
  return (
    <div className="risk-stack">
      <div className="risk-toolbar">
        <p className="muted">
          Registros rastreáveis por contexto de trabalho. Estados de cadastro não representam níveis
          de risco.
        </p>
        {canWrite && (
          <a href="#/inventario/novo" className="primary-link">
            Novo risco <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      <nav className="risk-presets" aria-label="Recortes rápidos do inventário">
        <a href="#/inventario?page=1">Não arquivados</a>
        <a href="#/inventario?page=1&status=DRAFT">Rascunhos</a>
        <a href="#/inventario?page=1&evaluationPresence=WITHOUT">Sem ficha preliminar</a>
        <a href="#/inventario?page=1&status=ARCHIVED">Arquivados</a>
      </nav>
      <nav className="risk-view-tabs" aria-label="Visualização do inventário">
        {['list', 'matrix'].map((view) => {
          const next = new URLSearchParams(query);
          if (view === 'list') next.delete('view');
          else next.set('view', view);
          return (
            <a
              key={view}
              href={`#/inventario?${next}`}
              aria-current={
                (params.get('view') === 'matrix' ? 'matrix' : 'list') === view ? 'page' : undefined
              }
            >
              {view === 'list' ? 'Lista' : 'Matriz'}
            </a>
          );
        })}
      </nav>
      <form className="surface risk-filters" onSubmit={filter} aria-label="Filtros do inventário">
        <div className="risk-search">
          <label htmlFor="risk-search">Buscar no inventário</label>
          <input
            id="risk-search"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={params.get('q') ?? ''}
            placeholder="Nome do fator de risco"
          />
        </div>
        <div>
          <label htmlFor="filter-unit">Unidade</label>
          <select
            id="filter-unit"
            name="unitId"
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setSectorId('');
              setSectorPage(1);
            }}
          >
            <option value="">Todas as unidades</option>
            {units.data?.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {!unit.isActive ? ' (inativa)' : ''}
              </option>
            ))}
            {unitId && !units.data?.items.some((unit) => unit.id === unitId) && (
              <option value={unitId}>Unidade selecionada</option>
            )}
          </select>
          {units.data && units.data.total > 50 && (
            <div className="lookup-pages">
              <Button
                variant="outline"
                disabled={unitPage === 1}
                onClick={() => setUnitPage(unitPage - 1)}
              >
                Unidades anteriores
              </Button>
              <Button
                variant="outline"
                disabled={unitPage * 50 >= units.data.total}
                onClick={() => setUnitPage(unitPage + 1)}
              >
                Mais unidades
              </Button>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="filter-sector">Setor</label>
          <select
            id="filter-sector"
            name="sectorId"
            disabled={!unitId && !sectorId}
            value={sectorId}
            onChange={(event) => setSectorId(event.target.value)}
          >
            <option value="">Todos os setores</option>
            {sectors.data?.items.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
                {!sector.isActive ? ' (inativo)' : ''}
              </option>
            ))}
            {sectorId && !sectors.data?.items.some((sector) => sector.id === sectorId) && (
              <option value={sectorId}>Setor selecionado</option>
            )}
          </select>
          {sectors.data && sectors.data.total > 50 && (
            <div className="lookup-pages">
              <Button
                variant="outline"
                disabled={sectorPage === 1}
                onClick={() => setSectorPage(sectorPage - 1)}
              >
                Setores anteriores
              </Button>
              <Button
                variant="outline"
                disabled={sectorPage * 50 >= sectors.data.total}
                onClick={() => setSectorPage(sectorPage + 1)}
              >
                Mais setores
              </Button>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="filter-status">Estado do registro</label>
          <select id="filter-status" name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">Não arquivados</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="REGISTERED">Registrados</option>
            <option value="ARCHIVED">Arquivados</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-evaluation">Ficha preliminar</label>
          <select
            id="filter-evaluation"
            name="evaluationPresence"
            defaultValue={params.get('evaluationPresence') ?? ''}
          >
            <option value="">Com e sem ficha</option>
            <option value="WITH">Com ficha</option>
            <option value="WITHOUT">Sem ficha</option>
          </select>
        </div>
        <div className="filter-actions">
          <Button type="submit">Aplicar filtros</Button>
          <a href="#/inventario">Limpar filtros</a>
        </div>
      </form>
      {(units.error || sectors.error) && (
        <p role="alert" className="feedback error">
          {units.error || sectors.error}
        </p>
      )}
      {!filters && (
        <p role="alert" className="feedback error">
          Os filtros desta URL são inválidos. <a href="#/inventario">Limpar filtros</a>
        </p>
      )}
      {params.get('view') === 'matrix' && filters ? (
        <RiskMatrix organizationId={organizationId} query={query} onExpire={onExpire} />
      ) : (
        <>
          {list.loading && (
            <StatusMessage tone="loading" className="surface">
              Carregando inventário…
            </StatusMessage>
          )}
          {list.error && (
            <StatusMessage tone="error" className="feedback error">
              <p>{list.error}</p>
              <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
                Atualizar inventário
              </Button>
            </StatusMessage>
          )}
          {data && (
            <>
              <div className="risk-list-heading">
                <h2 id="risk-list-heading" tabIndex={-1}>
                  Registros de risco
                </h2>
                <p className="muted">
                  {data.total} {data.total === 1 ? 'registro' : 'registros'} · Página {data.page}
                </p>
              </div>
              {data.items.length === 0 ? (
                <section className="surface empty-state">
                  <h3>Nenhum registro neste recorte</h3>
                  <p>
                    Revise os filtros ou cadastre o primeiro fator identificado. Ausência de
                    registros não significa ausência de risco.
                  </p>
                  {canWrite && <a href="#/inventario/novo">Cadastrar um risco →</a>}
                </section>
              ) : (
                <div
                  className="risk-table-scroll"
                  role="region"
                  aria-label="Registros do inventário"
                  tabIndex={0}
                >
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th scope="col">Fator / contexto</th>
                        <th scope="col">Fonte</th>
                        <th scope="col">Avaliação técnica / prioridade</th>
                        <th scope="col">Ações / pendências</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Ficha preliminar</th>
                        <th scope="col">Atualização</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((risk) => (
                        <tr
                          key={risk.id}
                          className={selectedId === risk.id ? 'risk-selected' : undefined}
                        >
                          <td data-label="Fator / contexto">
                            <a
                              className="risk-factor-link"
                              id={`risk-open-${risk.id}`}
                              aria-current={selectedId === risk.id ? 'true' : undefined}
                              onClick={onOpenDetail}
                              href={`#/inventario/${risk.id}?returnTo=${encodeURIComponent(`#/inventario${query ? `?${query}` : ''}`)}`}
                            >
                              {risk.factor}
                            </a>
                            <p>
                              {risk.unit.name} <span aria-hidden="true">/</span> {risk.sector.name}
                              {!risk.unit.isActive || !risk.sector.isActive
                                ? ' · Escopo inativo'
                                : ''}
                            </p>
                          </td>
                          <td data-label="Fonte">{risk.sourceLabel}</td>
                          <td data-label="Avaliação técnica / prioridade">
                            <strong>{technicalStateLabel(risk)}</strong>
                            {risk.technicalEvaluationState === 'CURRENT' &&
                              risk.latestTechnicalEvaluation && (
                                <p>
                                  {risk.latestTechnicalEvaluation.priority.label} ·{' '}
                                  {risk.latestTechnicalEvaluation.method.name} v
                                  {risk.latestTechnicalEvaluation.method.version}
                                </p>
                              )}
                          </td>
                          <td data-label="Ações / pendências">
                            <a href={`#/acoes?riskId=${risk.id}&page=1`}>
                              {risk.actionSummary.open}{' '}
                              {risk.actionSummary.open === 1 ? 'aberta' : 'abertas'} ·{' '}
                              {risk.actionSummary.overdue}{' '}
                              {risk.actionSummary.overdue === 1 ? 'atrasada' : 'atrasadas'}
                            </a>
                            <p>
                              {risk.pendingReasons
                                .map((reason) => pendingLabels[reason])
                                .join(' · ') || 'Sem pendências sinalizadas'}
                            </p>
                          </td>
                          <td data-label="Estado">
                            <StatusBadge
                              className={`risk-status risk-status-${risk.status.toLowerCase()}`}
                              label={statusLabels[risk.status]}
                              tone={risk.status === 'REGISTERED' ? 'info' : 'neutral'}
                            />
                          </td>
                          <td data-label="Ficha preliminar">
                            {risk.latestEvaluation
                              ? `Ficha ${risk.latestEvaluation.sequence} · Preliminar`
                              : 'Sem ficha'}
                          </td>
                          <td data-label="Atualização">
                            <time dateTime={risk.updatedAt}>{riskDate(risk.updatedAt)}</time>
                            <span className="risk-version">Versão {risk.version}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total > data.pageSize && (
                <Pagination
                  label="Paginação do inventário"
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  pending={list.loading}
                  onPageChange={(page) => {
                    window.location.hash = href(page);
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
