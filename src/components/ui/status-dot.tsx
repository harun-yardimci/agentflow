import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const STATUS_DOT_TONE_CLASSES = {
  active: 'bg-status-active',
  error: 'bg-status-error',
  idle: 'bg-status-idle',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
} as const;

export type StatusDotTone = keyof typeof STATUS_DOT_TONE_CLASSES;

function isStatusDotTone(value: string): value is StatusDotTone {
  return value in STATUS_DOT_TONE_CLASSES;
}

export const statusDotVariants = cva('inline-block rounded-full', {
  variants: {
    size: {
      lg: 'h-2.5 w-2.5',
      md: 'h-2 w-2',
      sm: 'h-1.5 w-1.5',
    },
    tone: STATUS_DOT_TONE_CLASSES,
  },
  defaultVariants: {
    size: 'md',
    tone: 'idle',
  },
});

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    Omit<VariantProps<typeof statusDotVariants>, 'tone'> {
  tone?: StatusDotTone | string;
}

export function StatusDot({
  className,
  size,
  tone = 'idle',
  ...props
}: StatusDotProps): React.JSX.Element {
  const normalizedTone = isStatusDotTone(tone) ? tone : 'idle';

  return (
    <span
      aria-hidden="true"
      className={cn(statusDotVariants({ size, tone: normalizedTone }), className)}
      data-testid="status-dot"
      {...props}
    />
  );
}
