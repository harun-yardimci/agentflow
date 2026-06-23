import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { deleteByPipeline as deleteAttachmentsByPipeline } from './attachment-service.js';
import { cleanupTaskWorktreeNow } from '../engine/worktree-cleanup-service.js';

interface PipelineRow {
  id: string;
  name: string;
  status: string;
  created: string;
  context_data: string;
  description: string;
  rules: string;
  enabled_agents: string;
  working_dir: string;
  git_branch: string | null;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  color: string;
  max_parallel: number;
}

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
  output: string | null;
  tokens: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  duration: string | null;
  sort_order: number;
  priority: string | null;
  timeout_ms: number;
  created_at?: string;
  task_type?: string;
  source_task_id?: string | null;
  stage_id?: string | null;
  interactive_mode?: number;
  worktree_path?: string | null;
  worktree_status?: string | null;
  user_note?: string | null;
  use_worktree?: number;
  branch?: string | null;
  archived_at?: string | null;
}

interface SourceTaskMeta {
  archivedAt: string | null;
  name: string | null;
  status: string | null;
}

interface LogRow {
  id: number;
  pipeline_id: string;
  time: string;
  type: string;
  msg: string;
}

function requireWorkingDir(workingDir: string | undefined): string {
  const normalized = workingDir?.trim();
  if (!normalized) {
    throw new AppError(400, 'Working directory is required');
  }
  return normalized;
}

function computePipelineStatus(tasks: TaskRow[]): string {
  if (tasks.length === 0) return 'queued';
  if (tasks.every((t) => t.status === 'completed' || t.status === 'skipped')) return 'completed';
  if (tasks.some((t) => t.status === 'running' || t.status === 'awaiting_approval')) return 'running';
  // `auth_required` surfaces as blocked: the pipeline is stalled on a human
  // re-login (provider session expired), not an external clock like rate limit.
  if (tasks.some((t) => t.status === 'blocked' || t.status === 'failed' || t.status === 'rejected' || t.status === 'auth_required')) return 'blocked';
  // `rate_limited` intentionally falls through to 'queued': the pipeline is
  // waiting on an external clock (provider reset window), not actively
  // running and not user-blocked. Task-level pill still surfaces the state.
  return 'queued';
}

function computeTokensByModel(taskIds: string[]): Record<string, number> {
  if (taskIds.length === 0) return {};
  const db = getDb();
  const rows = db.prepare(
    `SELECT COALESCE(model_used, 'claude') as model, SUM(tokens_used) as total
     FROM execution_runs
     WHERE task_id IN (${taskIds.map(() => '?').join(',')})
     GROUP BY model`
  ).all(...taskIds) as { model: string; total: number }[];
  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.model] = r.total;
  }
  return result;
}

function computePendingQuestions(taskIds: string[]): Map<string, number> {
  if (taskIds.length === 0) return new Map();
  const db = getDb();
  const rows = db.prepare(
    `SELECT task_id, COUNT(*) as cnt FROM control_requests
     WHERE task_id IN (${taskIds.map(() => '?').join(',')}) AND status = 'pending'
     GROUP BY task_id`
  ).all(...taskIds) as { task_id: string; cnt: number }[];
  return new Map(rows.map((r) => [r.task_id, r.cnt]));
}

