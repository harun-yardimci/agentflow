import * as React from 'react';

import { cn } from '../../lib/utils';

export interface ModalProps {
  children: React.ReactNode;
  className?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  overlayClassName?: string;
  title?: React.ReactNode;
}

export function Modal({
  children,
  className,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  description,
  footer,
  open,
  onOpenChange,
  overlayClassName,
  title,
}: ModalProps): React.JSX.Element | null {
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

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center '
          + 'bg-surface-0/85 p-4 backdrop-blur-sm',
        overlayClassName,
      )}
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
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={cn(
          'flex w-full max-w-[520px] flex-col rounded-lg border border-border-primary '
            + 'bg-surface-1 shadow-float',
          className,
        )}
        role="dialog"
      >
        {(title || description) && (
          <header className="shrink-0 border-b border-border-primary px-5 py-4">
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
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="shrink-0 border-t border-border-primary px-5 py-3">{footer}</footer>}
      </section>
    </div>
  );
}
