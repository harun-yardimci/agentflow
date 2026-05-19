import { useState } from 'react';
import type { Task, Agent, KanbanColumn as KanbanColumnType } from '@/types';
import { TaskCard } from './TaskCard';
import { StageGroup } from './StageGroup';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  column: KanbanColumnType;
  tasks: Task[];
  allTasks: Task[];
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

export function KanbanColumn({
  column,
  tasks,
  allTasks,
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
}: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onTaskMove(taskId, column.id);
    setDragOver(false);
  };

  // Group queued tasks by stage
  const renderQueuedWithStages = () => {
    const queuedTasks = tasks.filter((t) => t.status === 'queued');
    const stageGroups: Record<number, Task[]> = {};
    queuedTasks.forEach((t) => {
      if (!stageGroups[t.stage]) stageGroups[t.stage] = [];
      stageGroups[t.stage]!.push(t);
    });
    const sortedStages = Object.keys(stageGroups)
      .map(Number)
      .sort((a, b) => a - b);
    const firstQueuedStage = sortedStages[0];

    return sortedStages.map((stage, idx) => (
      <StageGroup
        key={stage}
        stage={stage}
        tasks={stageGroups[stage]!}
        allTasks={allTasks}
        agents={agents}
        selectedTaskId={selectedTaskId}
        isLast={idx === sortedStages.length - 1}
        isNext={stage === firstQueuedStage}
        onTaskSelect={onTaskSelect}
        onDragStart={handleDragStart}
        onApprove={onApprove}
        onReject={onReject}
        onAbort={onAbort}
        onRetry={onRetry}
        onSkip={onSkip}
        onArchive={onArchive}
      />
    ));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'flex min-w-[210px] flex-1 flex-col rounded-lg border bg-surface-1 transition-colors duration-150',
        dragOver ? 'border-border-hover bg-surface-2' : 'border-border-subtle'
      )}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-[7px] w-[7px] rounded-full"
            style={{ background: column.color }}
          />
          <span
            className="truncate font-mono text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: column.color }}
          >
            {column.label}
          </span>
        </div>
        <span className="font-mono text-[11px] text-text-secondary">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div
            className="flex h-10 items-center justify-center rounded-md border border-dashed border-border-primary bg-surface-2/50"
          >
            <span className="font-mono text-[9px] uppercase tracking-wide text-text-dim">
              drop task
            </span>
          </div>
        ) : column.id === 'queued' ? (
          renderQueuedWithStages()
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              agents={agents}
              allTasks={allTasks}
              isSelected={selectedTaskId === t.id}
              onSelect={onTaskSelect}
              onDragStart={handleDragStart}
              onApprove={onApprove}
              onReject={onReject}
              onAbort={onAbort}
              onRetry={onRetry}
              onSkip={onSkip}
              onArchive={onArchive}
            />
          ))
        )}
      </div>
    </div>
  );
}
