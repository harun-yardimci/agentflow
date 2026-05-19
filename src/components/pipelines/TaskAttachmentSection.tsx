import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button } from '../ui';
import { cn } from '../../lib/utils';
import type { Attachment } from '../../types';

export interface PendingTaskAttachmentUpload {
  id: string;
  errorMessage?: string;
  file?: File;
  name: string;
  progress: number;
  sizeBytes: number;
  status: 'error' | 'uploading';
}

interface TaskAttachmentSectionProps {
  attachments: Attachment[];
  canDelete: boolean;
  canUpload: boolean;
  errorMessage: string | null;
  isLoading: boolean;
  isUploading: boolean;
  onDelete: (attachmentId: string) => void;
  onDismissUploadError: (uploadId: string) => void;
  onDownload: (attachment: Attachment) => void;
  onRetryLoad: () => void;
  onRetryUpload: (uploadId: string) => void;
  onUpload: (files: File[]) => void;
  pendingUploads: PendingTaskAttachmentUpload[];
}

export function getAttachmentVisualType(
  mimeType: string,
): 'code' | 'file' | 'image' | 'pdf' {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType === 'application/pdf') {
    return 'pdf';
  }

  if (
    mimeType.startsWith('text/')
    || mimeType.includes('json')
    || mimeType.includes('javascript')
    || mimeType.includes('typescript')
    || mimeType.includes('xml')
    || mimeType.includes('yaml')
  ) {
    return 'code';
  }

  return 'file';
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatAttachmentDate(
  value: string,
  referenceDate = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  const sameDay =
    date.getFullYear() === referenceDate.getFullYear()
    && date.getMonth() === referenceDate.getMonth()
    && date.getDate() === referenceDate.getDate();

  if (sameDay) {
    return `Today ${new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)}`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === referenceDate.getFullYear()
        ? undefined
        : 'numeric',
  }).format(date);
}

export function TaskAttachmentSection({
  attachments,
  canDelete,
  canUpload,
  errorMessage,
  isLoading,
  isUploading,
  onDelete,
  onDismissUploadError,
  onDownload,
  onRetryLoad,
  onRetryUpload,
  onUpload,
  pendingUploads,
}: TaskAttachmentSectionProps) {
  const hasFiles = attachments.length > 0 || pendingUploads.length > 0;

  return (
    <section aria-labelledby="task-attachments" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3
          className="font-mono text-caption font-semibold uppercase tracking-[0.1em] text-text-secondary"
          id="task-attachments"
        >
          Attachments
        </h3>
        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-micro text-text-dim">
          {attachments.length}
        </span>
      </div>

      {errorMessage && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-accent-red/40 bg-accent-red-bg px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <AlertIcon className="h-4 w-4 shrink-0 text-accent-red" />
            <p className="text-xs text-accent-red">{errorMessage}</p>
          </div>
          <Button
            className="h-7 px-2 text-micro"
            onClick={onRetryLoad}
            size="sm"
            variant="ghost"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-border-secondary bg-surface-1 px-4 py-5">
          <p className="font-mono text-caption text-text-dim">
            Loading attachments...
          </p>
        </div>
      ) : !hasFiles ? (
        <div className="space-y-2">
          <p className="text-xs text-text-dim">No attachments yet</p>
          <TaskAttachmentDropZone
            compact={false}
            disabled={!canUpload}
            isUploading={isUploading}
            onFiles={onUpload}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <TaskAttachmentRow
                attachment={attachment}
                canDelete={canDelete}
                key={attachment.id}
                onDelete={onDelete}
                onDownload={onDownload}
              />
            ))}

            {pendingUploads.map((pendingUpload) => (
              <TaskAttachmentUploadRow
                key={pendingUpload.id}
                pendingUpload={pendingUpload}
                onDismiss={onDismissUploadError}
                onRetry={onRetryUpload}
              />
            ))}
          </div>

          <TaskAttachmentDropZone
            compact
            disabled={!canUpload}
            isUploading={isUploading}
            onFiles={onUpload}
          />
        </>
      )}

      {!canUpload && (
        <p className="text-micro text-text-dim">
          Attachments are locked while the task is running.
        </p>
      )}
    </section>
  );
}