function formatPipeline(row: PipelineRow, tasks: TaskRow[], deps: { task_id: string; depends_on_task_id: string }[], logs: LogRow[], taskTags: { task_id: string; name: string }[], stages: StageRow[]) {
  const taskIds = tasks.map((t) => t.id);
  const tokensByModel = computeTokensByModel(taskIds);
  const totalTokensUsed = Object.values(tokensByModel).reduce((s, v) => s + v, 0);
  const totalCostUsd = tasks.reduce((sum, task) => sum + (task.cost_usd ?? 0), 0);
  const pendingQuestions = computePendingQuestions(taskIds);
  const db = getDb();

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

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    created: row.created,
    description: row.description ?? '',
    rules: row.rules ?? '',
    enabledAgents: JSON.parse(row.enabled_agents || '[]') as string[],
    workingDir: row.working_dir,
    gitBranch: row.git_branch ?? null,
    totalTokensUsed,
    totalCostUsd,
    tokensByModel,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sort_order,
      color: s.color,
      maxParallel: s.max_parallel,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      agentId: t.agent_id,
      model: t.model,
      approval: t.approval,
      status: t.status,
      stage: t.stage,
      dependsOn: deps.filter((d) => d.task_id === t.id).map((d) => d.depends_on_task_id),
      input: t.input,
      output: t.output,
      tokens: t.tokens,
      inputTokens: t.input_tokens ?? null,
      outputTokens: t.output_tokens ?? null,
      costUsd: t.cost_usd ?? null,
      duration: t.duration,
      priority: t.priority ?? null,
      timeoutMs: t.timeout_ms,
      tags: taskTags.filter((tt) => tt.task_id === t.id).map((tt) => tt.name),
      taskType: t.task_type ?? 'seeded',
      sourceTaskId: t.source_task_id ?? null,
      sourceTaskName: t.source_task_id
        ? sourceTaskMetaById.get(t.source_task_id)?.name ?? null
        : null,
      sourceTaskStatus: t.source_task_id
        ? sourceTaskMetaById.get(t.source_task_id)?.status ?? null
        : null,
      sourceTaskArchivedAt: t.source_task_id
        ? sourceTaskMetaById.get(t.source_task_id)?.archivedAt ?? null
        : null,
      stageId: t.stage_id ?? null,
      createdAt: t.created_at || null,
      worktreePath: t.worktree_path ?? null,
      worktreeStatus: t.worktree_status ?? null,
      interactiveMode: t.interactive_mode === 1,
      pendingQuestions: pendingQuestions.get(t.id) ?? 0,
      userNote: t.user_note ?? '',
      useWorktree: t.use_worktree !== 0,
      branch: t.branch ?? null,
      archivedAt: t.archived_at ?? null,
    })),
    logs: logs.map((l) => ({
      id: l.id,
      time: l.time,
      type: l.type,
      msg: l.msg,
    })),
  };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function getDefaultTaskTimeoutMs(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'default_task_timeout_ms'"
  ).get() as { value: string } | undefined;
  return parsePositiveInt(row?.value) ?? 1_800_000;
}

export function listPipelines() {
  const db = getDb();
  const pipelines = db.prepare('SELECT * FROM pipelines ORDER BY created DESC').all() as PipelineRow[];

  return pipelines.map((p) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL ORDER BY sort_order DESC').all(p.id) as TaskRow[];
    const taskIds = tasks.map((t) => t.id);
    const deps = taskIds.length > 0
      ? db.prepare(`SELECT * FROM task_deps WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds) as { task_id: string; depends_on_task_id: string }[]
      : [];
    const taskTags = taskIds.length > 0
      ? db.prepare(`SELECT tt.task_id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds) as { task_id: string; name: string }[]
      : [];
    // Skip logs and large text fields in list view — loaded on demand
    const stages = db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order').all(p.id) as StageRow[];
    return formatPipeline(p, tasks, deps, [], taskTags, stages);
  });
}

export function getPipeline(id: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as PipelineRow | undefined;
  if (!row) throw new AppError(404, 'Pipeline not found');

  const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL ORDER BY sort_order DESC').all(id) as TaskRow[];
  const taskIds = tasks.map((t) => t.id);
  const deps = taskIds.length > 0
    ? db.prepare(`SELECT * FROM task_deps WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds) as { task_id: string; depends_on_task_id: string }[]
    : [];
  const taskTags = taskIds.length > 0
    ? db.prepare(`SELECT tt.task_id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds) as { task_id: string; name: string }[]
    : [];
  const logs = db.prepare('SELECT * FROM logs WHERE pipeline_id = ? ORDER BY id').all(id) as LogRow[];
  const stages = db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order').all(id) as StageRow[];
  return formatPipeline(row, tasks, deps, logs, taskTags, stages);
}

