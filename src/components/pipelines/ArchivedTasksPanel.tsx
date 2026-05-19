import { useCallback, useEffect, useState } from 'react';
import type { Agent, Task } from '@/types';
import * as api from '@/lib/api';
import { Badge, Button } from '@/components/ui';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { formatStatus, statusToTone } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui';

function getArchivedReasonLabel(worktreeStatus: string | null): string | null {
  if (worktreeStatus === 'merged_with_parent') return 'merged with parent';
  if (worktreeStatus === 'archived_with_parent') return 'archived with parent';
  if (worktreeStatus === 'cleaned') return 'workspace cleaned';
  if (worktreeStatus === 'cleaned_missing_path') return 'workspace metadata cleaned';
  if (worktreeStatus === 'cleanup_blocked_dirty') return 'cleanup blocked (dirty worktree)';
  return null;
}

interface ArchivedTasksPanelProps {
  pipelineId: string;
  agents: Agent[];
  onClose: () => void;
  onUnarchive: (taskId: string) => Promise<void>;
}

export function ArchivedTasksPanel({
  pipelineId,
  agents,
  onClose,
  onUnarchive,
}: ArchivedTasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.fetchArchivedTasks(pipelineId);
      setTasks(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUnarchive = async (taskId: string) => {
    await onUnarchive(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  return (
    <div className="animate-fade-in shrink-0 border-t border-border-primary bg-surface-0">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-text-primary uppercase">
            Archived Tasks
          </span>
          <Badge size="sm" tone="neutral">
            {tasks.length}
          </Badge>
        </div>
        <Button onClick={onClose} size="sm" variant="ghost">
          Hide
        </Button>
      </div>

      <div className="max-h-[320px] overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="py-6 text-center font-mono text-xs text-text-dim">
            Loading...
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-secondary bg-surface-1/50 px-4 py-6 text-center">
            <p className="font-mono text-xs text-text-secondary">No archived tasks.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => {
              const agent = agents.find((a) => a.id === task.agentId);
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-1 px-3 py-2"
                >
                  <CrewAvatar
                    seed={agent?.avatarSeed || agent?.name || task.agentId}
                    size="xs"
                    name={agent?.name}
                    title={agent?.title}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] font-semibold text-text-primary">
                      {task.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-text-dim">
                      <StatusDot size="sm" tone={statusToTone(task.status)} />
                      <span className="capitalize">{formatStatus(task.status)}</span>
                      {getArchivedReasonLabel(task.worktreeStatus ?? null) && (
                        <span className="text-text-muted">
                          {getArchivedReasonLabel(task.worktreeStatus ?? null)}
                        </span>
                      )}
                      {task.archivedAt && (
                        <span className="text-text-muted">
                          archived {task.archivedAt}
                        </span>
                      )}
                    </div>
                    {task.sourceTaskId && (
                      <p className="mt-1 truncate font-mono text-[10px] text-text-muted">
                        lifecycle owner:{' '}
                        {task.sourceTaskName ?? task.sourceTaskId}
                      </p>
                    )}
                  </div>
                  <Button
                    className="h-6 shrink-0 px-2 text-[10px]"
                    onClick={() => handleUnarchive(task.id)}
                    size="sm"
                    variant="secondary"
                  >
                    Restore
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
