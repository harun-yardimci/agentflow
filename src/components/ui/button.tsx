import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md '
    + 'border font-mono font-medium transition-colors duration-150 '
    + 'focus-visible:outline-none focus-visible:ring-2 '
    + 'focus-visible:ring-accent-orange/40 disabled:cursor-not-allowed '
    + 'disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-accent-orange bg-accent-orange text-black '
          + 'hover:bg-accent-orange/85',
        secondary:
          'border-border-secondary bg-surface-2 text-text-primary '
          + 'hover:border-border-hover hover:bg-surface-3',
        ghost:
          'border-transparent bg-transparent text-text-secondary '
          + 'hover:border-border-secondary hover:bg-surface-2 '
          + 'hover:text-text-primary',
        danger:
          'border-accent-red/40 bg-accent-red-bg text-accent-red '
          + 'hover:bg-accent-red/15',
      },
      size: {
        sm: 'h-8 px-3 text-[11px]',
        md: 'h-9 px-4 text-xs',
        lg: 'h-10 px-5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, type, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        type={type ?? 'button'}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
