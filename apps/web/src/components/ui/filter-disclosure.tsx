import type { ReactNode } from 'react';

export function FilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  return (
    <details className="filter-disclosure" open={activeCount > 0}>
      <summary>
        <span>Mais filtros</span>
        {activeCount > 0 && (
          <small>
            {activeCount === 1
              ? '1 filtro adicional ativo'
              : `${activeCount} filtros adicionais ativos`}
          </small>
        )}
      </summary>
      <div className="filter-disclosure-fields">{children}</div>
    </details>
  );
}
