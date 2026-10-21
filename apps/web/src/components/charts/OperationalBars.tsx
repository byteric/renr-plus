import { useId } from 'react';
import type { RiskOverview } from '@renr/contracts';

export function OperationalBars({ units }: { units: RiskOverview['units'] }) {
  const id = useId();
  const maximum = Math.max(1, ...units.map((unit) => unit.total));
  const chartHeight = Math.max(84, units.length * 48 + 32);
  return (
    <section className="surface operational-bars" aria-labelledby={`${id}-heading`}>
      <div className="dashboard-section-heading">
        <div>
          <p className="panel-label">DISTRIBUIÇÃO DO INVENTÁRIO</p>
          <h2 id={`${id}-heading`}>Registros por unidade</h2>
        </div>
        <span className="dashboard-section-index" aria-hidden="true">
          01
        </span>
      </div>
      <p className="chart-note" id={`${id}-description`}>
        Eixo começa em zero. Até oito unidades com mais registros e a soma das demais. Sem registros
        não aparecem nas barras; unidades inativas são identificadas na tabela.
      </p>
      {units.length === 0 ? (
        <p className="chart-empty">Nenhum registro para distribuir por unidade.</p>
      ) : (
        <>
          <div className="chart-legend">
            <span>
              <i className="legend-draft" />
              Rascunhos
            </span>
            <span>
              <i className="legend-registered" />
              Registrados
            </span>
          </div>
          <svg
            className="bars-svg"
            viewBox={`0 0 520 ${chartHeight}`}
            role="img"
            aria-label="Registros por unidade"
            aria-describedby={`${id}-description`}
          >
            <line x1="142" x2="142" y1="0" y2={chartHeight - 24} className="chart-axis" />
            <line
              x1="142"
              x2="492"
              y1={chartHeight - 24}
              y2={chartHeight - 24}
              className="chart-axis"
            />
            <text x="142" y={chartHeight - 6} className="chart-axis-label">
              0
            </text>
            <text x="492" y={chartHeight - 6} textAnchor="end" className="chart-axis-label">
              {maximum}
            </text>
            {units.map((unit, index) => {
              const y = index * 48 + 6;
              const draftWidth = (unit.draft / maximum) * 350;
              const registeredWidth = (unit.registered / maximum) * 350;
              return (
                <g key={unit.kind === 'UNIT' ? unit.unitId : 'others'}>
                  <text x="130" y={y + 18} textAnchor="end" className="chart-row-label">
                    {unit.name.length > 18 ? `${unit.name.slice(0, 17)}…` : unit.name}
                  </text>
                  <g data-chart-bar="" style={{ transformOrigin: '142px center' }}>
                    <rect x="142" y={y} width={draftWidth} height="26" className="bar-draft" />
                    <rect
                      x={142 + draftWidth}
                      y={y}
                      width={registeredWidth}
                      height="26"
                      className="bar-registered"
                    />
                  </g>
                  <text x="510" y={y + 18} textAnchor="end" className="chart-row-value">
                    {unit.total}
                  </text>
                </g>
              );
            })}
          </svg>
          <details className="chart-values">
            <summary>Ver valores e filtrar por unidade</summary>
            <div
              className="chart-table-scroll"
              role="region"
              aria-label="Valores por unidade"
              tabIndex={0}
            >
              <table className="chart-table">
                <caption>Valores e acesso ao inventário por unidade</caption>
                <thead>
                  <tr>
                    <th scope="col">Unidade</th>
                    <th scope="col">Rascunhos</th>
                    <th scope="col">Registrados</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.kind === 'UNIT' ? unit.unitId : 'others'}>
                      <td>
                        {unit.kind === 'UNIT' ? (
                          <a href={`#/inventario?page=1&unitId=${encodeURIComponent(unit.unitId)}`}>
                            {unit.name}
                            {!unit.isActive && ' · inativa'}
                          </a>
                        ) : (
                          unit.name
                        )}
                      </td>
                      <td>{unit.draft}</td>
                      <td>{unit.registered}</td>
                      <td>{unit.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <a className="action-link" href="#/inventario?page=1">
        Ver inventário completo
      </a>
    </section>
  );
}
