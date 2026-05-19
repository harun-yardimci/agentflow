import { getDb } from '../db/connection.js';
import { recalcPipelineStatus } from '../services/pipeline-service.js';
import { checkDependenciesSatisfied } from '../services/task-service.js';
import {
  closeActiveCycles,
  queuePendingFollowUp,
} from '../services/task-cycle-service.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { eventBus } from './event-bus.js';
import { workerPool } from './worker-pool.js';
import { runTask } from './task-runner.js';
import { evaluateCondition, parseCondition } from '../services/condition-evaluator.js';
import { getProviderKey } from '../lib/provider-utils.js';

interface TaskRow {
  id: string;
  pipeline_id: string;
  name: string;
  agent_id: string;
  model: string;
  approval: string;
  status: string;
  stage: number;
  output: string | null;
}

/** Start a pipeline: enqueue all ready tasks (stage 0 or deps all done) */
export function startPipeline(pipelineId: string): { started: string[]; pending: string[]; blocked?: string } {
  const db = getDb();
  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId) as { id: string; name: string; status: string } | undefined;
  if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

  const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ? ORDER BY stage, sort_order').all(pipelineId) as TaskRow[];
  const allDeps = db.prepare(
    `SELECT task_id, depends_on_task_id, condition FROM task_deps WHERE task_id IN (${tasks.map(() => '?').join(',') || "''"})`)
    .all(...tasks.map((t) => t.id)) as { task_id: string; depends_on_task_id: string; condition: string | null }[];

  const started: string[] = [];
  const pending: string[] = [];
  const skippedIds: string[] = [];

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  const run = db.transaction(() => {
    // Process in rounds to handle cascading skips
    let changed = true;
    const processed = new Set<string>();

    while (changed) {
      changed = false;
      for (const task of tasks) {
        // Handle pending_requeue on first pass only
        if (!processed.has('__requeue_' + task.id) && task.status === 'pending_requeue') {
          db.prepare('UPDATE tasks SET status = ?, iteration = 0, retry_count = 0, current_run_id = NULL WHERE id = ?')
            .run('queued', task.id);
          task.status = 'queued';
          processed.add('__requeue_' + task.id);
          insertLog.run(pipelineId, logTimestamp(), 'info',
            `'${task.name}' recovered from pending_requeue → queued`);
        }

        if (task.status !== 'queued' || processed.has(task.id)) continue;

        const taskDeps = allDeps.filter((d) => d.task_id === task.id);

        // Check if all dependencies are done (completed or skipped)
        const allDepsDone = taskDeps.length === 0 || taskDeps.every((d) => {
          const depTask = tasks.find((t) => t.id === d.depends_on_task_id);
          return depTask?.status === 'completed' || depTask?.status === 'skipped';
        });

        if (!allDepsDone) continue;

        // Evaluate conditions
        const conditionsMet = taskDeps.every((d) => {
          const cond = parseCondition(d.condition);
          if (!cond) return true;
          const depTask = tasks.find((t) => t.id === d.depends_on_task_id);
          return evaluateCondition(cond, depTask?.output ?? null, depTask?.status ?? '');
        });

        processed.add(task.id);

        if (!conditionsMet) {
          // Skip — conditions not met
          db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('skipped', task.id);
          task.status = 'skipped';
          skippedIds.push(task.id);
          insertLog.run(pipelineId, logTimestamp(), 'info',
            `'${task.name}' skipped — condition not met`);
          changed = true;
          continue;
        }

        // Task is ready to run — keep as queued, worker pool will start it
        if (task.approval === 'auto' || task.approval === 'on_error') {
          // task is already 'queued' in DB — no status update needed
          started.push(task.id);
          insertLog.run(pipelineId, logTimestamp(), 'info',
            `'${task.name}' → queued (ready)`);
        } else {
          db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('awaiting_approval', task.id);
          task.status = 'awaiting_approval';
          pending.push(task.id);
          insertLog.run(pipelineId, logTimestamp(), 'warning',
            `'${task.name}' → awaiting approval`);

          eventBus.emit('task:approval_needed', {
            taskId: task.id, pipelineId, taskName: task.name, status: 'awaiting_approval',
          });
        }
      }
    }

    recalcPipelineStatus(pipelineId);

    if (started.length > 0 || pending.length > 0) {
      insertLog.run(pipelineId, logTimestamp(), 'info', 'Pipeline started');
      eventBus.emit('pipeline:started', {
        pipelineId, pipelineName: pipeline.name, status: 'running',
      });
    }
  });

  run();

  // Enqueue started tasks into worker pool (outside transaction)
  for (const taskId of started) {
    const task = tasks.find((t) => t.id === taskId);
    workerPool.enqueue({
      taskId,
      pipelineId,
      taskName: task?.name ?? taskId,
      execute: () => runTask(taskId),
    });
  }

  // Pipeline has dispatched tasks — mark as running explicitly
  // (recalcPipelineStatus inside the transaction saw them as 'queued')
  if (started.length > 0) {
    db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(pipelineId);
  }

  // Build a reason when nothing could start
  let blocked: string | undefined;
  if (started.length === 0 && pending.length === 0) {
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    const runningTasks = tasks.filter((t) => t.status === 'running');
    const allCompleted = tasks.every((t) => t.status === 'completed' || t.status === 'skipped');

    if (allCompleted) {
      blocked = 'All tasks already completed.';
    } else if (failedTasks.length > 0) {
      const names = failedTasks.map((t) => t.name).join(', ');
      blocked = `${failedTasks.length} failed task(s) blocking the pipeline: ${names}. Retry them to continue.`;
    } else if (runningTasks.length > 0) {
      blocked = `${runningTasks.length} task(s) already running.`;
    } else {
      const queuedWithBlockedDeps = tasks.filter((t) => t.status === 'queued');
      if (queuedWithBlockedDeps.length > 0) {
        blocked = `${queuedWithBlockedDeps.length} queued task(s) waiting on incomplete dependencies.`;
      }
    }
  }

  return { started, pending, blocked };
}

