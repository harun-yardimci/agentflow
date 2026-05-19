/**
 * Periodic scheduler that re-enqueues tasks whose provider rate-limit window
 * has expired. Companion to rate-limit-detector.ts / handleTaskFailure.
 *
 * Runs every 30s. Idempotent: the UPDATE is guarded on `status='rate_limited'`
 * so a second pass (or a parallel process) can't double-queue a task.
 */

import { getDb } from '../db/connection.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { eventBus } from './event-bus.js';
import { workerPool } from './worker-pool.js';
import { recalcPipelineStatus } from '../services/pipeline-service.js';
import { runTask } from './task-runner.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

interface DueTask {
  id: string;
  pipeline_id: string;
  name: string;
}

export function resumeDueRateLimitedTasks(): number {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const due = db.prepare(
    `SELECT id, pipeline_id, name FROM tasks
     WHERE status = 'rate_limited'
       AND resume_at IS NOT NULL
       AND resume_at <= ?`,
  ).all(nowIso) as DueTask[];

  if (due.length === 0) return 0;

  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)',
  );
  const promote = db.prepare(
    `UPDATE tasks SET status = 'queued', resume_at = NULL
     WHERE id = ? AND status = 'rate_limited'`,
  );

  let resumed = 0;
  for (const task of due) {
    if (promote.run(task.id).changes === 0) continue;
    resumed++;

    insertLog.run(
      task.pipeline_id, logTimestamp(), 'info',
      `'${task.name}' rate-limit window ended, resuming`,
    );

    eventBus.emit('task:rate_limit_resumed', {
      taskId: task.id, pipelineId: task.pipeline_id, taskName: task.name,
      status: 'queued',
    });

    recalcPipelineStatus(task.pipeline_id);

    workerPool.enqueue({
      taskId: task.id,
      pipelineId: task.pipeline_id,
      taskName: task.name,
      execute: () => runTask(task.id),
    });
  }

  return resumed;
}

export function startRateLimitResumer(): void {
  try {
    const n = resumeDueRateLimitedTasks();
    if (n > 0) console.log(`[RateLimit] Resumed ${n} task(s) on startup`);
  } catch (err) {
    console.error('[RateLimit] Startup resume failed:', (err as Error).message);
  }

  timer = setInterval(() => {
    try {
      const n = resumeDueRateLimitedTasks();
      if (n > 0) console.log(`[RateLimit] Resumed ${n} task(s)`);
    } catch (err) {
      console.error('[RateLimit] Scheduled resume failed:', (err as Error).message);
    }
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopRateLimitResumer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
