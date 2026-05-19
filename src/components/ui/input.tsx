import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

export const inputVariants = cva(
  'w-full rounded-md border border-border-secondary bg-surface-2 px-3 '
    + 'font-mono text-xs text-text-primary placeholder:text-text-dim '
    + 'outline-none transition-colors focus-visible:border-accent-orange '
    + 'focus-visible:ring-2 focus-visible:ring-accent-orange/30 '
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

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, type = 'text', ...props }, ref) => {
    return (
      <input
        className={cn(inputVariants({ size }), className)}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
