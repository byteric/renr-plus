import type { ActionOverview } from '@renr/contracts';
export function ActionStatusBars({ totals }: { totals: ActionOverview['totals'] }) {
  const values = [
    ['PLANNED', 'Planejadas', totals.planned],
    ['IN_PROGRESS', 'Em execução', totals.inProgress],
    ['IMPLEMENTED', 'Execução informada', totals.implemented],
    ['CANCELLED', 'Canceladas', totals.cancelled],
  ] as const;
  return (
    <div className="surface">
      <h3>Distribuição por estado</h3>
      <ul className="action-status-bars" aria-label="Distribuição de ações por estado">
        {values.map(([status, label, value]) => (
          <li key={status}>
            <a href={`#/acoes?page=1&status=${status}`}>
              <span>{label}</span>
              <strong>{value}</strong>
            </a>
            <div className="action-status-track" aria-hidden="true">
              <span style={{ width: `${totals.total ? (value / totals.total) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
