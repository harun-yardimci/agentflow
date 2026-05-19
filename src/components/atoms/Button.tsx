import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center rounded-md border font-mono ' +
    'transition-colors duration-150 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-accent-orange/50 ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost:
          'border-border-secondary bg-surface-2 text-text-secondary hover:border-border-hover hover:bg-surface-3',
        primary:
          'border-accent-orange bg-accent-orange-bg text-accent-orange hover:bg-accent-orange/10',
        success:
          'border-accent-green bg-accent-green-bg text-accent-green hover:bg-accent-green/10',
        danger:
          'border-accent-red/25 bg-accent-red-bg text-accent-red hover:bg-accent-red/10',
      },
      size: {
        default: 'px-4 py-2 text-xs',
        small: 'px-3 py-1 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'default',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}
