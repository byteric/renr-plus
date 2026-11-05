import { useRef, useState } from 'react';
import { managementIndicatorHistorySchema, type ManagementIndicators } from '@renr/contracts';
import { useActionData, civilDate } from './actions/useActionData';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import { Button } from './ui/button';

type RiskData = ManagementIndicators['risks'];
type Row = { key: string; label: string; count: number; href: string };

function Distribution({ title, rows }: { title: string; rows: Row[] }) {
  const maximum = rows.reduce((max, row) => Math.max(max, row.count), 1);
  return (
    <section className="surface dashboard-distribution" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p>Nenhum risco neste recorte.</p>
      ) : (
        <>
          <ul className="dashboard-bar-list" aria-label={title}>
            {rows.map(({ key, label, count, href }) => {
              const bar = (
                <>
                  <span>{label}</span>
                  <strong>{count}</strong>
                  <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                    <rect width={100} height={6} className="dashboard-bar-track" />
                    <rect
                      data-chart-bar=""
                      width={(count / maximum) * 100}
                      height={6}
                      className="dashboard-bar-fill"
                    />
                  </svg>
                </>
              );
              return (
                <li key={key}>
                  {href ? (
                    <a href={href} aria-label={label + ' ' + count}>
                      {bar}
                    </a>
                  ) : (
                    <div>{bar}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <details className="chart-values">
            <summary>Ver valores em tabela</summary>
            <table className="chart-table">
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">Recorte</th>
                  <th scope="col">Riscos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, label, count, href }) => (
                  <tr key={key}>
                    <th scope="row">{href ? <a href={href}>{label}</a> : label}</th>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export function RiskDistribution({
  data,
  filters,
  listHref,
}: {
  data: RiskData;
  filters: URLSearchParams;
  listHref: (
    path: 'inventario',
    filters: URLSearchParams,
    extra?: Record<string, string>,
  ) => string;
}) {
  const byLevel = data.levels.map((level) => ({
    key: level.methodVersionId + ':' + level.key,
    label: level.label + ' · ' + level.methodName + ' v' + level.methodVersion,
    count: level.count,
    href: listHref('inventario', filters, {
      methodVersionId: level.methodVersionId,
      levelKey: level.key,
    }),
  }));
  const byUnit = data.units.map((unit) => {
    const recorte = new URLSearchParams(filters);
    recorte.set('unitId', unit.unitId);
    return {
      key: unit.unitId,
      label: unit.name,
      count: unit.count,
      href: listHref('inventario', recorte),
    };
  });
  const unclassified = {
    key: 'unclassified',
    label: 'Sem classificação vigente',
    count: data.unclassified,
    href: listHref('inventario', filters, { classification: 'UNCLASSIFIED' }),
  };
  return (
    <>
      <p className="chart-note">
        Classificados {data.classified} · Sem classificação vigente {data.unclassified}
      </p>
      <div className="dashboard-chart-grid">
        <Distribution
          title="Distribuição por nível"
          rows={data.total ? [...byLevel, unclassified] : []}
        />
        <Distribution title="Distribuição por unidade" rows={byUnit} />
      </div>
    </>
  );
}

const eventLabels = {
  evaluations: 'Avaliações técnicas registradas',
  implementations: 'Execuções informadas',
  closures: 'Encerramentos técnicos registrados',
} as const;
type EventKey = keyof typeof eventLabels;

export function DashboardHistory({
  root,
  organizationId,
  onExpire,
  filters,
  referenceDate,
  days,
  area,
  onDays,
}: {
  root: string;
  organizationId: string;
  onExpire: () => void;
  filters: URLSearchParams;
  referenceDate: string;
  days: number;
  area: 'riscos' | 'acoes';
  onDays: (value: number) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const from = new Date(referenceDate + 'T00:00:00Z');
  from.setUTCDate(from.getUTCDate() - days + 1);
  const fromDate = from.toISOString().slice(0, 10);
  const query = new URLSearchParams(filters);
  query.set('from', fromDate);
  query.set('to', referenceDate);
  const result = useActionData(
    root + '/history?' + query,
    managementIndicatorHistorySchema,
    organizationId,
    onExpire,
    attempt,
  );
  const scope = useRef<HTMLElement>(null);
  usePresentationMotion(scope, result.data);
  const keys: EventKey[] = area === 'riscos' ? ['evaluations'] : ['implementations', 'closures'];
  const points = result.data?.points ?? [];
  const maximum = points.reduce((max, point) => Math.max(max, ...keys.map((key) => point[key])), 1);
  const visible = points.some((point) => keys.some((key) => point[key] > 0));

  return (
    <section ref={scope} className="surface dashboard-history" aria-labelledby="dashboard-history">
      <div className="dashboard-reflow-heading">
        <h2 id="dashboard-history">Evolução no período</h2>
        <div>
          <label htmlFor="dashboard-history-period">Período da série</label>
          <select
            id="dashboard-history-period"
            value={days}
            onChange={(event) => onDays(Number(event.target.value))}
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </div>
      </div>
      <p className="chart-note">
        De {civilDate(fromDate)} a {civilDate(referenceDate)}
        {result.data && ' · ' + result.data.timeZone}. Eventos registrados no período. O retrato
        atual não muda com este filtro.
      </p>
      {result.loading && <p role="status">Carregando histórico…</p>}
      {result.error && (
        <div className="feedback error" role="alert">
          <p>Histórico indisponível. {result.error}</p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Tentar carregar histórico
          </Button>
        </div>
      )}
      {result.data && !visible && <p>Nenhum evento registrado neste período para o recorte.</p>}
      {result.data && visible && (
        <>
          <div className="dashboard-history-legend">
            {keys.map((key, index) => (
              <span key={key} className={'dashboard-series-' + index}>
                {eventLabels[key]}
              </span>
            ))}
          </div>
          <svg
            className="dashboard-history-svg"
            viewBox="0 0 320 112"
            role="img"
            aria-label={keys
              .map(
                (key) =>
                  eventLabels[key] + ': ' + points.reduce((total, point) => total + point[key], 0),
              )
              .join('. ')}
          >
            <line x1={24} y1={88} x2={316} y2={88} className="chart-axis" />
            <text x={2} y={92} className="chart-axis-label">
              0
            </text>
            <text x={2} y={20} className="chart-axis-label">
              {maximum}
            </text>
            <text x={24} y={108} className="chart-axis-label">
              {civilDate(fromDate).slice(0, 5)}
            </text>
            <text x={316} y={108} textAnchor="end" className="chart-axis-label">
              {civilDate(referenceDate).slice(0, 5)}
            </text>
            {keys.map((key, index) => (
              <polyline
                key={key}
                data-chart-series=""
                className={'dashboard-series-' + index}
                pathLength={1}
                points={points
                  .map(
                    (point, position) =>
                      24 +
                      (position * 292) / Math.max(1, points.length - 1) +
                      ',' +
                      (88 - (point[key] / maximum) * 72),
                  )
                  .join(' ')}
              />
            ))}
          </svg>
          <details className="chart-values">
            <summary>Ver eventos por dia</summary>
            <table className="chart-table dashboard-history-table">
              <caption>Eventos registrados no período</caption>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  {keys.map((key) => (
                    <th key={key} scope="col">
                      {eventLabels[key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{civilDate(point.date)}</th>
                    {keys.map((key) => (
                      <td key={key}>{point[key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
