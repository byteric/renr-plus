import { Button } from './button';
import { cn } from '../../lib/utils';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label,
  previousLabel = 'Página anterior',
  nextLabel = 'Próxima página',
  pending = false,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string;
  previousLabel?: string;
  nextLabel?: string;
  pending?: boolean;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className={cn('pagination', className)} aria-label={label}>
      <Button
        variant="outline"
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {previousLabel}
      </Button>
      <span className="pagination-summary">
        {page} de {pages}
      </span>
      <Button
        variant="outline"
        disabled={pending || page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        {nextLabel}
      </Button>
    </nav>
  );
}
