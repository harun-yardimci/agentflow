import type { Task, Agent } from '@/types';
import { TaskCard } from './TaskCard';
import { PipelineStageColumn } from './PipelineStageColumn';

interface StageGroupProps {
  stage: number;
  stageName?: string;
  stageColor?: string;
  tasks: Task[];
  allTasks: Task[];
  agents: Agent[];
  selectedTaskId: string | null;
  isLast: boolean;
  isNext: boolean;
  onTaskSelect: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (id: string) => void;
  onSkip?: (id: string) => void;
  onArchive?: (id: string) => void;
}

export function StageGroup({
  stage,
  stageName,
  stageColor,
  tasks,
  allTasks,
  agents,
  selectedTaskId,
  isLast,
  onTaskSelect,
  onDragStart,
  onApprove,
  onReject,
  onAbort,
  onRetry,
  onSkip,
  onArchive,
}: StageGroupProps) {
  const isParallel = tasks.length > 1;

  return (
    <PipelineStageColumn
      stage={stage}
      stageName={stageName}
      stageColor={stageColor}
      tasksCount={tasks.length}
      isParallel={isParallel}
      isLast={isLast}
    >
      <div
        className={
          isParallel
            ? 'rounded-md border border-border-secondary bg-surface-1 p-1.5'
            : ''
        }
      >
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            agents={agents}
            allTasks={allTasks}
            isSelected={selectedTaskId === t.id}
            onSelect={onTaskSelect}
            onDragStart={onDragStart}
            onApprove={onApprove}
            onReject={onReject}
            onAbort={onAbort}
            onRetry={onRetry}
            onSkip={onSkip}
            onArchive={onArchive}
          />
        ))}
      </div>
    </PipelineStageColumn>
  );
}
