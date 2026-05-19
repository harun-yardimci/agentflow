import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { recalcPipelineStatus } from './pipeline-service.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { deleteByTarget as deleteAttachmentsByTarget, getAttachmentsByTarget } from './attachment-service.js';
import { evaluateCondition, parseCondition, type DependencyCondition } from './condition-evaluator.js';
import { cleanupTaskWorktreeNow } from '../engine/worktree-cleanup-service.js';

interface TaskRow {
  id: string;
  pipeline_id: string;
  name: string;
  agent_id: string;
  model: string;
  approval: string;
  status: string;
  stage: number;
  input: string;
  original_input?: string;
  current_input?: string;
  output: string | null;
  tokens: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  duration: string | null;
  sort_order: number;
  priority: string | null;
  timeout_ms: number;
  task_type?: string;
  source_task_id?: string | null;
  stage_id?: string | null;
  created_at?: string;
  interactive_mode?: number;
  worktree_path?: string | null;
  worktree_status?: string | null;
  user_note?: string | null;
  use_worktree?: number;
  branch?: string | null;
  archived_at?: string | null;
  auto_retry?: number;
}

interface SourceTaskMeta {
  archivedAt: string | null;
  name: string | null;
  status: string | null;
}

function countPendingQuestions(taskId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM control_requests WHERE task_id = ? AND status = 'pending'"
  ).get(taskId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

function getTaskDepsWithConditions(taskId: string): { depId: string; condition: DependencyCondition | null }[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT depends_on_task_id, condition FROM task_deps WHERE task_id = ?'
  ).all(taskId) as { depends_on_task_id: string; condition: string | null }[];
  return rows.map((r) => ({
    depId: r.depends_on_task_id,
    condition: parseCondition(r.condition),
  }));
}

function archiveInheritedFollowUpsForParent(
  parentTaskId: string,
  reason: 'archived_with_parent' | 'merged_with_parent',
  now = logTimestamp(),
): number {
  const db = getDb();
  const listChildren = db.prepare(`
    SELECT id, name
    FROM tasks
    WHERE source_task_id = ?
      AND task_type IN ('spawned', 'system')
      AND branch IS NULL
      AND archived_at IS NULL
      AND status = 'completed'
  `);

  const updateChild = db.prepare(
    'UPDATE tasks SET archived_at = ?, worktree_status = ? WHERE id = ?'
  );
  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
  );
  const getParent = db.prepare(
    'SELECT id, pipeline_id, name FROM tasks WHERE id = ?'
  );

  const queue = [parentTaskId];
  const visited = new Set<string>();
  let archivedCount = 0;

  while (queue.length > 0) {
    const currentParentId = queue.shift();
    if (!currentParentId || visited.has(currentParentId)) continue;
    visited.add(currentParentId);

    const parent = getParent.get(currentParentId) as
      | { id: string; pipeline_id: string; name: string }
      | undefined;
    if (!parent) continue;

    const currentChildren = listChildren.all(currentParentId) as {
      id: string;
      name: string;
    }[];

    for (const child of currentChildren) {
      updateChild.run(now, reason, child.id);
      archivedCount += 1;
      insertLog.run(
        parent.pipeline_id,
        now,
        'info',
        `'${child.name}' archived because parent task '${parent.name}' was ${
          reason === 'merged_with_parent' ? 'finalized' : 'archived'
        }`,
      );
      queue.push(child.id);
    }
  }

  return archivedCount;
}

/**
 * Check if all dependencies of a task are satisfied (completed or skipped).
 * Returns { ok: true } or { ok: false, pending } with names of unsatisfied deps.
 */
export function checkDependenciesSatisfied(taskId: string): { ok: true } | { ok: false; pending: string[] } {
  const db = getDb();
  const deps = db.prepare(
    'SELECT depends_on_task_id FROM task_deps WHERE task_id = ?'
  ).all(taskId) as { depends_on_task_id: string }[];

  if (deps.length === 0) return { ok: true };

  const depIds = deps.map((d) => d.depends_on_task_id);
  const depTasks = db.prepare(
    `SELECT id, name, status FROM tasks WHERE id IN (${depIds.map(() => '?').join(',')})`
  ).all(...depIds) as { id: string; name: string; status: string }[];

  const pending = depTasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
  if (pending.length === 0) return { ok: true };

  return { ok: false, pending: pending.map((t) => `'${t.name}' (${t.status})`) };
}

