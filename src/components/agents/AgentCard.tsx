import type { JSX } from 'react';
import type { Agent, ModelKey } from '@/types';
import { useModels } from '@/context/ModelContext';
import { Badge, Button, Card, CardBody, StatusDot } from '@/components/ui';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { cn } from '@/lib/utils';

export interface AgentMetrics {
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  totalTaskCount: number;
}

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  layout: 'card' | 'row';
  metrics: AgentMetrics;
  onEdit: (agentId: string) => void;
  onQuickAssign?: (agentId: string, model: ModelKey) => void;
}

function modelTone(model: ModelKey): 'accent' | 'info' | 'success' | 'violet' {
  if (model === 'claude') return 'accent';
  if (model === 'gemini') return 'info';
  if (model === 'antigravity' || model.startsWith('antigravity')) return 'violet';
  return 'success';
}

function statusTone(activeTaskCount: number): 'success' | 'neutral' {
  return activeTaskCount > 0 ? 'success' : 'neutral';
}

function statusText(activeTaskCount: number): string {
  return activeTaskCount > 0 ? 'Active' : 'Idle';
}

export function AgentCard({
  agent,
  isSelected,
  layout,
  metrics,
  onEdit,
  onQuickAssign,
}: AgentCardProps): JSX.Element {
  const { getModel } = useModels();
  const currentModel = getModel(agent.defaultModel);
  const avatarSeed = agent.avatarSeed || agent.name;

  if (layout === 'row') {
    return (
      <div
        className={cn(
          'grid grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] '
            + 'items-center gap-3 border-b border-border-subtle px-4 py-3 text-[11px] '
            + 'transition-colors hover:bg-surface-2/60',
          isSelected && 'bg-surface-2',
        )}
      >
        <button
          className="flex min-w-0 items-center gap-2.5 text-left"
          onClick={() => onEdit(agent.id)}
          type="button"
        >
          <CrewAvatar seed={avatarSeed} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{agent.name}</p>
            <p className="truncate font-mono text-[10px] text-text-muted">
              {agent.title || agent.id}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <StatusDot tone={metrics.activeTaskCount > 0 ? 'active' : 'idle'} />
          <Badge size="sm" tone={statusTone(metrics.activeTaskCount)}>
            {statusText(metrics.activeTaskCount)}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {currentModel ? (
            <span
              className="inline-flex shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold"
              style={{ color: currentModel.color, backgroundColor: currentModel.bg }}
            >
              {currentModel.label}
            </span>
          ) : (
            <Badge size="sm" tone={modelTone(agent.defaultModel)}>
              {agent.defaultModel}
            </Badge>
          )}
          {onQuickAssign && (
            <Button
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                const nextModel: ModelKey =
                  agent.defaultModel === 'claude'
                    ? 'gemini'
                    : agent.defaultModel === 'gemini'
                      ? 'codex'
                      : agent.defaultModel === 'codex'
                        ? 'antigravity'
                        : 'claude';
                onQuickAssign(agent.id, nextModel);
              }}
              size="sm"
              variant="ghost"
            >
              cycle
            </Button>
          )}
        </div>

        <div className="font-mono text-[11px] text-text-secondary">
          {metrics.completedTaskCount} done / {metrics.totalTaskCount}
        </div>

        <Button onClick={() => onEdit(agent.id)} size="sm" variant="secondary">
          Edit
        </Button>
      </div>
    );
  }

  return (
    <Card className={cn(isSelected && 'border-accent-orange/40')} variant="interactive">
      <CardBody className="space-y-3">
        <button
          className="flex w-full items-start gap-3 text-left"
          onClick={() => onEdit(agent.id)}
          type="button"
        >
          <CrewAvatar seed={avatarSeed} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{agent.name}</p>
            <p className="truncate font-mono text-[10px] text-text-muted">
              {agent.title || agent.id}
            </p>
          </div>
          <Badge size="sm" tone={statusTone(metrics.activeTaskCount)}>
            <StatusDot className="mr-0.5" size="sm" tone={metrics.activeTaskCount > 0 ? 'active' : 'idle'} />
            {statusText(metrics.activeTaskCount)}
          </Badge>
        </button>

        <div className="flex items-center justify-between gap-2">
          {currentModel ? (
            <span
              className="inline-flex shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold"
              style={{ color: currentModel.color, backgroundColor: currentModel.bg }}
            >
              {currentModel.label}
            </span>
          ) : (
            <Badge size="sm" tone={modelTone(agent.defaultModel)}>
              {agent.defaultModel}
            </Badge>
          )}
          <span className="font-mono text-[10px] text-text-secondary">
            {metrics.completedTaskCount}/{metrics.totalTaskCount} tasks
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-md border border-border-subtle bg-surface-2 px-2.5 py-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted">Active</p>
            <p className="font-mono text-[11px] font-semibold text-text-primary">{metrics.activeTaskCount}</p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted">Errors</p>
            <p className="font-mono text-[11px] font-semibold text-accent-red">{metrics.failedTaskCount}</p>
          </div>
        </div>

        <Button className="w-full" onClick={() => onEdit(agent.id)} size="sm" variant="secondary">
          Open Crew Member
        </Button>
      </CardBody>
    </Card>
  );
}
