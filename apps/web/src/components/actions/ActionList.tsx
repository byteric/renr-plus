import { useEffect, useState, type FormEvent } from 'react';
import {
  actionWorkspaceListSchema,
  actionWorkspaceQuerySchema,
  riskWorkspaceListSchema,
  unitListSchema,
  sectorListSchema,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { ContextualHelp } from '../ui/contextual-help';
import { FilterDisclosure } from '../ui/filter-disclosure';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { actionLabels, civilDate, useActionData } from './useActionData';
import { ActionPending, ActionPriority } from './ActionContext';

export function ActionList({
  organizationId,
  query,
  canCreateAction = false,
  scopeRestricted = false,
  permissionsLoading = false,
  onExpire,
  onOpenDetail,
  takeReturnPosition,
}: {
  organizationId: string;
  query: string;
  canCreateAction?: boolean;
  scopeRestricted?: boolean;
  permissionsLoading?: boolean;
  onExpire: () => void;
  onOpenDetail?: (id: string) => void;
  takeReturnPosition?: (query: string) => { id: string; top: number } | null;
}) {
  const params = new URLSearchParams(query);
  const parsed = actionWorkspaceQuerySchema.safeParse(Object.fromEntries(params));
  const duplicates = [...params.keys()].some((key) => params.getAll(key).length > 1);
  const additionalFilters = ['unitId', 'sectorId', 'status'].filter((name) =>
    params.get(name),
  ).length;
  const [attempt, setAttempt] = useState(0);
  const [unitId, setUnitId] = useState(params.get('unitId') ?? '');
  const [selectedRiskId, setSelectedRiskId] = useState('');
  const data = useActionData(
    parsed.success && !duplicates
      ? `/organizations/${organizationId}/action-workspaces?${query || 'page=1'}`
      : null,
    actionWorkspaceListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const eligibleRiskFeed = useActionData(
    canCreateAction
      ? `/organizations/${organizationId}/risk-workspaces?status=REGISTERED&page=1&pageSize=50`
      : null,
    riskWorkspaceListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const eligibleRisks = (eligibleRiskFeed.data?.items ?? []).filter(
    (risk) => risk.status === 'REGISTERED' && risk.unit.isActive && risk.sector.isActive,
  );
  const validSelectedRiskId = eligibleRisks.some((risk) => risk.id === selectedRiskId)
    ? selectedRiskId
    : '';
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
  useEffect(() => {
    if (!data.data) return;
    const position = takeReturnPosition?.(query);
    const id = position?.id ?? sessionStorage.getItem('action-return-focus');
    if (id) {
      document.getElementById(`action-${id}`)?.focus({ preventScroll: Boolean(position) });
      sessionStorage.removeItem('action-return-focus');
    }
    if (position) window.scrollTo({ top: position.top, behavior: 'instant' });
  }, [data.data, query, takeReturnPosition]);
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
          {canCreateAction && (
            <a className="action-link" href="#/inventario?status=REGISTERED&page=1">
              Escolher risco no inventário →
            </a>
          )}
          <ContextualHelp
            screen="Ações"
            purpose="Acompanhe medidas preventivas, responsáveis, prazos e histórico."
            nextStep={
              canCreateAction
                ? 'Escolha um risco registrado na tela para abrir o formulário de ação preventiva ou abra uma ação existente para acompanhar seu andamento.'
                : 'Abra uma ação do seu recorte para conferir o prazo e o andamento. Se houver ações atribuídas a você, consulte Minhas ações.'
            }
            prerequisites={
              canCreateAction
                ? 'O risco de origem deve estar registrado, com unidade e setor ativos.'
                : 'O acompanhamento respeita seu recorte de empresa, unidade e setor. A execução depende de permissão e atribuição.'
            }
          />
        </div>
      </div>
      {canCreateAction ? (
        <section className="surface risk-stack" aria-labelledby="action-create-from-risk-heading">
          <h2 id="action-create-from-risk-heading">Criar ação preventiva a partir de um risco</h2>
          <p className="field-hint">
            Selecione um risco registrado em unidade e setor ativos para abrir o formulário de nova
            ação preventiva.
          </p>
          {eligibleRiskFeed.loading && (
            <p role="status" className="field-hint">
              Carregando riscos registrados elegíveis…
            </p>
          )}
          {eligibleRiskFeed.error && (
            <p role="alert" className="feedback error">
              {eligibleRiskFeed.error}
            </p>
          )}
          {!eligibleRiskFeed.loading && !eligibleRiskFeed.error && eligibleRisks.length === 0 && (
            <p className="field-hint">
              Nenhum risco registrado e ativo elegível encontrado nesta empresa. Registre um risco
              em unidade e setor ativos no inventário antes de criar uma medida.
            </p>
          )}
          {eligibleRisks.length > 0 && (
            <div className="record-actions">
              <div>
                <label htmlFor="action-eligible-risk">Risco registrado elegível</label>
                <select
                  id="action-eligible-risk"
                  value={validSelectedRiskId}
                  onChange={(event) => setSelectedRiskId(event.target.value)}
                >
                  <option value="">Selecione um risco registrado</option>
                  {eligibleRisks.map((risk) => (
                    <option key={risk.id} value={risk.id}>
                      {risk.factor} · {risk.unit.name} / {risk.sector.name}
                    </option>
                  ))}
                </select>
              </div>
              {validSelectedRiskId && (
                <a className="primary-link" href={`#/acoes/nova?riskId=${validSelectedRiskId}`}>
                  Criar ação preventiva
                </a>
              )}
            </div>
          )}
        </section>
      ) : (
        !permissionsLoading && (
          <p className="field-hint">
            {scopeRestricted
              ? 'Seu vínculo possui restrição de recorte por unidade ou setor e não permite criar ações preventivas.'
              : 'Seu perfil atual não permite criar ações preventivas. Criar medidas exige perfil Administrador ou capacidade de Decisões técnicas sem restrição de recorte.'}
          </p>
        )
      )}
      <form className="surface risk-filters" onSubmit={filter} aria-label="Filtrar ações">
        <div className="risk-search">
          <label htmlFor="action-q">Buscar título ou responsável</label>
          <input id="action-q" name="q" maxLength={120} defaultValue={params.get('q') ?? ''} />
        </div>
        {params.get('riskId') && (
          <input type="hidden" name="riskId" value={params.get('riskId') ?? ''} />
        )}
        <FilterDisclosure activeCount={additionalFilters}>
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
        </FilterDisclosure>
        <div className="actions-checks">
          <label>
            <input
              name="assignedTo"
              type="checkbox"
              value="me"
              defaultChecked={params.get('assignedTo') === 'me'}
            />
            Minhas ações
          </label>
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
        <div className="record-actions filter-actions">
          <Button type="submit">Aplicar filtros</Button>
          <a href="#/acoes?page=1">Limpar filtros</a>
        </div>
      </form>
      {(!parsed.success || duplicates) && (
        <p role="alert" className="feedback error">
          Filtros inválidos. <a href="#/acoes?page=1">Limpar filtros</a>
        </p>
      )}
      {data.loading && <StatusMessage tone="loading">Carregando ações…</StatusMessage>}
      {data.error && (
        <StatusMessage
          tone="error"
          className="feedback error"
          action={
            <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
              Atualizar ações
            </Button>
          }
        >
          <p>{data.error}</p>
        </StatusMessage>
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
                  <th>Contexto / pendências</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Ação / risco">
                      <a
                        id={`action-${item.id}`}
                        href={`#/acoes/${item.id}?returnTo=${encodeURIComponent(returnTo)}&returnFocus=${item.id}`}
                        onClick={(event) => {
                          if (
                            event.button === 0 &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.altKey &&
                            !event.shiftKey
                          ) {
                            onOpenDetail?.(item.id);
                          }
                        }}
                      >
                        {item.title}
                      </a>
                      <p className="muted">{item.risk.factor}</p>
                    </td>
                    <td data-label="Responsável">
                      {item.responsibleName}
                      <p className="muted">Membro: {item.assignedUser?.name ?? 'Sem atribuição'}</p>
                    </td>
                    <td data-label="Prazo">
                      <time dateTime={item.dueDate}>{civilDate(item.dueDate)}</time>
                      {item.isOverdue && <strong className="actions-overdue">Atrasada</strong>}
                    </td>
                    <td data-label="Contexto / pendências">
                      <p>
                        {item.riskContext.unit.name} / {item.riskContext.sector.name}
                      </p>
                      <ActionPriority context={item.riskContext} />
                      <ActionPending reasons={item.pendingReasons} />
                    </td>
                    <td data-label="Estado">
                      <StatusBadge
                        className="risk-status"
                        label={actionLabels[item.status]}
                        tone={item.status === 'IN_PROGRESS' ? 'info' : 'neutral'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.data.total > data.data.pageSize && (
            <Pagination
              label="Paginação de ações"
              page={data.data.page}
              pageSize={data.data.pageSize}
              total={data.data.total}
              pending={data.loading}
              onPageChange={page}
            />
          )}
        </>
      )}
    </div>
  );
}
