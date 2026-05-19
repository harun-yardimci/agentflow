import { useEffect } from 'react';
import { Button } from '@/components/atoms/Button';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[400px] rounded-lg border border-border-secondary bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border-primary px-5 py-4">
          <span className="font-sans text-sm font-semibold text-text-primary">
            {title}
          </span>
        </div>
        <div className="px-5 py-4">
          <p className="font-mono text-[11px] leading-relaxed text-text-secondary">
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-primary px-5 py-3">
          <Button size="small" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={variant} size="small" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