/** Normalize a dependency item: plain string ID or { taskId, condition } */
type DependencyItem = string | { taskId: string; condition: DependencyCondition | null };

function normalizeDeps(items: DependencyItem[]): { taskId: string; condition: DependencyCondition | null }[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { taskId: item, condition: null }
      : { taskId: item.taskId, condition: item.condition ?? null }
  );
}

/** Normalize a batch dependency item: plain number index or { index, condition } */
type BatchDependencyItem = number | { index: number; condition: DependencyCondition | null };

function normalizeBatchDeps(items: BatchDependencyItem[]): { index: number; condition: DependencyCondition | null }[] {
  return items.map((item) =>
    typeof item === 'number'
      ? { index: item, condition: null }
      : { index: item.index, condition: item.condition ?? null }
  );
}

function formatTask(
  row: TaskRow,
  deps: string[],
  tags: string[],
  preloadedConditions?: { depId: string; condition: DependencyCondition | null }[],
  sourceTaskMeta?: SourceTaskMeta,
) {
  const depsWithConditions = preloadedConditions ?? getTaskDepsWithConditions(row.id);
  const conditionsMap: Record<string, DependencyCondition> = {};
  for (const d of depsWithConditions) {
    if (d.condition) conditionsMap[d.depId] = d.condition;
  }

  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    model: row.model,
    approval: row.approval,
    status: row.status,
    stage: row.stage,
    dependsOn: deps,
    dependencyConditions: conditionsMap,
    input: row.current_input ?? row.input,
    originalInput: row.original_input ?? row.input,
    currentInput: row.current_input ?? row.input,
    output: row.output,
    tokens: row.tokens,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    costUsd: row.cost_usd ?? null,
    duration: row.duration,
    priority: row.priority ?? null,
    timeoutMs: row.timeout_ms,
    tags,
    taskType: row.task_type ?? 'seeded',
    sourceTaskId: row.source_task_id ?? null,
    sourceTaskName: sourceTaskMeta?.name ?? null,
    sourceTaskStatus: sourceTaskMeta?.status ?? null,
    sourceTaskArchivedAt: sourceTaskMeta?.archivedAt ?? null,
    stageId: row.stage_id ?? null,
    createdAt: row.created_at || null,
    worktreePath: row.worktree_path ?? null,
    worktreeStatus: row.worktree_status ?? null,
    interactiveMode: row.interactive_mode === 1,
    pendingQuestions: countPendingQuestions(row.id),
    userNote: row.user_note ?? '',
    useWorktree: row.use_worktree !== 0,
    branch: row.branch ?? null,
    archivedAt: row.archived_at ?? null,
    autoRetry: (row.auto_retry ?? 0) === 1,
  };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveTaskTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.round(timeoutMs);
  }

  // Default to 30 minutes when setting is missing/invalid.
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'default_task_timeout_ms'"
  ).get() as { value: string } | undefined;

  return parsePositiveInt(row?.value) ?? 1_800_000;
}

function resolveMaxRetries(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'max_retries'"
  ).get() as { value: string } | undefined;
  return parsePositiveInt(row?.value) ?? 2;
}

function resolveMaxIterations(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'max_iterations'"
  ).get() as { value: string } | undefined;
  return parsePositiveInt(row?.value) ?? 3;
}

function getTaskDeps(taskId: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT depends_on_task_id FROM task_deps WHERE task_id = ?').all(taskId) as { depends_on_task_id: string }[];
  return rows.map((r) => r.depends_on_task_id);
}

function getTaskTags(taskId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT t.name FROM tags t JOIN task_tags tt ON tt.tag_id = t.id WHERE tt.task_id = ?'
  ).all(taskId) as { name: string }[];
  return rows.map((r) => r.name);
}

function buildDependencySignature(
  deps: { taskId: string; condition: DependencyCondition | null }[],
): string {
  return JSON.stringify(
    deps
      .map((dep) => ({
        taskId: dep.taskId,
        condition: dep.condition ?? null,
      }))
      .sort((left, right) => {
        if (left.taskId === right.taskId) {
          return JSON.stringify(left.condition).localeCompare(
            JSON.stringify(right.condition),
          );
        }
        return left.taskId.localeCompare(right.taskId);
      }),
  );
}

