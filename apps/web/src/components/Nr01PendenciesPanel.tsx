import { useEffect, useState } from 'react';
import {
  nr01PendenciesSchema,
  type Nr01Pendencies,
  type Nr01PendencyOrigin,
  type Nr01PendencyRule,
  type Nr01PendencyStatus,
} from '@renr/contracts';
import { useActionData, civilDate } from './actions/useActionData';
import { Button } from './ui/button';

export type Nr01RouteFilters = {
  status: Nr01PendencyStatus | '';
  rule: Nr01PendencyRule | '';
  origin: Nr01PendencyOrigin | '';
};

const statusOrder: readonly Nr01PendencyStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_VALIDATION',
  'NEEDS_REVIEW',
  'COMPLETED',
];

const statusLabels: Record<Nr01PendencyStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  AWAITING_VALIDATION: 'Aguardando validação',
  NEEDS_REVIEW: 'Necessita revisão',
  COMPLETED: 'Concluído',
};

const ruleLabels: Record<Nr01PendencyRule, string> = {
  ACTION_OVERDUE: 'Ação com prazo vencido',
  ACTION_MISSING_EVIDENCE: 'Falta de evidência ativa',
  ACTION_PLANNED: 'Ação planejada aguardando início',
  ACTION_AWAITING_EFFICACY: 'Ação aguardando parecer de eficácia',
  ACTION_AWAITING_CLOSURE: 'Ação aguardando encerramento técnico',
  ACTION_EFFICACY_REVIEW_REQUIRED: 'Parecer de eficácia requer revisão',
  ACTION_EFFICACY_FOLLOW_UP: 'Parecer não eficaz ou inconclusivo',
  ACTION_CLOSURE_REVIEW_REQUIRED: 'Encerramento técnico requer revisão',
  ACTION_ASSIGNEE_INACTIVE: 'Responsável atribuído inativo',
  ACTION_ORIGIN_CHANGED: 'Contexto ou origem da ação alterado',
  RISK_DRAFT: 'Risco em rascunho',
  RISK_WITHOUT_ACTION: 'Risco sem medida ativa vinculada',
  RISK_AWAITING_EVALUATION: 'Risco aguardando avaliação técnica',
  RISK_EVALUATION_REVIEW_REQUIRED: 'Avaliação técnica do risco requer revisão',
  ORIGIN_INACTIVE: 'Estrutura de origem inativa',
};

