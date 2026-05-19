import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent, ApprovalMode, Attachment, ControlRequest, ConversationMessage, DependencyCondition, ExecutionRun, ModelKey, Task, TaskCycle, TaskPriority, TaskStatus } from '@/types';
import { APPROVAL_MODES, PRESET_TAGS, PRIORITIES } from '@/constants';
import { getTagColor } from '@/constants';
import { useModels } from '@/context/ModelContext';
import { parseCliOutput } from '@/lib/output-parser';
import { parseClaudeStream } from '@/lib/claude-stream-parser';
import { ConversationView, ToolUseBlockView, parseSpawnBlock, SpawnTasksView } from './ConversationView';
import { cn, formatCost, formatStatus, mkId, statusToTone, toErrorMessage } from '@/lib/utils';
import * as api from '@/lib/api';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { ModelSelector } from '@/components/atoms/ModelSelector';
import { QuestionBanner } from './QuestionBanner';
import {
  type PendingTaskAttachmentUpload,
  formatAttachmentSize,
  getAttachmentVisualType,
} from './TaskAttachmentSection';
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  StatusDot,
  Textarea,
} from '@/components/ui';

/* ─── Helpers ─── */

interface ExecutionOutput {
  taskId: string;
  runId?: string;
  status?: string;
  stream?: string;
  stdout?: string;
  stderr?: string;
  tokens?: number;
  durationMs?: number;
  attempt?: number;
}

function mergeExecutionOutput(
  previous: ExecutionOutput | null,
  next: ExecutionOutput,
): ExecutionOutput {
  if (!previous) {
    return next;
  }

  const sameRun = previous.runId && next.runId && previous.runId === next.runId;
  if (!sameRun) {
    return next;
  }

  return {
    ...previous,
    ...next,
    stream: next.stream || previous.stream,
    stdout: next.stdout || previous.stdout,
    stderr: next.stderr || previous.stderr,
  };
}

function priorityToTone(priority: TaskPriority | null): 'neutral' | 'warning' | 'error' | 'info' {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'neutral';
}

function formatApproval(mode: string): string {
  return mode.replace(/_/g, ' ');
}

function formatDepCondition(cond: DependencyCondition): string {
  if (cond.type === 'status') return 'if succeeded';
  if (cond.type === 'contains') return `if contains '${cond.value}'`;
  if (cond.type === 'not_contains') return `if not contains '${cond.value}'`;
  if (cond.type === 'regex') return `if matches /${cond.value}/`;
  return '';
}

function statusToBadgeTone(status: string): 'error' | 'info' | 'neutral' | 'success' | 'warning' {
  const tone = statusToTone(status);
  if (tone === 'active') return 'info';
  if (tone === 'idle') return 'neutral';
  return tone;
}

function getPricingSourceMeta(
  pricingSource: string | null | undefined,
): { label: string; tone: 'info' | 'neutral' | 'success' | 'warning' } | null {
  if (pricingSource === 'exact') {
    return { label: 'Exact', tone: 'success' };
  }

  if (pricingSource === 'calculated') {
    return { label: 'Estimated', tone: 'info' };
  }

  if (pricingSource === 'backfilled') {
    return { label: 'Backfilled', tone: 'warning' };
  }

  return null;
}

function getWorkspaceModeLabel(task: Task): string {
  if (task.useWorktree === false) {
    return 'Shared workspace';
  }

  if (
    (task.taskType === 'spawned' || task.taskType === 'system') &&
    task.sourceTaskId
  ) {
    return 'Follow-up';
  }

  return 'Isolated';
}

function getStartsFromLabel(task: Task): string {
  if (task.branch) {
    return task.branch;
  }

  if (task.dependsOn.length > 0) {
    return 'auto from dependencies';
  }

  return 'pipeline default';
}

function getWorktreeStatusLabel(worktreeStatus: string | null): string {
  if (worktreeStatus === 'merged') return 'Finalized';
  if (worktreeStatus === 'merged_with_parent') return 'Merged with parent task';
  if (worktreeStatus === 'cleaned') return 'Workspace cleaned';
  if (worktreeStatus === 'cleaned_missing_path') return 'Workspace metadata cleaned';
  if (worktreeStatus === 'archived_with_parent') return 'Archived with parent task';
  if (worktreeStatus === 'blocked_by_conflict') return 'Conflict needs fix';
  if (worktreeStatus === 'cleanup_blocked_dirty') return 'Cleanup blocked (dirty worktree)';
  if (worktreeStatus === 'ready_for_review') return 'Needs review';
  if (worktreeStatus === 'inherited') return 'Following parent task';
  return 'No workspace state';
}

function isWaitingOnParentReview(
  taskType: Task['taskType'],
  sourceTaskId: string | null,
  sourceTaskStatus: TaskStatus | null | undefined,
  worktreeStatus: string | null,
): boolean {
  return (
    (taskType === 'spawned' || taskType === 'system') &&
    !!sourceTaskId &&
    sourceTaskStatus === 'completed' &&
    worktreeStatus === 'ready_for_review'
  );
}

const EDITABLE_START_SOURCE_STATUSES: TaskStatus[] = ['queued', 'blocked'];

function canEditStartSource(status: TaskStatus): boolean {
  return EDITABLE_START_SOURCE_STATUSES.includes(status);
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s|^\*\*|^```|^- |^\d+\.\s/m.test(text);
}

function MarkdownOutput({ content }: { content: string }) {
  return (
    <div className="prose-invert prose-sm max-w-none overflow-auto font-mono text-[12px] leading-6 text-text-secondary [&_pre]:rounded-md [&_pre]:bg-surface-2 [&_pre]:p-2 [&_code]:text-accent-orange [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_a]:text-accent-blue [&_table]:text-caption">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const spawn = useMemo(() => parseSpawnBlock(content), [content]);
  const displayContent = spawn?.rest ?? content;

  return (
    <>
      {displayContent && (
        looksLikeMarkdown(displayContent) ? (
          <MarkdownOutput content={truncateText(displayContent, 16000)} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
            {truncateText(displayContent, 16000)}
          </pre>
        )
      )}
      {spawn && <SpawnTasksView items={spawn.items} />}
    </>
  );
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function shouldSuppressJsonEventContent(content: string): boolean {
  const parsed = parseJsonObject(content);
  if (!parsed) return false;

  if (parsed.type === 'message' && parsed.role === 'user') {
    return true;
  }

  if (parsed.type === 'turn.started') {
    return true;
  }

  if (parsed.type === 'rate_limit_event') {
    return true;
  }

  if (parsed.type === 'system') {
    const subtype = typeof parsed.subtype === 'string' ? parsed.subtype : '';
    return subtype === 'api_retry'
      || subtype === 'task_started'
      || subtype === 'task_progress'
      || subtype === 'task_notification';
  }

  if (parsed.type === 'stream_event') {
    const event = parsed.event && typeof parsed.event === 'object' && !Array.isArray(parsed.event)
      ? parsed.event as Record<string, unknown>
      : null;
    const eventType = typeof event?.type === 'string' ? event.type : '';

    if (eventType === 'message_start' || eventType === 'message_delta' || eventType === 'message_stop') {
      return true;
    }

    if (eventType === 'content_block_start') {
      const contentBlock = event?.content_block && typeof event.content_block === 'object' && !Array.isArray(event.content_block)
        ? event.content_block as Record<string, unknown>
        : null;
      const blockType = typeof contentBlock?.type === 'string' ? contentBlock.type : '';
      return blockType === 'text' || blockType === 'thinking';
    }

    if (eventType === 'content_block_stop') {
      return true;
    }

    if (eventType === 'content_block_delta') {
      const delta = event?.delta && typeof event.delta === 'object' && !Array.isArray(event.delta)
        ? event.delta as Record<string, unknown>
        : null;
      const deltaType = typeof delta?.type === 'string' ? delta.type : '';
      return deltaType === 'thinking_delta' || deltaType === 'signature_delta';
    }
  }

  return false;
}

function isLegacySessionInitMessage(message: ConversationMessage): boolean {
  const parsed = parseJsonObject(message.content);
  return (parsed?.type === 'system' && parsed?.subtype === 'init')
    || parsed?.type === 'init'
    || parsed?.type === 'thread.started';
}

function StructuredMessageContent({ message }: { message: ConversationMessage }) {
  const meta = message.meta ?? {};
  const legacyJson = parseJsonObject(message.content);
  const legacyStream = parseClaudeStream(message.content);
  const sessionMeta = message.messageType === 'session_init'
    ? meta
    : legacyJson?.type === 'system' && legacyJson?.subtype === 'init'
      ? {
          cwd: legacyJson.cwd,
          sessionId: legacyJson.session_id,
          model: legacyJson.model,
          permissionMode: legacyJson.permissionMode,
          claudeCodeVersion: legacyJson.claude_code_version,
          toolCount: Array.isArray(legacyJson.tools) ? legacyJson.tools.length : null,
          skillCount: Array.isArray(legacyJson.skills) ? legacyJson.skills.length : null,
          connectedServers: Array.isArray(legacyJson.mcp_servers)
            ? legacyJson.mcp_servers
                .filter((server): server is Record<string, unknown> =>
                  !!server && typeof server === 'object' && server.status === 'connected')
                .map((server) => String(server.name ?? 'unknown'))
            : [],
          failedServers: Array.isArray(legacyJson.mcp_servers)
            ? legacyJson.mcp_servers
                .filter((server): server is Record<string, unknown> =>
                  !!server && typeof server === 'object' && server.status === 'failed')
                .map((server) => String(server.name ?? 'unknown'))
            : [],
          authServers: Array.isArray(legacyJson.mcp_servers)
            ? legacyJson.mcp_servers
                .filter((server): server is Record<string, unknown> =>
                  !!server && typeof server === 'object' && server.status === 'needs-auth')
                .map((server) => String(server.name ?? 'unknown'))
            : [],
        }
      : legacyJson?.type === 'init'
        ? {
            cwd: legacyJson.cwd,
            sessionId: legacyJson.session_id,
            model: legacyJson.model,
          }
        : legacyJson?.type === 'thread.started'
          ? {
              sessionId: legacyJson.thread_id,
            }
      : null;

  if (sessionMeta) {
    const cwd = typeof sessionMeta.cwd === 'string' ? sessionMeta.cwd : null;
    const sessionId = typeof sessionMeta.sessionId === 'string'
      ? sessionMeta.sessionId
      : null;
    const model = typeof sessionMeta.model === 'string' ? sessionMeta.model : null;
    const permissionMode = typeof sessionMeta.permissionMode === 'string'
      ? sessionMeta.permissionMode
      : null;
    const claudeCodeVersion = typeof sessionMeta.claudeCodeVersion === 'string'
      ? sessionMeta.claudeCodeVersion
      : null;
    const toolCount = typeof sessionMeta.toolCount === 'number' ? sessionMeta.toolCount : null;
    const skillCount = typeof sessionMeta.skillCount === 'number' ? sessionMeta.skillCount : null;
    const connectedServers = Array.isArray(sessionMeta.connectedServers)
      ? sessionMeta.connectedServers.filter((server): server is string => typeof server === 'string')
      : [];
    const failedServers = Array.isArray(sessionMeta.failedServers)
      ? sessionMeta.failedServers.filter((server): server is string => typeof server === 'string')
      : [];
    const authServers = Array.isArray(sessionMeta.authServers)
      ? sessionMeta.authServers.filter((server): server is string => typeof server === 'string')
      : [];

    return (
      <details className="rounded border border-border-secondary bg-surface-0/50 px-2.5 py-2" open>
        <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
          Session initialized
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2 font-mono text-caption text-text-secondary">
            {sessionId && (
              <span className="rounded bg-surface-1 px-2 py-1">
                session {sessionId.slice(0, 8)}
              </span>
            )}
            {model && <span className="rounded bg-surface-1 px-2 py-1">{model}</span>}
            {permissionMode && <span className="rounded bg-surface-1 px-2 py-1">{permissionMode}</span>}
            {toolCount != null && <span className="rounded bg-surface-1 px-2 py-1">{toolCount} tools</span>}
            {skillCount != null && <span className="rounded bg-surface-1 px-2 py-1">{skillCount} skills</span>}
          </div>
          {cwd && (
            <div className="rounded border border-border-secondary bg-surface-1 px-2 py-1.5 font-mono text-caption text-text-dim">
              {cwd}
            </div>
          )}
          <div className="flex flex-wrap gap-2 font-mono text-caption">
            <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
              {connectedServers.length} connected MCP
            </span>
            {failedServers.length > 0 && (
              <span className="rounded bg-accent-red/10 px-2 py-1 text-accent-red">
                {failedServers.length} failed
              </span>
            )}
            {authServers.length > 0 && (
              <span className="rounded bg-accent-yellow/10 px-2 py-1 text-accent-yellow">
                {authServers.length} need auth
              </span>
            )}
            {claudeCodeVersion && (
              <span className="rounded bg-surface-1 px-2 py-1 text-text-dim">
                Claude Code {claudeCodeVersion}
              </span>
            )}
          </div>
          {(failedServers.length > 0 || authServers.length > 0) && (
            <div className="space-y-1 font-mono text-caption text-text-dim">
              {failedServers.length > 0 && (
                <div>Failed: {failedServers.join(', ')}</div>
              )}
              {authServers.length > 0 && (
                <div>Needs auth: {authServers.join(', ')}</div>
              )}
            </div>
          )}
        </div>
      </details>
    );
  }

  if (message.messageType === 'tool_call') {
    const toolName = typeof meta.toolName === 'string' ? meta.toolName : 'Tool';
    const summary = typeof meta.summary === 'string' ? meta.summary : undefined;
    const input = typeof meta.input === 'object' && meta.input !== null
      ? meta.input as Record<string, unknown>
      : {};
    const resultContent = typeof meta.resultContent === 'string' ? meta.resultContent : '';
    const isError = meta.isError === true;
    const toolId = typeof meta.toolId === 'string' ? meta.toolId : message.id;

    return (
      <ToolUseBlockView
        input={input}
        result={resultContent || isError
          ? { type: 'tool_result', toolId, content: resultContent, isError }
          : undefined}
        summary={summary}
        toolName={toolName}
      />
    );
  }

  if (message.messageType === 'raw_stdout' || message.messageType === 'raw_stderr' || message.messageType === 'json_event') {
    const title = message.messageType === 'raw_stdout'
      ? 'Raw stdout'
      : message.messageType === 'raw_stderr'
        ? 'Raw stderr'
        : 'JSON event';
    const isError = message.messageType === 'raw_stderr';

    return (
      <details className="rounded border border-border-secondary bg-surface-0/50 px-2.5 py-2">
        <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
          {title}
        </summary>
        <pre className={cn(
          'mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded border border-border-secondary bg-surface-1 p-2 font-mono text-caption leading-4',
          isError ? 'text-accent-red/80' : 'text-text-dim',
        )}>
          {truncateText(message.content, 16000)}
        </pre>
      </details>
    );
  }

  if (legacyStream.isClaudeStream && legacyStream.blocks.length > 0) {
    return <ConversationView rawOutput={message.content} />;
  }

  return <MessageContent content={message.content} />;
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(-max)}\n\n... showing last ${Math.round(max / 1000)}k characters`;
}

