import { useState, useCallback, useEffect } from 'react';
import type { Attachment } from '@/types';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';

interface AttachmentChipProps {
  attachment: Attachment;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'img';
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) return 'code';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'file';
}

function MimeIcon({ type }: { type: string }) {
  const icon = getMimeIcon(type);

  const iconPaths: Record<string, React.ReactNode> = {
    img: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    ),
    code: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    pdf: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    file: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  };

  return <span className="shrink-0 text-text-dim">{iconPaths[icon]}</span>;
}

export function AttachmentChip({ attachment, onDelete, compact = false }: AttachmentChipProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/');

  const handleClick = () => {
    if (isImage) {
      setPreviewOpen(true);
    } else {
      window.open(api.getAttachmentUrl(attachment.id), '_blank');
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(attachment.id);
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-full border border-border-secondary bg-surface-2 transition-colors hover:border-border-hover',
          compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
        )}
        title={`${attachment.originalName} (${formatBytes(attachment.sizeBytes)})`}
      >
        <MimeIcon type={attachment.mimeType} />
        <span className={cn(
          'max-w-[140px] truncate font-mono text-text-secondary',
          compact ? 'text-[9px]' : 'text-[10px]',
        )}>
          {attachment.originalName}
        </span>
        {!compact && (
          <span className="text-[9px] text-text-dim">
            {formatBytes(attachment.sizeBytes)}
          </span>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-dim opacity-0 transition-opacity hover:bg-accent-red/20 hover:text-accent-red group-hover:opacity-100"
            aria-label={`Remove ${attachment.originalName}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        )}
      </span>
      {isImage && previewOpen && (
        <ImagePreviewOverlay
          src={api.getAttachmentUrl(attachment.id)}
          alt={attachment.originalName}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

/** Full-screen overlay for previewing image attachments */
function ImagePreviewOverlay({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
      onClick={onClose}
      role="dialog"
      aria-label={`Image preview: ${alt}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
        aria-label="Close preview"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </svg>
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-md object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-surface-2 px-3 py-1 font-mono text-xs text-text-secondary">
        {alt}
      </p>
    </div>
  );
}

/** Chip for staged (not yet uploaded) files */
export function StagedFileChip({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  return (
    <span className="group inline-flex items-center gap-1.5 rounded-full border border-border-secondary bg-surface-2 px-2.5 py-1 transition-colors">
      <MimeIcon type={file.type || 'application/octet-stream'} />
      <span className="max-w-[140px] truncate font-mono text-[10px] text-text-secondary">
        {file.name}
      </span>
      <span className="text-[9px] text-text-dim">
        {formatBytes(file.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-dim opacity-0 transition-opacity hover:bg-accent-red/20 hover:text-accent-red group-hover:opacity-100"
        aria-label={`Remove ${file.name}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" x2="6" y1="6" y2="18" />
          <line x1="6" x2="18" y1="6" y2="18" />
        </svg>
      </button>
    </span>
  );
}
