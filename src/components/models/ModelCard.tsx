import { useEffect, useState, type JSX } from 'react';
import { useModels } from '@/context/ModelContext';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
  StatusDot,
  ToggleSwitch,
} from '@/components/ui';

export interface ModelUsageStats {
  avgDurationLabel: string;
  successRate: number;
  taskCount: number;
  tokens: number;
  totalCost: number;
}

export interface SyncResultSummary {
  provider: string;
  added: string[];
  updated: string[];
  removed: string[];
  error?: string;
}

interface ModelCardProps {
  detecting: boolean;
  enabled: boolean;
  executionMode: 'cli' | 'api';
  hasApiKey: boolean;
  installed: boolean;
  model: string;
  onRecheck: () => Promise<void>;
  onSyncModels: () => Promise<void>;
  onToggle: (model: string) => Promise<void>;
  onUpdateProvider: (
    model: string,
    update: { executionMode?: 'cli' | 'api'; apiKey?: string | null },
  ) => Promise<void>;
  providerLabel: string;
  share: number;
  stats: ModelUsageStats;
  syncResult?: SyncResultSummary;
}

interface InstallHint {
  command: string;
  docsUrl: string;
}

const INSTALL_HINTS: Record<string, InstallHint> = {
  claude: {
    command: 'npm install -g @anthropic-ai/claude-code',
    docsUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  gemini: {
    command: 'npm install -g @google/gemini-cli',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  codex: {
    command: 'npm install -g @openai/codex',
    docsUrl: 'https://github.com/openai/codex',
  },
};

const MODE_HELP =
  'CLI = uses the local provider binary, no key needed. ' +
  'API = uses the provider SDK with your API key, no CLI required.';

function cardTone(
  installed: boolean,
  enabled: boolean,
  executionMode: 'cli' | 'api',
  hasApiKey: boolean,
): 'active' | 'error' | 'warning' {
  if (executionMode === 'api') {
    if (!hasApiKey) return 'error';
    if (!enabled) return 'warning';
    return 'active';
  }
  if (!installed) return 'error';
  if (!enabled) return 'warning';
  return 'active';
}

export function ModelCard({
  detecting,
  enabled,
  executionMode,
  hasApiKey,
  installed,
  model,
  onRecheck,
  onSyncModels,
  onToggle,
  onUpdateProvider,
  providerLabel,
  share,
  stats,
  syncResult,
}: ModelCardProps): JSX.Element {
  const { providers: allProviders } = useModels();
  const providerDef = allProviders.find((p) => p.id === model);
  const modelMeta = {
    color: providerDef?.color ?? '#9CA3AF',
    label: providerDef?.label ?? model,
    bg: providerDef?.bg ?? '#1a1a1a',
  };

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setApiKeyDraft('');
    setKeyError(null);
  }, [executionMode, hasApiKey, model]);

  const isApi = executionMode === 'api';
  const ready = isApi ? hasApiKey : installed;
  const statusLabel = isApi
    ? hasApiKey ? 'API key set' : 'API key missing'
    : detecting ? 'checking' : installed ? 'installed' : 'missing';

  const handleToggleMode = async () => {
    if (savingMode) return;
    const next: 'cli' | 'api' = isApi ? 'cli' : 'api';
    setSavingMode(true);
    try {
      await onUpdateProvider(model, { executionMode: next });
    } finally {
      setSavingMode(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyDraft.trim()) {
      setKeyError('API key cannot be empty');
      return;
    }
    setSavingKey(true);
    setKeyError(null);
    try {
      await onUpdateProvider(model, { apiKey: apiKeyDraft.trim() });
      setApiKeyDraft('');
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleRemoveApiKey = async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      await onUpdateProvider(model, { apiKey: null });
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to remove API key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  };

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore
    }
  };

  const handleSyncModels = async () => {
    setSyncing(true);
    try {
      await onSyncModels();
    } catch {
      // error surfaces via syncResult prop
    } finally {
      setSyncing(false);
    }
  };

  const canSync = isApi ? hasApiKey : installed;
  const syncCounts = syncResult
    ? syncResult.added.length + syncResult.updated.length + syncResult.removed.length
    : 0;

  const installHint = INSTALL_HINTS[model];

  return (
    <Card
      statusTone={cardTone(installed, enabled, executionMode, hasApiKey)}
      style={{ borderTopColor: modelMeta.color, borderTopWidth: '2px' }}
      variant="status-bordered"
    >
      <CardHeader className="space-y-2 border-b border-border-subtle">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusDot tone={ready && enabled ? 'active' : ready ? 'warning' : 'error'} />
            <h3 className="font-mono text-sm font-semibold" style={{ color: modelMeta.color }}>
              {modelMeta.label}
            </h3>
          </div>
          <Badge size="sm" tone={ready ? 'success' : 'error'}>
            {statusLabel}
          </Badge>
        </div>

        <p className="text-xs text-text-secondary">
          Provider:{' '}
          <span className="font-mono text-text-primary">
            {providerLabel} · {isApi ? 'API' : 'CLI'}
          </span>
        </p>

        <div className="rounded-md border border-border-subtle bg-surface-0/60 px-2.5 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  Run via API
                </span>
                <span
                  aria-label={MODE_HELP}
                  className="cursor-help rounded-full border border-border-subtle px-1 font-mono text-[9px] text-text-muted hover:text-text-secondary"
                  title={MODE_HELP}
                >
                  ?
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
                {isApi
                  ? 'Uses provider SDK with your API key'
                  : `Uses local \`${providerDef?.cliCommand ?? model}\` binary`}
              </div>
            </div>
            <ToggleSwitch
              checked={isApi}
              disabled={savingMode}
              label="Run via API"
              onChange={() => void handleToggleMode()}
            />
          </div>

          {isApi ? (
            <div className="space-y-1.5 border-t border-border-subtle pt-2">
              <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                API Key
              </label>
              <div className="flex gap-1.5">
                <Input
                  className="flex-1 font-mono text-xs"
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  placeholder={hasApiKey ? '•••••••• (set)' : 'sk-...'}
                  type="password"
                  value={apiKeyDraft}
                />
                <Button
                  disabled={savingKey || !apiKeyDraft.trim()}
                  onClick={() => void handleSaveApiKey()}
                  size="sm"
                  variant="primary"
                >
                  {savingKey ? '...' : 'Save'}
                </Button>
              </div>
              {hasApiKey && (
                <button
                  className="font-mono text-[10px] text-accent-red hover:underline"
                  disabled={savingKey}
                  onClick={() => void handleRemoveApiKey()}
                  type="button"
                >
                  Remove key
                </button>
              )}
              {keyError && (
                <p className="font-mono text-[10px] text-accent-red">{keyError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2 border-t border-border-subtle pt-2">
              <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                <span className="uppercase tracking-wide text-text-muted">CLI status</span>
                <div className="flex items-center gap-2">
                  <span className={installed ? 'text-accent-green' : 'text-accent-red'}>
                    {detecting || rechecking
                      ? 'checking…'
                      : installed
                        ? 'installed on PATH'
                        : 'not found on PATH'}
                  </span>
                  <button
                    aria-label="Recheck CLI"
                    className="text-text-muted hover:text-text-primary disabled:opacity-50"
                    disabled={detecting || rechecking}
                    onClick={() => void handleRecheck()}
                    type="button"
                  >
                    ↻
                  </button>
                </div>
              </div>

              {!installed && !detecting && !rechecking && installHint && (
                <div className="space-y-1.5 rounded border border-accent-red/30 bg-accent-red-bg/40 p-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
                    Install via npm
                  </div>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 truncate rounded bg-surface-0 px-2 py-1 font-mono text-[11px] text-text-primary">
                      {installHint.command}
                    </code>
                    <button
                      className="rounded border border-border-subtle px-2 py-1 font-mono text-[10px] text-text-secondary hover:bg-surface-2"
                      onClick={() => void handleCopyCommand(installHint.command)}
                      type="button"
                    >
                      {copied ? '✓' : 'Copy'}
                    </button>
                  </div>
                  <a
                    className="font-mono text-[10px] text-accent-orange hover:underline"
                    href={installHint.docsUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View docs →
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
              Models
            </span>
            <button
              className="font-mono text-[10px] text-accent-orange hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
              disabled={!canSync || syncing}
              onClick={() => void handleSyncModels()}
              title={
                canSync
                  ? `Discover models via ${isApi ? 'API' : 'CLI'}`
                  : isApi
                    ? 'Add an API key to sync models'
                    : 'Install the CLI to sync models'
              }
              type="button"
            >
              {syncing ? 'syncing…' : `↻ Sync via ${isApi ? 'API' : 'CLI'}`}
            </button>
          </div>

          {syncResult && (
            syncResult.error ? (
              <p className="font-mono text-[10px] text-accent-red">
                {syncResult.error}
              </p>
            ) : syncCounts === 0 ? (
              <p className="font-mono text-[10px] text-text-muted">Up to date</p>
            ) : (
              <p className="font-mono text-[10px] text-accent-green">
                {syncResult.added.length > 0 && `+${syncResult.added.length} added `}
                {syncResult.updated.length > 0 && `${syncResult.updated.length} updated `}
                {syncResult.removed.length > 0 && `-${syncResult.removed.length} removed`}
              </p>
            )
          )}
        </div>
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
          disabled={!ready}
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
