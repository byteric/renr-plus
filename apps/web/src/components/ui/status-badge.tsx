import { cn } from '../../lib/utils';

export function StatusBadge({
  label,
  tone = 'neutral',
  className,
}: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  className?: string;
}) {
  return <span className={cn('status-badge', `status-badge--${tone}`, className)}>{label}</span>;
}