function TaskAttachmentRow({
  attachment,
  canDelete,
  onDelete,
  onDownload,
}: {
  attachment: Attachment;
  canDelete: boolean;
  onDelete: (attachmentId: string) => void;
  onDownload: (attachment: Attachment) => void;
}) {
  return (
    <div className="group flex items-center justify-between gap-3 rounded-md border border-border-secondary bg-surface-1 p-2 transition-colors hover:bg-surface-2">
      <div className="flex min-w-0 items-center gap-2">
        <AttachmentTypeIcon mimeType={attachment.mimeType} />
        <div className="min-w-0">
          <p
            className="truncate text-xs text-text-primary"
            title={attachment.originalName}
          >
            {attachment.originalName}
          </p>
          <p className="font-mono text-micro text-text-dim">
            {formatAttachmentSize(attachment.sizeBytes)}
            {' '}
            •
            {' '}
            {formatAttachmentDate(attachment.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          ariaLabel={`Download ${attachment.originalName}`}
          onClick={() => onDownload(attachment)}
          title="Download"
        >
          <DownloadIcon className="h-4 w-4" />
        </IconButton>
        {canDelete && (
          <IconButton
            ariaLabel={`Delete ${attachment.originalName}`}
            onClick={() => onDelete(attachment.id)}
            title="Delete"
            tone="danger"
          >
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function TaskAttachmentUploadRow({
  pendingUpload,
  onDismiss,
  onRetry,
}: {
  pendingUpload: PendingTaskAttachmentUpload;
  onDismiss: (uploadId: string) => void;
  onRetry: (uploadId: string) => void;
}) {
  const isError = pendingUpload.status === 'error';

  return (
    <div
      className={cn(
        'rounded-md border bg-surface-1 p-2',
        isError
          ? 'border-accent-red/40 bg-accent-red-bg/40'
          : 'border-border-secondary opacity-80',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isError ? (
            <AlertIcon className="h-4 w-4 shrink-0 text-accent-red" />
          ) : (
            <UploadSpinner />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs text-text-primary">
              {pendingUpload.name}
            </p>
            <p
              className={cn(
                'font-mono text-micro',
                isError ? 'text-accent-red' : 'text-text-dim',
              )}
            >
              {formatAttachmentSize(pendingUpload.sizeBytes)}
              {pendingUpload.errorMessage
                ? ` • ${pendingUpload.errorMessage}`
                : ` • Uploading ${Math.round(pendingUpload.progress)}%`}
            </p>
          </div>
        </div>

        {isError ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className="h-7 px-2 text-micro"
              onClick={() => onRetry(pendingUpload.id)}
              size="sm"
              variant="ghost"
            >
              Retry
            </Button>
            <IconButton
              ariaLabel={`Dismiss failed upload ${pendingUpload.name}`}
              onClick={() => onDismiss(pendingUpload.id)}
              title="Dismiss"
            >
              <CloseIcon className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}
      </div>

      {!isError && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full bg-accent-orange transition-[width] duration-300"
            style={{ width: `${Math.max(6, pendingUpload.progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function TaskAttachmentDropZone({
  compact,
  disabled,
  isUploading,
  onFiles,
}: {
  compact: boolean;
  disabled: boolean;
  isUploading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      const files = fileList ? Array.from(fileList) : [];
      if (files.length === 0 || disabled) {
        return;
      }

      onFiles(files);
    },
    [disabled, onFiles],
  );

  const openPicker = useCallback(() => {
    if (!disabled) {
      inputRef.current?.click();
    }
  }, [disabled]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  if (compact) {
    return (
      <div className="space-y-1">
        <div
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-2 text-xs transition-colors',
            isDragOver
              ? 'border-accent-orange bg-accent-orange/10 text-accent-orange'
              : 'border-border-secondary text-text-secondary hover:border-accent-orange/50 hover:text-accent-orange',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          onClick={openPicker}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openPicker();
            }
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          {isUploading ? <UploadSpinner /> : <UploadIcon className="h-4 w-4" />}
          <span>{isUploading ? 'Uploading files...' : 'Add more files'}</span>
        </div>
        <HiddenInput inputRef={inputRef} onFiles={handleFiles} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-md border border-dashed bg-surface-1 px-4 py-3 text-center transition-colors',
          isDragOver
            ? 'border-accent-orange bg-accent-orange/10'
            : 'border-border-secondary hover:border-accent-orange/50 hover:bg-surface-2',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && 'cursor-pointer',
        )}
        onClick={openPicker}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        {isUploading ? (
          <>
            <UploadSpinner />
            <p className="mt-2 text-xs text-text-secondary">Uploading files...</p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <UploadIcon className="h-4 w-4 text-text-dim" />
            <p className="text-xs text-text-secondary">
              Drag &amp; drop files or click to browse
            </p>
          </div>
        )}
      </div>
      <HiddenInput inputRef={inputRef} onFiles={handleFiles} />
    </div>
  );
}

function HiddenInput({
  inputRef,
  onFiles,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <input
      className="hidden"
      multiple
      onChange={(event) => {
        onFiles(event.target.files);
        event.target.value = '';
      }}
      ref={inputRef}
      type="file"
    />
  );
}

function IconButton({
  ariaLabel,
  children,
  onClick,
  title,
  tone = 'default',
}: {
  ariaLabel: string;
  children: ReactNode;
  onClick: () => void;
  title: string;
  tone?: 'danger' | 'default';
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'rounded p-1 text-text-dim transition-colors hover:text-text-primary',
        tone === 'danger' && 'hover:text-accent-red',
      )}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function AttachmentTypeIcon({ mimeType }: { mimeType: string }) {
  const type = getAttachmentVisualType(mimeType);

  if (type === 'image') {
    return <ImageIcon className="h-4 w-4 shrink-0 text-sky-400" />;
  }

  if (type === 'pdf') {
    return <PdfIcon className="h-4 w-4 shrink-0 text-red-400" />;
  }

  if (type === 'code') {
    return <CodeIcon className="h-4 w-4 shrink-0 text-emerald-400" />;
  }

  return <FileIcon className="h-4 w-4 shrink-0 text-text-dim" />;
}

function UploadSpinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-dim border-t-accent-orange" />
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" ry="2" width="18" x="3" y="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5a2 2 0 0 0-2.83 0L6 20" />
    </svg>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6" />
      <path d="M9 11h2" />
      <path d="M9 19h4" />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="m8 9-4 3 4 3" />
      <path d="m16 9 4 3-4 3" />
      <path d="m14 4-4 16" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
