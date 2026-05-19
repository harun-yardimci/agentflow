import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { useAgents } from '@/context/AgentContext';
import { useModels } from '@/context/ModelContext';
import { usePipelines } from '@/context/PipelineContext';
import type { UpdateProviderInput } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
} from '@/components/ui';
import type { DiscoveryResult } from '@/lib/api';
import * as api from '@/lib/api';
import { cn, formatCost, formatNumber, toErrorMessage } from '@/lib/utils';
import type {
  Task,
  UsageAnalytics,
  UsageBreakdownRow,
  UsageTimeseriesPoint,
} from '@/types';

import { ModelCard, type ModelUsageStats } from './ModelCard';

interface ProviderStatus {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

interface ProviderMeta {
  cli: string;
  key: string;
  label: string;
}

const PROVIDER_META: ProviderMeta[] = [
  { key: 'claude', label: 'Claude', cli: 'claude' },
  { key: 'gemini', label: 'Gemini', cli: 'gemini' },
  { key: 'codex', label: 'Codex', cli: 'codex' },
];

function parseDurationSeconds(duration: string | null): number | null {
  if (!duration) {
    return null;
  }

  const normalized = duration.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1] ?? '0');
  const unit = match[2] ?? 's';

  if (unit === 'ms') return value / 1000;
  if (unit === 'm') return value * 60;
  return value;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) {
    return 'n/a';
  }

  if (seconds >= 60) {
    return `${(seconds / 60).toFixed(1)}m`;
  }

  return `${seconds.toFixed(1)}s`;
}

function parseDate(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatCompactCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }

  if (value >= 1) {
    return formatCost(value);
  }

  return `$${value.toFixed(4)}`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function metricTone(index: number): string {
  if (index === 0) return 'text-accent-blue';
  if (index === 1) return 'text-accent-green';
  if (index === 2) return 'text-accent-orange';
  return 'text-text-primary';
}

