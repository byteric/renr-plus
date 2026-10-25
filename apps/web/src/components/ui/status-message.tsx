import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

type StatusMessageProps = Omit<ComponentProps<'div'>, 'children'> & {
  tone?: 'info' | 'success' | 'warning' | 'error' | 'loading';
  children: ReactNode;
  action?: ReactNode;
};

export function StatusMessage({
  tone = 'info',
  children,
  action,
  className,
  role,
  ...props
}: StatusMessageProps) {
  const announcement =
    tone === 'error' ? 'alert' : tone === 'loading' || tone === 'success' ? 'status' : undefined;
  return (
    <div
      className={cn('status-message', `status-message--${tone}`, className)}
      role={role ?? announcement}
      {...props}
    >
      {children}
      {action}
    </div>
  );
}
