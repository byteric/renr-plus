import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  riskListQuerySchema,
  riskListSchema,
  sectorListSchema,
  unitListSchema,
  type RiskListQuery,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { useRiskData, statusLabels, riskDate } from './useRiskData';

export function RiskInventory({
  organizationId,
  canWrite,
  query,
  restoreScrollY,
  onOpenDetail,
  onExpire,
}: {
  organizationId: string;
  canWrite: boolean;
  query: string;
  restoreScrollY?: number;
  onOpenDetail: () => void;
  onExpire: () => void;
}) {
  const params = new URLSearchParams(query);
  const keys = [...params.keys()];
  const parsed = riskListQuerySchema.safeParse(
    new Set(keys).size === keys.length ? Object.fromEntries(params) : null,
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
    parsed.success ? `/organizations/${organizationId}/risks?${encoded}` : null,
    riskListSchema,
    onExpire,
    attempt,
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
    window.location.hash = `/inventario?${next}`;
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
      {list.loading && (
        <p role="status" className="surface">
          Carregando inventário…
        </p>
      )}
      {list.error && (
        <div role="alert" className="feedback error">
          <p>{list.error}</p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Atualizar inventário
          </Button>
        </div>
      )}
      {data && (
        <>
          <div className="risk-list-heading">
            <h2>Registros de risco</h2>
            <p className="muted">
              {data.total} {data.total === 1 ? 'registro' : 'registros'} · Página {data.page}
            </p>
          </div>
          {data.items.length === 0 ? (
            <section className="surface empty-state">
              <h3>Nenhum registro neste recorte</h3>
              <p>
                Revise os filtros ou cadastre o primeiro fator identificado. Ausência de registros
                não significa ausência de risco.
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
                    <th scope="col">Estado</th>
                    <th scope="col">Ficha preliminar</th>
                    <th scope="col">Atualização</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((risk) => (
                    <tr key={risk.id}>
                      <td data-label="Fator / contexto">
                        <a
                          className="risk-factor-link"
                          onClick={onOpenDetail}
                          href={`#/inventario/${risk.id}?returnTo=${encodeURIComponent(`#/inventario${query ? `?${query}` : ''}`)}`}
                        >
                          {risk.factor}
                        </a>
                        <p>
                          {risk.unit.name} <span aria-hidden="true">/</span> {risk.sector.name}
                          {!risk.unit.isActive || !risk.sector.isActive ? ' · Escopo inativo' : ''}
                        </p>
                      </td>
                      <td data-label="Estado">
                        <span className={`risk-status risk-status-${risk.status.toLowerCase()}`}>
                          {statusLabels[risk.status]}
                        </span>
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
            <nav className="pagination" aria-label="Paginação do inventário">
              {data.page > 1 ? (
                <a href={href(data.page - 1)}>Página anterior</a>
              ) : (
                <span>Página anterior</span>
              )}
              <span>
                {data.page} de {Math.ceil(data.total / data.pageSize)}
              </span>
              {data.page * data.pageSize < data.total ? (
                <a href={href(data.page + 1)}>Próxima página</a>
              ) : (
                <span>Próxima página</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
