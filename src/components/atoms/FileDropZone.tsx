import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Compact mode shows a small paperclip button instead of a full drop zone */
  compact?: boolean;
  className?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function FileDropZone({ onFiles, disabled, compact, className }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const valid: File[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) continue;
      valid.push(file);
    }
    if (valid.length > 0) onFiles(valid);
  }, [onFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }, [disabled, handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className={cn(
            'inline-flex items-center justify-center rounded p-1 text-text-dim transition-colors hover:bg-surface-2 hover:text-text-secondary',
            disabled && 'pointer-events-none opacity-40',
            className,
          )}
          title="Attach files"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={openPicker}
      className={cn(
        'cursor-pointer rounded-md border border-dashed p-3 text-center transition-colors',
        isDragOver
          ? 'border-accent-orange bg-accent-orange/5'
          : 'border-border-secondary bg-surface-1 hover:border-border-hover',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <p className="font-mono text-[11px] text-text-dim">
        Drop files here or <span className="text-accent-orange">browse</span>
      </p>
      <p className="mt-0.5 font-mono text-[9px] text-text-dim/60">
        Max 10 MB per file
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