function ModelsPageSkeleton(): JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1380px] space-y-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <CardBody className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-2/3" />
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index}>
              <CardBody className="space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-28 w-full" />
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsageTrendChart({
  points,
}: {
  points: UsageTimeseriesPoint[];
}): JSX.Element {
  if (points.length === 0) {
    return (
      <EmptyState
        className="py-8"
        description="Run a few tasks to build a daily token and cost trend."
        icon={<span className="text-xl">📈</span>}
        title="No trend data yet"
      />
    );
  }

  const maxTokens = Math.max(...points.map((point) => point.tokens), 1);
  const maxCost = Math.max(...points.map((point) => point.costUsd), 0.0001);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[72px_minmax(0,1fr)_64px] gap-3 text-[11px]">
        {points.map((point) => (
          <div className="contents" key={point.date}>
            <span className="font-mono text-text-muted">{formatDateLabel(point.date)}</span>
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-0">
                <div
                  className="h-full rounded-full bg-accent-blue/80"
                  style={{ width: `${Math.max((point.tokens / maxTokens) * 100, 4)}%` }}
                />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-0">
                <div
                  className="h-full rounded-full bg-accent-green/80"
                  style={{ width: `${Math.max((point.costUsd / maxCost) * 100, 4)}%` }}
                />
              </div>
            </div>
            <div className="text-right font-mono text-text-secondary">
              <div>{formatNumber(point.tokens)}</div>
              <div className="text-accent-green">{formatCost(point.costUsd)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-wide text-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-accent-blue/80" />
          Tokens
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-accent-green/80" />
          Cost
        </span>
      </div>
    </div>
  );
}

function UsageBreakdownChart({
  rows,
}: {
  rows: UsageBreakdownRow[];
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <EmptyState
        className="py-8"
        description="Run tasks on multiple models to compare usage distribution."
        icon={<span className="text-xl">🧮</span>}
        title="No breakdown yet"
      />
    );
  }

  const maxCost = Math.max(...rows.map((row) => row.costUsd), 0.0001);

  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((row, index) => (
        <div className="space-y-1.5" key={row.key}>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className={cn('truncate font-mono', metricTone(index))}>{row.label}</span>
            <span className="font-mono text-text-secondary">
              {formatCost(row.costUsd)} · {formatNumber(row.tokens)} tokens
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-0">
            <div
              className={cn(
                'h-full rounded-full',
                index % 3 === 0
                  ? 'bg-accent-blue/80'
                  : index % 3 === 1
                    ? 'bg-accent-green/80'
                    : 'bg-accent-orange/80',
              )}
              style={{ width: `${Math.max((row.costUsd / maxCost) * 100, 5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function buildProviderCardStats(
  providerKey: string,
  rows: UsageBreakdownRow[],
  tasks: Task[],
  getProviderKey: (model: string) => string,
): ModelUsageStats {
  const providerUsage = rows.find((row) => row.key === providerKey);
  const providerTasks = tasks.filter((task) => getProviderKey(task.model) === providerKey);
  const finished = providerTasks.filter((task) => (
    task.status === 'completed'
    || task.status === 'failed'
    || task.status === 'blocked'
    || task.status === 'rejected'
  ));
  const successCount = finished.filter((task) => task.status === 'completed').length;
  const durations = providerTasks
    .map((task) => parseDurationSeconds(task.duration))
    .filter((value): value is number => value !== null);
  const avgDuration = durations.length > 0
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null;

  return {
    avgDurationLabel: formatDuration(avgDuration),
    successRate: finished.length > 0 ? (successCount / finished.length) * 100 : 0,
    taskCount: providerUsage?.taskCount ?? 0,
    tokens: providerUsage?.tokens ?? 0,
    totalCost: providerUsage?.costUsd ?? 0,
  };
}

export function ModelsPage(): JSX.Element {
  const { pipelines } = usePipelines();
  const { agents } = useAgents();
  const {
    providers: providerDefs,
    getModel,
    getProviderKey,
    refresh: refreshModels,
  } = useModels();

  const allTasks = useMemo(
    () => pipelines.flatMap((pipeline) => pipeline.tasks),
    [pipelines],
  );

  const [providers, setProviders] = useState<ProviderStatus>({
    claude: false,
    codex: false,
    gemini: false,
  });
  const [detecting, setDetecting] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoveryResults, setDiscoveryResults] =
    useState<DiscoveryResult[] | null>(null);

  const detectProviders = useCallback(async () => {
    setDetecting(true);
    setError(null);

    try {
      const result = await api.detectProviders();
      setProviders({
        claude: result.claude ?? false,
        codex: result.codex ?? false,
        gemini: result.gemini ?? false,
      });
    } catch (detectError) {
      setError(toErrorMessage(detectError));
    } finally {
      setDetecting(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);

    try {
      const data = await api.fetchSettings();
      setSettings(data);
    } catch (settingsError) {
      setError(toErrorMessage(settingsError));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);

    try {
      const data = await api.fetchUsageAnalytics();
      setAnalytics(data);
    } catch (analyticsError) {
      setError(toErrorMessage(analyticsError));
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const syncProvider = useCallback(async (providerId: string) => {
    setError(null);
    setDiscoveryResults((current) =>
      current ? current.filter((r) => r.provider !== providerId) : null,
    );
    try {
      const { results } = await api.discoverModels(providerId);
      setDiscoveryResults((current) => {
        const others = current?.filter((r) => r.provider !== providerId) ?? [];
        return [...others, ...results];
      });
      await refreshModels();
      await fetchAnalytics();
    } catch (discoverError) {
      setError(toErrorMessage(discoverError));
      throw discoverError;
    }
  }, [fetchAnalytics, refreshModels]);

  useEffect(() => {
    void detectProviders();
    void fetchSettings();
    void fetchAnalytics();
  }, [detectProviders, fetchAnalytics, fetchSettings]);

  const enabledByModel = useMemo(
    () => ({
      claude: (settings.provider_claude_enabled ?? 'true') === 'true',
      codex: (settings.provider_codex_enabled ?? 'true') === 'true',
      gemini: (settings.provider_gemini_enabled ?? 'true') === 'true',
    }),
    [settings],
  );

  const providerCards = useMemo(() => {
    const providerRows = analytics?.providers ?? [];
    const totalTokens = providerRows.reduce((sum, row) => sum + row.tokens, 0);

    return PROVIDER_META.map((providerMeta) => {
      const stats = buildProviderCardStats(
        providerMeta.key,
        providerRows,
        allTasks,
        getProviderKey,
      );

      return {
        model: providerMeta.key,
        share: totalTokens > 0 ? Math.round((stats.tokens / totalTokens) * 100) : 0,
        stats,
      };
    });
  }, [allTasks, analytics?.providers, getProviderKey]);

  const recentUsage = useMemo(() => {
    return pipelines
      .flatMap((pipeline) => pipeline.tasks.map((task) => {
        const agent = agents.find((item) => item.id === task.agentId);

        return {
          agentName: agent?.name ?? task.agentId,
          costLabel: formatCost(task.costUsd ?? 0),
          id: task.id,
          model: task.model,
          pipelineName: pipeline.name,
          sortKey: parseDate(task.createdAt ?? pipeline.created),
          status: task.status,
          taskName: task.name,
          timeLabel: task.duration ?? 'n/a',
        };
      }))
      .sort((left, right) => right.sortKey - left.sortKey)
      .slice(0, 12);
  }, [agents, pipelines]);

  const toggleProvider = async (model: string) => {
    const settingsKey = `provider_${model}_enabled`;
    const previous = settings[settingsKey] ?? 'true';
    const next = previous === 'true' ? 'false' : 'true';

    setSettings((current) => ({ ...current, [settingsKey]: next }));

    try {
      await api.updateSettings({ [settingsKey]: next });
    } catch (toggleError) {
      setSettings((current) => ({ ...current, [settingsKey]: previous }));
      setError(toErrorMessage(toggleError));
    }
  };

  const updateProvider = async (model: string, update: UpdateProviderInput) => {
    try {
      await api.updateProviderDef(model, update);
      await refreshModels();
    } catch (updateError) {
      setError(toErrorMessage(updateError));
      throw updateError;
    }
  };

  if (detecting && settingsLoading && analyticsLoading) {
    return <ModelsPageSkeleton />;
  }

  const allMissing =
    !detecting && !providers.claude && !providers.gemini && !providers.codex;
  const summary = analytics?.summary;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1380px] space-y-5">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-text-primary">
              Model Configuration
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Provider availability plus frozen token and cost analytics by run,
              task, and model.
            </p>
          </div>

          <Button
            disabled={detecting}
            onClick={() => void detectProviders()}
            variant="secondary"
          >
            {detecting ? 'Detecting...' : 'Re-detect Providers'}
          </Button>
        </header>

        {error && (
          <div className="rounded-md border border-accent-red/35 bg-accent-red-bg px-3 py-2 text-sm text-accent-red">
            {error}
          </div>
        )}

        {allMissing && (
          <EmptyState
            action={(
              <Button onClick={() => void detectProviders()} variant="primary">
                Detect Again
              </Button>
            )}
            description="Install claude, gemini, or codex CLI and ensure the binary is available on PATH."
            icon={<span className="text-xl">⚠️</span>}
            title="No model providers detected"
          />
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardBody className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                Total Tokens
              </div>
              <div className="font-mono text-2xl font-semibold text-text-primary">
                {formatNumber(summary?.totalTokens ?? 0)}
              </div>
              <div className="text-xs text-text-secondary">
                {formatNumber(summary?.totalInputTokens ?? 0)} in ·{' '}
                {formatNumber(summary?.totalOutputTokens ?? 0)} out
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                Total Cost
              </div>
              <div className="font-mono text-2xl font-semibold text-text-primary">
                {formatCost(summary?.totalCostUsd ?? 0)}
              </div>
              <div className="text-xs text-text-secondary">
                Frozen historical spend across all recorded runs
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                Avg / Task
              </div>
              <div className="font-mono text-2xl font-semibold text-text-primary">
                {formatCompactCurrency(summary?.avgCostPerTask ?? 0)}
              </div>
              <div className="text-xs text-text-secondary">
                {formatNumber(summary?.taskCount ?? 0)} tasks ·{' '}
                {formatNumber(summary?.runCount ?? 0)} runs
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                Avg Tokens / Run
              </div>
              <div className="font-mono text-2xl font-semibold text-text-primary">
                {formatNumber(Math.round(summary?.avgTokensPerRun ?? 0))}
              </div>
              <div className="text-xs text-text-secondary">
                Includes retries and failed attempts
              </div>
            </CardBody>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDER_META.map((provider) => {
            const modelCard = providerCards.find(
              (card) => card.model === provider.key,
            );
            if (!modelCard) {
              return null;
            }

            const providerDef = providerDefs.find((p) => p.id === provider.key);

            return (
              <ModelCard
                detecting={detecting}
                enabled={
                  enabledByModel[provider.key as keyof typeof enabledByModel] ?? false
                }
                executionMode={providerDef?.executionMode ?? 'cli'}
                hasApiKey={providerDef?.hasApiKey ?? false}
                installed={providers[provider.key as keyof ProviderStatus] ?? false}
                key={provider.key}
                model={provider.key}
                onRecheck={detectProviders}
                onSyncModels={() => syncProvider(provider.key)}
                onToggle={toggleProvider}
                onUpdateProvider={updateProvider}
                providerLabel={provider.label}
                share={modelCard.share}
                stats={modelCard.stats}
                syncResult={discoveryResults?.find((r) => r.provider === provider.key)}
              />
            );
          })}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Daily Usage Trend
              </h3>
              <p className="text-xs text-text-secondary">
                Tokens and cost by day across all finished runs.
              </p>
            </CardHeader>
            <CardBody>
              <UsageTrendChart points={analytics?.timeseries ?? []} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Model Cost Distribution
              </h3>
              <p className="text-xs text-text-secondary">
                Highest-spend models based on frozen per-run pricing.
              </p>
            </CardHeader>
            <CardBody>
              <UsageBreakdownChart rows={analytics?.models ?? []} />
            </CardBody>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Model Breakdown
              </h3>
              <p className="text-xs text-text-secondary">
                Per-model totals across runs, tokens, and frozen spend.
              </p>
            </CardHeader>
            <CardBody>
              {analytics && analytics.models.length > 0 ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(0,1.3fr)_auto_auto_auto] gap-3 border-b border-border-primary pb-2 text-[10px] uppercase tracking-wide text-text-muted">
                    <span>Model</span>
                    <span className="text-right">Runs</span>
                    <span className="text-right">Tokens</span>
                    <span className="text-right">Cost</span>
                  </div>
                  {analytics.models.map((row) => (
                    <div
                      className="grid grid-cols-[minmax(0,1.3fr)_auto_auto_auto] gap-3 border-b border-border-subtle py-2 text-[11px] last:border-b-0"
                      key={row.key}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-text-primary">
                          {row.label}
                        </div>
                        <div className="text-text-muted">{row.taskCount} tasks</div>
                      </div>
                      <span className="text-right font-mono text-text-secondary">
                        {formatNumber(row.runCount)}
                      </span>
                      <span className="text-right font-mono text-text-secondary">
                        {formatNumber(row.tokens)}
                      </span>
                      <span className="text-right font-mono text-text-primary">
                        {formatCost(row.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="py-8"
                  description="Model totals will appear after the first recorded runs."
                  icon={<span className="text-xl">🗂️</span>}
                  title="No model breakdown yet"
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Top Costly Tasks
              </h3>
              <p className="text-xs text-text-secondary">
                Tasks ranked by cumulative spend across retries and follow-ups.
              </p>
            </CardHeader>
            <CardBody>
              {analytics && analytics.topTasks.length > 0 ? (
                <div className="space-y-2">
                  {analytics.topTasks.map((task) => (
                    <div
                      className="rounded-md border border-border-subtle bg-surface-2/60 px-3 py-2"
                      key={task.taskId}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">
                            {task.taskName}
                          </div>
                          <div className="truncate text-[11px] text-text-secondary">
                            {task.pipelineName}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-text-primary">
                          {formatCost(task.costUsd)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-text-muted">
                        <span>{formatNumber(task.tokens)} tokens</span>
                        <span>{formatNumber(task.runCount)} runs</span>
                        {task.lastRunAt && <span>{formatDateLabel(task.lastRunAt)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="py-8"
                  description="Once tasks start consuming tokens, the top spenders will show up here."
                  icon={<span className="text-xl">💸</span>}
                  title="No costly tasks yet"
                />
              )}
            </CardBody>
          </Card>
        </section>

        <Card>
          <CardHeader className="space-y-1">
            <h3 className="text-sm font-semibold text-text-primary">
              Recent Usage
            </h3>
            <p className="text-xs text-text-secondary">
              Latest tasks executed by agents with frozen task-level cost totals.
            </p>
          </CardHeader>

          <CardBody>
            {recentUsage.length === 0 ? (
              <EmptyState
                className="py-8"
                description="Run a pipeline to populate model usage events."
                icon={<span className="text-xl">🧾</span>}
                title="No model usage yet"
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto_auto] gap-3 border-b border-border-primary pb-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Pipeline
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Agent
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Task
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Model
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Duration
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      Cost
                    </span>
                  </div>

                  {recentUsage.map((item) => (
                    <div
                      className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto_auto] items-center gap-3 border-b border-border-subtle py-2 text-[11px] last:border-b-0"
                      key={item.id}
                    >
                      <span className="truncate text-text-primary">
                        {item.pipelineName}
                      </span>
                      <span className="truncate text-text-secondary">
                        {item.agentName}
                      </span>
                      <span className="truncate text-text-secondary">
                        {item.taskName}
                      </span>
                      <Badge
                        size="sm"
                        tone={
                          getProviderKey(item.model) === 'claude'
                            ? 'accent'
                            : getProviderKey(item.model) === 'gemini'
                              ? 'info'
                              : 'success'
                        }
                      >
                        {getModel(item.model)?.label ?? item.model}
                      </Badge>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-text-muted">
                          {item.timeLabel}
                        </span>
                        <Badge
                          size="sm"
                          tone={
                            item.status === 'completed'
                              ? 'success'
                              : item.status === 'running'
                                ? 'info'
                                : 'warning'
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <span className="font-mono text-text-primary">
                        {item.costLabel}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 md:hidden">
                  {recentUsage.map((item) => (
                    <div
                      className="rounded-md border border-border-subtle bg-surface-2/60 p-3"
                      key={item.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary">
                          {item.taskName}
                        </span>
                        <Badge
                          size="sm"
                          tone={
                            getProviderKey(item.model) === 'claude'
                              ? 'accent'
                              : getProviderKey(item.model) === 'gemini'
                                ? 'info'
                                : 'success'
                          }
                        >
                          {item.model}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-text-secondary">
                        {item.pipelineName}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">{item.agentName}</span>
                        <span className="font-mono text-text-primary">
                          {item.costLabel}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {!detecting && (
          <p className="font-mono text-[11px] text-text-muted">
            Provider detection uses{' '}
            <code className="text-text-secondary">
              which {PROVIDER_META.map((provider) => provider.cli).join(', ')}
            </code>{' '}
            on the backend.
          </p>
        )}
      </div>
    </div>
  );
}