/** Pause a pipeline: abort running tasks, reset to todo */
export function pausePipeline(pipelineId: string): number {
  const db = getDb();
  const tasks = db.prepare("SELECT * FROM tasks WHERE pipeline_id = ? AND status IN ('running', 'awaiting_approval')").all(pipelineId) as TaskRow[];

  // Abort all running tasks in worker pool
  workerPool.abortPipeline(pipelineId);

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  const run = db.transaction(() => {
    for (const task of tasks) {
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('queued', task.id);
      insertLog.run(pipelineId, logTimestamp(), 'info',
        `'${task.name}' paused → queued`);
    }
    db.prepare('UPDATE pipelines SET status = ? WHERE id = ?').run('paused', pipelineId);
    insertLog.run(pipelineId, logTimestamp(), 'warning', 'Pipeline paused');
  });

  run();
  return tasks.length;
}

/** Resume an approved task: enqueue it for execution */
export function resumeTask(taskId: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (task.status !== 'running' && task.status !== 'queued') {
    throw new Error(`Task ${taskId} is not in a resumable state (current: ${task.status})`);
  }

  workerPool.enqueue({
    taskId,
    pipelineId: task.pipeline_id,
    taskName: task.name,
    execute: () => runTask(taskId),
  });
}

/** Start a single queued task independently of pipeline run */
export function startSingleTask(
  taskId: string,
): { started: boolean; blocked?: string } {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const startableStates = new Set(['queued', 'blocked', 'failed', 'rejected']);
  if (!startableStates.has(task.status)) {
    throw new Error(`Task ${taskId} cannot be started (current: ${task.status})`);
  }

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  // If dependencies aren't ready, queue the task so cascade picks it up later
  const depCheck = checkDependenciesSatisfied(taskId);
  if (!depCheck.ok) {
    db.prepare(
      'UPDATE tasks SET status = ?, iteration = 0, retry_count = 0, current_run_id = NULL, resume_at = NULL WHERE id = ?'
    ).run('queued', taskId);

    insertLog.run(task.pipeline_id, logTimestamp(), 'info',
      `'${task.name}' queued — waiting on: ${depCheck.pending.join(', ')}`);

    recalcPipelineStatus(task.pipeline_id);
    return {
      started: false,
      blocked: `Waiting on dependencies: ${depCheck.pending.join(', ')}`,
    };
  }

  db.prepare(
    'UPDATE tasks SET status = ?, iteration = 0, retry_count = 0, current_run_id = NULL WHERE id = ?'
  ).run('queued', taskId);

  insertLog.run(task.pipeline_id, logTimestamp(), 'info',
    `'${task.name}' started individually`);

  recalcPipelineStatus(task.pipeline_id);

  workerPool.enqueue({
    taskId,
    pipelineId: task.pipeline_id,
    taskName: task.name,
    execute: () => runTask(taskId),
  });

  // Ensure pipeline shows as running
  db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(task.pipeline_id);
  return { started: true };
}

