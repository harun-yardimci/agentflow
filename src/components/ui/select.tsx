import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

export const selectVariants = cva(
  'w-full rounded-md border border-border-secondary bg-surface-2 px-3 '
    + 'font-mono text-xs text-text-primary outline-none transition-colors '
    + 'focus-visible:border-accent-orange focus-visible:ring-2 '
    + 'focus-visible:ring-accent-orange/30 '
    + 'aria-[invalid=true]:border-accent-red aria-[invalid=true]:ring-accent-red/20 '
    + 'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        lg: 'h-10 py-2 text-sm',
        md: 'h-9 py-2 text-xs',
        sm: 'h-8 py-1.5 text-[11px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>,
    VariantProps<typeof selectVariants> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ children, className, size, ...props }, ref) => {
    return (
      <select className={cn(selectVariants({ size }), className)} ref={ref} {...props}>
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';
