import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  maxFileSize?: number;
  maxFiles?: number;
  accept?: string;
  uploading?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({
  onFiles,
  maxFileSize = MAX_FILE_SIZE,
  maxFiles = MAX_FILES,
  accept,
  uploading = false,
  compact = false,
  disabled = false,
}: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndEmit = useCallback(
    (fileList: FileList | File[]) => {
      setError(null);
      const files = Array.from(fileList);

      if (files.length > maxFiles) {
        setError(`Max ${maxFiles} files at a time`);
        return;
      }

      const oversized = files.find((f) => f.size > maxFileSize);
      if (oversized) {
        setError(`${oversized.name} exceeds ${formatBytes(maxFileSize)} limit`);
        return;
      }

      onFiles(files);
    },
    [maxFileSize, maxFiles, onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled || uploading) return;
      validateAndEmit(e.dataTransfer.files);
    },
    [disabled, uploading, validateAndEmit],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled && !uploading) setDragOver(true);
    },
    [disabled, uploading],
  );

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleClick = useCallback(() => {
    if (!disabled && !uploading) inputRef.current?.click();
  }, [disabled, uploading]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        validateAndEmit(e.target.files);
        e.target.value = '';
      }
    },
    [validateAndEmit],
  );

  // Compact mode: paperclip icon button
  if (compact) {
    return (
      <div className="inline-flex items-center">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
            dragOver
              ? 'border-accent-orange bg-accent-orange/10'
              : 'border-border-secondary bg-surface-2 hover:border-border-hover',
            (disabled || uploading) && 'cursor-not-allowed opacity-40',
          )}
          title="Attach files"
          aria-label="Attach files"
        >
          {uploading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-dim border-t-accent-orange" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-text-dim"
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleChange}
          className="hidden"
          aria-hidden="true"
        />
        {error && (
          <span className="ml-2 text-[10px] text-accent-red">{error}</span>
        )}
      </div>
    );
  }

  // Full drop zone
  return (
    <div className="space-y-1">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-4 transition-colors',
          dragOver
            ? 'border-accent-orange bg-accent-orange/5'
            : 'border-border-secondary bg-surface-1 hover:border-border-hover',
          (disabled || uploading) && 'cursor-not-allowed opacity-40',
        )}
      >
        {uploading ? (
          <>
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-text-dim border-t-accent-orange" />
            <span className="text-[11px] text-text-dim">Uploading...</span>
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-text-dim"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            <span className="text-[11px] text-text-dim">
              Drop files here or click to browse
            </span>
            <span className="text-[9px] text-text-dim/60">
              Max {formatBytes(maxFileSize)} per file, up to {maxFiles} files
            </span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleChange}
        className="hidden"
        aria-hidden="true"
      />
      {error && (
        <p className="text-[10px] text-accent-red">{error}</p>
      )}
    </div>
  );
}
