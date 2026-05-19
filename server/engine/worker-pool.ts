import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';
import { recalcPipelineStatus } from '../services/pipeline-service.js';
import { logTimestamp } from '../lib/log-timestamp.js';

export interface TaskJob {
  taskId: string;
  pipelineId: string;
  taskName: string;
  execute: () => Promise<void>;
}

interface RunningJob {
  taskId: string;
  pipelineId: string;
  abortFn: (() => void) | null;
  startedAt: number;
}

export interface PoolStatus {
  maxConcurrent: number;
  running: number;
  queued: number;
  jobs: { taskId: string; pipelineId: string; runningForMs: number }[];
}

class WorkerPool {
  private running = new Map<string, RunningJob>();
  private queue: TaskJob[] = [];
  private maxConcurrent: number = 5;

  constructor() {
    this.loadMaxConcurrent();
  }

  /** Reload max_parallel_tasks from settings */
  loadMaxConcurrent(): void {
    try {
      const db = getDb();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'max_parallel_tasks'").get() as { value: string } | undefined;
      this.maxConcurrent = row ? Math.max(1, parseInt(row.value, 10) || 5) : 5;
    } catch {
      this.maxConcurrent = 5;
    }
  }

  /** Enqueue a task for execution */
  enqueue(job: TaskJob): void {
    // Don't queue duplicates
    if (this.running.has(job.taskId) || this.queue.some((q) => q.taskId === job.taskId)) {
      return;
    }
    this.queue.push(job);
    this.processNext();
  }

  /** Try to start next queued job if capacity available */
  private processNext(): void {
    // Refresh capacity from settings on each cycle
    this.loadMaxConcurrent();

    if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    // Stale check: task may have been aborted/moved while waiting in queue
    try {
      const db = getDb();
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(job.taskId) as { status: string } | undefined;
      if (!row || !['queued', 'running'].includes(row.status)) {
        this.processNext();
        return;
      }
    } catch { /* proceed if DB check fails */ }

    const runningJob: RunningJob = {
      taskId: job.taskId,
      pipelineId: job.pipelineId,
      abortFn: null,
      startedAt: Date.now(),
    };

    this.running.set(job.taskId, runningJob);

    // Execute async — don't await, let it run in background
    job.execute()
      .catch((err) => {
        console.error(`[WorkerPool] Task ${job.taskId} failed:`, err.message);

        // Safety net: update DB so tasks don't stay stuck in "running"
        // WHERE status = 'running' guard prevents double-write if task-runner already handled it
        try {
          const db = getDb();
          const now = new Date().toISOString();
          const errorMsg = (err.message ?? 'Unknown error').slice(0, 2000);

          db.prepare(
            "UPDATE execution_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE task_id = ? AND status = 'running'"
          ).run(now, errorMsg, job.taskId);

          db.prepare(
            "UPDATE tasks SET status = 'failed', retry_count = retry_count + 1 WHERE id = ? AND status = 'running'"
          ).run(job.taskId);

          db.prepare(
            'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
          ).run(job.pipelineId, logTimestamp(), 'error',
            `'${job.taskName}' failed in worker pool — ${errorMsg.slice(0, 200)}`);

          recalcPipelineStatus(job.pipelineId);
        } catch (dbErr) {
          console.error(`[WorkerPool] DB update failed for ${job.taskId}:`, (dbErr as Error).message);
        }
      })
      .finally(() => {
        this.running.delete(job.taskId);
        // Process next in queue
        this.processNext();
      });
  }

  /** Register an abort function for a running task */
  registerAbort(taskId: string, abortFn: () => void): void {
    const job = this.running.get(taskId);
    if (job) {
      job.abortFn = abortFn;
    }
  }

  /** Abort a specific task */
  abort(taskId: string): boolean {
    const job = this.running.get(taskId);
    if (job?.abortFn) {
      job.abortFn();
      this.running.delete(taskId);
      this.processNext();
      return true;
    }

    // Maybe it's still in queue
    const qIdx = this.queue.findIndex((q) => q.taskId === taskId);
    if (qIdx >= 0) {
      this.queue.splice(qIdx, 1);
      return true;
    }

    return false;
  }

  /** Abort all tasks in a pipeline */
  abortPipeline(pipelineId: string): number {
    let aborted = 0;

    // Abort running tasks
    for (const [taskId, job] of this.running.entries()) {
      if (job.pipelineId === pipelineId) {
        job.abortFn?.();
        this.running.delete(taskId);
        aborted++;
      }
    }

    // Remove queued tasks
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.pipelineId !== pipelineId);
    aborted += before - this.queue.length;

    return aborted;
  }

  /** Check if a task is running or queued */
  isActive(taskId: string): boolean {
    return this.running.has(taskId) || this.queue.some((q) => q.taskId === taskId);
  }

  /** Abort all running tasks and clear queue — used during shutdown */
  abortAll(): number {
    let aborted = 0;

    for (const [taskId, job] of this.running.entries()) {
      job.abortFn?.();
      this.running.delete(taskId);
      aborted++;
    }

    aborted += this.queue.length;
    this.queue = [];

    return aborted;
  }

  /** Get pool status */
  getStatus(): PoolStatus {
    const now = Date.now();
    return {
      maxConcurrent: this.maxConcurrent,
      running: this.running.size,
      queued: this.queue.length,
      jobs: Array.from(this.running.values()).map((j) => ({
        taskId: j.taskId,
        pipelineId: j.pipelineId,
        runningForMs: now - j.startedAt,
      })),
    };
  }
}

// Singleton
export const workerPool = new WorkerPool();
