import * as React from 'react';

import { cn } from '../../lib/utils';

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  action?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  title: React.ReactNode;
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg '
          + 'border border-dashed border-border-secondary bg-surface-1/65 '
          + 'px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-accent-orange/35 bg-accent-orange-bg text-accent-orange">
          {icon}
        </div>
      )}
      <h3 className="font-mono text-heading font-semibold text-text-primary">{title}</h3>
      {description && <p className="max-w-lg text-body text-text-secondary">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