export function createPipeline(data: {
  name: string;
  description?: string;
  rules?: string;
  enabledAgents?: string[];
  workingDir: string;
  gitBranch?: string | null;
  stages?: { name: string; sortOrder: number; color?: string; maxParallel?: number }[];
  tasks?: { name: string; agentId: string; model: string; approval: string; stage: number; dependsOn: string[]; input: string }[];
}) {
  const db = getDb();
  const workingDir = requireWorkingDir(data.workingDir);
  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const created = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const insertPipeline = db.prepare('INSERT INTO pipelines (id, name, status, created, description, rules, enabled_agents, working_dir, git_branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTask = db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order, timeout_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDep = db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)');
  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  const insertStage = db.prepare('INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order, color, max_parallel) VALUES (?, ?, ?, ?, ?, ?)');

  const run = db.transaction(() => {
    insertPipeline.run(
      id, data.name, 'queued', created,
      data.description ?? '', data.rules ?? '',
      JSON.stringify(data.enabledAgents ?? []),
      workingDir,
      data.gitBranch?.trim() || null,
    );
    insertLog.run(id, logTimestamp(), 'info', 'Pipeline initialized');

    // Create stages
    if (data.stages) {
      for (const stage of data.stages) {
        const stageId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        insertStage.run(stageId, id, stage.name, stage.sortOrder, stage.color ?? '#9CA3AF', stage.maxParallel ?? 0);
      }
    }

    if (data.tasks) {
      const defaultTimeoutMs = getDefaultTaskTimeoutMs();
      const backendIds: string[] = [];
      // Build a map from frontend-generated dependsOn refs to array indices
      // Frontend sends tasks with dependsOn containing references (IDs or names)
      // that correspond to other tasks in this same array
      const refToIndex = new Map<string, number>();

      for (let i = 0; i < data.tasks.length; i++) {
        const t = data.tasks[i]!;
        const taskId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
        backendIds.push(taskId);
        insertTask.run(
          taskId,
          id,
          t.name,
          t.agentId,
          t.model,
          t.approval,
          'queued',
          t.stage,
          t.input,
          i,
          defaultTimeoutMs,
          logTimestamp(),
        );
        // Index by name so dependsOn can reference by task name
        refToIndex.set(t.name, i);
      }

      // Wire dependencies: resolve dependsOn refs to backend IDs
      for (let i = 0; i < data.tasks.length; i++) {
        const t = data.tasks[i]!;
        const taskId = backendIds[i]!;
        for (const depRef of t.dependsOn) {
          // Try: direct backend ID match (for tasks already in DB)
          const directIdx = backendIds.indexOf(depRef);
          if (directIdx !== -1) {
            insertDep.run(taskId, backendIds[directIdx]!);
            continue;
          }
          // Try: match by name
          const nameIdx = refToIndex.get(depRef);
          if (nameIdx !== undefined && backendIds[nameIdx]) {
            insertDep.run(taskId, backendIds[nameIdx]!);
            continue;
          }
          // Try: numeric index (e.g., "0", "1")
          const numIdx = parseInt(depRef, 10);
          if (!isNaN(numIdx) && numIdx >= 0 && numIdx < backendIds.length) {
            insertDep.run(taskId, backendIds[numIdx]!);
            continue;
          }
          // Last resort: check if any task in the batch was generated with
          // a frontend ID that matches (frontend IDs follow patterns like "t_xxx")
          // Find which index position the depRef task occupies by sequential match
          // This handles the case where frontend generates IDs and uses them in dependsOn
          // Since tasks are in order and each depends on previous, index i depends on i-1
          // Skip unresolvable refs silently
        }
      }
    }
  });

  run();
  return getPipeline(id);
}

