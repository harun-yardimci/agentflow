import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Modal,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleSwitch,
} from '@/components/ui';
import { cn, toErrorMessage } from '@/lib/utils';
import * as api from '@/lib/api';

type McpTool = 'claude_code' | 'codex_cli' | 'gemini_cli';

interface McpToolDef {
  configPath: string;
  format: 'json' | 'toml';
  id: McpTool;
  label: string;
}

const MCP_TOOLS: McpToolDef[] = [
  {
    id: 'claude_code',
    label: 'Claude Code',
    configPath: '~/.claude/settings.json → mcpServers',
    format: 'json',
  },
  {
    id: 'gemini_cli',
    label: 'Gemini CLI',
    configPath: '~/.gemini/settings.json → mcpServers',
    format: 'json',
  },
  {
    id: 'codex_cli',
    label: 'Codex CLI',
    configPath: '~/.codex/config.toml → mcp_servers',
    format: 'toml',
  },
];

function boolValue(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

function fromBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function toMinutes(milliseconds: string | undefined, fallback: number): string {
  const parsed = Number.parseInt(milliseconds ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback.toString();
  }
  return Math.max(1, Math.round(parsed / 60_000)).toString();
}

function fromMinutes(minutes: string, fallback: number): string {
  const parsed = Number.parseInt(minutes, 10);
  const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return (safeValue * 60_000).toString();
}

function getMcpConfigString(tool: McpTool, projectRoot: string, port: string): string {
  const mcpPath = `${projectRoot}/mcp/index.ts`;
  const envBlock = { AGENTFLOW_PORT: port };

  switch (tool) {
    case 'claude_code':
      return JSON.stringify(
        {
          agentflow: {
            command: 'npx',
            args: ['tsx', mcpPath],
            env: envBlock,
          },
        },
        null,
        2,
      );
    case 'gemini_cli':
      return JSON.stringify(
        {
          mcpServers: {
            agentflow: {
              command: 'npx',
              args: ['tsx', mcpPath],
              env: envBlock,
            },
          },
        },
        null,
        2,
      );
    case 'codex_cli':
      return [
        '[mcp_servers.agentflow]',
        'command = "npx"',
        `args = ["tsx", "${mcpPath}"]`,
        '',
        '[mcp_servers.agentflow.env]',
        `AGENTFLOW_PORT = "${port}"`,
      ].join('\n');
  }
}

function getMcpCliCommand(tool: McpTool, projectRoot: string, port: string): string {
  const mcpPath = `${projectRoot}/mcp/index.ts`;

  switch (tool) {
    case 'claude_code':
      return `claude mcp add agentflow --env AGENTFLOW_PORT=${port} -- npx tsx ${mcpPath}`;
    case 'gemini_cli':
      return `gemini mcp add agentflow -e AGENTFLOW_PORT=${port} -- npx tsx ${mcpPath}`;
    case 'codex_cli':
      return `codex mcp add agentflow --env AGENTFLOW_PORT=${port} -- npx tsx ${mcpPath}`;
  }
}

function SettingRow({
  label,
  description,
  children,
}: {
  children: React.ReactNode;
  description?: string;
  label: string;
}): JSX.Element {
  return (
    <div className="grid gap-2 border-b border-border-subtle py-3 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)] md:items-start md:gap-4">
      <div>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-text-primary">
          {label}
        </p>
        {description && <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SecretInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState('');

  const hasValue = value.trim().length > 0;

  if (isEditing) {
    return (
      <div className="space-y-2">
        <Input
          onChange={(event) => setLocalValue(event.target.value)}
          placeholder={placeholder}
          type="password"
          value={localValue}
        />
        <div className="flex gap-2">
          <Button
            disabled={localValue.trim().length === 0}
            onClick={() => {
              onChange(localValue.trim());
              setLocalValue('');
              setIsEditing(false);
            }}
            size="sm"
            variant="primary"
          >
            Save Key
          </Button>
          <Button
            onClick={() => {
              setLocalValue('');
              setIsEditing(false);
            }}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border-secondary bg-surface-2 px-3 py-2">
        {hasValue ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-green" />
            <span className="font-mono">{value}</span>
          </div>
        ) : (
          <span className="text-xs text-text-muted">Not configured</span>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setIsEditing(true)} size="sm" variant="secondary">
          {hasValue ? `Change ${label}` : `Add ${label}`}
        </Button>
        {hasValue && (
          <Button onClick={() => onChange('')} size="sm" variant="ghost">
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function NotificationSection({
  settings,
  updateField,
}: {
  settings: Record<string, string>;
  updateField: (key: string, value: string) => void;
}): JSX.Element {
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const nativeEnabled = boolValue(settings.native_notifications, false);
  const telegramEnabled = boolValue(settings.telegram_enabled, false);
  const slackEnabled = boolValue(settings.slack_enabled, false);

  const handleNativeToggle = async () => {
    if (!nativeEnabled && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      }
    }

    updateField('native_notifications', fromBool(!nativeEnabled));
    try {
      localStorage.setItem('agentflow_native_notifications', fromBool(!nativeEnabled));
    } catch {
      // Ignore storage write errors in restricted environments
    }
  };

  const testChannel = async (channel: 'slack' | 'telegram') => {
    setTestResult(null);

    try {
      if (channel === 'telegram') {
        setTestingTelegram(true);
      } else {
        setTestingSlack(true);
      }

      await api.testIntegration(channel);
      setTestResult(`${channel} test notification sent.`);
    } catch (error) {
      setTestResult(toErrorMessage(error));
    } finally {
      if (channel === 'telegram') {
        setTestingTelegram(false);
      } else {
        setTestingSlack(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-text-primary">Browser Notifications</h3>
        </CardHeader>
        <CardBody>
          <SettingRow
            description="Notify on completion, failure, or approval requests in supported browsers."
            label="Native Push"
          >
            <ToggleSwitch checked={nativeEnabled} onChange={() => void handleNativeToggle()} />
          </SettingRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-text-primary">Telegram</h3>
        </CardHeader>
        <CardBody className="space-y-3">
          <SettingRow
            description="Enable Telegram notifications for pipeline updates."
            label="Enabled"
          >
            <ToggleSwitch
              checked={telegramEnabled}
              onChange={() => updateField('telegram_enabled', fromBool(!telegramEnabled))}
            />
          </SettingRow>

          {telegramEnabled && (
            <>
              <SettingRow label="Bot Token">
                <SecretInput
                  label="Bot Token"
                  onChange={(value) => updateField('telegram_bot_token', value)}
                  placeholder="123456:ABC-DEF..."
                  value={settings.telegram_bot_token ?? ''}
                />
              </SettingRow>

              <SettingRow description="Target chat or group id." label="Chat ID">
                <Input
                  onChange={(event) => updateField('telegram_chat_id', event.target.value)}
                  placeholder="-1001234567890"
                  value={settings.telegram_chat_id ?? ''}
                />
              </SettingRow>

              <div className="flex items-center gap-2">
                <Button
                  disabled={testingTelegram}
                  onClick={() => void testChannel('telegram')}
                  size="sm"
                  variant="secondary"
                >
                  {testingTelegram ? 'Testing...' : 'Test Telegram'}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-text-primary">Slack</h3>
        </CardHeader>
        <CardBody className="space-y-3">
          <SettingRow
            description="Enable Slack notifications for run updates."
            label="Enabled"
          >
            <ToggleSwitch
              checked={slackEnabled}
              onChange={() => updateField('slack_enabled', fromBool(!slackEnabled))}
            />
          </SettingRow>

          {slackEnabled && (
            <>
              <SettingRow label="Webhook URL">
                <SecretInput
                  label="Webhook URL"
                  onChange={(value) => updateField('slack_webhook_url', value)}
                  placeholder="https://hooks.slack.com/services/..."
                  value={settings.slack_webhook_url ?? ''}
                />
              </SettingRow>

              <SettingRow label="Bot Token (optional)">
                <SecretInput
                  label="Bot Token"
                  onChange={(value) => updateField('slack_bot_token', value)}
                  placeholder="xoxb-..."
                  value={settings.slack_bot_token ?? ''}
                />
              </SettingRow>

              <SettingRow description="Required when using bot token." label="Channel">
                <Input
                  onChange={(event) => updateField('slack_channel', event.target.value)}
                  placeholder="#agentflow-notifications"
                  value={settings.slack_channel ?? ''}
                />
              </SettingRow>

              <div className="flex items-center gap-2">
                <Button
                  disabled={testingSlack}
                  onClick={() => void testChannel('slack')}
                  size="sm"
                  variant="secondary"
                >
                  {testingSlack ? 'Testing...' : 'Test Slack'}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {testResult && (
        <div className="rounded-md border border-border-secondary bg-surface-2 px-3 py-2 text-xs text-text-secondary">
          {testResult}
        </div>
      )}
    </div>
  );
}

function SettingsSkeleton(): JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1120px] space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-10 w-96" />
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <CardBody className="space-y-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'integrations' | 'notifications' | 'runtime'>('runtime');
  const [selectedMcpTool, setSelectedMcpTool] = useState<McpTool>('claude_code');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.fetchSettings();
      setSettings(data);
    } catch (fetchError) {
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'agentflow_native_notifications',
        boolValue(settings.native_notifications, false) ? 'true' : 'false',
      );
    } catch {
      // Ignore storage write errors
    }
  }, [settings.native_notifications]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const updateField = (key: string, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const projectRoot = settings.project_root || settings.working_directory || '/path/to/agentflow';
  const port = settings.port ?? '3100';
  const databasePath = settings.database_path ?? `${projectRoot}/data/agentflow.db`;

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSaved(true);
    } catch (saveError) {
      setError(toErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const skipPermissionsEnabled = boolValue(settings.cli_skip_permissions, false);

  if (loading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1120px] space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-text-primary">Settings</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Runtime configuration, notifications, and MCP integration.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => void fetchSettings()} size="sm" variant="ghost">
              Reset Changes
            </Button>
            <Button disabled={saving} onClick={() => void saveSettings()} size="sm" variant="primary">
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </header>

        {(saved || error) && (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              error
                ? 'border-accent-red/35 bg-accent-red-bg text-accent-red'
                : 'border-accent-green/35 bg-accent-green-bg text-accent-green',
            )}
          >
            {error ?? 'Settings saved successfully.'}
          </div>
        )}

        <Tabs onValueChange={(value) => setActiveTab(value as typeof activeTab)} value={activeTab}>
          <TabsList>
            <TabsTrigger value="runtime">Runtime</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4 space-y-4" value="runtime">
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-text-primary">General</h3>
              </CardHeader>
              <CardBody>
                <SettingRow
                  description="AgentFlow backend port. MCP clients and UI connect to this port."
                  label="Application Port"
                >
                  <div className="space-y-2">
                    <Input
                      className="max-w-40"
                      max={65535}
                      min={1024}
                      onChange={(event) => updateField('port', event.target.value)}
                      type="number"
                      value={settings.port ?? '3100'}
                    />
                    <Badge tone="warning">Server restart required after port change</Badge>
                  </div>
                </SettingRow>

                <SettingRow
                  description="SQLite database file path used by the backend."
                  label="Database Path"
                >
                  <Input
                    onChange={(event) => updateField('database_path', event.target.value)}
                    value={databasePath}
                  />
                </SettingRow>

                <SettingRow
                  description="Client polling interval for refreshing pipeline state."
                  label="Polling Interval (ms)"
                >
                  <Input
                    className="max-w-40"
                    onChange={(event) => updateField('poll_interval_ms', event.target.value)}
                    type="number"
                    value={settings.poll_interval_ms ?? '2000'}
                  />
                </SettingRow>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-text-primary">Execution Limits</h3>
              </CardHeader>
              <CardBody>
                <SettingRow description="Maximum concurrent task workers." label="Max Parallel Tasks">
                  <Input
                    className="max-w-32"
                    max={20}
                    min={1}
                    onChange={(event) => updateField('max_parallel_tasks', event.target.value)}
                    type="number"
                    value={settings.max_parallel_tasks ?? '5'}
                  />
                </SettingRow>

                <SettingRow description="Default timeout for newly created tasks." label="Default Task Timeout (min)">
                  <Input
                    className="max-w-32"
                    max={120}
                    min={1}
                    onChange={(event) => {
                      updateField('default_task_timeout_ms', fromMinutes(event.target.value, 30));
                    }}
                    type="number"
                    value={toMinutes(settings.default_task_timeout_ms, 30)}
                  />
                </SettingRow>

                <SettingRow description="Timeout for AI breakdown generation." label="Breakdown Timeout (min)">
                  <Input
                    className="max-w-32"
                    max={60}
                    min={1}
                    onChange={(event) => {
                      updateField('breakdown_timeout_ms', fromMinutes(event.target.value, 10));
                    }}
                    type="number"
                    value={toMinutes(settings.breakdown_timeout_ms, 10)}
                  />
                </SettingRow>

                <SettingRow description="Retries before marking a task as failed." label="Max Retries">
                  <Input
                    className="max-w-32"
                    max={10}
                    min={0}
                    onChange={(event) => updateField('max_retries', event.target.value)}
                    type="number"
                    value={settings.max_retries ?? '2'}
                  />
                </SettingRow>

                <SettingRow description="Upper bound for total task attempts." label="Max Iterations">
                  <Input
                    className="max-w-32"
                    max={10}
                    min={1}
                    onChange={(event) => updateField('max_iterations', event.target.value)}
                    type="number"
                    value={settings.max_iterations ?? '3'}
                  />
                </SettingRow>

                <SettingRow description="Delete historical logs older than this value." label="Log Retention (days)">
                  <Input
                    className="max-w-32"
                    max={365}
                    min={1}
                    onChange={(event) => updateField('log_retention_days', event.target.value)}
                    type="number"
                    value={settings.log_retention_days ?? '30'}
                  />
                </SettingRow>

                <SettingRow
                  description="Run each task in isolated git worktrees for safer parallel work."
                  label="Worktree Isolation"
                >
                  <ToggleSwitch
                    checked={boolValue(settings.worktree_isolation, true)}
                    onChange={() => updateField('worktree_isolation', fromBool(!boolValue(settings.worktree_isolation, true)))}
                  />
                </SettingRow>

                <SettingRow
                  description="Allow tasks to create follow-up tasks automatically from outputs."
                  label="Auto Spawn Follow-Ups"
                >
                  <ToggleSwitch
                    checked={boolValue(settings.auto_spawn_follow_ups, false)}
                    onChange={() => updateField('auto_spawn_follow_ups', fromBool(!boolValue(settings.auto_spawn_follow_ups, false)))}
                  />
                </SettingRow>

                {boolValue(settings.auto_spawn_follow_ups, false) && (
                  <SettingRow
                    description="Safety cap for spawned tasks from one completion."
                    label="Max Spawned Tasks"
                  >
                    <Input
                      className="max-w-32"
                      max={20}
                      min={1}
                      onChange={(event) => updateField('max_spawned_tasks_per_completion', event.target.value)}
                      type="number"
                      value={settings.max_spawned_tasks_per_completion ?? '10'}
                    />
                  </SettingRow>
                )}

                <SettingRow
                  description="Pass dangerous auto-approval flags to CLI agents."
                  label="CLI Skip Permissions"
                >
                  <div className="space-y-2">
                    <ToggleSwitch
                      checked={skipPermissionsEnabled}
                      onChange={() => {
                        if (skipPermissionsEnabled) {
                          updateField('cli_skip_permissions', 'false');
                        } else {
                          setShowSkipConfirm(true);
                        }
                      }}
                    />
                    {skipPermissionsEnabled && (
                      <Badge tone="warning">
                        Enabled: CLI commands can run without interactive approvals
                      </Badge>
                    )}
                  </div>
                </SettingRow>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-text-primary">Run Hooks</h3>
              </CardHeader>
              <CardBody>
                <SettingRow
                  description="Shell command executed before each run. Env: AGENTFLOW_TASK_ID, AGENTFLOW_TASK_NAME, AGENTFLOW_TASK_AGENT_ID, AGENTFLOW_TASK_MODEL, AGENTFLOW_PIPELINE_ID, AGENTFLOW_WORKING_DIR"
                  label="Pre-Run Hook"
                >
                  <Textarea
                    onChange={(event) => updateField('pre_run_hook', event.target.value)}
                    placeholder={'echo "Task started"'}
                    resize="vertical"
                    rows={3}
                    value={settings.pre_run_hook ?? ''}
                  />
                </SettingRow>

                <SettingRow
                  description="Shell command executed after each run. Env: AGENTFLOW_TASK_STATUS, AGENTFLOW_TASK_EXIT_CODE, AGENTFLOW_TASK_OUTPUT, AGENTFLOW_TASK_TOKENS, AGENTFLOW_TASK_DURATION_MS"
                  label="Post-Run Hook"
                >
                  <Textarea
                    onChange={(event) => updateField('post_run_hook', event.target.value)}
                    placeholder={'echo "Task completed"'}
                    resize="vertical"
                    rows={3}
                    value={settings.post_run_hook ?? ''}
                  />
                </SettingRow>
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent className="mt-4" value="notifications">
            <NotificationSection settings={settings} updateField={updateField} />
          </TabsContent>

          <TabsContent className="mt-4 space-y-4" value="integrations">
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-text-primary">MCP Integration</h3>
                <p className="text-xs text-text-secondary">
                  Connect AgentFlow MCP server to external coding tools.
                </p>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-2 md:grid-cols-3">
                  {MCP_TOOLS.map((tool) => (
                    <button
                      className={cn(
                        'rounded-md border px-3 py-2 text-left transition-colors',
                        selectedMcpTool === tool.id
                          ? 'border-accent-orange bg-accent-orange-bg'
                          : 'border-border-secondary bg-surface-2 hover:border-border-hover',
                      )}
                      key={tool.id}
                      onClick={() => setSelectedMcpTool(tool.id)}
                      type="button"
                    >
                      <p className="text-sm font-semibold text-text-primary">{tool.label}</p>
                      <p className="font-mono text-[10px] text-text-muted">{tool.format.toUpperCase()}</p>
                    </button>
                  ))}
                </div>

                <SettingRow
                  description="Run this command to auto-register AgentFlow MCP server."
                  label="CLI Command"
                >
                  <div className="space-y-2">
                    <code className="block overflow-x-auto rounded-md border border-border-secondary bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-secondary">
                      {getMcpCliCommand(selectedMcpTool, projectRoot, port)}
                    </code>
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          getMcpCliCommand(selectedMcpTool, projectRoot, port),
                        );
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Copy Command
                    </Button>
                  </div>
                </SettingRow>

                <SettingRow
                  description={`Manual config path: ${MCP_TOOLS.find((item) => item.id === selectedMcpTool)?.configPath ?? ''}`}
                  label="Config Block"
                >
                  <div className="space-y-2">
                    <pre className="max-h-72 overflow-auto rounded-md border border-border-secondary bg-surface-2 p-3 font-mono text-[11px] text-text-secondary">
                      {getMcpConfigString(selectedMcpTool, projectRoot, port)}
                    </pre>
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          getMcpConfigString(selectedMcpTool, projectRoot, port),
                        );
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Copy Config
                    </Button>
                  </div>
                </SettingRow>
              </CardBody>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Modal
        description="This enables dangerous flags (e.g. --dangerously-skip-permissions / --full-auto). Use only in trusted environments."
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowSkipConfirm(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              onClick={() => {
                updateField('cli_skip_permissions', 'true');
                setShowSkipConfirm(false);
              }}
              size="sm"
              variant="danger"
            >
              Enable Anyway
            </Button>
          </div>
        )}
        onOpenChange={setShowSkipConfirm}
        open={showSkipConfirm}
        title="Security Warning"
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          Agents will be able to execute commands without requesting permission for each action.
          This may modify files, run external commands, and perform network operations automatically.
        </p>
      </Modal>
    </div>
  );
}