function shouldInvalidateWorkspace(
  existing: TaskRow,
  data: {
    dependsOn?: DependencyItem[];
    useWorktree?: boolean;
    branch?: string | null;
  },
): boolean {
  const currentUseWorktree = existing.use_worktree !== 0;

  if (
    data.useWorktree !== undefined &&
    data.useWorktree !== currentUseWorktree
  ) {
    return true;
  }

  if (data.branch !== undefined && data.branch !== (existing.branch ?? null)) {
    return true;
  }

  if (data.dependsOn !== undefined) {
    const currentDeps = getTaskDepsWithConditions(existing.id).map((dep) => ({
      taskId: dep.depId,
      condition: dep.condition,
    }));
    const nextDeps = normalizeDeps(data.dependsOn);
    if (
      buildDependencySignature(currentDeps) !==
      buildDependencySignature(nextDeps)
    ) {
      return true;
    }
  }

  return false;
}

function syncTaskTags(taskId: string, pipelineId: string, tagNames: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);

  if (tagNames.length === 0) return;

  const upsertTag = db.prepare(
    'INSERT OR IGNORE INTO tags (id, pipeline_id, name) VALUES (?, ?, ?)'
  );
  const insertTaskTag = db.prepare(
    'INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)'
  );

  for (const name of tagNames) {
    const tagId = `tag_${pipelineId}_${name.toLowerCase().replace(/\s+/g, '_')}`;
    upsertTag.run(tagId, pipelineId, name);
    const existing = db.prepare(
      'SELECT id FROM tags WHERE pipeline_id = ? AND name = ?'
    ).get(pipelineId, name) as { id: string };
    insertTaskTag.run(taskId, existing.id);
  }
}

/** Batch-load deps and tags for a set of tasks, then format them. */
function batchFormatTasks(tasks: TaskRow[]) {
  if (tasks.length === 0) return [];

  const db = getDb();
  const taskIds = tasks.map((t) => t.id);
  const placeholders = taskIds.map(() => '?').join(',');

  // Batch-load all deps with conditions
  const allDeps = db.prepare(
    `SELECT task_id, depends_on_task_id, condition FROM task_deps WHERE task_id IN (${placeholders})`
  ).all(...taskIds) as { task_id: string; depends_on_task_id: string; condition: string | null }[];

  const depsByTask = new Map<string, { depId: string; condition: DependencyCondition | null }[]>();
  for (const d of allDeps) {
    const list = depsByTask.get(d.task_id) ?? [];
    list.push({ depId: d.depends_on_task_id, condition: parseCondition(d.condition) });
    depsByTask.set(d.task_id, list);
  }

  // Batch-load all tags
  const allTags = db.prepare(
    `SELECT tt.task_id, t.name FROM task_tags tt JOIN tags t ON tt.tag_id = t.id WHERE tt.task_id IN (${placeholders})`
  ).all(...taskIds) as { task_id: string; name: string }[];

  const tagsByTask = new Map<string, string[]>();
  for (const row of allTags) {
    const list = tagsByTask.get(row.task_id) ?? [];
    list.push(row.name);
    tagsByTask.set(row.task_id, list);
  }

  const sourceTaskIds = [
    ...new Set(
      tasks
        .map((task) => task.source_task_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ];
  const sourceTaskMetaById = new Map<string, SourceTaskMeta>();

  if (sourceTaskIds.length > 0) {
    const sourceRows = db.prepare(
      `SELECT id, name, status, archived_at
       FROM tasks
       WHERE id IN (${sourceTaskIds.map(() => '?').join(',')})`
    ).all(...sourceTaskIds) as {
      archived_at: string | null;
      id: string;
      name: string;
      status: string;
    }[];

    for (const source of sourceRows) {
      sourceTaskMetaById.set(source.id, {
        archivedAt: source.archived_at ?? null,
        name: source.name,
        status: source.status,
      });
    }
  }

  return tasks.map((t) => {
    const depsWithConditions = depsByTask.get(t.id) ?? [];
    const depIds = depsWithConditions.map((d) => d.depId);
    const tags = tagsByTask.get(t.id) ?? [];
    return formatTask(
      t,
      depIds,
      tags,
      depsWithConditions,
      t.source_task_id ? sourceTaskMetaById.get(t.source_task_id) : undefined,
    );
  });
}

export function listTasks(pipelineId: string) {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL ORDER BY sort_order DESC').all(pipelineId) as TaskRow[];
  return batchFormatTasks(tasks);
}

export function getTask(taskId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!row) throw new AppError(404, 'Task not found');
  const sourceTaskMeta = row.source_task_id
    ? db.prepare(
      'SELECT name, status, archived_at FROM tasks WHERE id = ?'
    ).get(row.source_task_id) as {
      archived_at: string | null;
      name: string;
      status: string;
    } | undefined
    : undefined;
  return formatTask(
    row,
    getTaskDeps(row.id),
    getTaskTags(row.id),
    undefined,
    sourceTaskMeta
      ? {
          archivedAt: sourceTaskMeta.archived_at ?? null,
          name: sourceTaskMeta.name,
          status: sourceTaskMeta.status,
        }
      : undefined,
  );
}

export function createTask(pipelineId: string, data: {
  name: string;
  agentId: string;
  model: string;
  approval: string;
  stage: number;
  dependsOn: DependencyItem[];
  input: string;
  priority?: string | null;
  timeoutMs?: number;
  tags?: string[];
  useWorktree?: boolean;
  branch?: string | null;
  autoRetry?: boolean;
}) {
  const db = getDb();

  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM tasks WHERE pipeline_id = ?').get(pipelineId) as { max_order: number | null };
  const sortOrder = (maxOrder.max_order ?? -1) + 1;
  const timeoutMs = resolveTaskTimeoutMs(data.timeoutMs);
  const maxRetries = resolveMaxRetries();
  const maxIterations = resolveMaxIterations();

  const taskId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const insertTask = db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, original_input, current_input, sort_order, priority, timeout_ms, max_retries, max_iterations, created_at, use_worktree, branch, auto_retry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDep = db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id, condition) VALUES (?, ?, ?)');
  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  const normalizedDeps = normalizeDeps(data.dependsOn);

  const run = db.transaction(() => {
    insertTask.run(
      taskId,
      pipelineId,
      data.name,
      data.agentId,
      data.model,
      data.approval,
      'queued',
      data.stage,
      data.input,
      data.input,
      data.input,
      sortOrder,
      data.priority ?? null,
      timeoutMs,
      maxRetries,
      maxIterations,
      logTimestamp(),
      data.useWorktree === false ? 0 : 1,
      data.branch ?? null,
      data.autoRetry ? 1 : 0,
    );
    for (const dep of normalizedDeps) {
      insertDep.run(taskId, dep.taskId, dep.condition ? JSON.stringify(dep.condition) : null);
    }
    if (data.tags && data.tags.length > 0) {
      syncTaskTags(taskId, pipelineId, data.tags);
    }
    insertLog.run(pipelineId, logTimestamp(), 'info', `Task '${data.name}' added`);
    recalcPipelineStatus(pipelineId);
  });

  run();
  return getTask(taskId);
}

