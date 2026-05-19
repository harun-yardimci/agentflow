import { useMemo, useRef } from 'react';
import type { Agent, PipelineStage, Task } from '@/types';
import { Card, CardBody, CardHeader, EmptyState, Skeleton, StatusDot } from '@/components/ui';

import { TaskCard } from './TaskCard';

interface PipelineViewProps {
  tasks: Task[];
  agents: Agent[];
  stages: PipelineStage[];
  selectedTaskId: string | null;
  onTaskSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAbort: (id: string) => void;
  onRetry: (id: string) => void;
  onStart?: (id: string) => void;
  onSkip?: (id: string) => void;
  onArchive?: (id: string) => void;
}

interface StageTaskMap {
  resolvedStages: PipelineStage[];
  stageTaskMap: Map<string, Task[]>;
}

function buildStageTaskMap(tasks: Task[], stages: PipelineStage[]): StageTaskMap {
  const stageTaskMap = new Map<string, Task[]>();

  if (stages.length > 0) {
    const resolvedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const stage of resolvedStages) {
      stageTaskMap.set(stage.id, []);
    }

    for (const task of tasks) {
      if (task.stageId && stageTaskMap.has(task.stageId)) {
        stageTaskMap.get(task.stageId)?.push(task);
        continue;
      }

      const fallbackStage =
        resolvedStages[task.stage] ?? resolvedStages[resolvedStages.length - 1];

      if (fallbackStage) {
        stageTaskMap.get(fallbackStage.id)?.push(task);
      }
    }

    return { resolvedStages, stageTaskMap };
  }

  const uniqueStages = [...new Set(tasks.map((task) => task.stage))].sort((a, b) => a - b);
  const implicitColors = [
    '#8B5CF6',
    '#2563EB',
    '#16A34A',
    '#F59E0B',
    '#EC4899',
    '#06B6D4',
    '#EF4444',
    '#10B981',
  ];

  const resolvedStages = uniqueStages.map((stage, index) => {
    return {
      id: `implicit-${stage}`,
      name: `Stage ${stage + 1}`,
      sortOrder: stage,
      color: implicitColors[index % implicitColors.length] ?? '#6B7280',
      maxParallel: index + 1,
    };
  });

  for (const stage of resolvedStages) {
    stageTaskMap.set(stage.id, []);
  }

  for (const task of tasks) {
    const stageId = `implicit-${task.stage}`;
    stageTaskMap.get(stageId)?.push(task);
  }

  return { resolvedStages, stageTaskMap };
}

function StageLoadingSkeleton() {
  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card className="w-[min(86vw,320px)] shrink-0 p-3 sm:w-[320px]" key={index}>
          <Skeleton className="mb-3 h-4 w-28" />
          <Skeleton className="mb-2 h-20 w-full" />
          <Skeleton className="mb-2 h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function PipelineView({
  tasks,
  agents,
  stages,
  selectedTaskId,
  onTaskSelect,
  onApprove,
  onReject,
  onAbort,
  onRetry,
  onStart,
  onSkip,
  onArchive,
}: PipelineViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { resolvedStages, stageTaskMap } = useMemo(() => {
    return buildStageTaskMap(tasks, stages);
  }, [tasks, stages]);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          description="Add a task to start building your stage-based execution flow."
          title="No tasks in this pipeline"
        />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 overflow-hidden p-4">
        <StageLoadingSkeleton />
      </div>
    );
  }

  return (
    <section className="relative flex flex-1 flex-col overflow-hidden">
      <div ref={containerRef} className="relative flex-1 overflow-auto p-4">

        <div className="flex h-full min-w-max gap-3">
          {resolvedStages.map((stage) => {
            const stageTasks = stageTaskMap.get(stage.id) ?? [];
            return (
              <Card
                className="flex w-[min(86vw,320px)] shrink-0 flex-col sm:w-[320px]"
                key={stage.id}
              >
                <CardHeader className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-text-primary">
                      <StatusDot size="sm" style={{ backgroundColor: stage.color }} tone="idle" />
                      <span className="truncate">{stage.name}</span>
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-text-dim">
                    {stageTasks.length} {stageTasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                </CardHeader>

                <CardBody className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
                  {stageTasks.length === 0 ? (
                    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border-secondary bg-surface-0/45 px-3 text-center font-mono text-[10px] text-text-dim">
                      Drop or create tasks for this stage
                    </div>
                  ) : (
                    stageTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        agents={agents}
                        allTasks={tasks}  /* full list for dep resolution */
                        isSelected={selectedTaskId === task.id}
                        onAbort={onAbort}
                        onApprove={onApprove}
                        onDragStart={() => undefined}
                        onReject={onReject}
                        onRetry={onRetry}
                        onStart={onStart}
                        onSkip={onSkip}
                        onArchive={onArchive}
                        onSelect={onTaskSelect}
                        task={task}
                      />
                    ))
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
