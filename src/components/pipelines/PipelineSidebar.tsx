import { useMemo, useState } from 'react';
import type { Pipeline } from '@/types';
import { Badge, Button, Card, EmptyState, StatusDot } from '@/components/ui';
import { cn, formatStatus, statusToTone } from '@/lib/utils';

interface PipelineSidebarProps {
  pipelines: Pipeline[];
  selectedId: string;
  onSelect: (id: string) => void;
  onNewPipeline: () => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
}

interface PipelineCardProps {
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onSelect: (id: string) => void;
  pipeline: Pipeline;
  selected: boolean;
}

/* ---- Inline SVG icons (no geometric unicode — project rule) ---- */

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.5 2.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2.5" width="3.5" height="11" rx="0.75" />
      <rect x="9.5" y="2.5" width="3.5" height="11" rx="0.75" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function getPipelineControl(status: string) {
  switch (status) {
    case 'running':
      return { icon: PauseIcon, action: 'pause' as const, label: 'Pause pipeline', color: 'text-accent-amber hover:text-accent-amber' };
    case 'completed':
      return { icon: StopIcon, action: 'none' as const, label: 'Pipeline completed', color: 'text-text-dim cursor-default' };
    case 'queued':
    case 'paused':
    case 'failed':
    case 'rejected':
    default:
      return { icon: PlayIcon, action: 'run' as const, label: 'Run pipeline', color: 'text-accent-green hover:text-accent-green' };
  }
}

function getPipelineMetrics(pipeline: Pipeline) {
  const total = pipeline.tasks.length;
  const completed = pipeline.tasks.filter((task) => task.status === 'completed' || task.status === 'skipped').length;
  const awaitingApproval = pipeline.tasks.filter(
    (task) => task.status === 'awaiting_approval',
  ).length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { awaitingApproval, completed, progress, total };
}

export function PipelineCard({
  onDelete,
  onRun,
  onPause,
  onSelect,
  pipeline,
  selected,
}: PipelineCardProps) {
  const metrics = useMemo(() => getPipelineMetrics(pipeline), [pipeline]);
  const tone = statusToTone(pipeline.status);
  const ctrl = getPipelineControl(pipeline.status);
  const CtrlIcon = ctrl.icon;

  return (
    <Card
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group relative w-full overflow-hidden p-3',
        selected && 'ring-2 ring-accent-orange/60 border-border-hover bg-surface-2',
      )}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(pipeline.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(pipeline.id);
        }
      }}
      role="button"
      statusTone={tone}
      tabIndex={0}
      variant="status-bordered"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot
              data-testid={`pipeline-status-${pipeline.id}`}
              size="sm"
              tone={tone}
            />
            <p className="truncate font-mono text-xs font-semibold text-text-primary">
              {pipeline.name}
            </p>
          </div>

          {pipeline.description && (
            <p className="mt-1 line-clamp-2 text-caption text-text-secondary">
              {pipeline.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge size="sm" tone={tone === 'active' ? 'info' : tone === 'idle' ? 'neutral' : tone}>
              {formatStatus(pipeline.status)}
            </Badge>
            <span className="font-mono text-micro text-text-dim">
              {metrics.completed}/{metrics.total}
            </span>
            {metrics.awaitingApproval > 0 && (
              <Badge size="sm" tone="warning">
                {metrics.awaitingApproval} review
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            aria-label={ctrl.label}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-surface-1 transition-colors',
              ctrl.color,
              ctrl.action === 'none' && 'opacity-40',
            )}
            disabled={ctrl.action === 'none'}
            onClick={(event) => {
              event.stopPropagation();
              if (ctrl.action === 'run') onRun(pipeline.id);
              else if (ctrl.action === 'pause') onPause(pipeline.id);
            }}
            type="button"
          >
            <CtrlIcon className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label={`Delete ${pipeline.name}`}
            className="rounded p-0.5 text-text-dim opacity-0 transition-all group-hover:opacity-100 hover:text-accent-red"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(pipeline.id);
            }}
            type="button"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded bg-surface-4" role="presentation">
        <div
          className="h-full rounded bg-accent-orange transition-[width] duration-500"
          style={{ width: `${metrics.progress}%` }}
        />
      </div>
    </Card>
  );
}

function PipelineList({
  onDelete,
  onNewPipeline,
  onRun,
  onPause,
  onSelect,
  pipelines,
  selectedId,
}: PipelineSidebarProps) {
  if (pipelines.length === 0) {
    return (
      <EmptyState
        action={
          <Button onClick={onNewPipeline} size="sm" variant="primary">
            + New Pipeline
          </Button>
        }
        className="px-4 py-6"
        description="Create your first automation pipeline to orchestrate agent tasks."
        title="No pipelines"
      />
    );
  }

  return (
    <div className="space-y-2">
      {pipelines.map((pipeline) => (
        <PipelineCard
          key={pipeline.id}
          onDelete={onDelete}
          onPause={onPause}
          onRun={onRun}
          onSelect={onSelect}
          pipeline={pipeline}
          selected={selectedId === pipeline.id}
        />
      ))}
    </div>
  );
}

export function PipelineSidebar({
  onDelete,
  onNewPipeline,
  onRun,
  onPause,
  onSelect,
  pipelines,
  selectedId,
}: PipelineSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedId);

  return (
    <>
      <section className="border-b border-border-primary bg-surface-0 p-3 sm:hidden">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-micro tracking-[0.14em] text-text-muted uppercase">
            Pipelines
          </span>
          <Button
            aria-label="Create pipeline"
            onClick={onNewPipeline}
            size="sm"
            variant="secondary"
          >
            +
          </Button>
        </div>

        <Button
          className="w-full justify-between"
          onClick={() => setMobileOpen((prev) => !prev)}
          size="md"
          variant="secondary"
        >
          <span className="truncate">{selectedPipeline?.name ?? 'Select pipeline'}</span>
          <span aria-hidden="true" className={cn('transition-transform', mobileOpen && 'rotate-180')}>
            v
          </span>
        </Button>

        {mobileOpen && (
          <div className="mt-2 max-h-72 overflow-y-auto">
            <PipelineList
              onDelete={onDelete}
              onNewPipeline={onNewPipeline}
              onPause={onPause}
              onRun={onRun}
              onSelect={(id) => {
                onSelect(id);
                setMobileOpen(false);
              }}
              pipelines={pipelines}
              selectedId={selectedId}
            />
          </div>
        )}
      </section>

      <aside className="hidden w-72 shrink-0 border-r border-border-primary bg-surface-0 p-3 sm:flex sm:flex-col">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-micro tracking-[0.14em] text-text-muted uppercase">
            Pipelines
          </span>
          <Button onClick={onNewPipeline} size="sm" variant="primary">
            + New Pipeline
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <PipelineList
            onDelete={onDelete}
            onNewPipeline={onNewPipeline}
            onPause={onPause}
            onRun={onRun}
            onSelect={onSelect}
            pipelines={pipelines}
            selectedId={selectedId}
          />
        </div>
      </aside>
    </>
  );
}
