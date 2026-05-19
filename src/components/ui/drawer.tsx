import * as React from 'react';

import { Button } from './button';
import { cn } from '../../lib/utils';

export interface DrawerProps {
  children: React.ReactNode;
  className?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  overlayClassName?: string;
  side?: 'left' | 'right';
  title?: React.ReactNode;
  widthClassName?: string;
}

export function Drawer({
  children,
  className,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  description,
  footer,
  open,
  onOpenChange,
  overlayClassName,
  side = 'right',
  title,
  widthClassName,
}: DrawerProps): React.JSX.Element | null {
  const titleId = React.useId();
  const descriptionId = React.useId();

  const handleClose = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!open || !closeOnEscape || typeof window === 'undefined') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, handleClose, open]);

  if (!open) {
    return null;
  }

  const sideClasses =
    side === 'left'
      ? 'mr-auto border-r border-border-primary'
      : 'ml-auto border-l border-border-primary';

  return (
    <div
      className={cn('fixed inset-0 z-50 flex bg-surface-0/55', overlayClassName)}
      onClick={
        closeOnOverlayClick
          ? (event) => {
              if (event.target === event.currentTarget) {
                handleClose();
              }
            }
          : undefined
      }
      role="presentation"
    >
      <aside
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={cn(
          'animate-slide-in flex h-full w-[420px] max-w-[92vw] flex-col '
            + 'bg-surface-0 shadow-float',
          sideClasses,
          widthClassName,
          className,
        )}
        role="dialog"
      >
        {(title || description) && (
          <header className="flex items-start justify-between gap-3 border-b border-border-primary px-4 py-3">
            <div>
              {title && (
                <h2 className="font-mono text-sm font-semibold text-text-primary" id={titleId}>
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-xs text-text-secondary" id={descriptionId}>
                  {description}
                </p>
              )}
            </div>

            <Button
              aria-label="Close drawer"
              onClick={handleClose}
              size="sm"
              variant="ghost"
            >
              x
            </Button>
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && <footer className="border-t border-border-primary px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
