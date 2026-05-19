import { useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/types';
import * as api from '@/lib/api';
import { AttachmentList } from '@/components/atoms/AttachmentList';
import { FileDropZone } from '@/components/atoms/FileDropZone';
import { Button } from '@/components/ui';

interface PlannerAttachmentsProps {
  pipelineId: string;
  attachments: Attachment[];
  selectedAttachmentIds: string[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onSelectedAttachmentIdsChange: (attachmentIds: string[]) => void;
  disabled?: boolean;
}

const MAX_CONTEXT_BYTES = 128 * 1024;
const WARN_CONTEXT_BYTES = 96 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 32 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextAttachment(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || [
      'application/graphql',
      'application/javascript',
      'application/json',
      'application/sql',
      'application/toml',
      'application/typescript',
      'application/x-sh',
      'application/x-yaml',
      'application/xml',
    ].some((candidate) => mimeType === candidate);
}

export function PlannerAttachments({
  pipelineId,
  attachments,
  selectedAttachmentIds,
  onAttachmentsChange,
  onSelectedAttachmentIdsChange,
  disabled,
}: PlannerAttachmentsProps) {
  const [uploading, setUploading] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);

  const selectedAttachments = useMemo(
    () =>
      selectedAttachmentIds
        .map((attachmentId) => attachments.find((attachment) => attachment.id === attachmentId))
        .filter((attachment): attachment is Attachment => Boolean(attachment)),
    [attachments, selectedAttachmentIds],
  );

  const selectedAttachmentSet = useMemo(
    () => new Set(selectedAttachmentIds),
    [selectedAttachmentIds],
  );

  const estimatedContextBytes = useMemo(
    () =>
      selectedAttachments.reduce((total, attachment) => {
        if (!isTextAttachment(attachment.mimeType)) {
          return total;
        }
        return total + Math.min(attachment.sizeBytes, MAX_TEXT_ATTACHMENT_BYTES);
      }, 0),
    [selectedAttachments],
  );

  const contextWarningTone =
    estimatedContextBytes >= MAX_CONTEXT_BYTES
      ? 'text-accent-red'
      : estimatedContextBytes >= WARN_CONTEXT_BYTES
        ? 'text-amber-400'
        : 'text-text-dim';

  const handleFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    try {
      const uploaded = await api.uploadFiles(files, 'pipeline', pipelineId, pipelineId);
      onAttachmentsChange([...attachments, ...uploaded]);
      onSelectedAttachmentIdsChange(
        Array.from(
          new Set([
            ...selectedAttachmentIds,
            ...uploaded.map((attachment) => attachment.id),
          ]),
        ),
      );
    } catch {
      // upload errors are shown by the API layer
    } finally {
      setUploading(false);
    }
  }, [
    attachments,
    onAttachmentsChange,
    onSelectedAttachmentIdsChange,
    pipelineId,
    selectedAttachmentIds,
  ]);

  const toggleAttachment = useCallback((attachmentId: string) => {
    onSelectedAttachmentIdsChange(
      selectedAttachmentIds.includes(attachmentId)
        ? selectedAttachmentIds.filter((id) => id !== attachmentId)
        : [...selectedAttachmentIds, attachmentId],
    );
  }, [onSelectedAttachmentIdsChange, selectedAttachmentIds]);

  const handleRemoveSelection = useCallback((attachmentId: string) => {
    onSelectedAttachmentIdsChange(
      selectedAttachmentIds.filter((id) => id !== attachmentId),
    );
  }, [onSelectedAttachmentIdsChange, selectedAttachmentIds]);

  return (
    <section aria-labelledby="planner-context-files" className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h4
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-text-secondary"
            id="planner-context-files"
          >
            Context Files
          </h4>
          {selectedAttachments.length > 0 && (
            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-dim">
              {selectedAttachments.length} selected
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-dim">
          These files will be read by the AI to help plan the tasks.
        </p>
      </div>

      {selectedAttachments.length > 0 ? (
        <AttachmentList
          attachments={selectedAttachments}
          className="gap-2"
          onDelete={handleRemoveSelection}
        />
      ) : (
        <div className="rounded-md border border-dashed border-border-secondary bg-surface-1 px-3 py-4 text-center">
          <p className="font-mono text-[11px] text-text-secondary">
            No context files selected
          </p>
          <p className="mt-1 text-[10px] text-text-dim">
            Upload new files or choose from this pipeline before generating the plan.
          </p>
        </div>
      )}

      <div
        className={cn(
          'rounded-md border border-border-secondary bg-surface-1 px-3 py-2',
          estimatedContextBytes >= MAX_CONTEXT_BYTES && 'border-accent-red/40 bg-accent-red-bg/40',
          estimatedContextBytes >= WARN_CONTEXT_BYTES
            && estimatedContextBytes < MAX_CONTEXT_BYTES
            && 'border-amber-500/30 bg-amber-500/5',
        )}
      >
        <p className={cn('font-mono text-[10px] uppercase', contextWarningTone)}>
          {selectedAttachments.length} file{selectedAttachments.length === 1 ? '' : 's'} selected
          {selectedAttachments.length > 0 && ` • est. ${formatBytes(estimatedContextBytes)} prompt context`}
        </p>
        <p className="mt-1 text-[10px] text-text-dim">
          Text files are capped at 32 KB each and 128 KB total before the planner prompt is built.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="h-8 px-2 text-[10px]"
          disabled={disabled || attachments.length === 0}
          onClick={() => setShowAttachmentPicker((prev) => !prev)}
          variant="secondary"
        >
          {showAttachmentPicker ? 'Hide Available Files' : `Choose From Available (${attachments.length})`}
        </Button>
        <span className="text-[10px] text-text-dim">
          Includes files from pipeline and task uploads. New uploads are added to the pipeline.
        </span>
      </div>

      {showAttachmentPicker && (
        <div className="max-h-[180px] space-y-1 overflow-y-auto rounded-md border border-border-secondary bg-surface-1 p-1.5">
          {attachments.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-text-dim">
              No attachments available yet.
            </p>
          ) : (
            attachments.map((attachment) => {
              const isSelected = selectedAttachmentSet.has(attachment.id);
              const sourceLabel = attachment.targetType === 'task' ? 'task' : 'pipeline';

              return (
                <button
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-accent-orange/45 bg-accent-orange-bg text-accent-orange'
                      : 'border-transparent bg-surface-0 text-text-secondary hover:border-border-hover hover:bg-surface-2',
                  )}
                  disabled={disabled}
                  key={attachment.id}
                  onClick={() => toggleAttachment(attachment.id)}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-current">
                      {attachment.originalName}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-text-dim">
                      {formatBytes(attachment.sizeBytes)} • {attachment.mimeType} • <span className="uppercase">{sourceLabel}</span>
                    </p>
                  </div>
                  <span className="font-mono text-[10px] uppercase">
                    {isSelected ? 'Added' : 'Add'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      <FileDropZone
        className="border-border-secondary bg-surface-1 hover:border-accent-orange/40"
        compact={attachments.length > 0}
        disabled={disabled || uploading}
        onFiles={handleFiles}
      />
    </section>
  );
}