export function batchCreateTasks(
  pipelineId: string,
  tasks: {
    name: string;
    agentId: string;
    model: string;
    approval: string;
    stage: number;
    dependsOnIndices: BatchDependencyItem[];
    input: string;
    priority?: string | null;
    timeoutMs?: number;
    tags?: string[];
    useWorktree?: boolean;
    branch?: string | null;
    autoRetry?: boolean;
  }[],
) {
  const db = getDb();

  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  // Normalize batch deps and validate indices
  const normalizedBatchDeps = tasks.map((t) => normalizeBatchDeps(t.dependsOnIndices));
  for (let i = 0; i < tasks.length; i++) {
    for (const dep of normalizedBatchDeps[i]!) {
      if (dep.index < 0 || dep.index >= tasks.length) {
        throw new AppError(400, `Task[${i}] has invalid dependency index: ${dep.index}`);
      }
      if (dep.index === i) {
        throw new AppError(400, `Task[${i}] cannot depend on itself`);
      }
    }
  }

  // Topological sort validation (detect cycles)
  const visited = new Set<number>();
  const visiting = new Set<number>();
  const topoCheck = (idx: number): boolean => {
    if (visiting.has(idx)) return false; // cycle
    if (visited.has(idx)) return true;
    visiting.add(idx);
    for (const dep of normalizedBatchDeps[idx]!) {
      if (!topoCheck(dep.index)) return false;
    }
    visiting.delete(idx);
    visited.add(idx);
    return true;
  };
  for (let i = 0; i < tasks.length; i++) {
    if (!topoCheck(i)) {
      throw new AppError(400, 'Circular dependency detected in task plan');
    }
  }

  // Pre-generate all task IDs
  const maxOrder = db.prepare(
    'SELECT MAX(sort_order) as max_order FROM tasks WHERE pipeline_id = ?',
  ).get(pipelineId) as { max_order: number | null };
  let sortOrder = (maxOrder.max_order ?? -1) + 1;

  const taskIds: string[] = tasks.map(() =>
    `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );

  const maxRetries = resolveMaxRetries();
  const maxIterations = resolveMaxIterations();

  const insertTask = db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, original_input, current_input, sort_order, priority, timeout_ms, max_retries, max_iterations, created_at, use_worktree, branch, auto_retry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertDep = db.prepare(
    'INSERT INTO task_deps (task_id, depends_on_task_id, condition) VALUES (?, ?, ?)',
  );
  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)',
  );

  const now = logTimestamp();
  const run = db.transaction(() => {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const taskId = taskIds[i]!;
      const timeoutMs = resolveTaskTimeoutMs(t.timeoutMs);

      insertTask.run(
        taskId, pipelineId, t.name, t.agentId, t.model, t.approval,
        'queued', t.stage, t.input, t.input, t.input, sortOrder++, t.priority ?? null, timeoutMs,
        maxRetries, maxIterations, now,
        t.useWorktree === false ? 0 : 1, t.branch ?? null,
        t.autoRetry ? 1 : 0,
      );

      // Resolve index-based deps to real task IDs with conditions
      for (const dep of normalizedBatchDeps[i]!) {
        insertDep.run(taskId, taskIds[dep.index]!, dep.condition ? JSON.stringify(dep.condition) : null);
      }

      // Sync tags
      if (t.tags && t.tags.length > 0) {
        syncTaskTags(taskId, pipelineId, t.tags);
      }
    }

    // Propagate pipeline-level attachments to each created task
    const pipelineAttachments = getAttachmentsByTarget('pipeline', pipelineId);
    if (pipelineAttachments.length > 0) {
      const insertAtt = db.prepare(
        'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const taskId of taskIds) {
        for (const att of pipelineAttachments) {
          const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          insertAtt.run(
            attId, 'task', taskId, att.pipeline_id,
            att.filename, att.original_name, att.mime_type, att.size_bytes, now,
          );
        }
      }
    }

    insertLog.run(pipelineId, now, 'info', `Batch created ${tasks.length} tasks`);
    recalcPipelineStatus(pipelineId);
  });

  run();

  // Return all created tasks
  return taskIds.map((id) => getTask(id));
}

export function updateTask(taskId: string, data: {
  name?: string;
  agentId?: string;
  model?: string;
  approval?: string;
  stage?: number;
  input?: string;
  status?: string;
  priority?: string | null;
  timeoutMs?: number;
  tags?: string[];
  dependsOn?: DependencyItem[];
  interactiveMode?: boolean;
  useWorktree?: boolean;
  branch?: string | null;
  autoRetry?: boolean;
}) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  // Guard: prevent editing execution-critical fields while task is running
  if (existing.status === 'running') {
    const LOCKED_WHILE_RUNNING = [
      'agentId',
      'model',
      'input',
      'stage',
      'useWorktree',
      'branch',
      'dependsOn',
    ] as const;
    const attempted = LOCKED_WHILE_RUNNING.filter((f) => data[f] !== undefined);
    if (attempted.length > 0) {
      throw new AppError(409, `Cannot change ${attempted.join(', ')} while task is running`);
    }
  }

  const LOCKED_AFTER_START = [
    'useWorktree',
    'branch',
    'dependsOn',
  ] as const;
  if (!['queued', 'blocked'].includes(existing.status)) {
    const attempted = LOCKED_AFTER_START.filter((f) => data[f] !== undefined);
    if (attempted.length > 0) {
      throw new AppError(
        409,
        `Cannot change ${attempted.join(', ')} after task execution has started`,
      );
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.agentId !== undefined) { fields.push('agent_id = ?'); values.push(data.agentId); }
  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
  if (data.approval !== undefined) { fields.push('approval = ?'); values.push(data.approval); }
  if (data.stage !== undefined) { fields.push('stage = ?'); values.push(data.stage); }
  if (data.input !== undefined) {
    fields.push('input = ?', 'current_input = ?');
    values.push(data.input, data.input);
  }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
  if (data.timeoutMs !== undefined) { fields.push('timeout_ms = ?'); values.push(resolveTaskTimeoutMs(data.timeoutMs)); }
  if (data.interactiveMode !== undefined) { fields.push('interactive_mode = ?'); values.push(data.interactiveMode ? 1 : 0); }
  if (data.useWorktree !== undefined) { fields.push('use_worktree = ?'); values.push(data.useWorktree ? 1 : 0); }
  if (data.branch !== undefined) { fields.push('branch = ?'); values.push(data.branch); }
  if (data.autoRetry !== undefined) { fields.push('auto_retry = ?'); values.push(data.autoRetry ? 1 : 0); }

  const invalidateWorkspace = shouldInvalidateWorkspace(existing, data);
  if (invalidateWorkspace) {
    fields.push('worktree_path = NULL', 'worktree_status = ?');
    values.push('none');
  }

  if (fields.length > 0) {
    values.push(taskId);
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    recalcPipelineStatus(existing.pipeline_id);
  }

  if (data.tags !== undefined) {
    syncTaskTags(taskId, existing.pipeline_id, data.tags);
  }

  if (data.dependsOn !== undefined) {
    db.prepare('DELETE FROM task_deps WHERE task_id = ?').run(taskId);
    const insertDep = db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id, condition) VALUES (?, ?, ?)');
    const normalizedDeps = normalizeDeps(data.dependsOn);
    for (const dep of normalizedDeps) {
      insertDep.run(taskId, dep.taskId, dep.condition ? JSON.stringify(dep.condition) : null);
    }
  }

  return getTask(taskId);
}

export function deleteTask(taskId: string) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT
      t.pipeline_id,
      t.status,
      t.worktree_path,
      t.working_dir,
      p.working_dir AS pipeline_working_dir
    FROM tasks t
    JOIN pipelines p ON p.id = t.pipeline_id
    WHERE t.id = ?
  `).get(taskId) as {
    pipeline_id: string;
    status: string;
    worktree_path: string | null;
    working_dir: string | null;
    pipeline_working_dir: string | null;
  } | undefined;
  if (!existing) throw new AppError(404, 'Task not found');
  if (existing.status === 'running') {
    throw new AppError(409, 'Cannot delete a running task. Stop it first.');
  }

  cleanupTaskWorktreeNow({
    id: taskId,
    projectDir:
      existing.working_dir?.trim()
      || existing.pipeline_working_dir?.trim()
      || process.cwd(),
    worktreePath: existing.worktree_path,
  });

  // Clean up attachment files before CASCADE deletes the DB rows
  deleteAttachmentsByTarget('task', taskId);

  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  recalcPipelineStatus(existing.pipeline_id);
  return { deleted: true };
}

