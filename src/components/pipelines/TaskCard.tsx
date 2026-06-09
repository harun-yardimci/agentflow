import type { Agent, Task, TaskPriority, TaskStatus } from '@/types';
import { PRIORITIES } from '@/constants';
import { useModels } from '@/context/ModelContext';
import { Badge, Button, Card, StatusDot } from '@/components/ui';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { cn, formatStatus, statusToTone } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  agents: Agent[];
  allTasks: Task[];
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (id: string) => void;
  onStart?: (id: string) => void;
  onSkip?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
}

function priorityToTone(priority: TaskPriority | null):
  | 'neutral'
  | 'warning'
  | 'error'
  | 'info' {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'neutral';
}

function modelToTone(model: Task['model']): 'info' | 'success' | 'warning' | 'violet' {
  if (model.startsWith('gemini')) return 'info';
  if (model.startsWith('codex')) return 'success';
  if (model.startsWith('antigravity')) return 'violet';
  return 'warning';
}

function taskTypeTone(taskType: Task['taskType']): 'info' | 'warning' | 'success' | 'neutral' {
  if (taskType === 'spawned') return 'warning';
  if (taskType === 'planned') return 'info';
  if (taskType === 'seeded') return 'success';
  return 'neutral';
}

function formatCreated(task: Task): string {
  if (!task.createdAt) return 'n/a';

  const created = task.createdAt.trim();
  return created.length > 0 ? created : 'n/a';
}

function TaskActions({
  onAbort,
  onApprove,
  onReject,
  onRetry,
  onStart,
  onSkip,
  onArchive,
  onUnarchive,
  task,
}: {
  onAbort: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetry: (id: string) => void;
  onStart?: (id: string) => void;
  onSkip?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  task: Task;
}) {
  if (task.status === 'awaiting_approval') {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onApprove(task.id)}
          variant="secondary"
        >
          Approve
        </Button>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onReject(task.id)}
          variant="danger"
        >
          Reject
        </Button>
      </div>
    );
  }

  if (task.status === 'running') {
    return (
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onAbort(task.id)}
          variant="danger"
        >
          Stop
        </Button>
      </div>
    );
  }

  if (task.status === 'blocked' || task.status === 'failed' || task.status === 'rejected') {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onRetry(task.id)}
          variant="primary"
        >
          Retry
        </Button>
        {onArchive && (
          <Button
            className="h-7 px-2 text-[10px]"
            onClick={() => onArchive(task.id)}
            variant="secondary"
          >
            Archive
          </Button>
        )}
      </div>
    );
  }

  if ((task.status === 'completed' || task.status === 'skipped') && onArchive) {
    return (
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onArchive(task.id)}
          variant="secondary"
        >
          Archive
        </Button>
      </div>
    );
  }

  if (task.status === 'queued') {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(event) => event.stopPropagation()}>
        {onStart && (
          <Button
            className="h-7 px-2 text-[10px]"
            onClick={() => onStart(task.id)}
            variant="primary"
          >
            Start
          </Button>
        )}
        {onSkip && (
          <Button
            className="h-7 px-2 text-[10px]"
            onClick={() => onSkip(task.id)}
            variant="secondary"
          >
            Skip
          </Button>
        )}
        {onArchive && (
          <Button
            className="h-7 px-2 text-[10px]"
            onClick={() => onArchive(task.id)}
            variant="secondary"
          >
            Archive
          </Button>
        )}
      </div>
    );
  }

  // Archived task — show unarchive
  if (task.archivedAt && onUnarchive) {
    return (
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={() => onUnarchive(task.id)}
          variant="primary"
        >
          Restore
        </Button>
      </div>
    );
  }

  return null;
}

export function TaskCard({
  task,
  agents,
  isSelected,
  onSelect,
  onDragStart,
  onApprove,
  onReject,
  onAbort,
  onRetry,
  onStart,
  onSkip,
  onArchive,
  onUnarchive,
}: TaskCardProps) {
  const { getModel } = useModels();
  const tone = statusToTone(task.status);
  const agent = agents.find((item) => item.id === task.agentId);
  const priority = PRIORITIES.find((item) => item.key === task.priority);
  return (
    <Card
      className={cn(
        'w-full p-3',
        isSelected && 'border-border-hover bg-surface-2 shadow-float',
      )}
      data-task-id={task.id}
      draggable
      onClick={() => onSelect(task.id)}
      onDragStart={(event) => onDragStart(event, task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(task.id);
        }
      }}
      role="button"
      statusTone={tone}
      tabIndex={0}
      variant="status-bordered"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <CrewAvatar seed={agent?.avatarSeed || agent?.name || task.agentId} size="xs" name={agent?.name} title={agent?.title} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[12px] font-semibold text-text-primary">
              {task.name}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-secondary">
                <StatusDot
                  className={cn(task.status === 'running' && 'animate-pulse')}
                  size="sm"
                  tone={tone}
                />
                <span className="capitalize">{formatStatus(task.status)}</span>
              </div>
              <Badge
                className="shrink-0"
                size="sm"
                tone={modelToTone(task.model)}
              >
                {getModel(task.model)?.label ?? task.model}
              </Badge>
            </div>
          </div>
        </div>

      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge size="sm" tone="neutral">
          {agent?.name ?? task.agentId}
          {agent?.title ? ` - ${agent.title}` : ''}
        </Badge>
        {priority && (
          <Badge size="sm" tone={priorityToTone(priority.key)}>
            {priority.label}
          </Badge>
        )}
        <Badge size="sm" tone={task.approval === 'manual' ? 'warning' : task.approval === 'on_error' ? 'info' : 'neutral'}>
          {task.approval.replace(/_/g, ' ')}
        </Badge>
        <Badge size="sm" tone={taskTypeTone(task.taskType)}>
          {task.taskType}
        </Badge>
        {task.interactiveMode && task.status === 'running' && (task.pendingQuestions ?? 0) > 0 && (
          <Badge size="sm" tone="warning">
            {task.pendingQuestions} question
          </Badge>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-text-dim">
        <span>created {formatCreated(task)}</span>
        <span>duration {task.duration ?? 'pending'}</span>
      </div>

      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <Badge key={`${task.id}-${tag}`} size="sm" tone="neutral">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <TaskActions
        onAbort={onAbort}
        onApprove={onApprove}
        onReject={onReject}
        onRetry={onRetry}
        onStart={onStart}
        onSkip={onSkip}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        task={task}
      />
    </Card>
  );
}
