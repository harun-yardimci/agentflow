import type { Pipeline, Task } from '@/types';
import { Badge, Button, Card, CardBody } from '@/components/ui';

function getTaskLabel(taskId: string, tasksById: Map<string, Task>): string {
  return tasksById.get(taskId)?.name ?? taskId;
}

function getWorkspaceMode(task: Task): string {
  if (task.useWorktree === false) {
    return 'Shared workspace';
  }

  if (
    (task.taskType === 'spawned' || task.taskType === 'system') &&
    task.sourceTaskId
  ) {
    return 'Follow-up';
  }

  if (!task.branch && task.dependsOn.length > 1) {
    return 'Combine tasks';
  }

  return 'Independent';
}

function getStartsFrom(
  task: Task,
  pipeline: Pipeline,
  tasksById: Map<string, Task>,
): string {
  if (task.branch) {
    if (task.branch.startsWith('task/')) {
      return getTaskLabel(task.branch.replace('task/', ''), tasksById);
    }
    return task.branch;
  }

  if (
    (task.taskType === 'spawned' || task.taskType === 'system') &&
    task.sourceTaskId
  ) {
    return getTaskLabel(task.sourceTaskId, tasksById);
  }

  if (task.dependsOn.length === 1) {
    return getTaskLabel(task.dependsOn[0]!, tasksById);
  }

  if (task.dependsOn.length > 1) {
    return `${task.dependsOn.length} task outputs`;
  }

  return pipeline.gitBranch ? 'Pipeline default' : 'Pipeline default (auto)';
}

function getStatusTone(
  task: Task,
): 'error' | 'info' | 'neutral' | 'success' | 'warning' {
  const worktreeStatus = task.worktreeStatus ?? null;
  if (worktreeStatus === 'merged') return 'success';
  if (worktreeStatus === 'merged_with_parent') return 'success';
  if (worktreeStatus === 'cleaned') return 'neutral';
  if (worktreeStatus === 'cleaned_missing_path') return 'neutral';
  if (worktreeStatus === 'archived_with_parent') return 'neutral';
  if (worktreeStatus === 'blocked_by_conflict') return 'error';
  if (worktreeStatus === 'cleanup_blocked_dirty') return 'warning';
  if (
    (task.taskType === 'spawned' || task.taskType === 'system') &&
    task.sourceTaskId &&
    task.sourceTaskStatus === 'completed' &&
    worktreeStatus === 'ready_for_review'
  ) {
    return 'warning';
  }
  if (worktreeStatus === 'ready_for_review') return 'info';
  if (worktreeStatus === 'inherited') return 'warning';
  return 'neutral';
}

function getStatusLabel(task: Task): string {
  const worktreeStatus = task.worktreeStatus ?? null;
  if (worktreeStatus === 'merged') return 'Finalized';
  if (worktreeStatus === 'merged_with_parent') return 'Merged with parent task';
  if (worktreeStatus === 'cleaned') return 'Workspace cleaned';
  if (worktreeStatus === 'cleaned_missing_path') return 'Workspace metadata cleaned';
  if (worktreeStatus === 'archived_with_parent') return 'Archived with parent task';
  if (worktreeStatus === 'blocked_by_conflict') return 'Conflict needs fix';
  if (worktreeStatus === 'cleanup_blocked_dirty') return 'Cleanup blocked (dirty worktree)';
  if (
    (task.taskType === 'spawned' || task.taskType === 'system') &&
    task.sourceTaskId &&
    task.sourceTaskStatus === 'completed' &&
    worktreeStatus === 'ready_for_review'
  ) {
    return 'Waiting on parent review';
  }
  if (worktreeStatus === 'ready_for_review') return 'Needs review';
  if (worktreeStatus === 'inherited') return 'Following parent task';
  return 'No workspace state';
}

function getPipelineDefaultLabel(pipeline: Pipeline): string {
  if (pipeline.gitBranch) {
    return pipeline.gitBranch;
  }

  return 'Auto (main, fallback master)';
}

interface PipelineIntegrationPanelProps {
  onTaskSelect?: (taskId: string) => void;
  pipeline: Pipeline;
}