function StatusGlyph({ status }: { status: Nr01PendencyStatus }) {
  switch (status) {
    case 'PENDING':
      return (
        <svg className="nr01-status-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="1" fill="currentColor" />
        </svg>
      );
    case 'IN_PROGRESS':
      return (
        <svg className="nr01-status-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M8 4.5v3.7l2.5 1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'AWAITING_VALIDATION':
      return (
        <svg className="nr01-status-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="11"
            height="11"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'NEEDS_REVIEW':
      return (
        <svg className="nr01-status-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 2.2 14 13H2L8 2.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8 6.2v3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="11.2" r="0.85" fill="currentColor" />
        </svg>
      );
    case 'COMPLETED':
      return (
        <svg className="nr01-status-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M5.2 8.2 7.2 10.2 11 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

function originHref(item: Nr01Pendencies['items'][number], returnTo: string): string {
  const params = new URLSearchParams({ returnTo });
  return item.origin === 'ACTION' && item.actionId
    ? `#/acoes/${item.actionId}?${params}`
    : `#/inventario/${item.riskId}?${params}`;
}

export function Nr01PendenciesPanel({
  organizationId,
  scopeFilters,
  nrFilters,
  page,
  attempt,
  returnTo,
  onExpire,
  onUnavailable,
  onChangeFilters,
  onPageHref,
}: {
  organizationId: string;
  scopeFilters: URLSearchParams;
  nrFilters: Nr01RouteFilters;
  page: number;
  attempt: number;
  returnTo: string;
  onExpire: () => void;
  onUnavailable?: (status: number) => void;
  onChangeFilters: (next: Nr01RouteFilters) => void;
  onPageHref: (nextPage: number) => string;
}) {
  const [localAttempt, setLocalAttempt] = useState(0);
  const [retained, setRetained] = useState<Nr01Pendencies | null>(null);

  const query = new URLSearchParams(scopeFilters);
  if (nrFilters.status) query.set('status', nrFilters.status);
  if (nrFilters.rule) query.set('rule', nrFilters.rule);
  if (nrFilters.origin) query.set('origin', nrFilters.origin);
  query.set('page', String(page));
  query.set('pageSize', '10');

  const result = useActionData(
    `/organizations/${organizationId}/management-indicators/nr01-pendencies?${query}`,
    nr01PendenciesSchema,
    organizationId,
    onExpire,
    attempt + localAttempt,
  );

  const denied = result.errorStatus !== null && [401, 403, 404].includes(result.errorStatus);

  if (result.data && result.data !== retained) setRetained(result.data);
  if ((result.error || denied) && retained) setRetained(null);

  useEffect(() => {
    if (denied && result.errorStatus !== null) onUnavailable?.(result.errorStatus);
  }, [denied, result.errorStatus, onUnavailable]);

  const retainedForOrg = retained?.organizationId === organizationId ? retained : null;
  const data =
    result.error || denied ? null : (result.data ?? (result.loading ? retainedForOrg : null));
  const hasQueueFilters = Boolean(nrFilters.status || nrFilters.rule || nrFilters.origin);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section
      className="surface nr01-panel"
      aria-labelledby="nr01-pendencies-heading"
      aria-busy={result.loading}
    >
      <div className="dashboard-reflow-heading">
        <div>
          <h2 id="nr01-pendencies-heading">Pendências da NR-01</h2>
          {data && (
            <p className="chart-note">
              Referência {civilDate(data.referenceDate)} · {data.timeZone} · Projeção operacional (
              {data.ruleSet.version})
            </p>
          )}
        </div>
        <a className="action-link" href="#/relatorios">
          Abrir resumo executivo em Relatórios
        </a>
      </div>

      {result.loading && !data && (
        <p className="chart-note" role="status">
          Carregando pendências da NR-01…
        </p>
      )}

      {result.error && (
        <div className="feedback error" role="alert">
          <p>{result.error}</p>
          <Button variant="outline" onClick={() => setLocalAttempt((value) => value + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && (
        <>
          <p className="nr01-scope-note">{data.ruleSet.scopeNote}</p>

          <div className="nr01-status-bar" role="group" aria-label="Filtrar por situação NR-01">
            {statusOrder.map((status) => {
              const pressed = nrFilters.status === status;
              return (
                <button
                  key={status}
                  type="button"
                  className={`nr01-status-chip nr01-status-${status.toLowerCase()}`}
                  aria-pressed={pressed}
                  onClick={() =>
                    onChangeFilters({
                      ...nrFilters,
                      status: pressed ? '' : status,
                    })
                  }
                >
                  <span className="nr01-status-chip-head">
                    <StatusGlyph status={status} />
                    <span>{statusLabels[status]}</span>
                  </span>
                  <strong>{data.summary.byStatus[status]}</strong>
                </button>
              );
            })}
          </div>

          <dl className="dashboard-counts nr01-signals" aria-label="Sinais verificáveis no recorte">
            <div>
              <dt>Ações vencidas</dt>
              <dd>{data.summary.signals.overdueActions}</dd>
            </div>
            <div>
              <dt>Falta de evidência ativa</dt>
              <dd>{data.summary.signals.missingEvidence}</dd>
            </div>
            <div>
              <dt>Riscos sem medida ativa</dt>
              <dd>{data.summary.signals.risksWithoutAction}</dd>
            </div>
            <div>
              <dt>Aguardando avaliação ou validação</dt>
              <dd>{data.summary.signals.awaitingEvaluationOrValidation}</dd>
            </div>
            <div>
              <dt>Necessitam revisão</dt>
              <dd>{data.summary.signals.needsReview}</dd>
            </div>
          </dl>

          <div className="nr01-filters" role="group" aria-label="Filtros da fila de pendências">
            <div>
              <label htmlFor="nr01-filter-status">Situação</label>
              <select
                id="nr01-filter-status"
                value={nrFilters.status}
                onChange={(event) =>
                  onChangeFilters({
                    ...nrFilters,
                    status: event.target.value as Nr01PendencyStatus | '',
                  })
                }
              >
                <option value="">Todas ({data.summary.total})</option>
                {statusOrder.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]} ({data.summary.byStatus[status]})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="nr01-filter-rule">Regra operacional</label>
              <select
                id="nr01-filter-rule"
                value={nrFilters.rule}
                onChange={(event) =>
                  onChangeFilters({
                    ...nrFilters,
                    rule: event.target.value as Nr01PendencyRule | '',
                  })
                }
              >
                <option value="">Todas as regras</option>
                {(Object.entries(ruleLabels) as [Nr01PendencyRule, string][]).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label htmlFor="nr01-filter-origin">Origem</label>
              <select
                id="nr01-filter-origin"
                value={nrFilters.origin}
                onChange={(event) =>
                  onChangeFilters({
                    ...nrFilters,
                    origin: event.target.value as Nr01PendencyOrigin | '',
                  })
                }
              >
                <option value="">Riscos e ações ({data.summary.total})</option>
                <option value="ACTION">Ações preventivas ({data.summary.byOrigin.ACTION})</option>
                <option value="RISK">Riscos do inventário ({data.summary.byOrigin.RISK})</option>
              </select>
            </div>

            {hasQueueFilters && (
              <div className="nr01-filter-reset">
                <Button
                  variant="outline"
                  onClick={() => onChangeFilters({ status: '', rule: '', origin: '' })}
                >
                  Limpar filtros da fila
                </Button>
              </div>
            )}
          </div>

          {data.total === 0 ? (
            <p className="nr01-empty">
              {data.summary.total === 0
                ? 'Nenhum risco ou medida preventiva registrado no recorte selecionado.'
                : 'Nenhum registro encontrado para os filtros aplicados.'}
            </p>
          ) : (
            <div className="nr01-table-wrapper">
              <table className="chart-table nr01-pendencies-table" role="table">
                <caption className="sr-only">Pendências da NR-01 no recorte atual</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      Registro e origem
                    </th>
                    <th scope="col" role="columnheader">
                      Situação
                    </th>
                    <th scope="col" role="columnheader">
                      Motivo e evidências
                    </th>
                    <th scope="col" role="columnheader">
                      Prazo e responsável
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {data.items.map((item) => (
                    <tr key={item.id} role="row">
                      <th scope="row" role="rowheader">
                        <a href={originHref(item, returnTo)}>{item.title}</a>
                        <span className="nr01-meta">
                          {item.origin === 'ACTION' ? 'Ação preventiva' : 'Risco'} ·{' '}
                          {item.unit.name} / {item.sector.name}
                        </span>
                        <span className="nr01-submeta">{item.contextLabel}</span>
                      </th>
                      <td role="cell">
                        <div className="nr01-status-cell">
                          <span className={`nr01-badge nr01-status-${item.status.toLowerCase()}`}>
                            <StatusGlyph status={item.status} />
                            <span>{statusLabels[item.status]}</span>
                          </span>
                          {item.isOverdue && (
                            <span className="nr01-overdue-tag">Prazo vencido</span>
                          )}
                        </div>
                      </td>
                      <td role="cell">
                        <p className="nr01-reason">{item.reasonSummary}</p>
                        {item.evidence !== null && (
                          <p className="nr01-evidence-line">
                            Evidências: {item.evidence.activeCount}{' '}
                            {item.evidence.activeCount === 1 ? 'ativa' : 'ativas'}
                            {item.evidence.archivedCount > 0
                              ? ` · ${item.evidence.archivedCount} ${
                                  item.evidence.archivedCount === 1 ? 'arquivada' : 'arquivadas'
                                }`
                              : ''}
                          </p>
                        )}
                        {item.missingInfo.length > 0 && (
                          <ul
                            className="nr01-missing-list"
                            aria-label="Informações ausentes para avaliação"
                          >
                            {item.missingInfo.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td role="cell">
                        <p className="nr01-due">
                          {item.dueDate ? (
                            <time dateTime={item.dueDate}>{civilDate(item.dueDate)}</time>
                          ) : (
                            'Sem prazo registrado'
                          )}
                        </p>
                        <p className="nr01-responsible">
                          {item.responsible
                            ? `${item.responsible.name}${
                                !item.responsible.isActive ? ' (vínculo inativo)' : ''
                              }`
                            : 'Responsável definido na avaliação/plano'}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.total > 0 && (
            <nav className="dashboard-pagination" aria-label="Paginação de pendências NR-01">
              {data.page > 1 && <a href={onPageHref(Math.min(pages, data.page - 1))}>Anterior</a>}
              <span>
                Página {data.page} de {pages} · {data.total}{' '}
                {data.total === 1 ? 'registro' : 'registros'}
                {data.total !== data.summary.total ? ` de ${data.summary.total} no recorte` : ''}
              </span>
              {data.page < pages && <a href={onPageHref(data.page + 1)}>Próxima</a>}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
