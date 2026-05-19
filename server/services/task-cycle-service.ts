import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { getProviderKey } from '../lib/provider-utils.js';

type AttemptTriggerType =
  | 'initial'
  | 'retry'
  | 'follow_up'
  | 'agent_switch'
  | 'provider_switch'
  | 'model_switch'
  | 'auto_retry';

interface TaskCycleRow {
  id: string;
  task_id: string;
  cycle_number: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  started_by: string | null;
  restart_reason: string | null;
  summary: string;
}

interface ExecutionRunRow {
  id: string;
  task_id: string;
  cycle_id: string | null;
  attempt?: number;
  attempt_number: number | null;
  status: string;
  started_at?: string;
  completed_at?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  tokens_used?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cost_usd?: number | null;
  pricing_source?: string | null;
  pricing_snapshot_json?: string | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  agent_id: string | null;
  provider: string | null;
  model_used: string | null;
  follow_up_prompt: string | null;
  session_id?: string | null;
  provider_session_id?: string | null;
  trigger_type?: string | null;
  parent_run_id?: string | null;
  parsed_output?: string | null;
}

interface ConversationMessageRow {
  id: string;
  task_id: string;
  cycle_id: string;
  run_id: string | null;
  role: string;
  message_type: string;
  content: string;
  created_at: string;
  agent_id: string | null;
  provider: string | null;
  model_used: string | null;
  meta_json: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveCycle(taskId: string): TaskCycleRow | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM task_cycles WHERE task_id = ? AND ended_at IS NULL ORDER BY cycle_number DESC LIMIT 1'
  ).get(taskId) as TaskCycleRow | undefined;
}

export function getOrCreateActiveCycle(
  taskId: string,
  startedBy = 'system',
): TaskCycleRow {
  const db = getDb();
  const existing = getActiveCycle(taskId);
  if (existing) return existing;

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new AppError(404, 'Task not found');

  const maxRow = db.prepare(
    'SELECT MAX(cycle_number) as max_cycle FROM task_cycles WHERE task_id = ?'
  ).get(taskId) as { max_cycle: number | null } | undefined;
  const cycleNumber = (maxRow?.max_cycle ?? 0) + 1;
  const cycleId = makeId('cycle');
  const startedAt = nowIso();

  db.prepare(`
    INSERT INTO task_cycles (id, task_id, cycle_number, status, started_at, started_by, summary)
    VALUES (?, ?, ?, 'running', ?, ?, '')
  `).run(cycleId, taskId, cycleNumber, startedAt, startedBy);

  return db.prepare('SELECT * FROM task_cycles WHERE id = ?')
    .get(cycleId) as TaskCycleRow;
}

export function closeActiveCycles(taskId: string, restartReason: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE task_cycles
    SET ended_at = COALESCE(ended_at, ?),
        status = 'restarted',
        restart_reason = ?
    WHERE task_id = ? AND ended_at IS NULL
  `).run(nowIso(), restartReason, taskId);
}

export function setCycleStatus(cycleId: string, status: string, summary?: string): void {
  const db = getDb();
  if (summary !== undefined) {
    db.prepare('UPDATE task_cycles SET status = ?, summary = ? WHERE id = ?')
      .run(status, summary, cycleId);
    return;
  }
  db.prepare('UPDATE task_cycles SET status = ? WHERE id = ?')
    .run(status, cycleId);
}

export function finishCycle(cycleId: string, status: string, summary?: string): void {
  const db = getDb();
  if (summary !== undefined) {
    db.prepare(`
      UPDATE task_cycles
      SET status = ?, summary = ?, ended_at = COALESCE(ended_at, ?)
      WHERE id = ?
    `).run(status, summary, nowIso(), cycleId);
    return;
  }
  db.prepare(`
    UPDATE task_cycles
    SET status = ?, ended_at = COALESCE(ended_at, ?)
    WHERE id = ?
  `).run(status, nowIso(), cycleId);
}

export function reopenCycle(cycleId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE task_cycles
    SET status = 'running',
        ended_at = NULL
    WHERE id = ?
  `).run(cycleId);
}

export function getNextAttemptNumber(cycleId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT MAX(COALESCE(attempt_number, 0)) as max_attempt FROM execution_runs WHERE cycle_id = ?'
  ).get(cycleId) as { max_attempt: number | null } | undefined;
  return (row?.max_attempt ?? 0) + 1;
}

