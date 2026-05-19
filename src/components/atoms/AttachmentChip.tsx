import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/types';
import * as api from '@/lib/api';

interface AttachmentChipProps {
  attachment: Attachment;
  onDelete?: (id: string) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'img';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('typescript')) return 'txt';
  return 'file';
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

export function AttachmentChip({ attachment, onDelete, className }: AttachmentChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const url = api.getAttachmentUrl(attachment.id);
  const icon = mimeIcon(attachment.mimeType);

  const handleClick = () => {
    if (isImage(attachment.mimeType)) {
      setShowPreview(true);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <>
      <div
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-md border border-border-secondary bg-surface-1 px-2 py-1 text-xs transition-colors hover:border-border-hover',
          className,
        )}
      >
        <span className="font-mono text-[9px] font-bold uppercase text-text-dim">{icon}</span>
        <button
          type="button"
          onClick={handleClick}
          className="max-w-[140px] truncate text-text-secondary hover:text-accent-orange"
          title={attachment.originalName}
        >
          {attachment.originalName}
        </button>
        <span className="font-mono text-[9px] text-text-dim">{formatSize(attachment.sizeBytes)}</span>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(attachment.id)}
            className="ml-0.5 text-text-dim opacity-0 transition-opacity hover:text-accent-red group-hover:opacity-100"
            title="Remove"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Image preview modal */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setShowPreview(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowPreview(false); }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className="absolute right-4 top-4 text-white/70 hover:text-white"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={url}
            alt={attachment.originalName}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/** Chip for staged (not yet uploaded) files */
interface StagedFileChipProps {
  file: File;
  onRemove: () => void;
}

export function StagedFileChip({ file, onRemove }: StagedFileChipProps) {
  const icon = mimeIcon(file.type);

  return (
    <div className="group inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent-orange/30 bg-accent-orange/5 px-2 py-1 text-xs">
      <span className="font-mono text-[9px] font-bold uppercase text-accent-orange/60">{icon}</span>
      <span className="max-w-[140px] truncate text-text-secondary" title={file.name}>
        {file.name}
      </span>
      <span className="font-mono text-[9px] text-text-dim">{formatSize(file.size)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-text-dim hover:text-accent-red"
        title="Remove"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