export function PipelineIntegrationPanel({
  onTaskSelect,
  pipeline,
}: PipelineIntegrationPanelProps) {
  const tasks = [...pipeline.tasks].sort((left, right) => {
    const leftCreated = left.createdAt ?? '';
    const rightCreated = right.createdAt ?? '';
    return leftCreated.localeCompare(rightCreated);
  });
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  const counts = tasks.reduce(
    (acc, task) => {
      const mode = getWorkspaceMode(task);
      if (mode === 'Follow-up') acc.followUp += 1;
      else if (mode === 'Combine tasks') acc.integration += 1;
      else if (mode === 'Shared workspace') acc.shared += 1;
      else acc.isolated += 1;

      if (task.worktreeStatus === 'blocked_by_conflict') acc.conflicts += 1;
      if (task.worktreeStatus === 'merged') acc.merged += 1;
      return acc;
    },
    {
      conflicts: 0,
      followUp: 0,
      integration: 0,
      isolated: 0,
      merged: 0,
      shared: 0,
    },
  );

  return (
    <Card className="mx-4 my-3 flex min-h-0 flex-1 border-border-secondary bg-surface-1/70">
      <CardBody className="flex min-h-0 flex-1 flex-col space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-mono text-caption font-semibold uppercase tracking-[0.1em] text-text-secondary">
              Integration
            </h3>
            <p className="mt-1 text-caption text-text-dim">
              Pipeline default:{' '}
              <span className="font-mono text-text-secondary">
                {getPipelineDefaultLabel(pipeline)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge size="sm" tone="neutral">
              {counts.isolated} independent
            </Badge>
            <Badge size="sm" tone="warning">
              {counts.followUp} follow-up
            </Badge>
            <Badge size="sm" tone="info">
              {counts.integration} combine
            </Badge>
            <Badge size="sm" tone="neutral">
              {counts.shared} shared
            </Badge>
            {counts.merged > 0 && (
              <Badge size="sm" tone="success">
                {counts.merged} merged
              </Badge>
            )}
            {counts.conflicts > 0 && (
              <Badge size="sm" tone="error">
                {counts.conflicts} conflict
              </Badge>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border-secondary bg-surface-0/70 p-3">
          <p className="font-mono text-caption text-text-secondary">
            Use this view to understand where each task starts, which other
            task outputs it depends on, and which code lines need a manual
            decision.
          </p>
          <p className="mt-2 font-mono text-caption text-text-dim">
            <span className="text-text-secondary">Needs review</span> means the
            agent finished its work. Open the task, inspect the diff, then
            choose <span className="text-text-secondary">Finalize</span>,{' '}
            <span className="text-text-secondary">Sync</span>, or{' '}
            <span className="text-text-secondary">Archive workspace</span>.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto rounded-md border border-border-secondary bg-surface-0">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b border-border-secondary text-left">
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  Task
                </th>
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  Mode
                </th>
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  Starts from
                </th>
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  Needs output from
                </th>
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  State
                </th>
                <th className="px-3 py-2 font-mono text-micro uppercase tracking-wide text-text-dim">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  className="border-b border-border-primary/70 last:border-b-0"
                  key={task.id}
                >
                  <td className="px-3 py-2 text-caption text-text-secondary">
                    {task.name}
                  </td>
                  <td className="px-3 py-2">
                    <Badge size="sm" tone="neutral">
                      {getWorkspaceMode(task)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-caption text-text-dim">
                    {getStartsFrom(task, pipeline, tasksById)}
                  </td>
                  <td className="px-3 py-2 font-mono text-caption text-text-dim">
                    {task.dependsOn.length === 0
                      ? '—'
                      : task.dependsOn
                          .map((depId) => getTaskLabel(depId, tasksById))
                          .join(', ')}
                    {task.sourceTaskId && (
                      <div className="mt-1 text-micro text-text-muted">
                        owner:{' '}
                        {task.sourceTaskName
                          ?? getTaskLabel(task.sourceTaskId, tasksById)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      size="sm"
                      tone={getStatusTone(task)}
                    >
                      {getStatusLabel(task)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      className="h-7 px-2 text-caption"
                      onClick={() => onTaskSelect?.(task.id)}
                      size="sm"
                      variant="secondary"
                    >
                      Open task
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