export function moveTask(taskId: string, status: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  // Guard: cannot move to an executable state if dependencies aren't satisfied
  if (status === 'running' || status === 'awaiting_approval') {
    const depCheck = checkDependenciesSatisfied(taskId);
    if (!depCheck.ok) {
      throw new AppError(400, `Cannot move to ${status} — unsatisfied dependencies: ${depCheck.pending.join(', ')}`);
    }
  }

  // If moving to completed, use cascade logic
  if (status === 'completed') {
    return completeAndCascade(taskId, existing.output ?? 'Completed manually.', existing.duration ?? '0s', existing.tokens ?? 0);
  }

  // If moving to skipped, use skip-and-cascade logic
  if (status === 'skipped') {
    return skipAndCascade(taskId);
  }

  // Reset counters when restarting a task (queued or running from a terminal state)
  const isRestart = (status === 'queued' || status === 'running') &&
    ['failed', 'rejected', 'blocked', 'completed', 'skipped'].includes(existing.status);
  if (isRestart) {
    db.prepare('UPDATE tasks SET status = ?, iteration = 0, retry_count = 0, current_run_id = NULL, output = NULL WHERE id = ?')
      .run(status, taskId);
  } else {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
  }

  recalcPipelineStatus(existing.pipeline_id);

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  insertLog.run(existing.pipeline_id, logTimestamp(), 'info', `'${existing.name}' moved to ${status}`);

  return { task: getTask(taskId), cascaded: [] as string[] };
}