export function updatePipeline(id: string, data: { name?: string; status?: string; description?: string; rules?: string; enabledAgents?: string[]; workingDir?: string; gitBranch?: string | null }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(id);
  if (!existing) throw new AppError(404, 'Pipeline not found');

  if (data.name !== undefined) {
    db.prepare('UPDATE pipelines SET name = ? WHERE id = ?').run(data.name, id);
  }
  if (data.status !== undefined) {
    db.prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(data.status, id);
  }
  if (data.description !== undefined) {
    db.prepare('UPDATE pipelines SET description = ? WHERE id = ?').run(data.description, id);
  }
  if (data.rules !== undefined) {
    db.prepare('UPDATE pipelines SET rules = ? WHERE id = ?').run(data.rules, id);
  }
  if (data.enabledAgents !== undefined) {
    db.prepare('UPDATE pipelines SET enabled_agents = ? WHERE id = ?').run(JSON.stringify(data.enabledAgents), id);
  }
  if (data.workingDir !== undefined) {
    db.prepare('UPDATE pipelines SET working_dir = ? WHERE id = ?')
      .run(requireWorkingDir(data.workingDir), id);
  }
  if (data.gitBranch !== undefined) {
    db.prepare('UPDATE pipelines SET git_branch = ? WHERE id = ?')
      .run(data.gitBranch?.trim() || null, id);
  }

  return getPipeline(id);
}

export function deletePipeline(id: string) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id, working_dir FROM pipelines WHERE id = ?',
  ).get(id) as { id: string; working_dir: string } | undefined;
  if (!existing) throw new AppError(404, 'Pipeline not found');

  const tasks = db.prepare(
    'SELECT id, status, worktree_path, working_dir FROM tasks WHERE pipeline_id = ?',
  ).all(id) as Array<{
    id: string;
    status: string;
    worktree_path: string | null;
    working_dir: string | null;
  }>;

  const runningTask = tasks.find((task) => task.status === 'running');
  if (runningTask) {
    throw new AppError(
      409,
      `Cannot delete pipeline while task '${runningTask.id}' is running. Stop it first.`,
    );
  }

  for (const task of tasks) {
    cleanupTaskWorktreeNow({
      id: task.id,
      projectDir:
        task.working_dir?.trim()
        || existing.working_dir?.trim()
        || process.cwd(),
      worktreePath: task.worktree_path,
    });
  }

  // Clean up attachment files before CASCADE deletes the DB rows
  deleteAttachmentsByPipeline(id);

  db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  return { deleted: true };
}

export function recalcPipelineStatus(pipelineId: string) {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? AND archived_at IS NULL').all(pipelineId) as TaskRow[];
  const newStatus = computePipelineStatus(tasks);
  db.prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(newStatus, pipelineId);
}

// ─── Stage CRUD ───

export function listStages(pipelineId: string) {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const stages = db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order').all(pipelineId) as StageRow[];
  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sort_order,
    color: s.color,
    maxParallel: s.max_parallel,
  }));
}

export function createStage(pipelineId: string, data: { name: string; sortOrder: number; color?: string; maxParallel?: number }) {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order, color, max_parallel) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, pipelineId, data.name, data.sortOrder, data.color ?? '#9CA3AF', data.maxParallel ?? 0);

  return { id, name: data.name, sortOrder: data.sortOrder, color: data.color ?? '#9CA3AF', maxParallel: data.maxParallel ?? 0 };
}

export function updateStage(pipelineId: string, stageId: string, data: { name?: string; sortOrder?: number; color?: string; maxParallel?: number }) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND pipeline_id = ?').get(stageId, pipelineId) as StageRow | undefined;
  if (!existing) throw new AppError(404, 'Stage not found');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(data.sortOrder); }
  if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
  if (data.maxParallel !== undefined) { fields.push('max_parallel = ?'); values.push(data.maxParallel); }

  if (fields.length > 0) {
    values.push(stageId);
    db.prepare(`UPDATE pipeline_stages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(stageId) as StageRow;
  return { id: updated.id, name: updated.name, sortOrder: updated.sort_order, color: updated.color, maxParallel: updated.max_parallel };
}

export function deleteStage(pipelineId: string, stageId: string) {
  const db = getDb();
  const result = db.prepare('DELETE FROM pipeline_stages WHERE id = ? AND pipeline_id = ?').run(stageId, pipelineId);
  if (result.changes === 0) throw new AppError(404, 'Stage not found');
  return { deleted: true };
}
