import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const BADGE_TONE_CLASSES = {
  accent: 'border-accent-orange/35 bg-accent-orange-bg text-accent-orange',
  error: 'border-accent-red/35 bg-accent-red-bg text-accent-red',
  info: 'border-accent-blue/35 bg-accent-blue-bg text-accent-blue',
  neutral: 'border-border-secondary bg-surface-2 text-text-secondary',
  success: 'border-accent-green/35 bg-accent-green-bg text-accent-green',
  violet: 'border-accent-violet/35 bg-accent-violet-bg text-accent-violet',
  warning: 'border-accent-amber/35 bg-accent-amber-bg text-accent-amber',
} as const;

type BadgeTone = keyof typeof BADGE_TONE_CLASSES;

function isBadgeTone(value: string): value is BadgeTone {
  return value in BADGE_TONE_CLASSES;
}

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-mono font-medium '
    + 'tracking-wide uppercase',
  {
    variants: {
      size: {
        md: 'px-2 py-1 text-[10px]',
        sm: 'px-1.5 py-0.5 text-[9px]',
      },
      tone: BADGE_TONE_CLASSES,
    },
    defaultVariants: {
      size: 'md',
      tone: 'neutral',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    Omit<VariantProps<typeof badgeVariants>, 'tone'> {
  tone?: BadgeTone | string;
}

export function Badge({ className, size, tone = 'neutral', ...props }: BadgeProps) {
  const normalizedTone = isBadgeTone(tone) ? tone : 'neutral';

  return (
    <span
      className={cn(badgeVariants({ size, tone: normalizedTone }), className)}
      {...props}
    />
  );
}