/**
 * Approve an awaiting_approval task: set to running.
 */
export function approveTask(taskId: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');
  if (existing.status !== 'awaiting_approval') throw new AppError(400, 'Task is not awaiting approval');

  // Guard: all dependencies must be completed or skipped
  const depCheck = checkDependenciesSatisfied(taskId);
  if (!depCheck.ok) {
    throw new AppError(400, `Cannot approve — unsatisfied dependencies: ${depCheck.pending.join(', ')}`);
  }

  const run = db.transaction(() => {
    // Set to queued — worker pool will promote to running when capacity available
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('queued', taskId);
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(existing.pipeline_id, logTimestamp(), 'info', `'${existing.name}' approved — queued`);
    recalcPipelineStatus(existing.pipeline_id);
  });

  run();
  return getTask(taskId);
}

/**
 * Reject a task: set to rejected.
 */
export function rejectTask(taskId: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  const run = db.transaction(() => {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('rejected', taskId);
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(existing.pipeline_id, logTimestamp(), 'error', `'${existing.name}' rejected`);
    recalcPipelineStatus(existing.pipeline_id);
  });

  run();
  return getTask(taskId);
}

/**
 * Core cascade logic: check queued tasks whose deps are all done (completed/skipped),
 * evaluate conditions, and either cascade or skip them.
 * Returns cascaded and skipped task IDs.
 */
