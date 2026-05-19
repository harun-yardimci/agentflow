import { useState, useEffect, useCallback, useRef } from 'react';
import type { ControlRequest } from '@/types';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import { FileDropZone } from '@/components/atoms/FileDropZone';
import { StagedFileChip } from '@/components/atoms/AttachmentChip';

/** Client-side polling interval (ms) for checking pending questions */
const QUESTION_POLL_INTERVAL_MS = 1000;

interface QuestionBannerProps {
  taskId: string;
  pipelineId: string;
  isRunning: boolean;
}

/**
 * Polls for pending control requests (questions/tool approvals) on a running task
 * and displays an interactive banner for the user to respond.
 */
export function QuestionBanner({ taskId, pipelineId, isRunning }: QuestionBannerProps) {
  const [questions, setQuestions] = useState<ControlRequest[]>([]);
  const [responding, setResponding] = useState<string | null>(null);
  const [answerTexts, setAnswerTexts] = useState<Record<string, string>>({});
  const [stagedFiles, setStagedFiles] = useState<Record<string, File[]>>({});
  const [error, setError] = useState<string | null>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Poll for questions while task is running
  useEffect(() => {
    if (!isRunning) {
      setQuestions([]);
      return;
    }

    let mounted = true;

    const poll = async () => {
      try {
        const data = await api.getTaskQuestions(taskId);
        if (mounted) {
          setQuestions(data.filter((q) => q.status === 'pending'));
        }
      } catch {
        // Ignore polling errors
      }
    };

    poll();
    const timer = setInterval(poll, QUESTION_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [taskId, isRunning]);

  // Auto-focus the first AskUserQuestion textarea when questions appear
  useEffect(() => {
    if (questions.length > 0) {
      const firstAsk = questions.find((q) => q.toolName === 'AskUserQuestion');
      if (firstAsk) {
        const el = textareaRefs.current.get(firstAsk.id);
        el?.focus();
      }
    }
  }, [questions.length]);

  const getAnswerText = useCallback(
    (requestId: string) => answerTexts[requestId] ?? '',
    [answerTexts],
  );

  const setAnswerText = useCallback(
    (requestId: string, text: string) => {
      setAnswerTexts((prev) => ({ ...prev, [requestId]: text }));
    },
    [],
  );

  const getStagedFiles = useCallback(
    (requestId: string) => stagedFiles[requestId] ?? [],
    [stagedFiles],
  );

  const addStagedFiles = useCallback(
    (requestId: string, files: File[]) => {
      setStagedFiles((prev) => ({
        ...prev,
        [requestId]: [...(prev[requestId] ?? []), ...files],
      }));
    },
    [],
  );

  const removeStagedFile = useCallback(
    (requestId: string, index: number) => {
      setStagedFiles((prev) => ({
        ...prev,
        [requestId]: (prev[requestId] ?? []).filter((_, i) => i !== index),
      }));
    },
    [],
  );

  const handleRespond = useCallback(async (requestId: string, action: 'allow' | 'deny') => {
    setResponding(requestId);
    setError(null);
    try {
      const answer = answerTexts[requestId]?.trim();
      const updatedInput = action === 'allow' && answer
        ? { answers: { '0': answer } }
        : undefined;

      await api.respondToQuestion(taskId, {
        requestId,
        action,
        message: action === 'deny' ? 'Denied by user' : undefined,
        updatedInput,
      });

      // Upload any staged files as message attachments
      const files = stagedFiles[requestId];
      if (files?.length) {
        await api.uploadFiles(files, 'message', requestId, pipelineId).catch(() => {
          // Non-blocking — response already sent
        });
      }

      setQuestions((prev) => prev.filter((q) => q.id !== requestId));
      setAnswerTexts((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      setStagedFiles((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResponding(null);
    }
  }, [taskId, pipelineId, answerTexts, stagedFiles]);

  if (questions.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {questions.map((q) => {
        const isAskQuestion = q.toolName === 'AskUserQuestion';
        const qFiles = getStagedFiles(q.id);

        return (
          <div
            key={q.id}
            className={cn(
              'rounded-lg border p-3',
              isAskQuestion
                ? 'border-accent-orange/30 bg-accent-orange/5'
                : 'border-accent-blue/30 bg-accent-blue/5',
            )}
          >
            {/* Header */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {isAskQuestion ? '?' : '\u{1F6E1}'}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                  {isAskQuestion ? 'Agent Question' : `Tool: ${q.toolName}`}
                </span>
              </div>
              <CountdownTimer timeoutAt={q.timeoutAt} />
            </div>

            {/* Question text */}
            <p className="mb-2 text-sm text-text-primary">
              {q.question ?? `${q.toolName} permission request`}
            </p>

            {/* Tool input preview (for non-question requests) */}
            {!isAskQuestion && q.inputJson && (
              <details className="mb-2">
                <summary className="cursor-pointer text-[11px] text-text-dim hover:text-text-secondary">
                  Show input details
                </summary>
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-surface-1 p-2 font-mono text-[10px] text-text-dim">
                  {formatInputJson(q.inputJson)}
                </pre>
              </details>
            )}

            {/* Answer textarea with compact attach button (for AskUserQuestion) */}
            {isAskQuestion && (
              <>
                <div className="relative mb-2">
                  <textarea
                    ref={(el) => {
                      if (el) {
                        textareaRefs.current.set(q.id, el);
                      } else {
                        textareaRefs.current.delete(q.id);
                      }
                    }}
                    value={getAnswerText(q.id)}
                    onChange={(e) => setAnswerText(q.id, e.target.value)}
                    placeholder="Type your answer..."
                    className="w-full rounded border border-border bg-surface-1 p-2 pr-8 font-mono text-xs text-text-primary placeholder:text-text-dim focus:border-accent-orange focus:outline-none"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        handleRespond(q.id, 'allow');
                      }
                    }}
                  />
                  <div className="absolute right-1 top-1">
                    <FileDropZone
                      compact
                      onFiles={(files) =>
                        setStagedFiles((prev) => ({
                          ...prev,
                          [q.id]: [...(prev[q.id] ?? []), ...files],
                        }))
                      }
                    />
                  </div>
                </div>
                {(stagedFiles[q.id]?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {stagedFiles[q.id]!.map((file, i) => (
                      <StagedFileChip
                        key={`${file.name}-${i}`}
                        file={file}
                        onRemove={() =>
                          setStagedFiles((prev) => ({
                            ...prev,
                            [q.id]: (prev[q.id] ?? []).filter((_, idx) => idx !== i),
                          }))
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRespond(q.id, 'allow')}
                disabled={responding === q.id}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  isAskQuestion
                    ? 'bg-accent-orange text-white hover:bg-accent-orange/80'
                    : 'bg-accent-blue text-white hover:bg-accent-blue/80',
                  responding === q.id && 'opacity-50',
                )}
              >
                {responding === q.id ? '...' : (isAskQuestion ? 'Send' : 'Allow')}
              </button>
              <button
                onClick={() => handleRespond(q.id, 'deny')}
                disabled={responding === q.id}
                className="rounded border border-border px-3 py-1 text-xs text-text-dim transition-colors hover:border-red-400 hover:text-red-400"
              >
                {isAskQuestion ? 'Skip' : 'Deny'}
              </button>
            </div>

            {error && (
              <p className="mt-1 text-[10px] text-red-400">{error}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Countdown Timer ── */

function CountdownTimer({ timeoutAt }: { timeoutAt: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, new Date(timeoutAt).getTime() - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const isUrgent = remaining > 0 && remaining < 30000;

  if (remaining <= 0) return <span className="font-mono text-[10px] text-red-400">expired</span>;

  return (
    <span className={cn('font-mono text-[10px]', isUrgent ? 'text-red-400' : 'text-text-dim')}>
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  );
}

/* ── Helpers ── */

function formatInputJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