export function getLatestCycleAttempt(taskId: string, cycleId: string): ExecutionRunRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM execution_runs
    WHERE task_id = ? AND cycle_id = ?
    ORDER BY COALESCE(attempt_number, attempt) DESC, started_at DESC
    LIMIT 1
  `).get(taskId, cycleId) as ExecutionRunRow | undefined;
}

export function inferAttemptContext(
  taskId: string,
  cycleId: string,
  agentId: string,
  model: string,
  followUpPrompt?: string,
  retryCount = 0,
): {
  triggerType: AttemptTriggerType;
  parentRunId: string | null;
  previousRun: ExecutionRunRow | undefined;
  provider: string;
} {
  const previousRun = getLatestCycleAttempt(taskId, cycleId);
  const provider = getProviderKey(model);

  if (!previousRun) {
    return {
      triggerType: 'initial',
      parentRunId: null,
      previousRun,
      provider,
    };
  }

  let triggerType: AttemptTriggerType = 'retry';
  if (followUpPrompt?.trim()) {
    triggerType = 'follow_up';
  } else if (previousRun.agent_id && previousRun.agent_id !== agentId) {
    triggerType = 'agent_switch';
  } else if (previousRun.provider && previousRun.provider !== provider) {
    triggerType = 'provider_switch';
  } else if (previousRun.model_used && previousRun.model_used !== model) {
    triggerType = 'model_switch';
  } else if (retryCount > 0) {
    triggerType = 'auto_retry';
  }

  return {
    triggerType,
    parentRunId: previousRun.id,
    previousRun,
    provider,
  };
}

export function describeTriggerEvent(
  triggerType: AttemptTriggerType,
  agentName: string,
  provider: string,
  model: string,
): string | null {
  switch (triggerType) {
    case 'retry':
      return 'Retry started';
    case 'auto_retry':
      return 'Auto-retry started';
    case 'agent_switch':
      return `Switched agent to ${agentName}`;
    case 'provider_switch':
      return `Switched provider to ${provider} (${model})`;
    case 'model_switch':
      return `Switched model to ${model}`;
    default:
      return null;
  }
}

export function createConversationMessage(data: {
  id?: string;
  taskId: string;
  cycleId: string;
  runId?: string | null;
  role: 'assistant' | 'system' | 'user';
  messageType: 'error' | 'event' | 'final_answer' | 'follow_up' | 'summary' | 'tool_answer' | 'tool_question';
  content: string;
  agentId?: string | null;
  provider?: string | null;
  modelUsed?: string | null;
  meta?: Record<string, unknown>;
}): string {
  const db = getDb();
  const id = data.id ?? makeId('msg');
  db.prepare(`
    INSERT INTO conversation_messages (
      id, task_id, cycle_id, run_id, role, message_type, content, created_at,
      agent_id, provider, model_used, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.taskId,
    data.cycleId,
    data.runId ?? null,
    data.role,
    data.messageType,
    data.content,
    nowIso(),
    data.agentId ?? null,
    data.provider ?? null,
    data.modelUsed ?? null,
    JSON.stringify(data.meta ?? {}),
  );
  return id;
}

