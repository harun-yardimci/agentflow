import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const CARD_STATUS_TONE_CLASSES = {
  active: 'border-l-status-active',
  error: 'border-l-status-error',
  idle: 'border-l-status-idle',
  success: 'border-l-status-success',
  warning: 'border-l-status-warning',
} as const;

export type CardStatusTone = keyof typeof CARD_STATUS_TONE_CLASSES;

export const cardVariants = cva(
  'rounded-lg border border-border-primary bg-surface-1 text-text-primary '
    + 'shadow-card',
  {
    variants: {
      variant: {
        default: '',
        interactive:
          'cursor-pointer transition-colors duration-150 '
          + 'hover:border-border-hover hover:bg-surface-2',
        'status-bordered': 'border-l-2',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function isCardStatusTone(value: string): value is CardStatusTone {
  return value in CARD_STATUS_TONE_CLASSES;
}

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  statusTone?: CardStatusTone | string;
}

export function Card({
  className,
  statusTone = 'idle',
  variant,
  ...props
}: CardProps): React.JSX.Element {
  const normalizedTone = isCardStatusTone(statusTone) ? statusTone : 'idle';

  return (
    <div
      className={cn(
        cardVariants({ variant }),
        variant === 'status-bordered' && CARD_STATUS_TONE_CLASSES[normalizedTone],
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, ...props }: CardHeaderProps): React.JSX.Element {
  return <div className={cn('border-b border-border-primary px-4 py-3', className)} {...props} />;
}

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardBody({ className, ...props }: CardBodyProps): React.JSX.Element {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardFooter({ className, ...props }: CardFooterProps): React.JSX.Element {
  return <div className={cn('border-t border-border-primary px-4 py-3', className)} {...props} />;
}