function cascadeDependents(
  pipelineId: string,
  justDoneTaskId: string,
  allTasks: TaskRow[],
  allDeps: { task_id: string; depends_on_task_id: string; condition: string | null }[],
  insertLog: { run: (...args: unknown[]) => void },
): { cascaded: string[]; skipped: string[] } {
  const cascaded: string[] = [];
  const skipped: string[] = [];
  const db = getDb();

  // Process in rounds: a skipped task may unblock further dependents
  const processed = new Set<string>();
  const doneSet = new Set([justDoneTaskId]);

  // Seed doneSet with all already-completed/skipped tasks
  for (const t of allTasks) {
    if (t.status === 'completed' || t.status === 'skipped') doneSet.add(t.id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const task of allTasks) {
      if (task.status !== 'queued' || processed.has(task.id)) continue;

      const taskDeps = allDeps.filter((d) => d.task_id === task.id);
      if (taskDeps.length === 0) continue;
      if (!taskDeps.some((d) => doneSet.has(d.depends_on_task_id))) continue;

      // Check if ALL dependencies are done (completed or skipped)
      const allDepsDone = taskDeps.every((d) => doneSet.has(d.depends_on_task_id));
      if (!allDepsDone) continue;

      // All deps done — evaluate conditions
      const conditionsMet = taskDeps.every((d) => {
        const cond = parseCondition(d.condition);
        if (!cond) return true; // no condition = unconditional
        const depTask = allTasks.find((t) => t.id === d.depends_on_task_id);
        return evaluateCondition(cond, depTask?.output ?? null, depTask?.status ?? '');
      });

      processed.add(task.id);

      if (!conditionsMet) {
        // Skip this task — conditions not met
        db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('skipped', task.id);
        task.status = 'skipped'; // M2: update in-memory status for downstream condition checks
        doneSet.add(task.id);
        skipped.push(task.id);
        insertLog.run(pipelineId, logTimestamp(), 'info', `'${task.name}' skipped — condition not met`);
        changed = true; // a skip may unblock further dependents
      } else {
        // Normal cascade — auto/on_error stay queued (worker pool promotes to running)
        const newStatus = (task.approval === 'auto' || task.approval === 'on_error') ? 'queued' : 'awaiting_approval';
        db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(newStatus, task.id);
        task.status = newStatus; // M2: keep in-memory consistent
        cascaded.push(task.id);
        const statusLabel = (task.approval === 'auto' || task.approval === 'on_error') ? 'queued (ready)' : 'awaiting approval';
        insertLog.run(pipelineId, logTimestamp(), 'info', `'${task.name}' → ${statusLabel}`);
      }
    }
  }

  return { cascaded, skipped };
}