export function queuePendingFollowUp(data: {
  taskId: string;
  content: string;
  agentId?: string | null;
  provider?: string | null;
  modelUsed?: string | null;
}): {
  cycleId: string;
  messageId: string;
} {
  const cycle = getOrCreateActiveCycle(data.taskId, 'follow_up');
  const db = getDb();
  const trimmedContent = data.content.trim();

  const existing = db.prepare(`
    SELECT id
    FROM conversation_messages
    WHERE task_id = ?
      AND cycle_id = ?
      AND run_id IS NULL
      AND role = 'user'
      AND message_type = 'follow_up'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(data.taskId, cycle.id) as { id: string } | undefined;

  const messageId = existing?.id ?? makeId('msg');
  upsertConversationMessage({
    id: messageId,
    taskId: data.taskId,
    cycleId: cycle.id,
    runId: null,
    role: 'user',
    messageType: 'follow_up',
    content: trimmedContent,
    agentId: data.agentId ?? null,
    provider: data.provider ?? null,
    modelUsed: data.modelUsed ?? null,
    meta: { pending: true },
  });

  return {
    cycleId: cycle.id,
    messageId,
  };
}

export function attachPendingFollowUpToRun(data: {
  taskId: string;
  cycleId: string;
  runId: string;
  content: string;
  agentId?: string | null;
  provider?: string | null;
  modelUsed?: string | null;
  attempt?: number;
  attemptNumber?: number;
  triggerType?: string;
}): string {
  const db = getDb();
  const trimmedContent = data.content.trim();
  const existing = db.prepare(`
    SELECT id
    FROM conversation_messages
    WHERE task_id = ?
      AND cycle_id = ?
      AND run_id IS NULL
      AND role = 'user'
      AND message_type = 'follow_up'
      AND content = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(
    data.taskId,
    data.cycleId,
    trimmedContent,
  ) as { id: string } | undefined;

  const messageId = existing?.id ?? makeId('msg');
  upsertConversationMessage({
    id: messageId,
    taskId: data.taskId,
    cycleId: data.cycleId,
    runId: data.runId,
    role: 'user',
    messageType: 'follow_up',
    content: trimmedContent,
    agentId: data.agentId ?? null,
    provider: data.provider ?? null,
    modelUsed: data.modelUsed ?? null,
    meta: {
      attempt: data.attempt,
      attemptNumber: data.attemptNumber,
      pending: false,
      triggerType: data.triggerType,
    },
  });

  return messageId;
}

export function upsertConversationMessage(data: {
  id: string;
  taskId: string;
  cycleId: string;
  runId?: string | null;
  role: 'assistant' | 'system' | 'user';
  messageType: string;
  content: string;
  agentId?: string | null;
  provider?: string | null;
  modelUsed?: string | null;
  meta?: Record<string, unknown>;
}): string {
  const db = getDb();
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO conversation_messages (
      id, task_id, cycle_id, run_id, role, message_type, content, created_at,
      agent_id, provider, model_used, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      task_id = excluded.task_id,
      cycle_id = excluded.cycle_id,
      run_id = excluded.run_id,
      role = excluded.role,
      message_type = excluded.message_type,
      content = excluded.content,
      agent_id = excluded.agent_id,
      provider = excluded.provider,
      model_used = excluded.model_used,
      meta_json = excluded.meta_json
  `).run(
    data.id,
    data.taskId,
    data.cycleId,
    data.runId ?? null,
    data.role,
    data.messageType,
    data.content,
    createdAt,
    data.agentId ?? null,
    data.provider ?? null,
    data.modelUsed ?? null,
    JSON.stringify(data.meta ?? {}),
  );
  return data.id;
}

export function listTaskCycles(taskId: string): Array<{
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
}> {
  const db = getDb();
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new AppError(404, 'Task not found');

  const rows = db.prepare(`
    SELECT
      tc.*,
      COUNT(er.id) as attempt_count,
      MAX(er.started_at) as last_attempt_at
    FROM task_cycles tc
    LEFT JOIN execution_runs er ON er.cycle_id = tc.id
    WHERE tc.task_id = ?
    GROUP BY tc.id
    ORDER BY tc.cycle_number ASC
  `).all(taskId) as Array<TaskCycleRow & { attempt_count: number; last_attempt_at: string | null }>;

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    cycleNumber: row.cycle_number,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    startedBy: row.started_by,
    restartReason: row.restart_reason,
    summary: row.summary,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
  }));
}

export function listCycleAttempts(taskId: string, cycleId: string): ExecutionRunRow[] {
  const db = getDb();
  const cycle = db.prepare('SELECT id FROM task_cycles WHERE id = ? AND task_id = ?').get(cycleId, taskId);
  if (!cycle) throw new AppError(404, 'Task cycle not found');

  return db.prepare(`
    SELECT * FROM execution_runs
    WHERE task_id = ? AND cycle_id = ?
    ORDER BY COALESCE(attempt_number, attempt) ASC, started_at ASC
  `).all(taskId, cycleId) as ExecutionRunRow[];
}

export function listCycleMessages(taskId: string, cycleId: string): Array<{
  id: string;
  taskId: string;
  cycleId: string;
  runId: string | null;
  role: string;
  messageType: string;
  content: string;
  createdAt: string;
  agentId: string | null;
  provider: string | null;
  modelUsed: string | null;
  meta: Record<string, unknown>;
}> {
  const db = getDb();
  const cycle = db.prepare('SELECT id FROM task_cycles WHERE id = ? AND task_id = ?').get(cycleId, taskId);
  if (!cycle) throw new AppError(404, 'Task cycle not found');

  const rows = db.prepare(`
    SELECT * FROM conversation_messages
    WHERE task_id = ? AND cycle_id = ?
    ORDER BY created_at ASC
  `).all(taskId, cycleId) as ConversationMessageRow[];

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    cycleId: row.cycle_id,
    runId: row.run_id,
    role: row.role,
    messageType: row.message_type,
    content: row.content,
    createdAt: row.created_at,
    agentId: row.agent_id,
    provider: row.provider,
    modelUsed: row.model_used,
    meta: JSON.parse(row.meta_json || '{}') as Record<string, unknown>,
  }));
}
