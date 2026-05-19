import { useEffect, useRef, useState } from 'react';

import type { Pipeline, TaskStatus } from '@/types';
import { STATUS_COLOR } from '@/constants';
import { completedCount } from '@/lib/pipeline-engine';
import { Button, StatusDot } from '@/components/ui';
import { cn, formatCost, formatNumber, statusToTone } from '@/lib/utils';

export type TaskFilter = 'all' | TaskStatus;
export type PipelineContentView = 'board' | 'integration';

interface PipelineHeaderProps {
  contentView: PipelineContentView;
  pipeline: Pipeline;
  searchQuery: string;
  showArchived: boolean;
  showLogs: boolean;
  statusFilter: TaskFilter;
  onAddTask: () => void;
  onArchiveAllDone: () => void;
  onPause: () => void;
  onRun: () => void;
  onSearchQueryChange: (query: string) => void;
  onSettings: () => void;
  onStatusFilterChange: (filter: TaskFilter) => void;
  onToggleArchived: () => void;
  onToggleLogs: () => void;
  onViewChange: (view: PipelineContentView) => void;
}

function getStatusCounts(tasks: Pipeline['tasks']) {
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const t of tasks) {
    if (t.archivedAt) continue;
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  return counts;
}

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Done',
  blocked: 'Blocked',
  awaiting_approval: 'Approval',
  failed: 'Failed',
  paused: 'Paused',
};

const STATUS_ORDER: TaskStatus[] = [
  'running',
  'awaiting_approval',
  'queued',
  'blocked',
  'failed',
  'paused',
  'completed',
];

