import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

export const textareaVariants = cva(
  'w-full rounded-md border border-border-secondary bg-surface-2 px-3 py-2 '
    + 'font-mono text-xs text-text-primary placeholder:text-text-dim '
    + 'outline-none transition-colors focus-visible:border-accent-orange '
    + 'focus-visible:ring-2 focus-visible:ring-accent-orange/30 '
    + 'aria-[invalid=true]:border-accent-red aria-[invalid=true]:ring-accent-red/20 '
    + 'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      resize: {
        both: 'resize',
        none: 'resize-none',
        vertical: 'resize-y',
      },
      size: {
        lg: 'min-h-32 text-sm',
        md: 'min-h-24 text-xs',
        sm: 'min-h-20 text-[11px]',
      },
    },
    defaultVariants: {
      resize: 'vertical',
      size: 'md',
    },
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, resize, size, ...props }, ref) => {
    return (
      <textarea
        className={cn(textareaVariants({ resize, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
