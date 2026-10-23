import { useState, type FormEvent } from 'react';
import {
  actionListSchema,
  actionListQuerySchema,
  unitListSchema,
  sectorListSchema,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { actionLabels, civilDate, useActionData } from './useActionData';

export function ActionList({
  organizationId,
  query,
  onExpire,
}: {
  organizationId: string;
  query: string;
  onExpire: () => void;
}) {
  const params = new URLSearchParams(query);
  const parsed = actionListQuerySchema.safeParse(Object.fromEntries(params));
  const duplicates = [...params.keys()].some((key) => params.getAll(key).length > 1);
  const [attempt, setAttempt] = useState(0);
  const [unitId, setUnitId] = useState(params.get('unitId') ?? '');
  const data = useActionData(
    parsed.success && !duplicates
      ? `/organizations/${organizationId}/actions?${query || 'page=1'}`
      : null,
    actionListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const units = useActionData(
    `/organizations/${organizationId}/units?page=1&pageSize=100`,
    unitListSchema,
    organizationId,
    onExpire,
  );
  const sectors = useActionData(
    unitId ? `/units/${unitId}/sectors?page=1&pageSize=100` : null,
    sectorListSchema,
    organizationId,
    onExpire,
  );
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget))
      if (typeof value === 'string' && value.trim()) next.set(name, value.trim());
    next.set('page', '1');
    window.location.hash = `/acoes?${next}`;
  }
  function page(value: number) {
    const next = new URLSearchParams(query);
    next.set('page', String(value));
    window.location.hash = `/acoes?${next}`;
  }
  const returnTo = `#/acoes${query ? `?${query}` : ''}`;
  return (
    <div className="risk-stack actions-workspace">
      <div className="risk-toolbar">
        <p>
          Medidas preventivas, responsáveis nominais e acompanhamento. O responsável informado não
          recebe acesso ao sistema.
        </p>
        <div className="record-actions">
          <Button variant="outline" disabled={data.loading} onClick={() => setAttempt(attempt + 1)}>
            Atualizar ações
          </Button>
          <a className="action-link" href="#/inventario">
            Criar a partir de um risco →
          </a>
        </div>
      </div>
      <form className="surface risk-filters" onSubmit={filter} aria-label="Filtrar ações">
        <div className="risk-search">
          <label htmlFor="action-q">Buscar título ou responsável</label>
          <input id="action-q" name="q" maxLength={120} defaultValue={params.get('q') ?? ''} />
        </div>
        {params.get('riskId') && (
          <input type="hidden" name="riskId" value={params.get('riskId') ?? ''} />
        )}
        <div>
          <label htmlFor="action-unit">Unidade</label>
          <select
            id="action-unit"
            name="unitId"
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
          >
            <option value="">Todas</option>
            {units.data?.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {!unit.isActive ? ' · Inativa' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="action-sector">Setor</label>
          <select
            key={unitId}
            id="action-sector"
            name="sectorId"
            defaultValue={params.get('sectorId') ?? ''}
          >
            <option value="">Todos</option>
            {sectors.data?.items.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
                {!sector.isActive ? ' · Inativo' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="action-status">Estado</label>
          <select id="action-status" name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">Todos</option>
            {Object.entries(actionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="actions-checks">
          <label>
            <input
              name="openOnly"
              type="checkbox"
              value="true"
              defaultChecked={params.get('openOnly') === 'true'}
            />{' '}
            Somente abertas
          </label>
          <label>
            <input
              name="overdue"
              type="checkbox"
              value="true"
              defaultChecked={params.get('overdue') === 'true'}
            />{' '}
            Somente atrasadas
          </label>
        </div>
        <div className="record-actions">
          <Button type="submit">Aplicar filtros</Button>
          <a href="#/acoes?page=1">Limpar filtros</a>
        </div>
      </form>
      {(!parsed.success || duplicates) && (
        <p role="alert" className="feedback error">
          Filtros inválidos. <a href="#/acoes?page=1">Limpar filtros</a>
        </p>
      )}
      {data.loading && <p role="status">Carregando ações…</p>}
      {data.error && (
        <div className="feedback error" role="alert">
          <p>{data.error}</p>
        </div>
      )}
      {data.data && (
        <>
          <p className="list-summary">
            {data.data.total} ações · Página {data.data.page}
          </p>
          {data.data.items[0] && (
            <p className="field-hint">
              Referência de prazo: {civilDate(data.data.items[0].referenceDate)} ·{' '}
              {data.data.items[0].timeZone}
            </p>
          )}
          {data.data.items.length === 0 ? (
            <div className="surface empty-state">
              <h2>Nenhuma ação neste recorte</h2>
              <p>Revise os filtros ou consulte o inventário para criar uma medida.</p>
            </div>
          ) : (
            <table className="actions-table surface">
              <caption>Ações preventivas</caption>
              <thead>
                <tr>
                  <th>Ação / risco</th>
                  <th>Responsável</th>
                  <th>Prazo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Ação / risco">
                      <a href={`#/acoes/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}>
                        {item.title}
                      </a>
                      <p className="muted">{item.risk.factor}</p>
                    </td>
                    <td data-label="Responsável">{item.responsibleName}</td>
                    <td data-label="Prazo">
                      <time dateTime={item.dueDate}>{civilDate(item.dueDate)}</time>
                      {item.isOverdue && <strong className="actions-overdue">Atrasada</strong>}
                    </td>
                    <td data-label="Estado">
                      <span className="risk-status">{actionLabels[item.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.data.total > data.data.pageSize && (
            <nav className="pagination" aria-label="Paginação de ações">
              <Button
                variant="outline"
                disabled={data.data.page <= 1}
                onClick={() => page(data.data!.page - 1)}
              >
                Página anterior
              </Button>
              <Button
                variant="outline"
                disabled={data.data.page * data.data.pageSize >= data.data.total}
                onClick={() => page(data.data!.page + 1)}
              >
                Próxima página
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