/** Restart a task fresh — clears session history so it starts from scratch with potentially new model */
export function restartTaskFresh(taskId: string, model?: string, followUpPrompt?: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as (TaskRow & { iteration: number; max_iterations: number }) | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const restartableStates = new Set(['blocked', 'failed', 'rejected', 'completed', 'queued']);
  if (!restartableStates.has(task.status)) {
    throw new Error(`Task ${taskId} cannot be restarted (current: ${task.status})`);
  }

  // Guard: all dependencies must be completed or skipped
  const depCheck = checkDependenciesSatisfied(taskId);
  if (!depCheck.ok) {
    throw new Error(`Cannot restart '${task.name}' — unsatisfied dependencies: ${depCheck.pending.join(', ')}`);
  }

  // Clear all execution runs' session_ids so runTask won't resume
  db.prepare(
    'UPDATE execution_runs SET session_id = NULL WHERE task_id = ?'
  ).run(taskId);
  try {
    db.prepare(
      'UPDATE execution_runs SET provider_session_id = NULL WHERE task_id = ?'
    ).run(taskId);
  } catch {
    // Older schemas may not have the column yet during migration windows.
  }
  closeActiveCycles(taskId, followUpPrompt?.trim() || 'restart_fresh');

  // Reset task state — keep as queued, worker pool will promote to running
  const updates: string[] = [
    'status = ?', 'iteration = 0', 'retry_count = 0', 'current_run_id = NULL',
    'output = NULL', 'tokens = NULL', 'duration = NULL',
    'worktree_path = NULL', 'worktree_status = \'none\'',
  ];
  const values: unknown[] = ['queued'];

  if (model) {
    updates.push('model = ?');
    values.push(model);
  }

  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  if (followUpPrompt?.trim()) {
    queuePendingFollowUp({
      taskId,
      content: followUpPrompt,
      agentId: task.agent_id,
      modelUsed: model ?? task.model,
      provider: getProviderKey(model ?? task.model),
    });
  }

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  insertLog.run(task.pipeline_id, logTimestamp(), 'info',
    `'${task.name}' restarted fresh${model ? ` with model ${model}` : ''}`);

  recalcPipelineStatus(task.pipeline_id);

  workerPool.enqueue({
    taskId,
    pipelineId: task.pipeline_id,
    taskName: task.name,
    execute: () => runTask(taskId, followUpPrompt),
  });

  // Ensure pipeline shows as running
  db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(task.pipeline_id);
}

