import { Fragment } from 'react';
import type { Task, Agent } from '@/types';
import { KANBAN_COLS } from '@/constants';
import { KanbanColumn } from './KanbanColumn';
import { cn } from '@/lib/utils';

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  selectedTaskId: string | null;
  onTaskSelect: (id: string) => void;
  onTaskMove: (taskId: string, columnId: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (id: string) => void;
  onSkip?: (id: string) => void;
  onArchive: (id: string) => void;
}

function getColumnTasks(tasks: Task[], colId: string): Task[] {
  switch (colId) {
    case 'queued':
      return tasks.filter((t) => t.status === 'queued');
    case 'running':
      return tasks.filter((t) => t.status === 'running' || t.status === 'awaiting_approval');
    case 'completed':
      return tasks.filter((t) => t.status === 'completed' || t.status === 'skipped');
    case 'blocked':
      return tasks.filter((t) => t.status === 'blocked' || t.status === 'failed' || t.status === 'rejected' || t.status === 'auth_required');
    default:
      return [];
  }
}

function ExecutionTimeline({ tasks }: { tasks: Task[] }) {
  const allStages = [...new Set(tasks.map((t) => t.stage))].sort((a, b) => a - b);
  if (allStages.length === 0) return null;

  return (
    <div className="mx-4 mb-1 flex items-center gap-1 overflow-x-auto py-2">
      <span className="mr-1 shrink-0 font-mono text-[9px] tracking-wider text-text-muted uppercase">
        Flow
      </span>
      {allStages.map((stage, idx) => {
        const stageTasks = tasks.filter((t) => t.stage === stage);
        const allDone = stageTasks.every((t) => t.status === 'completed' || t.status === 'skipped');
        const anyActive = stageTasks.some(
          (t) => t.status === 'running' || t.status === 'awaiting_approval'
        );

        return (
          <Fragment key={stage}>
            <div
              className={cn(
                'flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px]',
                allDone
                  ? 'border-accent-green/30 bg-accent-green/5 text-accent-green'
                  : anyActive
                    ? 'border-accent-blue/30 bg-accent-blue/5 text-accent-blue'
                    : 'border-border-subtle bg-surface-3 text-text-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  anyActive && 'animate-blink'
                )}
                style={{
                  backgroundColor: allDone
                    ? 'var(--color-accent-green)'
                    : anyActive
                      ? 'var(--color-accent-blue)'
                      : 'var(--color-text-muted)',
                }}
              />
              S{stage + 1}
              {stageTasks.length > 1 && (
                <span className="text-[9px] opacity-80">&times;{stageTasks.length}</span>
              )}
            </div>
            {idx < allStages.length - 1 && (
              <span className="shrink-0 font-mono text-[10px] text-text-muted">&rarr;</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export function KanbanBoard({
  tasks,
  agents,
  selectedTaskId,
  onTaskSelect,
  onTaskMove,
  onApprove,
  onReject,
  onAbort,
  onRetry,
  onSkip,
  onArchive,
}: KanbanBoardProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ExecutionTimeline tasks={tasks} />
      <div className="flex flex-1 gap-2.5 overflow-x-auto p-3">
        {KANBAN_COLS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            tasks={getColumnTasks(tasks, col.id)}
            allTasks={tasks}
            agents={agents}
            selectedTaskId={selectedTaskId}
            onTaskSelect={onTaskSelect}
            onTaskMove={onTaskMove}
            onApprove={onApprove}
            onReject={onReject}
            onAbort={onAbort}
            onRetry={onRetry}
            onSkip={onSkip}
            onArchive={onArchive}
          />
        ))}
      </div>
    </div>
  );
}
