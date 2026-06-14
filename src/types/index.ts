export type TaskStatus = 'queued' | 'running' | 'completed' | 'blocked' | 'awaiting_approval' | 'failed' | 'rejected' | 'paused' | 'skipped' | 'rate_limited';
export type TaskType = 'seeded' | 'spawned' | 'planned' | 'system' | 'routine';
export type ScheduleKind = 'hourly' | 'daily' | 'weekly';
export type ApprovalMode = 'auto' | 'manual' | 'on_error';
/** Dynamic model key — stored in DB, not hardcoded */
export type ModelKey = string;
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type PageId = 'pipelines' | 'agents' | 'models' | 'settings';
export type LogType = 'info' | 'success' | 'warning' | 'error' | 'model';

export interface ModelConfig {
  label: string;
  color: string;
  bg: string;
  costPer1k: number;
}

export type PipelineViewMode = 'kanban' | 'pipeline';

export interface PipelineStage {
  id: string;
  name: string;
  sortOrder: number;
  color: string;
  maxParallel: number;
}

export interface Routine {
  id: string;
  pipelineId: string;
  name: string;
  agentId: string;
  model: ModelKey;
  approval: ApprovalMode;
  input: string;
  scheduleKind: ScheduleKind;
  /** 'HH:MM' (24h, server local time) — used by daily/weekly */
  scheduleTime: string;
  /** 0=Sunday … 6=Saturday — used by weekly */
  scheduleWeekday: number;
  useWorktree: boolean;
  branch: string | null;
  timeoutMs: number | null;
  priority: TaskPriority | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  createdAt: string;
  /** IANA timezone the server interprets schedule times in. */
  serverTimeZone: string;
}

export interface DependencyCondition {
  type: 'contains' | 'not_contains' | 'regex' | 'status';
  value: string;
}

export interface Task {
  id: string;
  name: string;
  agentId: string;
  model: ModelKey;
  approval: ApprovalMode;
  status: TaskStatus;
  stage: number;
  dependsOn: string[];
  dependencyConditions?: Record<string, DependencyCondition>;
  input: string;
  originalInput?: string;
  currentInput?: string;
  output: string | null;
  tokens: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  duration: string | null;
  priority: TaskPriority | null;
  timeoutMs: number;
  tags: string[];
  taskType: TaskType;
  sourceTaskId: string | null;
  routineId?: string | null;
  sourceTaskName?: string | null;
  sourceTaskStatus?: TaskStatus | null;
  sourceTaskArchivedAt?: string | null;
  stageId: string | null;
  createdAt: string | null;
  worktreePath: string | null;
  worktreeStatus: string | null;
  interactiveMode?: boolean;
  pendingQuestions?: number;
  userNote?: string;
  useWorktree?: boolean;
  branch?: string | null;
  archivedAt?: string | null;
  autoRetry?: boolean;
}

export interface ExecutionRun {
  id: string;
  taskId: string;
  attempt: number;
  cycleId: string | null;
  attemptNumber: number;
  parentRunId?: string | null;
  triggerType?: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  stdout: string;
  stderr: string;
  tokens: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  costUsd?: number | null;
  pricingSource?: string | null;
  pricingSnapshot?: UsageSnapshot | null;
  durationMs: number;
  exitCode: number | null;
  executorType: string | null;
  model: string | null;
  error: string | null;
  followUpPrompt: string | null;
  isFollowUp: boolean;
  sessionId: string | null;
  providerSessionId?: string | null;
  agentId?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
  parsedOutput: string | null;
}

export interface TaskCycle {
  id: string;
  taskId: string;
  cycleNumber: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  startedBy: string | null;
  restartReason: string | null;
  summary: string;
  attemptCount: number;
  lastAttemptAt: string | null;
}

export interface ConversationMessage {
  id: string;
  taskId: string;
  cycleId: string;
  runId: string | null;
  role: 'assistant' | 'system' | 'user';
  messageType: string;
  content: string;
  createdAt: string;
  agentId: string | null;
  provider: string | null;
  modelUsed: string | null;
  meta: Record<string, unknown>;
}

export type ControlRequestStatus = 'pending' | 'approved' | 'denied' | 'timed_out' | 'approved_sent' | 'denied_sent';

export interface ControlRequest {
  id: string;
  taskId: string;
  runId: string;
  toolName: string;
  toolUseId: string | null;
  inputJson: string;
  question: string | null;
  status: ControlRequestStatus;
  responseJson: string | null;
  createdAt: string;
  respondedAt: string | null;
  timeoutAt: string;
}

export interface LogEntry {
  id: number;
  time: string;
  type: LogType;
  msg: string;
}

export interface Pipeline {
  id: string;
  name: string;
  status: TaskStatus;
  created: string;
  description: string;
  rules: string;
  enabledAgents: string[];
  workingDir: string;
  gitBranch?: string | null;
  totalTokensUsed: number;
  totalCostUsd?: number;
  tokensByModel: Record<string, number>;
  stages: PipelineStage[];
  logs: LogEntry[];
  tasks: Task[];
}

export interface UsageSnapshot {
  calculatedAt: string;
  costPer1k: number | null;
  label: string | null;
  mode: 'estimated' | 'exact';
  modelId: string | null;
  provider: string | null;
  source: string;
}

export interface UsageSummary {
  avgCostPerTask: number;
  avgTokensPerRun: number;
  runCount: number;
  taskCount: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface UsageTimeseriesPoint {
  costUsd: number;
  date: string;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
}

export interface UsageBreakdownRow {
  avgCostPerRun: number;
  avgTokensPerRun: number;
  costUsd: number;
  inputTokens: number;
  key: string;
  label: string;
  outputTokens: number;
  runCount: number;
  taskCount: number;
  tokens: number;
}

export interface TopTaskUsageRow {
  costUsd: number;
  inputTokens: number;
  lastRunAt: string | null;
  outputTokens: number;
  pipelineId: string;
  pipelineName: string;
  runCount: number;
  taskId: string;
  taskName: string;
  tokens: number;
}

export interface UsageAnalytics {
  filters: {
    from: string | null;
    model: string | null;
    pipelineId: string | null;
    provider: string | null;
    to: string | null;
  };
  providers: UsageBreakdownRow[];
  models: UsageBreakdownRow[];
  summary: UsageSummary;
  timeseries: UsageTimeseriesPoint[];
  topTasks: TopTaskUsageRow[];
}

export interface Agent {
  id: string;
  name: string;
  icon: string;
  title: string;
  avatarSeed: string;
  defaultModel: ModelKey;
  prompt: string;
}

export interface KanbanColumn {
  id: string;
  label: string;
  color: string;
}

export interface RoutingRule {
  condition: string;
  model: ModelKey;
  reason: string;
}

// ─── Attachments ───

export interface Attachment {
  id: string;
  targetType: 'task' | 'message';
  targetId: string;
  pipelineId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

// ─── Breakdown Plan ───

export interface BreakdownTaskPlan {
  name: string;
  agentId: string;
  model: ModelKey;
  approval: ApprovalMode;
  stage: number;
  dependsOn: number[];       // index-based refs into tasks array
  input: string;
  rationale: string;         // AI's reasoning for this task
  priority: TaskPriority | null;
  tags: string[];
  taskType: TaskType;        // planned (core) or spawned (follow-up)
}

export interface BreakdownPlan {
  summary: string;           // overall approach summary
  tasks: BreakdownTaskPlan[];
  reasoning: string;         // why certain agents were included/excluded
}