/** Retry a failed/blocked task with optional user note */
export function retryTask(taskId: string, followUpPrompt?: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as (TaskRow & { iteration: number; max_iterations: number }) | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const retryableStates = new Set(['blocked', 'failed', 'rejected', 'completed', 'rate_limited']);
  if (!retryableStates.has(task.status)) {
    throw new Error(`Task ${taskId} is not in a retryable state (current: ${task.status})`);
  }

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  // If dependencies aren't ready, queue the task so cascade picks it up later
  const depCheck = checkDependenciesSatisfied(taskId);
  if (!depCheck.ok) {
    db.prepare(
      'UPDATE tasks SET status = ?, iteration = 0, retry_count = 0, current_run_id = NULL, resume_at = NULL WHERE id = ?'
    ).run('queued', taskId);

    if (followUpPrompt?.trim()) {
      queuePendingFollowUp({
        taskId,
        content: followUpPrompt,
        agentId: task.agent_id,
        modelUsed: task.model,
        provider: getProviderKey(task.model),
      });
    }

    insertLog.run(task.pipeline_id, logTimestamp(), 'info',
      `'${task.name}' queued for retry — waiting on: ${depCheck.pending.join(', ')}`);

    recalcPipelineStatus(task.pipeline_id);
    return;
  }

  // User-initiated retry always resets counters so it can proceed
  // Keep as queued — worker pool will promote to running when capacity available
  const updates: string[] = ['status = ?'];
  const values: unknown[] = ['queued'];

  // Reset iteration/retry counters and clear stale output
  updates.push('iteration = 0', 'retry_count = 0', 'current_run_id = NULL', 'resume_at = NULL');
  if (task.status === 'completed') {
    updates.push('output = NULL', 'tokens = NULL', 'duration = NULL');
  }

  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  if (followUpPrompt?.trim()) {
    queuePendingFollowUp({
      taskId,
      content: followUpPrompt,
      agentId: task.agent_id,
      modelUsed: task.model,
      provider: getProviderKey(task.model),
    });
  }

  insertLog.run(task.pipeline_id, logTimestamp(), 'info',
    `'${task.name}' retry #${task.iteration + 1}${followUpPrompt ? ' with guidance' : ''}`);

  recalcPipelineStatus(task.pipeline_id);

  // Pass followUpPrompt directly to runTask — don't store on task.user_note
  workerPool.enqueue({
    taskId,
    pipelineId: task.pipeline_id,
    taskName: task.name,
    execute: () => runTask(taskId, followUpPrompt),
  });

  // Ensure pipeline shows as running
  db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(task.pipeline_id);
}

/** Abort a specific running task */
export function abortTask(taskId: string): boolean {
  const db = getDb();
  const aborted = workerPool.abort(taskId);

  if (aborted) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
    if (task) {
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('blocked', taskId);

      const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
      insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
        `'${task.name}' aborted by user`);

      recalcPipelineStatus(task.pipeline_id);

      eventBus.emit('task:blocked', {
        taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'blocked',
        reason: 'Aborted by user',
      });
    }
  }

  return aborted;
}

/** Orphan recovery: reset running tasks on startup, then re-enqueue ready ones */
export function recoverOrphans(): number {
  const db = getDb();
  const orphans = db.prepare("SELECT * FROM tasks WHERE status IN ('running', 'pending_requeue')").all() as TaskRow[];

  if (orphans.length === 0) return 0;

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');

  const affectedPipelines = [...new Set(orphans.map((t) => t.pipeline_id))];

  const run = db.transaction(() => {
    for (const task of orphans) {
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('queued', task.id);
      insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
        `'${task.name}' recovered from orphan running state → queued`);

      // Also mark any running execution_runs as failed
      db.prepare("UPDATE execution_runs SET status = 'failed', error_message = 'Server restart — orphan recovery', completed_at = ? WHERE task_id = ? AND status = 'running'")
        .run(new Date().toISOString(), task.id);
    }

    // Recalc pipeline statuses
    for (const pid of affectedPipelines) {
      recalcPipelineStatus(pid);
    }
  });

  run();
  console.log(`[PipelineRunner] Recovered ${orphans.length} orphan tasks`);

  // Re-enqueue tasks whose dependencies are all completed.
  // startPipeline scans for queued tasks with satisfied deps and enqueues them.
  for (const pid of affectedPipelines) {
    try {
      const result = startPipeline(pid);
      if (result.started.length > 0) {
        console.log(`[PipelineRunner] Auto-resumed ${result.started.length} task(s) in pipeline ${pid}`);
      }
    } catch (err) {
      console.warn(`[PipelineRunner] Failed to auto-resume pipeline ${pid}:`, (err as Error).message);
    }
  }

  return orphans.length;
}

/** Listen for task completion events to advance pipelines */
export function setupCascadeListener(): void {
  eventBus.on('task:completed', (data) => {
    // Check if pipeline is completed
    const db = getDb();
    const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(data.pipelineId) as { id: string; name: string; status: string } | undefined;

    if (pipeline?.status === 'completed') {
      eventBus.emit('pipeline:completed', {
        pipelineId: pipeline.id, pipelineName: pipeline.name, status: 'completed',
      });
    }
  });
}