export function PipelineHeader({
  contentView,
  pipeline,
  showLogs,
  showArchived,
  statusFilter,
  searchQuery,
  onStatusFilterChange,
  onSearchQueryChange,
  onToggleLogs,
  onToggleArchived,
  onArchiveAllDone,
  onAddTask,
  onRun,
  onPause,
  onSettings,
  onViewChange,
}: PipelineHeaderProps) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [hasDescriptionOverflow, setHasDescriptionOverflow] = useState(false);
  const descriptionContainerRef = useRef<HTMLDivElement | null>(null);
  const descriptionMeasureRef = useRef<HTMLSpanElement | null>(null);
  const done = completedCount(pipeline.tasks);
  const cost = pipeline.totalCostUsd ?? 0;

  const statusCounts = getStatusCounts(pipeline.tasks);

  useEffect(() => {
    if (!pipeline.description) {
      setHasDescriptionOverflow(false);
      setIsDescriptionExpanded(false);
      return;
    }

    const measureOverflow = () => {
      const container = descriptionContainerRef.current;
      const measure = descriptionMeasureRef.current;
      if (!container || !measure) return;
      setHasDescriptionOverflow(measure.scrollWidth > container.clientWidth + 1);
    };

    measureOverflow();

    const container = descriptionContainerRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && container
        ? new ResizeObserver(() => measureOverflow())
        : null;

    if (container && resizeObserver) {
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', measureOverflow);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureOverflow);
    };
  }, [pipeline.description]);

  return (
    <div className="border-b border-border-primary bg-surface-1 px-4 py-3">
      {/* Row 1: Name + stats + actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex shrink-0 items-center gap-2">
            <h2 className="font-mono text-heading font-semibold text-text-primary">
              {pipeline.name}
            </h2>
            <StatusDot size="md" tone={statusToTone(pipeline.status)} />
          </div>

          <div className="hidden h-3.5 w-px bg-border-primary sm:block" />

          {/* Labeled stats */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-caption font-medium text-text-secondary">
                {done}/{pipeline.tasks.length}
              </span>
              <span className="font-mono text-caption text-text-dim">tasks</span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-caption font-medium text-text-secondary">
                {formatNumber(pipeline.totalTokensUsed)}
              </span>
              <span className="font-mono text-caption text-text-dim">tokens</span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-caption font-medium text-text-secondary">
                {formatCost(cost)}
              </span>
              <span className="font-mono text-caption text-text-dim">cost</span>
            </div>

            {pipeline.workingDir && pipeline.workingDir !== '.' && (
              <span
                className="max-w-[160px] truncate font-mono text-caption text-accent-blue"
                title={pipeline.workingDir}
              >
                {pipeline.workingDir.split('/').filter(Boolean).slice(-1)[0]}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:flex-nowrap">
          <Button
            className="h-7 px-2.5"
            onClick={onToggleLogs}
            size="sm"
            variant={showLogs ? 'secondary' : 'ghost'}
          >
            Log
          </Button>
          <Button
            className="h-7 px-2.5"
            onClick={onToggleArchived}
            size="sm"
            variant={showArchived ? 'secondary' : 'ghost'}
          >
            Archived
          </Button>
          {pipeline.tasks.some(
            (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'rejected',
          ) && (
            <Button className="h-7 px-2.5" onClick={onArchiveAllDone} size="sm" variant="ghost">
              Archive Done
            </Button>
          )}
          <Button className="h-7 px-2.5" onClick={onSettings} size="sm" variant="ghost">
            Settings
          </Button>
          <div className="flex items-center rounded-md border border-border-secondary bg-surface-0 p-0.5">
            <Button
              className="h-7 px-2.5"
              onClick={() => onViewChange('board')}
              size="sm"
              variant={contentView === 'board' ? 'secondary' : 'ghost'}
            >
              Board
            </Button>
            <Button
              className="h-7 px-2.5"
              onClick={() => onViewChange('integration')}
              size="sm"
              variant={contentView === 'integration' ? 'secondary' : 'ghost'}
            >
              Integration
            </Button>
          </div>
          <Button
            className="h-8 shrink-0 px-4 font-semibold"
            onClick={onAddTask}
            size="sm"
            variant="primary"
          >
            + Add Task
          </Button>
        </div>
      </div>

      {/* Row 2: Description + task controls */}
      <div className="mt-2 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {pipeline.description && (
            <div className="flex min-w-0 items-start gap-2">
              <div className="relative min-w-0 flex-1" ref={descriptionContainerRef}>
                <span
                  ref={descriptionMeasureRef}
                  className="pointer-events-none absolute invisible whitespace-nowrap font-mono text-caption"
                >
                  {pipeline.description}
                </span>
                <p
                  className={cn(
                    'font-mono text-caption text-text-muted',
                    isDescriptionExpanded ? 'whitespace-normal break-words' : 'truncate',
                  )}
                  title={pipeline.description}
                >
                  {pipeline.description}
                </p>
              </div>
              {(hasDescriptionOverflow || isDescriptionExpanded) && (
                <button
                  className="shrink-0 font-mono text-caption text-text-dim transition-colors hover:text-text-primary"
                  onClick={() => setIsDescriptionExpanded((expanded) => !expanded)}
                  type="button"
                >
                  {isDescriptionExpanded ? 'Hide' : 'More'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {contentView === 'board' ? (
            <>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                <button
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-caption transition-colors',
                    statusFilter === 'all'
                      ? 'bg-text-primary/15 text-text-primary'
                      : 'text-text-dim hover:text-text-secondary',
                  )}
                  onClick={() => onStatusFilterChange('all')}
                  type="button"
                >
                  All
                </button>
                {STATUS_ORDER.map((status) => {
                  const count = statusCounts[status];
                  if (!count) return null;
                  const color = STATUS_COLOR[status];
                  const isActive = statusFilter === status;
                  return (
                    <button
                      key={status}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-caption transition-colors',
                        isActive ? 'ring-1 ring-current' : 'opacity-75 hover:opacity-100',
                      )}
                      onClick={() =>
                        onStatusFilterChange(isActive ? 'all' : status)
                      }
                      style={{
                        color,
                        background: `${color}${isActive ? '25' : '15'}`,
                      }}
                      type="button"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: color }}
                      />
                      {count} {STATUS_LABELS[status] ?? status}
                    </button>
                  );
                })}
              </div>

              <div className="flex shrink-0 items-center">
                <input
                  className="h-8 w-full min-w-[220px] rounded border border-border-secondary bg-surface-0 px-3 font-mono text-caption text-text-primary placeholder:text-text-dim focus:border-accent-orange focus:outline-none sm:w-56"
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder="Search tasks..."
                  type="text"
                  value={searchQuery}
                />
              </div>
            </>
          ) : (
            <p className="max-w-[520px] text-right font-mono text-caption text-text-dim">
              Open a task from the integration view to inspect its diff and
              decide whether to finalize, sync, or archive that code line.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
