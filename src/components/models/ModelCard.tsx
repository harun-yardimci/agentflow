import type { JSX } from 'react';
import { useModels } from '@/context/ModelContext';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, StatusDot } from '@/components/ui';

export interface ModelUsageStats {
  avgDurationLabel: string;
  successRate: number;
  taskCount: number;
  tokens: number;
  totalCost: number;
}

interface ModelCardProps {
  detecting: boolean;
  enabled: boolean;
  installed: boolean;
  model: string;
  onToggle: (model: string) => Promise<void>;
  providerLabel: string;
  share: number;
  stats: ModelUsageStats;
}

function cardTone(installed: boolean, enabled: boolean): 'active' | 'error' | 'warning' {
  if (!installed) return 'error';
  if (!enabled) return 'warning';
  return 'active';
}

export function ModelCard({
  detecting,
  enabled,
  installed,
  model,
  onToggle,
  providerLabel,
  share,
  stats,
}: ModelCardProps): JSX.Element {
  const { providers: allProviders } = useModels();
  const providerDef = allProviders.find((p) => p.id === model);
  const modelMeta = {
    color: providerDef?.color ?? '#9CA3AF',
    label: providerDef?.label ?? model,
    bg: providerDef?.bg ?? '#1a1a1a',
  };

  return (
    <Card
      statusTone={cardTone(installed, enabled)}
      style={{ borderTopColor: modelMeta.color, borderTopWidth: '2px' }}
      variant="status-bordered"
    >
      <CardHeader className="space-y-2 border-b border-border-subtle">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusDot tone={installed && enabled ? 'active' : installed ? 'warning' : 'error'} />
            <h3 className="font-mono text-sm font-semibold" style={{ color: modelMeta.color }}>
              {modelMeta.label}
            </h3>
          </div>
          <Badge size="sm" tone={installed ? 'success' : 'error'}>
            {detecting ? 'checking' : installed ? 'installed' : 'missing'}
          </Badge>
        </div>

        <p className="text-xs text-text-secondary">
          Provider: <span className="font-mono text-text-primary">{providerLabel}</span>
        </p>
      </CardHeader>

      <CardBody className="space-y-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-muted">Tasks</span>
          <span className="font-mono font-semibold text-text-primary">{stats.taskCount}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-muted">Tokens</span>
          <span className="font-mono font-semibold text-text-primary">
            {stats.tokens.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-muted">Avg Duration</span>
          <span className="font-mono font-semibold text-text-primary">{stats.avgDurationLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-muted">Success</span>
          <span className="font-mono font-semibold text-text-primary">
            {stats.successRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-muted">Total Cost</span>
          <span className="font-mono font-semibold text-text-primary">
            ${stats.totalCost.toFixed(4)}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>Share</span>
            <span>{share}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-0">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ backgroundColor: modelMeta.color, width: `${share}%` }}
            />
          </div>
        </div>
      </CardBody>

      <CardFooter className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted">
          {enabled ? 'Enabled for execution' : 'Disabled'}
        </span>
        <Button
          disabled={!installed}
          onClick={() => {
            void onToggle(model);
          }}
          size="sm"
          variant={enabled ? 'secondary' : 'primary'}
        >
          {enabled ? 'Disable' : 'Enable'}
        </Button>
      </CardFooter>
    </Card>
  );
}