/* ─── MarkdownTextarea: edit / preview toggle ─── */

function MarkdownTextarea({
  value,
  onChange,
  onBlur,
  disabled,
  rows,
  label,
  toolbar,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  rows: number;
  label: string;
  toolbar?: React.ReactNode;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-border-secondary focus-within:border-accent-orange/60">
      {preview ? (
        <div className="min-h-[120px] bg-surface-1 p-3">
          {value.trim() ? (
            <MarkdownOutput content={value} />
          ) : (
            <p className="text-xs text-text-dim italic">No content</p>
          )}
        </div>
      ) : (
        <Textarea
          aria-label={label}
          className="rounded-none border-0 focus:ring-0"
          disabled={disabled}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          value={value}
        />
      )}
      <div className="flex min-h-[32px] flex-wrap items-center gap-1.5 border-t border-border-secondary bg-surface-1 px-2 py-1">
        <button
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            preview
              ? 'bg-accent-orange/15 text-accent-orange'
              : 'text-text-dim hover:bg-surface-2 hover:text-text-secondary',
          )}
          onClick={() => setPreview((p) => !p)}
          title={preview ? 'Edit' : 'Preview markdown'}
          type="button"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">
            {preview ? (
              <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>
            ) : (
              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
            )}
          </svg>
        </button>
        {toolbar}
      </div>
    </div>
  );
}

/* ─── Section Header ─── */

function SectionHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3
      className="font-mono text-caption font-semibold tracking-[0.1em] text-text-secondary uppercase"
      id={id}
    >
      {children}
    </h3>
  );
}

/* ─── Task Detail with Inline Attachments ─── */

function TaskDetailWithAttachments({
  attachments,
  attachmentError,
  attachmentsLoading,
  canManage,
  input,
  isLocked,
  isUploading,
  onBlur,
  onChange,
  onDeleteAttachment,
  onDismissUploadError,
  onDownloadAttachment,
  onRetryLoad,
  onRetryUpload,
  onUploadFiles,
  pendingUploads,
}: {
  attachments: Attachment[];
  attachmentError: string | null;
  attachmentsLoading: boolean;
  canManage: boolean;
  input: string;
  isLocked: boolean;
  isUploading: boolean;
  onBlur: () => void;
  onChange: (v: string) => void;
  onDeleteAttachment: (id: string) => void;
  onDismissUploadError: (id: string) => void;
  onDownloadAttachment: (a: Attachment) => void;
  onRetryLoad: () => void;
  onRetryUpload: (id: string) => void;
  onUploadFiles: (files: File[]) => void;
  pendingUploads: PendingTaskAttachmentUpload[];
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!canManage) return;
      const files = e.dataTransfer.files;
      if (files.length > 0) onUploadFiles(Array.from(files));
    },
    [canManage, onUploadFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (canManage) setIsDragOver(true);
    },
    [canManage],
  );

  const hasFiles = attachments.length > 0 || pendingUploads.length > 0;

  return (
    <section
      aria-labelledby="task-detail-section"
      className={cn(
        'space-y-2 rounded-md transition-colors',
        isDragOver && 'ring-1 ring-accent-orange/50 bg-accent-orange/5',
      )}
      onDragLeave={() => setIsDragOver(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <SectionHeader id="task-detail-section">Task Details</SectionHeader>

      <MarkdownTextarea
        disabled={isLocked}
        label="Task input"
        onBlur={onBlur}
        onChange={onChange}
        rows={8}
        toolbar={
          <>
            {canManage && (
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-text-dim transition-colors hover:bg-surface-2 hover:text-text-secondary"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                type="button"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            )}
            {attachmentError && (
              <span className="flex items-center gap-1 text-micro text-accent-red">
                {attachmentError}
                <button className="underline" onClick={onRetryLoad} type="button">Retry</button>
              </span>
            )}
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                name={a.originalName}
                size={a.sizeBytes}
                mimeType={a.mimeType}
                onDelete={canManage ? () => onDeleteAttachment(a.id) : undefined}
                onClick={() => onDownloadAttachment(a)}
              />
            ))}
            {pendingUploads.map((p) => (
              <AttachmentChip
                key={p.id}
                name={p.name}
                size={p.sizeBytes}
                status={p.status}
                progress={p.progress}
                errorMessage={p.errorMessage}
                onRetry={() => onRetryUpload(p.id)}
                onDismiss={() => onDismissUploadError(p.id)}
              />
            ))}
          </>
        }
        value={input}
      />

      <input
        className="hidden"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onUploadFiles(Array.from(e.target.files));
          }
          e.target.value = '';
        }}
        ref={fileInputRef}
        type="file"
      />
    </section>
  );
}

function AttachmentChip({
  name,
  size,
  mimeType,
  status,
  progress,
  errorMessage,
  onClick,
  onDelete,
  onRetry,
  onDismiss,
}: {
  name: string;
  size: number;
  mimeType?: string;
  status?: 'error' | 'uploading';
  progress?: number;
  errorMessage?: string;
  onClick?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const isError = status === 'error';
  const isUploading = status === 'uploading';

  const typeColor = mimeType ? {
    image: 'text-sky-400',
    pdf: 'text-red-400',
    code: 'text-emerald-400',
    file: 'text-text-dim',
  }[getAttachmentVisualType(mimeType)] : 'text-text-dim';

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-micro transition-colors',
        isError
          ? 'border-accent-red/40 bg-accent-red-bg/40 text-accent-red'
          : isUploading
            ? 'border-border-secondary bg-surface-1 text-text-dim opacity-70'
            : 'border-border-secondary bg-surface-1 text-text-primary hover:bg-surface-2 cursor-pointer',
      )}
      onClick={!isError && !isUploading ? onClick : undefined}
      title={isError ? (errorMessage ?? 'Upload failed') : `${name} (${formatAttachmentSize(size)})`}
    >
      {isUploading && (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-text-dim border-t-accent-orange" />
      )}
      {!isUploading && !isError && (
        <span className={cn('shrink-0', typeColor)}>*</span>
      )}
      {isError && <span className="shrink-0 text-accent-red">!</span>}

      <span className="max-w-[120px] truncate">{name}</span>

      {isError && onRetry && (
        <button
          className="shrink-0 text-accent-red hover:text-accent-red/80 underline"
          onClick={(e) => { e.stopPropagation(); onRetry(); }}
          type="button"
        >
          retry
        </button>
      )}
      {isError && onDismiss && (
        <button
          className="shrink-0 text-accent-red hover:text-accent-red/80"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          type="button"
        >
          x
        </button>
      )}
      {!isError && !isUploading && onDelete && (
        <button
          className="shrink-0 text-text-dim opacity-0 transition-opacity hover:text-accent-red group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          type="button"
        >
          x
        </button>
      )}
    </div>
  );
}

/* ─── Task Flow View (Sidebar) ─── */

