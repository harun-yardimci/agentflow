import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PipelineStageColumnProps {
  stage: number;
  stageName?: string;
  stageColor?: string;
  tasksCount: number;
  isParallel: boolean;
  isLast: boolean;
  children: ReactNode;
}

export function PipelineStageColumn({
  stage,
  stageName,
  stageColor,
  tasksCount,
  isParallel,
  isLast,
  children,
}: PipelineStageColumnProps) {
  return (
    <div className={cn('relative mb-2.5 w-[240px] min-w-[240px]', !isLast && 'pb-2')}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border',
              isParallel
                ? 'border-accent-orange/50 text-accent-orange'
                : 'border-border-secondary text-text-secondary',
            )}
            style={stageColor ? { borderColor: `${stageColor}80`, color: stageColor } : undefined}
          >
            <span className="font-mono text-[10px] font-semibold">{stage + 1}</span>
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-wide text-text-secondary"
            style={stageColor ? { color: stageColor } : undefined}
          >
            {stageName ?? `Stage ${stage + 1}`}
          </span>
        </div>
        <span className="font-mono text-[10px] text-text-dim">
          {tasksCount} {tasksCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      <div>{children}</div>
    </div>
  );
}
