import { useRef, useState } from 'react';
import { riskRegistrationsSchema, type RiskRegistrations as Registrations } from '@renr/contracts';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import { useRiskData } from './risks/useRiskData';
import { Button } from './ui/button';

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

export function RiskRegistrations({
  organizationId,
  onExpire,
}: {
  organizationId: string;
  onExpire: () => void;
}) {
  const [days, setDays] = useState(30);
  const [attempt, setAttempt] = useState(0);
  const result = useRiskData(
    `/organizations/${organizationId}/risk-registrations?days=${days}`,
    riskRegistrationsSchema,
    onExpire,
    attempt,
  );
  const data = result.data?.organizationId === organizationId ? result.data : null;
  return (
    <section className="surface registrations-panel" aria-labelledby="registrations-heading">
      <div className="dashboard-section-heading">
        <div>
          <p className="panel-label">ATIVIDADE DE REGISTRO</p>
          <h2 id="registrations-heading">Cadastros de riscos por dia</h2>
        </div>
        <div className="registrations-period">
          <label htmlFor="registrations-period">Período de cadastros</label>
          <select
            id="registrations-period"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>
      </div>
      <p className="chart-note">
        Inclui rascunhos, registrados e arquivados pela data do cadastro. Não mede evolução de saúde
        nem redução de exposição.
      </p>
      {result.loading ? (
        <p role="status">Carregando série de cadastros…</p>
      ) : !data ? (
        <div className="feedback error" role="alert">
          <p>{result.error || 'Não foi possível validar a série desta empresa.'}</p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Atualizar série de cadastros
          </Button>
        </div>
      ) : (
        <RegistrationChart key={`${organizationId}-${days}`} data={data} />
      )}
    </section>
  );
}

function RegistrationChart({ data }: { data: Registrations }) {
  const scope = useRef<HTMLDivElement>(null);
  usePresentationMotion(scope, data);
  const width = 640;
  const left = 38;
  const right = width - 20;
  const bottom = 158;
  const top = 20;
  const max = Math.max(1, ...data.points.map((point) => point.count));
  const points = data.points.map((point, index) => ({
    ...point,
    x: left + (index * (right - left)) / Math.max(1, data.points.length - 1),
    y: bottom - (point.count / max) * (bottom - top),
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = `${line} L${right},${bottom} L${left},${bottom} Z`;
  const label = `${data.total} cadastros entre ${dateLabel(data.fromDate)} e ${dateLabel(data.toDate)}, fuso ${data.timeZone}`;
  return (
    <div className="registrations-chart" ref={scope}>
      <div className="registrations-summary">
        <p>
          <strong data-motion-value>{data.total.toLocaleString('pt-BR')}</strong> cadastros no
          período
        </p>
        <p className="chart-note">
          {dateLabel(data.fromDate)} a {dateLabel(data.toDate)} · {data.timeZone}
        </p>
      </div>
      <svg viewBox={`0 0 ${width} 190`} role="img" aria-label={label} className="registrations-svg">
        <title>{label}</title>
        <line x1={left} y1={bottom} x2={right} y2={bottom} className="registrations-axis" />
        <line x1={left} y1={top} x2={right} y2={top} className="registrations-grid" />
        <text x={left - 10} y={bottom + 4} textAnchor="end">
          0
        </text>
        <text x={left - 10} y={top + 4} textAnchor="end">
          {max}
        </text>
        <g data-chart-bar style={{ transformOrigin: `${left}px ${bottom}px` }}>
          <path d={area} className="registrations-area" />
          <path d={line} className="registrations-line" />
          {points
            .filter((point) => point.count > 0)
            .map((point) => (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r={3}
                className="registrations-point"
              />
            ))}
        </g>
        <text x={left} y={183}>
          {dateLabel(data.fromDate)}
        </text>
        <text x={right} y={183} textAnchor="end">
          {dateLabel(data.toDate)}
        </text>
      </svg>
      {data.total === 0 && (
        <p className="feedback">
          Nenhum cadastro neste período. Isso não significa ausência de riscos.
        </p>
      )}
      <details className="registrations-values">
        <summary>Ver cadastros por dia</summary>
        <div
          className="registrations-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Valores da série de cadastros"
        >
          <table aria-label="Cadastros diários de riscos">
            <thead>
              <tr>
                <th scope="col">Data ({data.timeZone})</th>
                <th scope="col">Cadastros</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((point) => (
                <tr key={point.date}>
                  <td>
                    <time dateTime={point.date}>{dateLabel(point.date)}</time>
                  </td>
                  <td>{point.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="chart-note">
        Contagem histórica de criação; o arquivamento posterior não apaga um cadastro da série. O
        painel de registros ativos usa outro denominador.
      </p>
    </div>
  );
}