function TaskFlowView({ task, tasks, agents }: { task: Task; tasks: Task[]; agents: Agent[] }) {
  const { getModel } = useModels();

  const upstream = useMemo(() =>
    task.dependsOn
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is Task => t != null),
    [task.dependsOn, tasks],
  );

  const downstream = useMemo(() =>
    tasks.filter((t) => t.dependsOn.includes(task.id)),
    [task.id, tasks],
  );

  const spawned = useMemo(() =>
    tasks.filter((t) => t.sourceTaskId === task.id),
    [task.id, tasks],
  );

  const FlowNode = ({ t, isCurrent }: { t: Task; isCurrent?: boolean }) => {
    const agent = agents.find((a) => a.id === t.agentId);
    const model = getModel(t.model);
    return (
      <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
        isCurrent
          ? 'border-accent-orange/40 bg-accent-orange/5'
          : 'border-border-secondary bg-surface-1'
      }`}>
        <StatusDot size="sm" tone={statusToTone(t.status)} />
        <span className="min-w-0 truncate font-mono text-caption text-text-primary">{t.name}</span>
        {isCurrent && (
          <span className="ml-auto text-accent-orange text-caption">&#10003;</span>
        )}
      </div>
    );
  };

  const FlowSection = ({ title, items, emptyText }: { title: string; items: Task[]; emptyText: string }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-dim">{title}</span>
        <span className="font-mono text-caption text-text-dim">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-caption text-text-dim italic">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {items.map((t) => <FlowNode key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Dependencies with condition badges */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-dim">Dependencies</span>
          <span className="font-mono text-caption text-text-dim">{upstream.length}</span>
        </div>
        {upstream.length === 0 ? (
          <p className="text-caption text-text-dim italic">No dependencies</p>
        ) : (
          <div className="space-y-1">
            {upstream.map((t) => {
              const cond = task.dependencyConditions?.[t.id];
              return (
                <div key={t.id} className="space-y-0.5">
                  <FlowNode t={t} />
                  {cond && (
                    <span className="ml-2 inline-block rounded bg-accent-orange/10 px-1.5 py-0.5 font-mono text-micro text-accent-orange">
                      {formatDepCondition(cond)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current task node */}
      <div className="space-y-1">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-dim">Current Task</span>
        <FlowNode t={task} isCurrent />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FlowSection title="Dependents" items={downstream} emptyText="No dependents" />
        <FlowSection title="Spawned" items={spawned} emptyText="No spawned" />
      </div>
    </div>
  );
}

/* ─── Chat Q&A Entry ─── */

function ChatQAEntry({ question: q }: { question: ControlRequest }) {
  const isAsk = q.toolName === 'AskUserQuestion';
  const wasDenied = q.status === 'denied' || q.status === 'denied_sent';
  const wasTimedOut = q.status === 'timed_out';

  let userAnswer: string | null = null;
  if (q.responseJson) {
    try {
      const resp = JSON.parse(q.responseJson) as Record<string, unknown>;
      const updatedInput = resp?.updatedInput as Record<string, unknown> | undefined;
      const answers = updatedInput?.answers as Record<string, string> | undefined;
      if (answers?.['0']) {
        userAnswer = answers['0'];
      } else if (resp?.result) {
        userAnswer = typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-orange/20 font-mono text-caption font-bold text-accent-orange">
          AI
        </div>
        <div className="max-w-[85%] rounded-lg rounded-tl-sm border border-border-secondary bg-surface-2/80 px-3 py-2">
          <p className="text-caption leading-relaxed text-text-primary">
            {q.question ?? `${q.toolName} permission request`}
          </p>
          <span className="mt-1 block font-mono text-caption text-text-dim">
            {isAsk ? 'Question' : q.toolName}
          </span>
        </div>
      </div>

      {userAnswer && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg rounded-tr-sm border border-accent-orange/20 bg-accent-orange/10 px-3 py-2">
            <p className="whitespace-pre-wrap text-caption leading-relaxed text-text-primary">
              {userAnswer}
            </p>
            <span className="mt-1 block text-right font-mono text-caption text-text-dim">You</span>
          </div>
        </div>
      )}

      {wasDenied && !userAnswer && (
        <div className="flex justify-end">
          <span className="rounded-md bg-accent-red/10 px-2.5 py-1 font-mono text-caption text-accent-red">
            Denied by user
          </span>
        </div>
      )}

      {wasTimedOut && (
        <div className="flex justify-end">
          <span className="rounded-md bg-surface-2 px-2.5 py-1 font-mono text-caption text-text-dim">
            Timed out
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Single Run Output ─── */

function RunOutput({
  stdout,
  stderr,
  isLive,
  parsedOutput,
}: {
  stdout: string;
  stderr: string;
  isLive: boolean;
  parsedOutput?: string | null;
}) {
  const streamParsed = useMemo(() => {
    if (!stdout) return null;
    const result = parseClaudeStream(stdout);
    return result.isClaudeStream ? result : null;
  }, [stdout]);

  const cliParsed = useMemo(() => {
    if (!stdout || streamParsed) return null;
    return parseCliOutput(stdout);
  }, [stdout, streamParsed]);

  const stderrStream = useMemo(() => {
    if (streamParsed || (cliParsed && cliParsed.content)) return null;
    if (!stderr) return null;
    const result = parseClaudeStream(stderr);
    return result.isClaudeStream ? result : null;
  }, [streamParsed, cliParsed, stderr]);

  const stderrCli = useMemo(() => {
    if (streamParsed || (cliParsed && cliParsed.content) || stderrStream) return null;
    if (!stderr) return null;
    return parseCliOutput(stderr);
  }, [streamParsed, cliParsed, stderrStream, stderr]);

  const activeStream = streamParsed ?? stderrStream;
  const activeCli = cliParsed?.content ? cliParsed : stderrCli;
  const activeRaw = streamParsed ? stdout : stderrStream ? stderr : stdout;
  const normalizedParsedOutput = parsedOutput?.trim() ?? '';
  const normalizedStreamResult = activeStream?.result?.trim() ?? '';
  const normalizedCliContent = activeCli?.content?.trim() ?? '';
  const shouldShowParsedFallback = Boolean(
    normalizedParsedOutput
    && normalizedParsedOutput !== normalizedStreamResult
    && normalizedParsedOutput !== normalizedCliContent,
  );

  if (activeStream) {
    return (
      <>
        <ConversationView isLive={isLive} rawOutput={activeRaw} maxHeight={undefined} />
        {!isLive && shouldShowParsedFallback && parsedOutput && (
          <div className="mt-3 rounded border border-border-secondary bg-surface-1 p-3">
            {looksLikeMarkdown(parsedOutput) ? (
              <MarkdownOutput content={truncateText(parsedOutput, 16000)} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
                {truncateText(parsedOutput, 16000)}
              </pre>
            )}
          </div>
        )}
      </>
    );
  }

  if (activeCli?.content) {
    const spawn = parseSpawnBlock(activeCli.content);
    const displayContent = spawn?.rest ?? activeCli.content;
    return (
      <>
        {displayContent && (looksLikeMarkdown(displayContent) ? (
          <MarkdownOutput content={truncateText(displayContent, 16000)} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
            {truncateText(displayContent, 16000)}
          </pre>
        ))}
        {spawn && <SpawnTasksView items={spawn.items} />}
        {!isLive && shouldShowParsedFallback && parsedOutput && (
          <div className="mt-3 rounded border border-border-secondary bg-surface-1 p-3">
            {looksLikeMarkdown(parsedOutput) ? (
              <MarkdownOutput content={truncateText(parsedOutput, 16000)} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
                {truncateText(parsedOutput, 16000)}
              </pre>
            )}
          </div>
        )}
      </>
    );
  }

  // Fallback: server-side parsed output (when stdout parsing fails, e.g. truncated)
  if (parsedOutput) {
    return looksLikeMarkdown(parsedOutput) ? (
      <MarkdownOutput content={truncateText(parsedOutput, 16000)} />
    ) : (
      <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
        {truncateText(parsedOutput, 16000)}
      </pre>
    );
  }

  if (isLive) {
    return <span className="inline-block animate-pulse font-mono text-xs text-accent-blue">_</span>;
  }

  return null;
}

/* ─── Execution Run Viewer ─── */

function ExecutionRunViewer({
  taskId,
  taskStatus,
  isRunning,
  liveOutput,
  parsedOutput,
}: {
  taskId: string;
  taskStatus: TaskStatus;
  isRunning: boolean;
  liveOutput: ExecutionOutput | null;
  parsedOutput?: { content: string } | null;
}) {
  const [cycles, setCycles] = useState<TaskCycle[]>([]);
  const [attempts, setAttempts] = useState<ExecutionRun[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [allQuestions, setAllQuestions] = useState<ControlRequest[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRunsLoading(true);
    void api.getTaskCycles(taskId).then((nextCycles) => {
      setCycles(nextCycles);
      setRunsLoading(false);
    }).catch(() => {
      setRunsLoading(false);
    });
  }, [taskId, taskStatus, liveOutput?.status]);

  useEffect(() => {
    if (cycles.length === 0) {
      setSelectedCycleId(null);
      return;
    }

    setSelectedCycleId((current) => {
      if (current && cycles.some((cycle) => cycle.id === current)) {
        return current;
      }
      return cycles[cycles.length - 1]?.id ?? null;
    });
  }, [cycles]);

  useEffect(() => {
    if (!selectedCycleId) {
      setAttempts([]);
      setMessages([]);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const loadCycleData = async () => {
      setRunsLoading(true);
      try {
        const [nextAttempts, nextMessages] = await Promise.all([
          api.getTaskCycleAttempts(taskId, selectedCycleId),
          api.getTaskCycleMessages(taskId, selectedCycleId),
        ]);
        if (!cancelled) {
          setAttempts(nextAttempts);
          setMessages(nextMessages);
          setRunsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRunsLoading(false);
        }
      }
    };

    void loadCycleData();

    const currentLatestCycleId = cycles[cycles.length - 1]?.id ?? null;
    if (isRunning && selectedCycleId === currentLatestCycleId) {
      timer = setInterval(() => {
        void loadCycleData();
      }, 1000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [cycles, isRunning, selectedCycleId, taskId]);

  useEffect(() => {
    void api.getTaskQuestions(taskId).then(setAllQuestions).catch(() => {});
  }, [taskId, liveOutput?.status]);

  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === selectedCycleId),
    [cycles, selectedCycleId],
  );
  const latestCycleId = cycles[cycles.length - 1]?.id ?? null;
  const isViewingLatestCycle = selectedCycleId != null && selectedCycleId === latestCycleId;
  const attemptsById = useMemo(
    () => new Map(attempts.map((attempt) => [attempt.id, attempt])),
    [attempts],
  );
  const visibleMessages = useMemo(
    () => messages.filter((message) =>
      !(message.messageType === 'json_event' && shouldSuppressJsonEventContent(message.content))),
    [messages],
  );
  const messagesByRun = useMemo(() => {
    const grouped = new Map<string, ConversationMessage[]>();
    for (const message of visibleMessages) {
      if (!message.runId) continue;
      const existing = grouped.get(message.runId) ?? [];
      existing.push(message);
      grouped.set(message.runId, existing);
    }
    return grouped;
  }, [visibleMessages]);
  const firstMessageIdByRun = useMemo(() => {
    const grouped = new Map<string, string>();
    for (const message of messages) {
      if (!message.runId || grouped.has(message.runId)) continue;
      grouped.set(message.runId, message.id);
    }
    return grouped;
  }, [messages]);
  const latestAttempt = attempts[attempts.length - 1];
  const legacyFallbackAttempt = useMemo(() => {
    if (visibleMessages.length > 0) return null;
    if (!latestAttempt) return null;
    const hasOutput = !!(
      latestAttempt.parsedOutput
      || latestAttempt.stdout
      || latestAttempt.stderr
    );
    return hasOutput ? latestAttempt : null;
  }, [latestAttempt, visibleMessages.length]);

  // Get questions grouped by run
  const runQuestions = useMemo(() => {
    if (!selectedCycle) return new Map<string, ControlRequest[]>();
    const map = new Map<string, ControlRequest[]>();
    for (const run of attempts) {
      const rq = allQuestions
        .filter((q) => q.runId === run.id && q.status !== 'pending')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (rq.length > 0) map.set(run.id, rq);
    }
    return map;
  }, [allQuestions, attempts, selectedCycle]);

  // Cycle-level stats
  const cycleStats = useMemo(() => {
    if (!selectedCycle) return { status: '', tokens: null as number | null, duration: null as number | null };
    const status = isViewingLatestCycle && liveOutput?.status
      ? liveOutput.status
      : latestAttempt?.status ?? selectedCycle.status ?? '';

    let tokens = 0;
    let duration = 0;
    for (const run of attempts) {
      const isLive = isViewingLatestCycle && latestAttempt && run.id === latestAttempt.id;
      tokens += (isLive && liveOutput?.tokens != null ? liveOutput.tokens : run.tokens) ?? 0;
      duration += (isLive && liveOutput?.durationMs != null ? liveOutput.durationMs : run.durationMs) ?? 0;
    }

    return { status, tokens: tokens || null, duration: duration || null };
  }, [attempts, isViewingLatestCycle, latestAttempt, liveOutput, selectedCycle]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Double-pass scroll covers delayed markdown/layout expansion after data loads.
  useEffect(() => {
    if (runsLoading || !scrollRef.current || !selectedCycle) return undefined;

    const timers: number[] = [];
    const initialTimer = window.setTimeout(() => {
      scrollToBottom();
      const followUpTimer = window.setTimeout(() => {
        scrollToBottom();
      }, 50);
      timers.push(followUpTimer);
    }, 50);
    timers.push(initialTimer);

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [attempts.length, runsLoading, scrollToBottom, selectedCycle, selectedCycleId, visibleMessages.length]);

  // Auto-scroll when running
  const liveStdout = useMemo(() => {
    if (!selectedCycle || !isViewingLatestCycle || !liveOutput) return '';
    return liveOutput.stream ?? liveOutput.stdout ?? '';
  }, [selectedCycle, isViewingLatestCycle, liveOutput]);

  useEffect(() => {
    if (isRunning && isViewingLatestCycle && scrollRef.current) {
      scrollToBottom();
    }
  }, [liveStdout, isRunning, isViewingLatestCycle, scrollToBottom]);

  // Check if there's any content to show (or still loading)
  const hasAnyContent = useMemo(() => {
    // While loading runs, assume there's content to prevent flashing empty state
    if (runsLoading) return true;
    if (!selectedCycle) return false;
    return visibleMessages.length > 0 || attempts.some((run) => {
      const isLive = isViewingLatestCycle && latestAttempt && run.id === latestAttempt.id;
      const stdout = isLive && liveOutput
        ? (liveOutput.stream ?? liveOutput.stdout ?? '')
        : run.stdout;
      const stderr = isLive && liveOutput ? (liveOutput.stderr ?? '') : run.stderr;
      return stdout || stderr || run.parsedOutput;
    }) || runQuestions.size > 0;
  }, [attempts, isViewingLatestCycle, latestAttempt, liveOutput, runQuestions.size, runsLoading, selectedCycle, visibleMessages.length]);

  const handleCopy = async () => {
    if (!selectedCycle) return;
    const parts: string[] = [];
    for (const message of messages) {
      const label = message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'user'
          ? 'User'
          : 'System';
      parts.push(`[${label}] ${message.content}`);
    }
    if (isViewingLatestCycle && (liveOutput?.stream || liveOutput?.stdout)) {
      parts.push(liveOutput.stream ?? liveOutput.stdout ?? '');
    }
    const text = parts.join('\n\n---\n\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const renderAttemptDebug = (
    run: ExecutionRun,
    runMessages: ConversationMessage[],
  ) => {
    const hasStructuredMessages = runMessages.length > 0;
    const hasRawStdout = !!run.stdout?.trim();
    const hasRawStderr = !!run.stderr?.trim();
    const hasParsed = !!run.parsedOutput?.trim();

    if (hasStructuredMessages) {
      return null;
    }

    if (!hasRawStdout && !hasRawStderr && !hasParsed) {
      return null;
    }

    return (
      <div className="space-y-2">
        {hasParsed && (
          <details className="rounded border border-border-secondary bg-surface-1/60 px-2.5 py-2">
            <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
              Parsed output
            </summary>
            <div className="mt-2">
              {looksLikeMarkdown(run.parsedOutput!) ? (
                <MarkdownOutput content={truncateText(run.parsedOutput!, 16000)} />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
                  {truncateText(run.parsedOutput!, 16000)}
                </pre>
              )}
            </div>
          </details>
        )}
        {!hasParsed && hasRawStdout && (
          <details className="rounded border border-border-secondary bg-surface-1/60 px-2.5 py-2">
            <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
              Legacy raw stdout
            </summary>
            <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded border border-border-secondary bg-surface-0 p-2 font-mono text-caption leading-4 text-text-dim">
              {truncateText(run.stdout, 16000)}
            </pre>
          </details>
        )}
        {hasRawStderr && (
          <details className="rounded border border-border-secondary bg-surface-1/60 px-2.5 py-2">
            <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
              Legacy raw stderr
            </summary>
            <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded border border-border-secondary bg-surface-0 p-2 font-mono text-caption leading-4 text-text-dim">
              {truncateText(run.stderr, 16000)}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const renderRunUsageBadge = (run: ExecutionRun) => {
    const pricingMeta = getPricingSourceMeta(run.pricingSource);
    if (!pricingMeta) {
      return null;
    }

    return (
      <Badge size="sm" tone={pricingMeta.tone}>
        {pricingMeta.label}
      </Badge>
    );
  };

  return (
    <section aria-labelledby="execution-section" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionHeader id="execution-section">Execution</SectionHeader>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedCycle && (
            <span className="font-mono text-caption text-text-dim">
              Run #{selectedCycle.cycleNumber}
            </span>
          )}
          {attempts.length > 0 && (
            <span className="font-mono text-caption text-text-dim">
              {attempts.length} attempts
            </span>
          )}
          {visibleMessages.length > 0 && (
            <span className="font-mono text-caption text-text-dim">
              {visibleMessages.length} messages
            </span>
          )}
          {cycleStats.tokens != null && (
            <span className="font-mono text-caption text-text-dim">
              {cycleStats.tokens.toLocaleString()} tokens
            </span>
          )}
          {cycleStats.duration != null && (
            <span className="font-mono text-caption text-text-dim">
              {(cycleStats.duration / 1000).toFixed(1)}s
            </span>
          )}
          <Button className="h-6 px-2 text-caption" onClick={handleCopy} size="sm" variant="ghost">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Cycle selector — only show when there are multiple task cycles */}
      {cycles.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-caption text-text-dim">Run:</span>
          {cycles.map((cycle) => {
            const isDone = cycle.status === 'completed';
            const isFail = cycle.status === 'failed' || cycle.status === 'aborted' || cycle.status === 'timeout' || cycle.status === 'restarted';
            return (
              <Button
                className="h-6 min-w-[28px] px-1.5 text-caption"
                key={cycle.id}
                onClick={() => setSelectedCycleId(cycle.id)}
                size="sm"
                variant={cycle.id === selectedCycleId ? 'primary' : 'ghost'}
              >
                #{cycle.cycleNumber}
                {isDone ? ' \u2713' : isFail ? ' \u2717' : ''}
              </Button>
            );
          })}
        </div>
      )}

      {/* Conversation thread */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-secondary bg-surface-1 p-3"
      >
        {runsLoading && !selectedCycle ? (
          <div className="flex items-center gap-2 py-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-dim border-t-accent-orange" />
            <span className="font-mono text-caption text-text-dim">Loading output...</span>
          </div>
        ) : selectedCycle ? (
          <div className="space-y-3">
            {visibleMessages.map((message) => {
              const run = message.runId ? attemptsById.get(message.runId) : undefined;
              const runQs = run ? (runQuestions.get(run.id) ?? []) : [];
              const attemptDebug = run
                ? renderAttemptDebug(run, messagesByRun.get(run.id) ?? [])
                : null;
              const runMessages = run ? (messagesByRun.get(run.id) ?? []) : [];
              const shouldShowLegacyTimeline = Boolean(
                run
                && run.stdout
                && firstMessageIdByRun.get(run.id) === message.id
                && runMessages.every((item) => item.messageType === 'final_answer'),
                );

              if (message.role === 'user') {
                return (
                  <div className="flex justify-end" key={message.id}>
                    <div className="max-w-[85%] rounded-lg rounded-tr-sm border border-accent-orange/20 bg-accent-orange/10 px-3 py-2">
                      <p className="whitespace-pre-wrap text-caption leading-relaxed text-text-primary">
                        {message.content}
                      </p>
                      <span className="mt-1 block text-right font-mono text-micro text-text-dim">You</span>
                    </div>
                  </div>
                );
              }

              if (message.role === 'system' && message.messageType === 'event') {
                return (
                  <div className="flex justify-center" key={message.id}>
                    <div className="max-w-[90%] rounded-md border border-border-secondary bg-surface-0 px-3 py-2 text-center">
                      <p className="whitespace-pre-wrap font-mono text-caption text-text-dim">
                        {message.content}
                      </p>
                    </div>
                  </div>
                );
              }

              const isToolLike = message.messageType === 'tool_call'
                || message.messageType === 'raw_stdout'
                || message.messageType === 'raw_stderr'
                || message.messageType === 'json_event'
                || message.messageType === 'session_init'
                || isLegacySessionInitMessage(message);

              return (
                <div className="space-y-2" key={message.id}>
                  {shouldShowLegacyTimeline && (
                    <div className="rounded-md border border-border-secondary bg-surface-0/40 px-3 py-3">
                      <ConversationView rawOutput={run!.stdout} />
                      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-micro text-text-dim">
                        <span>Recovered timeline</span>
                        {run?.agentId && <span>{run.agentId}</span>}
                        {run?.provider && <span>{run.provider}</span>}
                        {run?.model && <span>{run.model}</span>}
                        {run?.attemptNumber != null && <span>attempt #{run.attemptNumber}</span>}
                      </div>
                    </div>
                  )}

                  {run && attemptDebug && (
                    <details className="rounded-md border border-border-secondary bg-surface-0/60 px-3 py-2">
                      <summary className="cursor-pointer font-mono text-caption text-text-dim hover:text-text-secondary">
                        Show attempt details
                      </summary>
                      <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-micro text-text-dim">
                          {run.status && <span>{run.status}</span>}
                          {run.exitCode != null && <span>exit {run.exitCode}</span>}
                          {run.durationMs != null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
                          {run.tokens != null && <span>{run.tokens.toLocaleString()} tokens</span>}
                          {run.costUsd != null && <span>{formatCost(run.costUsd)}</span>}
                          {renderRunUsageBadge(run)}
                          {run.providerSessionId && <span>session {run.providerSessionId.slice(0, 8)}</span>}
                        </div>
                        {attemptDebug}
                      </div>
                    </details>
                  )}

                  <div className={cn(
                    'px-3 py-3',
                    isToolLike
                      ? 'rounded-md border border-border-secondary bg-surface-0/40'
                      : message.messageType === 'final_answer'
                        ? 'rounded-lg rounded-tl-sm border border-accent-orange/30 bg-accent-orange/5'
                        : 'rounded-lg rounded-tl-sm border border-border-secondary bg-surface-2/80',
                  )}>
                    <StructuredMessageContent message={message} />
                    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-micro text-text-dim">
                      <span>
                        {message.messageType === 'final_answer'
                          ? 'Final'
                          : message.messageType === 'tool_call'
                            ? 'Tool'
                            : message.messageType === 'stream_text'
                              ? 'Assistant'
                              : 'AI'}
                      </span>
                      {run?.agentId && <span>{run.agentId}</span>}
                      {run?.provider && <span>{run.provider}</span>}
                      {run?.model && <span>{run.model}</span>}
                      {run?.attemptNumber != null && <span>attempt #{run.attemptNumber}</span>}
                      {run?.tokens != null && <span>{run.tokens.toLocaleString()} tokens</span>}
                      {run?.costUsd != null && <span>{formatCost(run.costUsd)}</span>}
                      {run ? renderRunUsageBadge(run) : null}
                      {run?.durationMs != null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
                      {run?.startedAt && <span>{new Date(run.startedAt).toLocaleString()}</span>}
                    </div>
                  </div>

                  {runQs.length > 0 && (
                    <div className="space-y-2">
                      {runQs.map((q) => (
                        <ChatQAEntry key={q.id} question={q} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {legacyFallbackAttempt && !isRunning && (
              <div className="space-y-2">
                <div className="rounded-lg rounded-tl-sm border border-border-secondary bg-surface-2/80 px-3 py-3">
                  <RunOutput
                    isLive={false}
                    parsedOutput={legacyFallbackAttempt.parsedOutput}
                    stderr={legacyFallbackAttempt.stderr}
                    stdout={legacyFallbackAttempt.stdout}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-micro text-text-dim">
                    <span>AI</span>
                    {legacyFallbackAttempt.agentId && (
                      <span>{legacyFallbackAttempt.agentId}</span>
                    )}
                    {legacyFallbackAttempt.provider && (
                      <span>{legacyFallbackAttempt.provider}</span>
                    )}
                    {legacyFallbackAttempt.model && (
                      <span>{legacyFallbackAttempt.model}</span>
                    )}
                    {legacyFallbackAttempt.attemptNumber != null && (
                      <span>attempt #{legacyFallbackAttempt.attemptNumber}</span>
                    )}
                    {legacyFallbackAttempt.tokens != null && (
                      <span>{legacyFallbackAttempt.tokens.toLocaleString()} tokens</span>
                    )}
                    {legacyFallbackAttempt.costUsd != null && (
                      <span>{formatCost(legacyFallbackAttempt.costUsd)}</span>
                    )}
                    {renderRunUsageBadge(legacyFallbackAttempt)}
                    {legacyFallbackAttempt.durationMs != null && (
                      <span>{(legacyFallbackAttempt.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    {legacyFallbackAttempt.startedAt && (
                      <span>
                        {new Date(legacyFallbackAttempt.startedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {isRunning && isViewingLatestCycle && latestAttempt && (
              <div className="space-y-2">
                <div className="rounded-lg rounded-tl-sm border border-accent-blue/20 bg-accent-blue/5 px-3 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-micro text-text-dim">
                    <span>Running</span>
                    {latestAttempt.agentId && <span>{latestAttempt.agentId}</span>}
                    {latestAttempt.provider && <span>{latestAttempt.provider}</span>}
                    {latestAttempt.model && <span>{latestAttempt.model}</span>}
                    <span>attempt #{latestAttempt.attemptNumber}</span>
                    {liveOutput?.tokens != null && <span>{liveOutput.tokens.toLocaleString()} tokens</span>}
                    {latestAttempt.costUsd != null && <span>{formatCost(latestAttempt.costUsd)}</span>}
                    {renderRunUsageBadge(latestAttempt)}
                    {liveOutput?.durationMs != null && <span>{(liveOutput.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                  <RunOutput
                    isLive
                    parsedOutput={latestAttempt.parsedOutput}
                    stderr={liveOutput?.stderr ?? latestAttempt.stderr}
                    stdout={liveOutput?.stream ?? liveOutput?.stdout ?? latestAttempt.stdout}
                  />
                </div>
              </div>
            )}

            {!isRunning
              && isViewingLatestCycle
              && attempts.length === 0
              && visibleMessages.some((message) =>
                message.role === 'user' && message.messageType === 'follow_up')
              && (
                <div className="flex items-center gap-2 px-1">
                  <span className="inline-block animate-pulse font-mono text-xs text-text-dim">
                    ...
                  </span>
                  <span className="font-mono text-micro text-text-dim">
                    Waiting for agent
                  </span>
                </div>
              )}
          </div>
        ) : isRunning ? (
          <span className="inline-block animate-pulse font-mono text-xs text-accent-blue">_</span>
        ) : parsedOutput?.content ? (
          <div>
            {looksLikeMarkdown(parsedOutput.content) ? (
              <MarkdownOutput content={parsedOutput.content} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
                {parsedOutput.content}
              </pre>
            )}
          </div>
        ) : (
          <p className="font-mono text-caption text-text-dim">No output yet. Output will appear here once the task runs.</p>
        )}
      </div>

    </section>
  );
}

/* ─── Branch Picker (Autocomplete) ─── */

interface BranchPickerProps {
  taskId: string;
  pipelineId: string;
  currentBranch: string | null;
  isEditable: boolean;
  dependencyCandidates: { id: string; name: string }[];
  dependsOn: string[];
  onBranchChanged: () => void;
}

function BranchPicker({
  taskId,
  pipelineId,
  currentBranch,
  isEditable,
  dependencyCandidates,
  dependsOn,
  onBranchChanged,
}: BranchPickerProps) {
  const [input, setInput] = useState(currentBranch ?? '');
  const [branches, setBranches] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncommittedFiles, setUncommittedFiles] = useState<string[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input with prop
  useEffect(() => {
    setInput(currentBranch ?? '');
    setError(null);
    setUncommittedFiles(null);
  }, [currentBranch]);

  // Fetch branches on focus
  const fetchBranches = useCallback(async () => {
    if (branches.length > 0) return; // already loaded
    setLoading(true);
    try {
      const { branches: list } = await api.fetchBranches(pipelineId);
      setBranches(list);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, branches.length]);

  // Filter branches by input
  const filtered = useMemo(() => {
    const q = input.toLowerCase().trim();
    if (!q) return branches;
    return branches.filter(b => b.toLowerCase().includes(q));
  }, [branches, input]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleClear = async () => {
    setShowDropdown(false);
    setError(null);
    setUncommittedFiles(null);
    setInput('');
    try {
      await api.updateTask(taskId, { branch: null } as Partial<Task>);
      onBranchChanged();
    } catch {
      setInput(currentBranch ?? '');
    }
  };

  const handleSelect = async (branch: string) => {
    setShowDropdown(false);
    setError(null);
    setUncommittedFiles(null);

    // Clear case
    if (!branch.trim()) {
      void handleClear();
      return;
    }

    if (branch === (currentBranch ?? '')) return;

    setInput(branch);

    const result = await api.switchTaskBranch(taskId, branch);
    if (result.ok) {
      onBranchChanged();
    } else if (result.error === 'uncommitted_changes') {
      setError(result.message ?? 'Uncommitted changes in worktree');
      setUncommittedFiles(result.files ?? null);
      setInput(currentBranch ?? '');
    } else {
      setError(result.error ?? result.message ?? 'Failed to switch branch');
      setInput(currentBranch ?? '');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && trimmed !== (currentBranch ?? '')) {
        void handleSelect(trimmed);
      }
      setShowDropdown(false);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setInput(currentBranch ?? '');
    }
  };

  return (
    <div className="space-y-1.5">
      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          aria-label="Task start source"
          className={
            'w-full rounded-md border bg-surface-1 px-2 py-1.5 font-mono text-caption outline-none transition-colors ' +
            (error
              ? 'border-accent-red text-accent-red'
              : 'border-border-secondary text-text-primary focus:border-accent-orange') +
            (!isEditable ? ' cursor-not-allowed opacity-50' : '')
          }
          disabled={!isEditable}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
            setUncommittedFiles(null);
            if (!showDropdown) setShowDropdown(true);
          }}
          onFocus={() => {
            void fetchBranches();
            setShowDropdown(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="pipeline default / dependency output"
          value={input}
        />

        {/* Dropdown */}
        {showDropdown && isEditable && (
          <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-y-auto rounded-md border border-border-secondary bg-surface-2 shadow-lg">
            {loading ? (
              <div className="px-2 py-1.5 text-caption text-text-dim">Loading branches...</div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-caption text-text-dim">
                {input.trim() ? 'No matching branch found' : 'No branches'}
              </div>
            ) : (
              filtered.map(b => (
                <button
                  key={b}
                  type="button"
                  className={
                    'block w-full px-2 py-1 text-left font-mono text-caption transition-colors hover:bg-surface-3 ' +
                    (b === (currentBranch ?? '') ? 'text-accent-orange' : 'text-text-secondary')
                  }
                  onClick={() => void handleSelect(b)}
                >
                  {b}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-accent-red/30 bg-accent-red/5 p-2 text-caption text-accent-red">
          {error}
          {uncommittedFiles && uncommittedFiles.length > 0 && (
            <div className="mt-1 space-y-0.5 font-mono text-micro text-text-dim">
              {uncommittedFiles.slice(0, 5).map(f => (
                <div key={f}>{f}</div>
              ))}
              {uncommittedFiles.length > 5 && (
                <div>...and {uncommittedFiles.length - 5} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Running warning */}
      {!isEditable && (
        <div className="text-micro text-text-dim">
          Start source can only be changed before the task runs.
        </div>
      )}

      {/* Dependency quick-select buttons */}
      {dependsOn.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-caption text-text-muted">Start from task:</span>
          {dependencyCandidates
            .filter(c => dependsOn.includes(c.id))
            .map(dep => (
              <Button
                className="h-5 px-1.5 font-mono text-caption"
                disabled={!isEditable}
                key={dep.id}
                onClick={() => void handleSelect(`task/${dep.id}`)}
                size="sm"
                variant={currentBranch === `task/${dep.id}` ? 'primary' : 'secondary'}
              >
                {dep.name}
              </Button>
            ))}
          {currentBranch && (
            <Button
              className="h-5 px-1.5 font-mono text-caption text-accent-red"
                disabled={!isEditable}
              onClick={() => void handleSelect('')}
              size="sm"
              variant="ghost"
            >
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Git Panel (Sidebar) ─── */

interface GitPanelProps {
  taskId: string;
  pipelineId: string;
  currentBranch: string | null;
  isEditable: boolean;
  isRunning: boolean;
  dependencyCandidates: { id: string; name: string }[];
  dependsOn: string[];
  sourceTaskId: string | null;
  sourceTaskName: string | null;
  sourceTaskStatus: TaskStatus | null;
  taskType: Task['taskType'];
  onOpenTask?: (taskId: string) => void;
}

function GitPanel({
  taskId,
  pipelineId,
  currentBranch,
  isEditable,
  isRunning,
  dependencyCandidates,
  dependsOn,
  sourceTaskId,
  sourceTaskName,
  sourceTaskStatus,
  taskType,
  onOpenTask,
}: GitPanelProps) {
  const [status, setStatus] = useState<api.GitStatus | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'merge' | 'rebase' | 'cleanup' | null>(null);
  const [conflictInfo, setConflictInfo] = useState<api.GitConflictError | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.fetchGitStatus(taskId);
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const executeAction = async (action: 'merge' | 'rebase' | 'cleanup') => {
    setConfirmAction(null);
    setActionLoading(action);
    setActionResult(null);
    setConflictInfo(null);
    try {
      const result = await api.performGitAction(taskId, action);
      setActionResult(result);
      await fetchStatus();
    } catch (err) {
      const conflict = (err as Error & { conflict?: api.GitConflictError }).conflict;
      if (conflict) {
        setConflictInfo(conflict);
        setActionResult({ ok: false, message: conflict.message });
      } else {
        setActionResult({ ok: false, message: (err as Error).message });
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleShowDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    try {
      const { diff: d } = await api.fetchGitDiff(taskId);
      setDiff(d);
      setShowDiff(true);
    } catch {
      setDiff('Failed to load diff');
      setShowDiff(true);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <BranchPicker
          taskId={taskId}
          pipelineId={pipelineId}
          currentBranch={currentBranch}
          isEditable={isEditable}
          dependencyCandidates={dependencyCandidates}
          dependsOn={dependsOn}
          onBranchChanged={() => void fetchStatus()}
        />
        <div className="rounded-md border border-border-secondary bg-surface-1 p-2 text-caption text-text-dim">Loading git status...</div>
      </div>
    );
  }

  if (!status || (!status.exists && !status.worktreePath)) {
    return (
      <BranchPicker
        taskId={taskId}
        pipelineId={pipelineId}
        currentBranch={currentBranch}
        isEditable={isEditable}
        dependencyCandidates={dependencyCandidates}
        dependsOn={dependsOn}
        onBranchChanged={() => void fetchStatus()}
      />
    );
  }

  const usesParentCodeLine =
    !status.exists &&
    !currentBranch &&
    !!sourceTaskId &&
    (taskType === 'spawned' || taskType === 'system');
  const waitingOnParentReview = isWaitingOnParentReview(
    taskType,
    sourceTaskId,
    sourceTaskStatus,
    status.worktreeStatus ?? null,
  );

  const canMerge = status.commitsAhead > 0 && !status.isMerged;
  const canRebase = status.commitsBehind > 0 && !status.isMerged;
  const canCleanup = status.isMerged;
  const canViewDiff = status.commitsAhead > 0;

  const confirmLabels: Record<string, string> = {
    merge: `Finalize ${status.branch} into ${status.mainBranch}?`,
    rebase: `Sync ${status.branch} with ${status.mainBranch}? This rewrites history.`,
    cleanup: `Archive workspace and delete ${status.branch}?`,
  };

  return (
    <div className="space-y-2">
      {/* Actual working branch (read-only) */}
      {status.exists ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 text-caption">
          <span className="text-text-dim">Code line</span>
          <span className="truncate font-mono text-accent-orange" title={status.branch}>{status.branch}</span>
        </div>
      ) : usesParentCodeLine ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 text-caption">
          <span className="text-text-dim">Code line</span>
          <span className="font-mono text-text-secondary">
            No separate code line
          </span>
        </div>
      ) : null}

      {/* Start source picker (editable) */}
      <div>
        <span className="mb-1 block text-micro uppercase tracking-wider text-text-dim">Starts from</span>
        <BranchPicker
          taskId={taskId}
          pipelineId={pipelineId}
          currentBranch={currentBranch}
          isEditable={isEditable}
          dependencyCandidates={dependencyCandidates}
          dependsOn={dependsOn}
          onBranchChanged={() => void fetchStatus()}
        />
        <p className="mt-1 text-micro text-text-dim">
          This controls which branch an isolated workspace starts from.
        </p>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-1">
        {!status.exists ? (
          <Badge size="sm" tone={usesParentCodeLine ? 'neutral' : 'warning'}>
            {usesParentCodeLine ? 'No separate code line' : 'Branch not found'}
          </Badge>
        ) : status.isMerged ? (
          <Badge size="sm" tone="success">Merged</Badge>
        ) : (
          <Badge size="sm" tone="info">Not merged</Badge>
        )}
        {status.worktreeStatus && status.worktreeStatus !== 'none' && (
          <Badge size="sm" tone={
            status.worktreeStatus === 'merged' ||
            status.worktreeStatus === 'merged_with_parent' ? 'success'
              : status.worktreeStatus === 'cleanup_blocked_dirty' ? 'warning'
              : status.worktreeStatus === 'archived_with_parent' ? 'neutral'
              : waitingOnParentReview ? 'warning'
              : status.worktreeStatus === 'ready_for_review' ? 'info'
                : 'neutral'
          }>
            {waitingOnParentReview
              ? 'Waiting on parent review'
              : usesParentCodeLine && status.worktreeStatus === 'ready_for_review'
              ? 'Review parent task'
              : getWorktreeStatusLabel(status.worktreeStatus)}
          </Badge>
        )}
        {status.commitsAhead > 0 && (
          <Badge size="sm" tone="neutral">{status.commitsAhead} ahead</Badge>
        )}
        {status.commitsBehind > 0 && (
          <Badge size="sm" tone="warning">{status.commitsBehind} behind</Badge>
        )}
        {status.hasUncommitted && (
          <Badge size="sm" tone="warning">Uncommitted</Badge>
        )}
      </div>

      {usesParentCodeLine && sourceTaskId ? (
        <div className="space-y-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 text-caption">
            <span className="text-text-dim">Lifecycle owner</span>
            <span className="truncate font-mono text-text-secondary">
              {sourceTaskName ?? sourceTaskId}
            </span>
          </div>
          <p className="text-micro text-text-dim">
            {waitingOnParentReview
              ? 'This follow-up task is waiting on its parent task review. Review and finalize the parent task first.'
              : 'This follow-up task worked on its parent task&apos;s code line. Open the parent task to inspect the combined diff and take action.'}
          </p>
          <Button
            className="h-7 px-2 text-caption"
            onClick={() => onOpenTask?.(sourceTaskId)}
            size="sm"
            variant="secondary"
          >
            {sourceTaskName
              ? `${waitingOnParentReview ? 'Review parent task' : 'Open parent task'}: ${sourceTaskName}`
              : 'Open parent task'}
          </Button>
        </div>
      ) : status.worktreeStatus === 'merged_with_parent' ? (
        <p className="text-micro text-text-dim">
          This follow-up task was closed together with its parent task after
          the parent was finalized.
        </p>
      ) : status.worktreeStatus === 'archived_with_parent' ? (
        <p className="text-micro text-text-dim">
          This follow-up task was archived together with its parent task.
        </p>
      ) : status.worktreeStatus === 'ready_for_review' && (
        <p className="text-micro text-text-dim">
          Review happens here. Open the diff, then choose Finalize, Sync, or
          Archive workspace.
        </p>
      )}

      {/* Confirmation */}
      {confirmAction && (
        <div className="rounded-md border border-amber-800 bg-amber-950/30 p-2 space-y-2">
          <p className="text-caption text-amber-300">{confirmLabels[confirmAction]}</p>
          <div className="flex gap-1.5">
            <Button className="h-6 px-2 text-caption" onClick={() => executeAction(confirmAction)} size="sm" variant="primary">Confirm</Button>
            <Button className="h-6 px-2 text-caption" onClick={() => setConfirmAction(null)} size="sm" variant="ghost">Cancel</Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!confirmAction && (
        <div className="flex flex-wrap gap-1.5">
          {canViewDiff && (
            <Button
              className="h-6 px-2 text-caption"
              onClick={handleShowDiff}
              size="sm"
              variant="secondary"
            >
              Open Diff
            </Button>
          )}
          {canMerge && (
            <Button className="h-6 px-2 text-caption" disabled={isRunning || actionLoading !== null} onClick={() => setConfirmAction('merge')} size="sm" variant="primary">
              {actionLoading === 'merge' ? 'Finalizing...' : 'Finalize'}
            </Button>
          )}
          {canRebase && (
            <Button className="h-6 px-2 text-caption" disabled={isRunning || actionLoading !== null} onClick={() => setConfirmAction('rebase')} size="sm" variant="secondary">
              {actionLoading === 'rebase' ? 'Syncing...' : 'Sync'}
            </Button>
          )}
          {canCleanup && (
            <Button className="h-6 px-2 text-caption" disabled={isRunning || actionLoading !== null} onClick={() => setConfirmAction('cleanup')} size="sm" variant="secondary">
              {actionLoading === 'cleanup' ? 'Archiving...' : 'Archive workspace'}
            </Button>
          )}
        </div>
      )}

      {isRunning && (
        <div className="text-micro text-text-dim">
          Stop the task before finalizing, syncing, or archiving its workspace.
        </div>
      )}

      {/* Action result */}
      {actionResult && (
        <div className={`rounded-md border p-2 text-caption ${
          actionResult.ok
            ? 'border-green-800 bg-green-950/30 text-green-400'
            : 'border-red-800 bg-red-950/30 text-red-400'
        }`}>
          {actionResult.message}
        </div>
      )}

      {/* Conflict info */}
      {conflictInfo && (
        <div className="rounded-md border border-amber-800 bg-amber-950/30 p-2 space-y-1">
          {conflictInfo.conflictFiles.length > 0 && (
            <div className="space-y-0.5">
              <span className="text-caption font-semibold tracking-wider text-amber-400 uppercase">Conflicts</span>
              <div className="rounded bg-surface-2 p-1.5">
                {conflictInfo.conflictFiles.map((f) => (
                  <div key={f} className="truncate font-mono text-caption text-amber-300">{f}</div>
                ))}
              </div>
            </div>
          )}
          {conflictInfo.fixerTaskId && (
            <p className="text-caption text-amber-300">
              Fixer task <span className="font-mono text-accent-orange">{conflictInfo.fixerTaskId}</span> spawned.
            </p>
          )}
        </div>
      )}

      <Modal
        className="h-[85vh] max-w-[min(1100px,92vw)]"
        description="Review the full patch for this code line."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setShowDiff(false)} variant="ghost">
              Close
            </Button>
          </div>
        }
        onOpenChange={setShowDiff}
        open={showDiff}
        title={
          <div className="space-y-1">
            <div>Diff Viewer</div>
            {status.exists && (
              <div className="font-mono text-caption font-normal text-text-dim">
                {status.branch} vs {status.mainBranch}
              </div>
            )}
          </div>
        }
      >
        <div className="h-full overflow-auto rounded-md border border-border-secondary bg-surface-0 p-3">
          <pre className="whitespace-pre font-mono text-caption leading-5">
            {(diff ?? '').split('\n').map((line, i) => {
              let cls = 'text-text-dim';
              if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400';
              else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
              else if (line.startsWith('@@')) cls = 'text-accent-blue';
              else if (line.startsWith('diff ')) cls = 'text-text-secondary font-semibold';
              return <div key={i} className={cls}>{line}</div>;
            })}
          </pre>
        </div>
      </Modal>
    </div>
  );
}

/* ─── Collapsible Sidebar Section ─── */

function SidebarSection({ id, title, children, defaultOpen = true, collapsed, onToggle }: {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const isOpen = collapsed[id] === undefined ? defaultOpen : !collapsed[id];
  return (
    <section className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => onToggle(id)}
      >
        <SectionHeader>{title}</SectionHeader>
        <span className="font-mono text-caption text-text-dim">{isOpen ? '[-]' : '[+]'}</span>
      </button>
      {isOpen && children}
    </section>
  );
}

/* ─── Main TaskDrawer ─── */

interface TaskDrawerProps {
  task: Task;
  tasks: Task[];
  agents: Agent[];
  pipelineId: string;
  actionMessage?: string | null;
  onClose: () => void;
  onDismissActionMessage?: () => void;
  onOpenTask?: (taskId: string) => void;
  onUpdate: (update: Partial<Task>) => Promise<void> | void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onAbort?: (id: string) => void;
  onRetry?: (id: string, followUpPrompt?: string) => void;
  onStart?: (id: string) => void;
  onSkip?: (id: string) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
}

export function TaskDrawer({
  task,
  tasks,
  agents,
  pipelineId,
  actionMessage,
  onClose,
  onDismissActionMessage,
  onOpenTask,
  onUpdate,
  onApprove,
  onReject,
  onAbort,
  onRetry,
  onStart,
  onSkip,
  onDelete,
  onArchive,
}: TaskDrawerProps) {
  const { getModel } = useModels();
  const [input, setInput] = useState(task.input);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [execOutput, setExecOutput] = useState<ExecutionOutput | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<
    PendingTaskAttachmentUpload[]
  >([]);
  const [followUp, setFollowUp] = useState('');
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [note, setNote] = useState(task.userNote ?? '');
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attachmentRequestRef = useRef(0);
  const uploadTimersRef = useRef<
    Map<string, ReturnType<typeof setInterval>>
  >(new Map());

  const isRunning = task.status === 'running';
  const isLocked = isRunning;
  const canEditGitStartSource = canEditStartSource(task.status);
  const canManageAttachments = !isRunning;

  const parsedTaskOutput = useMemo(() => {
    if (!task.output) return null;
    return parseCliOutput(task.output);
  }, [task.output]);
  const isUploadingFiles = pendingUploads.some(
    (upload) => upload.status === 'uploading',
  );

  useEffect(() => {
    setInput(task.input);
    setNote(task.userNote ?? '');
    setNoteDirty(false);
    setUpdateError(null);
  }, [task.id, task.input, task.name, task.branch, task.userNote, task.model]);

  const clearUploadTimer = useCallback((uploadId: string) => {
    const timer = uploadTimersRef.current.get(uploadId);
    if (!timer) {
      return;
    }

    clearInterval(timer);
    uploadTimersRef.current.delete(uploadId);
  }, []);

  const beginUploadProgress = useCallback((uploadId: string) => {
    clearUploadTimer(uploadId);

    const timer = setInterval(() => {
      setPendingUploads((currentUploads) =>
        currentUploads.map((upload) => {
          if (upload.id !== uploadId || upload.status !== 'uploading') {
            return upload;
          }

          return {
            ...upload,
            progress: Math.min(upload.progress + 12, 92),
          };
        }),
      );
    }, 220);

    uploadTimersRef.current.set(uploadId, timer);
  }, [clearUploadTimer]);

  const loadAttachments = useCallback(async () => {
    const requestId = attachmentRequestRef.current + 1;
    attachmentRequestRef.current = requestId;
    setAttachmentsLoading(true);
    setAttachmentError(null);

    try {
      const nextAttachments = await api.getTaskAttachments(task.id);
      if (attachmentRequestRef.current !== requestId) {
        return;
      }
      setAttachments(nextAttachments);
    } catch (error) {
      if (attachmentRequestRef.current !== requestId) {
        return;
      }
      setAttachmentError(toErrorMessage(error));
    } finally {
      if (attachmentRequestRef.current === requestId) {
        setAttachmentsLoading(false);
      }
    }
  }, [task.id]);

  useEffect(() => {
    for (const uploadId of uploadTimersRef.current.keys()) {
      clearUploadTimer(uploadId);
    }
    setAttachments([]);
    setPendingUploads([]);
    setAttachmentError(null);
    void loadAttachments();
  }, [clearUploadTimer, loadAttachments]);

  useEffect(() => {
    return () => {
      for (const uploadId of uploadTimersRef.current.keys()) {
        clearUploadTimer(uploadId);
      }
    };
  }, [clearUploadTimer]);

  const safeUpdate = useCallback(
    async (update: Partial<Task>) => {
      try {
        await onUpdate(update);
        setUpdateError(null);
      } catch {
        setUpdateError('Could not save task changes.');
      }
    },
    [onUpdate],
  );

  const fetchOutput = useCallback(async () => {
    if (task.status === 'queued') return;
    try {
      const output = await api.getTaskOutput(task.id);
      setExecOutput((previous) => mergeExecutionOutput(previous, output));
    } catch {
      // Ignore transient errors
    }
  }, [task.id, task.status]);

  useEffect(() => {
    void fetchOutput();
    if (task.status === 'running') {
      pollRef.current = setInterval(() => {
        void fetchOutput();
      }, 1000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchOutput, task.id, task.status]);

  useEffect(() => {
    setShowRestartConfirm(false);
  }, [task.id, task.status]);

  const dependencyCandidates = useMemo(() => {
    return tasks.filter((candidate) => candidate.id !== task.id);
  }, [task.id, tasks]);

  const agent = agents.find((a) => a.id === task.agentId);

  const isCompleted = task.status === 'completed';
  const canFollowUp = isCompleted && onRetry;
  const canRestartFresh = task.status === 'completed' || task.status === 'failed' || task.status === 'blocked' || task.status === 'rejected';
  const canDraftFollowUp = canFollowUp || canRestartFresh || isRunning;

  const handleFollowUp = () => {
    if (!followUp.trim() || !onRetry) return;
    onRetry(task.id, followUp.trim());
    setFollowUp('');
  };

  const uploadAttachmentFile = useCallback(async (file: File, uploadId: string) => {
    setPendingUploads((currentUploads) =>
      currentUploads.map((upload) =>
        upload.id === uploadId
          ? {
              ...upload,
              errorMessage: undefined,
              progress: 8,
              status: 'uploading',
            }
          : upload,
      ),
    );
    beginUploadProgress(uploadId);

    try {
      const uploadedAttachment = await api.uploadTaskAttachment(task.id, file);
      clearUploadTimer(uploadId);
      setAttachments((currentAttachments) => [
        ...currentAttachments,
        uploadedAttachment,
      ]);
      setPendingUploads((currentUploads) =>
        currentUploads.filter((upload) => upload.id !== uploadId),
      );
    } catch (error) {
      clearUploadTimer(uploadId);
      setPendingUploads((currentUploads) =>
        currentUploads.map((upload) =>
          upload.id === uploadId
            ? {
                ...upload,
                errorMessage: toErrorMessage(error),
                progress: 100,
                status: 'error',
              }
            : upload,
        ),
      );
      setAttachmentError(toErrorMessage(error));
    }
  }, [beginUploadProgress, clearUploadTimer, task.id]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    setAttachmentError(null);

    const uploads = files.map((file) => ({
      id: mkId(),
      file,
      name: file.name,
      progress: 0,
      sizeBytes: file.size,
      status: 'uploading' as const,
    }));

    setPendingUploads((currentUploads) => [...currentUploads, ...uploads]);

    try {
      await Promise.all(
        uploads.map((upload) => uploadAttachmentFile(upload.file, upload.id)),
      );
    } finally {
      // individual upload rows track their own lifecycle
    }
  }, [uploadAttachmentFile]);

  const handleRetryUpload = useCallback((uploadId: string) => {
    const pendingUpload = pendingUploads.find((upload) => upload.id === uploadId);
    if (!pendingUpload?.file) {
      return;
    }

    setAttachmentError(null);
    void uploadAttachmentFile(pendingUpload.file, uploadId);
  }, [pendingUploads, uploadAttachmentFile]);

  const handleDismissUploadError = useCallback((uploadId: string) => {
    clearUploadTimer(uploadId);
    setPendingUploads((currentUploads) =>
      currentUploads.filter((upload) => upload.id !== uploadId),
    );
  }, [clearUploadTimer]);

  const handleDeleteAttachment = useCallback(async (attachmentId: string) => {
    try {
      await api.deleteTaskAttachment(task.id, attachmentId);
      setAttachments((currentAttachments) =>
        currentAttachments.filter((attachment) => attachment.id !== attachmentId),
      );
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(toErrorMessage(error));
    }
  }, [task.id]);

  const handleAttachmentClick = useCallback((attachment: Attachment) => {
    if (attachment.mimeType?.startsWith('image/')) {
      setPreviewAttachment(attachment);
    } else {
      window.open(
        api.getAttachmentDownloadUrl(attachment.id),
        '_blank',
        'noopener',
      );
    }
  }, []);

  const handleRestartFresh = async () => {
    setRestarting(true);
    try {
      await api.restartTaskFresh(task.id);
      setShowRestartConfirm(false);
    } catch {
      // ignore
    } finally {
      setRestarting(false);
    }
  };

  const handleNoteSave = async () => {
    setNoteSaving(true);
    try {
      await api.updateTaskNote(task.id, note);
      setNoteDirty(false);
    } catch {
      // ignore
    } finally {
      setNoteSaving(false);
    }
  };

  const taskCost = task.costUsd != null ? formatCost(task.costUsd) : null;
  const drawerWidthClassName = 'w-[min(97vw,1320px)] min-w-[1080px] max-w-none';
  const panelClassName = 'rounded-xl border border-border-secondary bg-surface-1/80 p-4';
  const mutedPanelClassName = 'rounded-xl border border-border-secondary bg-surface-0/70 p-4';

  const renderPrimaryActions = () => (
    <>
      {task.status === 'awaiting_approval' && onApprove && (
        <Button className="h-8 px-3" onClick={() => onApprove(task.id)} size="sm" variant="primary">
          Approve
        </Button>
      )}
      {task.status === 'awaiting_approval' && onReject && (
        <Button className="h-8 px-3" onClick={() => onReject(task.id)} size="sm" variant="danger">
          Reject
        </Button>
      )}
      {task.status === 'queued' && onStart && (
        <Button className="h-8 px-3" onClick={() => onStart(task.id)} size="sm" variant="primary">
          Start
        </Button>
      )}
      {task.status === 'queued' && onSkip && (
        <Button className="h-8 px-3" onClick={() => onSkip(task.id)} size="sm" variant="secondary">
          Skip
        </Button>
      )}
    </>
  );

  const renderSecondaryActions = () => (
    <>
      {onArchive && task.status !== 'running' && (
        <Button
          className="h-7 px-2 text-caption"
          onClick={() => {
            onArchive(task.id);
            onClose();
          }}
          size="sm"
          variant="ghost"
        >
          Archive
        </Button>
      )}
      {onDelete && task.status !== 'running' && (
        showDeleteConfirm ? (
          <>
            <Button className="h-7 px-2 text-caption" onClick={() => onDelete(task.id)} size="sm" variant="danger">
              Confirm delete
            </Button>
            <Button className="h-7 px-2 text-caption" onClick={() => setShowDeleteConfirm(false)} size="sm" variant="ghost">
              Cancel
            </Button>
          </>
        ) : (
          <Button className="h-7 px-2 text-caption" onClick={() => setShowDeleteConfirm(true)} size="sm" variant="ghost">
            Delete
          </Button>
        )
      )}
    </>
  );

  const taskControlsPanel = (
    <section className={panelClassName}>
      <SectionHeader>Task Controls</SectionHeader>
      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block font-mono text-micro tracking-[0.08em] text-text-dim uppercase">
            Agent
          </label>
          <Select
            aria-label="Crew Member"
            disabled={isLocked}
            onChange={(event) => {
              const newAgentId = event.target.value;
              const newAgent = agents.find((item) => item.id === newAgentId);
              const update: Partial<Task> = { agentId: newAgentId };
              if (newAgent?.defaultModel) {
                update.model = newAgent.defaultModel;
              }
              void safeUpdate(update);
            }}
            value={task.agentId}
          >
            {agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.title ? ` - ${item.title}` : ''}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block font-mono text-micro tracking-[0.08em] text-text-dim uppercase">
            Model
          </label>
          <ModelSelector
            disabled={isLocked}
            onChange={(model) => { void safeUpdate({ model }); }}
            size="sm"
            value={task.model}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-micro tracking-[0.08em] text-text-dim uppercase">
              Approval
            </label>
            <Select
              aria-label="Approval mode"
              onChange={(event) => {
                void safeUpdate({ approval: event.target.value as ApprovalMode });
              }}
              value={task.approval}
            >
              {APPROVAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {formatApproval(mode)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block font-mono text-micro tracking-[0.08em] text-text-dim uppercase">
              Priority
            </label>
            <Select
              aria-label="Priority"
              onChange={(event) => {
                const value = event.target.value;
                void safeUpdate({ priority: value ? (value as TaskPriority) : null });
              }}
              value={task.priority ?? ''}
            >
              <option value="">None</option>
              {PRIORITIES.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {task.autoRetry && (
          <div className="flex items-center gap-2">
            <Badge size="sm" tone="warning">Auto Retry</Badge>
            <span className="font-mono text-caption text-text-dim">enabled for this task</span>
          </div>
        )}
      </div>
    </section>
  );

  const gitPanel = (
    <section className={panelClassName}>
      <SectionHeader>Git Actions</SectionHeader>
      <div className="mt-3">
        <GitPanel
          taskId={task.id}
          pipelineId={pipelineId}
          currentBranch={task.branch ?? null}
          isEditable={canEditGitStartSource}
          isRunning={isRunning}
          dependencyCandidates={dependencyCandidates}
          dependsOn={task.dependsOn}
          sourceTaskId={task.sourceTaskId}
          sourceTaskName={
            task.sourceTaskName
              ?? (task.sourceTaskId
                ? tasks.find((item) => item.id === task.sourceTaskId)?.name ?? null
                : null)
          }
          sourceTaskStatus={task.sourceTaskStatus ?? null}
          taskType={task.taskType}
          onOpenTask={onOpenTask}
        />
      </div>
    </section>
  );

  const flowPanel = (
    <section className={panelClassName}>
      <SectionHeader>Flow</SectionHeader>
      <div className="mt-3">
        <TaskFlowView task={task} tasks={tasks} agents={agents} />
      </div>
    </section>
  );

  const tagsPanel = (
    <section className={panelClassName}>
      <SectionHeader>Tags</SectionHeader>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESET_TAGS.map((tag) => {
          const selected = task.tags.includes(tag);
          const color = getTagColor(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => {
                const nextTags = selected
                  ? task.tags.filter((item) => item !== tag)
                  : [...task.tags, tag];
                void safeUpdate({ tags: nextTags });
              }}
              className="rounded-md border px-2 py-0.5 font-mono text-caption font-medium transition-all"
              style={selected
                ? { borderColor: color, color, backgroundColor: `${color}15` }
                : { borderColor: 'var(--border-secondary)', color: 'var(--text-dim)' }
              }
            >
              {tag}
            </button>
          );
        })}
      </div>
    </section>
  );

  const notesPanel = (
    <section className={panelClassName}>
      <SectionHeader>Notes</SectionHeader>
      <div className="mt-3 space-y-3">
        <Textarea
          aria-label="Task notes"
          className="text-caption"
          onBlur={() => { if (noteDirty) void handleNoteSave(); }}
          onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
          placeholder={isCompleted
            ? 'Add merge notes, review comments...'
            : 'Additional instructions for the agent...'}
          rows={4}
          value={note}
        />
        {noteDirty && (
          <div className="flex justify-end">
            <Button
              className="h-7 px-3 text-caption"
              disabled={noteSaving}
              onClick={handleNoteSave}
              size="sm"
              variant="secondary"
            >
              {noteSaving ? 'Saving...' : 'Save notes'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );

  const advancedPanel = (
    <details className={mutedPanelClassName}>
      <summary className="cursor-pointer list-none font-mono text-caption font-semibold tracking-[0.08em] text-text-secondary uppercase">
        Advanced context
      </summary>
      <div className="mt-4 space-y-4">
        <div className="rounded-md border border-border-secondary bg-surface-1 px-3 py-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-caption">
            <span className="text-text-dim">Type</span>
            <span className="text-text-secondary">{task.taskType}</span>
            <span className="text-text-dim">Dependencies</span>
            <span className="text-text-secondary">{task.dependsOn.length}</span>
            <span className="text-text-dim">Workspace mode</span>
            <span className="text-text-secondary">
              {getWorkspaceModeLabel(task)}
            </span>
            <span className="text-text-dim">Starts from</span>
            <span className="text-text-secondary">{getStartsFromLabel(task)}</span>
            <span className="text-text-dim">Workspace path</span>
            <span className="text-text-secondary">
              {task.worktreePath ??
                (task.useWorktree ? 'pending isolated workspace' : 'shared project workspace')}
            </span>
          </div>
        </div>
      </div>
    </details>
  );

  const briefEditorPanel = (
    <section className="pt-2 pb-4">
      <TaskDetailWithAttachments
        attachments={attachments}
        attachmentError={attachmentError}
        attachmentsLoading={attachmentsLoading}
        canManage={canManageAttachments}
        input={input}
        isLocked={isLocked}
        isUploading={isUploadingFiles}
        onBlur={() => {
          if (input !== task.input) {
            void safeUpdate({ input });
          }
        }}
        onChange={setInput}
        onDeleteAttachment={handleDeleteAttachment}
        onDismissUploadError={handleDismissUploadError}
        onDownloadAttachment={handleAttachmentClick}
        onRetryLoad={() => { void loadAttachments(); }}
        onRetryUpload={handleRetryUpload}
        onUploadFiles={handleUploadFiles}
        pendingUploads={pendingUploads}
      />
    </section>
  );

  const executionPanel = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden py-4">
      <ExecutionRunViewer
        taskId={task.id}
        taskStatus={task.status}
        isRunning={isRunning}
        liveOutput={execOutput}
        parsedOutput={parsedTaskOutput}
      />
    </section>
  );

  const followUpPanel = (
    <section className="py-4">
      <SectionHeader>{isRunning || canFollowUp ? 'Follow-up' : 'Next action'}</SectionHeader>
      <div className="mt-3 flex items-start gap-3">
        <textarea
          className="flex-1 resize-none rounded-md border border-border-secondary bg-surface-0 px-3 py-2 font-mono text-caption leading-relaxed text-text-primary placeholder:text-text-dim focus:border-accent-orange focus:outline-none disabled:opacity-40"
          disabled={!canDraftFollowUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && canFollowUp && !isRunning) {
              e.preventDefault();
              handleFollowUp();
            }
          }}
          placeholder={isRunning ? 'Write a follow-up while the task runs...' : 'Send a follow-up message...'}
          rows={5}
          value={followUp}
        />
        <div className="flex w-[136px] shrink-0 flex-col gap-2">
          {isRunning && onAbort && (
            <Button
              className="h-8 w-full px-3 text-caption"
              onClick={() => onAbort(task.id)}
              size="sm"
              variant="danger"
            >
              Stop
            </Button>
          )}
          {canFollowUp && (
            <Button
              className="h-8 w-full px-3 text-caption"
              disabled={isRunning || !followUp.trim()}
              onClick={handleFollowUp}
              size="sm"
              variant="primary"
            >
              Send
            </Button>
          )}
          {!canFollowUp && canRestartFresh && !isRunning && onRetry && (
            <Button
              className="h-8 w-full px-3 text-caption"
              disabled={restarting}
              onClick={() => { setRestarting(true); onRetry(task.id); }}
              size="sm"
              variant="primary"
            >
              Retry
            </Button>
          )}
          {canRestartFresh && !isRunning && (
            showRestartConfirm ? (
              <>
                <Button
                  className="h-8 w-full px-3 text-caption"
                  disabled={restarting}
                  onClick={handleRestartFresh}
                  size="sm"
                  variant="danger"
                >
                  {restarting ? '...' : 'Confirm'}
                </Button>
                <Button
                  className="h-8 w-full px-3 text-caption"
                  disabled={restarting}
                  onClick={() => setShowRestartConfirm(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                className="h-8 w-full px-3 text-caption"
                disabled={restarting}
                onClick={() => setShowRestartConfirm(true)}
                size="sm"
                variant="ghost"
              >
                Restart
              </Button>
            )
          )}
        </div>
      </div>
    </section>
  );

  const executionLayout = (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-hidden p-4">
        <div className="flex h-full min-h-0 flex-col divide-y divide-border-primary">
          <div className="shrink-0">
            {briefEditorPanel}
          </div>
          <div className="min-h-[440px] flex-1 overflow-hidden">
            {executionPanel}
          </div>
          <div className="shrink-0">
            {followUpPanel}
          </div>
        </div>
      </div>

      <div className="w-[380px] shrink-0 overflow-y-auto border-l border-border-primary p-4">
        <div className="space-y-4">
          {taskControlsPanel}
          {gitPanel}
          {flowPanel}
          {tagsPanel}
          {notesPanel}
          {advancedPanel}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        role="presentation"
      />
      <aside
        aria-modal="true"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full flex-col overflow-hidden border-l border-border-primary bg-surface-0 shadow-float',
          drawerWidthClassName,
        )}
        role="dialog"
      >
        <header className="border-b border-border-primary px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <CrewAvatar
                  seed={agent?.avatarSeed || agent?.name || task.agentId}
                  size="xs"
                  name={agent?.name}
                  title={agent?.title}
                />
                <h2 className="min-w-0 truncate font-mono text-sm font-semibold text-text-primary">
                  {task.name}
                </h2>
                <Badge size="sm" tone={statusToBadgeTone(task.status)}>
                  {formatStatus(task.status).toUpperCase()}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 font-mono text-caption text-text-dim">
                <span>{agent?.name ?? task.agentId}</span>
                <span>·</span>
                <span className="max-w-[280px] truncate" title={task.id}>{task.id}</span>
                <span>·</span>
                <span>{task.createdAt ?? 'n/a'}</span>
                {task.tokens != null && (
                  <>
                    <span>·</span>
                    <span>{task.tokens.toLocaleString()} tokens</span>
                  </>
                )}
                {task.inputTokens != null && task.outputTokens != null && (
                  <>
                    <span>·</span>
                    <span>
                      {task.inputTokens.toLocaleString()} in /{' '}
                      {task.outputTokens.toLocaleString()} out
                    </span>
                  </>
                )}
                {task.duration && (
                  <>
                    <span>·</span>
                    <span>{task.duration}</span>
                  </>
                )}
                {taskCost && (
                  <>
                    <span>·</span>
                    <span>{taskCost}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {renderSecondaryActions()}
              <Button aria-label="Close panel" className="h-8 w-8" onClick={onClose} size="sm" variant="ghost">
                x
              </Button>
            </div>
          </div>
        </header>

        <div className="border-b border-border-primary px-4 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {renderPrimaryActions()}
            </div>
          </div>
        </div>

        {(actionMessage || updateError) && (
          <div
            className={cn(
              'mx-4 mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs',
              actionMessage
                ? 'border border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
                : 'border border-accent-red/40 bg-accent-red-bg text-accent-red',
            )}
          >
            <span className="min-w-0 flex-1">{actionMessage || updateError}</span>
            {actionMessage && onDismissActionMessage && (
              <button
                className="shrink-0 font-mono text-xs text-text-dim transition-colors hover:text-text-primary"
                onClick={onDismissActionMessage}
                type="button"
              >
                x
              </button>
            )}
          </div>
        )}

        {task.interactiveMode && task.status === 'running' && (
          <div className="px-4 pt-3">
            <QuestionBanner isRunning taskId={task.id} pipelineId={pipelineId} />
          </div>
        )}

        {executionLayout}

        {/* Image preview modal */}
        {previewAttachment && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setPreviewAttachment(null)}
            onKeyDown={(e) => { if (e.key === 'Escape') setPreviewAttachment(null); }}
            role="dialog"
            tabIndex={-1}
          >
            <button
              className="absolute right-4 top-4 rounded-md bg-surface-2 px-2.5 py-1 font-mono text-caption text-text-primary transition-colors hover:bg-surface-3"
              onClick={() => setPreviewAttachment(null)}
              type="button"
            >
              close
            </button>
            <img
              alt={previewAttachment.originalName}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
              src={api.getAttachmentUrl(previewAttachment.id)}
            />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-surface-2/80 px-3 py-1.5 font-mono text-caption text-text-secondary">
              {previewAttachment.originalName}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
