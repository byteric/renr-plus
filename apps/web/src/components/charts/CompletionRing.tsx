import { useId } from 'react';

export function CompletionRing({ total, completed }: { total: number; completed: number }) {
  const id = useId();
  const percentage = total === 0 ? 0 : (completed / total) * 100;
  return (
    <section className="surface completion-panel" aria-labelledby={`${id}-heading`}>
      <div className="dashboard-section-heading">
        <div>
          <p className="panel-label">RASTREABILIDADE</p>
          <h2 id={`${id}-heading`}>Fichas preliminares</h2>
        </div>
        <span className="dashboard-section-index" aria-hidden="true">
          02
        </span>
      </div>
      <div className="completion-ring">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`${completed} de ${total} registros com ficha preliminar`}
        >
          <circle cx="100" cy="100" r="78" className="ring-track" />
          <circle
            cx="100"
            cy="100"
            r="78"
            pathLength="100"
            strokeDasharray={`${percentage} 100`}
            transform="rotate(-90 100 100)"
            className="ring-value"
            data-chart-ring=""
          />
        </svg>
        <div className="completion-value">
          <strong>{total === 0 ? '—' : `${Math.round(percentage)}%`}</strong>
          <span>{total === 0 ? 'Sem registros' : `${completed} de ${total} registros`}</span>
        </div>
      </div>
      <ul className="completion-links">
        <li>
          <a href="#/inventario?page=1&evaluationPresence=WITH">
            <span>Com ficha</span>
            <strong>{completed}</strong>
          </a>
        </li>
        <li>
          <a href="#/inventario?page=1&evaluationPresence=WITHOUT">
            <span>Sem ficha</span>
            <strong>{total - completed}</strong>
          </a>
        </li>
      </ul>
      <p className="chart-note">
        Preenchimento operacional dos registros não arquivados. Uma ficha preliminar não significa
        avaliação técnica aprovada.
      </p>
    </section>
  );
}
