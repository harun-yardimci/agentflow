/**
 * Periodic scheduler that fires due routines. A routine is a recurring task
 * template scoped to a pipeline (see services/routine-service.ts). On each tick
 * it spawns a fresh task into the pipeline and dispatches it through the normal
 * worker pool / approval flow — routines reuse the existing engine, they don't
 * run a parallel one.
 *
 * Runs every 60s. The poll query is guarded on `enabled = 1`, and the trigger
 * advances `next_trigger_at` in the SAME transaction as task creation, so a
 * partial failure can never re-fire the routine on the next tick.
 */

import { getDb } from '../db/connection.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { createPeriodicScheduler } from '../lib/periodic-scheduler.js';
import { eventBus } from './event-bus.js';
import { workerPool } from './worker-pool.js';
import { runTask } from './task-runner.js';
import { createTask } from '../services/task-service.js';
import { recalcPipelineStatus } from '../services/pipeline-service.js';
import { markRoutineTriggered, listDueRoutines, type Routine } from '../services/routine-service.js';

const CHECK_INTERVAL_MS = 60 * 1000;

function agentExists(agentId: string): boolean {
  return !!getDb().prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
}

function hasPendingRoutineTask(routineId: string): boolean {
  return !!getDb()
    .prepare(
      "SELECT id FROM tasks WHERE routine_id = ? AND status = 'awaiting_approval' AND archived_at IS NULL LIMIT 1",
    )
    .get(routineId);
}

function insertLog(pipelineId: string, type: string, msg: string): void {
  getDb()
    .prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
    .run(pipelineId, logTimestamp(), type, msg);
}

/**
 * Spawn a task from a routine and dispatch it through the normal worker-pool /
 * approval flow. `advanceSchedule` is true for scheduled fires and false for
 * manual run-now. Returns the spawned task id, or `null` when the fire was
 * skipped (agent no longer exists, or a manual-approval run is still pending).
 *
 * All DB writes — including advancing `next_trigger_at` — run in one
 * transaction; only the worker-pool enqueue happens after commit. This prevents
 * the failure mode where a throw after task creation leaves `next_trigger_at`
 * in the past and the routine re-fires (spawning a task) on every 60s poll.
 */
export function triggerRoutine(routine: Routine, advanceSchedule: boolean): string | null {
  const db = getDb();

  // Skip a misconfigured routine instead of spawning a guaranteed-failing task
  // each period; still advance the schedule so it doesn't retry every 60s.
  if (!agentExists(routine.agentId)) {
    insertLog(
      routine.pipelineId, 'warning',
      `Routine '${routine.name}' skipped — agent '${routine.agentId}' no longer exists`,
    );
    markRoutineTriggered(routine, advanceSchedule);
    return null;
  }

  // Don't pile up un-acted manual-approval tasks: if the previous run is still
  // awaiting approval, skip this fire.
  if (routine.approval === 'manual' && hasPendingRoutineTask(routine.id)) {
    insertLog(
      routine.pipelineId, 'info',
      `Routine '${routine.name}' skipped — previous run still awaiting approval`,
    );
    markRoutineTriggered(routine, advanceSchedule);
    return null;
  }

  const isManual = routine.approval === 'manual';
  let taskId = '';

  const tx = db.transaction(() => {
    const task = createTask(routine.pipelineId, {
      name: routine.name,
      agentId: routine.agentId,
      model: routine.model,
      approval: routine.approval,
      stage: 0,
      dependsOn: [],
      input: routine.input,
      priority: routine.priority,
      timeoutMs: routine.timeoutMs ?? undefined,
      useWorktree: routine.useWorktree,
      branch: routine.branch,
    });
    taskId = task.id;

    db.prepare("UPDATE tasks SET task_type = 'routine', routine_id = ? WHERE id = ?").run(routine.id, taskId);
    insertLog(routine.pipelineId, 'info', `Routine '${routine.name}' triggered`);
    if (isManual) {
      db.prepare("UPDATE tasks SET status = 'awaiting_approval' WHERE id = ?").run(taskId);
    }
    // Advance the schedule atomically with task creation.
    markRoutineTriggered(routine, advanceSchedule);
    recalcPipelineStatus(routine.pipelineId);
  });
  tx();

  // Post-commit side effects (must not run inside the transaction).
  if (isManual) {
    eventBus.emit('task:approval_needed', {
      taskId, pipelineId: routine.pipelineId, taskName: routine.name, status: 'awaiting_approval',
    });
  } else {
    workerPool.enqueue({
      taskId,
      pipelineId: routine.pipelineId,
      taskName: routine.name,
      execute: () => runTask(taskId),
    });
    db.prepare("UPDATE pipelines SET status = 'running' WHERE id = ?").run(routine.pipelineId);
  }

  return taskId;
}

export function runDueRoutines(): number {
  const due = listDueRoutines(new Date().toISOString());
  let fired = 0;
  for (const routine of due) {
    try {
      if (triggerRoutine(routine, true) !== null) fired++;
    } catch (err) {
      console.error(`[Routine] Failed to trigger '${routine.name}':`, (err as Error).message);
    }
  }
  if (fired > 0) console.log(`[Routine] Fired ${fired} routine(s)`);
  return fired;
}

const scheduler = createPeriodicScheduler({
  name: 'Routine',
  intervalMs: CHECK_INTERVAL_MS,
  task: runDueRoutines,
});

export function startRoutineScheduler(): void {
  scheduler.start();
}

export function stopRoutineScheduler(): void {
  scheduler.stop();
}