export function completeAndCascade(taskId: string, output: string, duration: string, tokens: number) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  let cascaded: string[] = [];

  const run = db.transaction(() => {
    // 0. Handle pending_requeue: task was running when a new dep was injected.
    if (existing.status === 'pending_requeue') {
      db.prepare('UPDATE tasks SET status = ?, output = ?, duration = ?, tokens = ?, iteration = 0, retry_count = 0, current_run_id = NULL WHERE id = ?')
        .run('queued', output, duration, tokens, taskId);
      const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
      insertLog.run(existing.pipeline_id, logTimestamp(), 'info', `'${existing.name}' re-queued — new dependency was added while running`);
      recalcPipelineStatus(existing.pipeline_id);
      return;
    }

    // 1. Mark task as completed
    db.prepare('UPDATE tasks SET status = ?, output = ?, duration = ?, tokens = ? WHERE id = ?')
      .run('completed', output, duration, tokens, taskId);

    // 2. Write output to pipeline context
    db.prepare('INSERT OR REPLACE INTO pipeline_ctx (pipeline_id, key, value, set_by_task_id) VALUES (?, ?, ?, ?)')
      .run(existing.pipeline_id, `task_output:${existing.name}`, output, taskId);

    // 3. Cascade: find queued tasks whose deps are all done, evaluate conditions
    const allTasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL').all(existing.pipeline_id) as TaskRow[];
    const allDeps = db.prepare(
      `SELECT task_id, depends_on_task_id, condition FROM task_deps WHERE task_id IN (${allTasks.map(() => '?').join(',')})`
    ).all(...allTasks.map((t) => t.id)) as { task_id: string; depends_on_task_id: string; condition: string | null }[];

    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(existing.pipeline_id, logTimestamp(), 'success', `'${existing.name}' completed — ${tokens} tokens`);

    const result = cascadeDependents(existing.pipeline_id, taskId, allTasks, allDeps, insertLog);
    cascaded = result.cascaded;

    // 4. Recalc pipeline status
    recalcPipelineStatus(existing.pipeline_id);
  });

  run();
  return { task: getTask(taskId), cascaded };
}

/**
 * Skip a task manually and cascade to its dependents.
 */
export function skipAndCascade(taskId: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  let cascaded: string[] = [];

  const run = db.transaction(() => {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('skipped', taskId);

    const allTasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL').all(existing.pipeline_id) as TaskRow[];
    const allDeps = db.prepare(
      `SELECT task_id, depends_on_task_id, condition FROM task_deps WHERE task_id IN (${allTasks.map(() => '?').join(',')})`
    ).all(...allTasks.map((t) => t.id)) as { task_id: string; depends_on_task_id: string; condition: string | null }[];

    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(existing.pipeline_id, logTimestamp(), 'info', `'${existing.name}' skipped`);

    const result = cascadeDependents(existing.pipeline_id, taskId, allTasks, allDeps, insertLog);
    cascaded = result.cascaded;

    recalcPipelineStatus(existing.pipeline_id);
  });

  run();
  return { task: getTask(taskId), cascaded };
}

/**
 * Archive a task — hides it from the board but keeps data intact.
 */
export function archiveTask(taskId: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');
  if (existing.status === 'running') throw new AppError(400, 'Cannot archive a running task');

  const now = logTimestamp();
  db.prepare('UPDATE tasks SET archived_at = ? WHERE id = ?').run(now, taskId);

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  insertLog.run(existing.pipeline_id, now, 'info', `'${existing.name}' archived`);
  archiveInheritedFollowUpsForParent(taskId, 'archived_with_parent', now);

  return getTask(taskId);
}

/**
 * Unarchive a task — restores it to the board.
 */
export function unarchiveTask(taskId: string) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!existing) throw new AppError(404, 'Task not found');

  db.prepare('UPDATE tasks SET archived_at = NULL WHERE id = ?').run(taskId);

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  insertLog.run(existing.pipeline_id, logTimestamp(), 'info', `'${existing.name}' restored from archive`);

  recalcPipelineStatus(existing.pipeline_id);
  return getTask(taskId);
}

/**
 * List archived tasks for a pipeline.
 */
export function listArchivedTasks(pipelineId: string) {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC').all(pipelineId) as TaskRow[];
  return batchFormatTasks(tasks);
}

/**
 * Archive all completed/failed/rejected tasks in a pipeline.
 */
export function archiveAllDone(pipelineId: string) {
  const db = getDb();
  const now = logTimestamp();
  const archivedParents = db.prepare(
    "SELECT id FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL AND status IN ('completed', 'failed', 'rejected')"
  ).all(pipelineId) as { id: string }[];
  const result = db.prepare(
    "UPDATE tasks SET archived_at = ? WHERE pipeline_id = ? AND archived_at IS NULL AND status IN ('completed', 'failed', 'rejected')"
  ).run(now, pipelineId);

  if (result.changes > 0) {
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(pipelineId, now, 'info', `Archived ${result.changes} completed/failed tasks`);
    for (const parent of archivedParents) {
      archiveInheritedFollowUpsForParent(parent.id, 'archived_with_parent', now);
    }
  }

  return { archived: result.changes };
}

export { archiveInheritedFollowUpsForParent };
