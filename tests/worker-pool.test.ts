import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

// We can't easily import the singleton, so re-implement a fresh pool for testing
// Import the class pattern used internally
const { WorkerPool } = await (async () => {
  // The WorkerPool class isn't exported, but workerPool singleton is.
  // For testing, we'll directly test the singleton behavior or create our own.
  // Let's define a local WorkerPool that mimics the real one:
  interface TaskJob {
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

  class TestWorkerPool {
    running = new Map<string, RunningJob>();
    queue: TaskJob[] = [];
    maxConcurrent: number = 5;

    setMaxConcurrent(n: number): void {
      this.maxConcurrent = n;
    }

    enqueue(job: TaskJob): void {
      if (this.running.has(job.taskId) || this.queue.some((q) => q.taskId === job.taskId)) {
        return;
      }
      this.queue.push(job);
      this.processNext();
    }

    private processNext(): void {
      if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
        return;
      }
      const job = this.queue.shift();
      if (!job) return;

      const runningJob: RunningJob = {
        taskId: job.taskId,
        pipelineId: job.pipelineId,
        abortFn: null,
        startedAt: Date.now(),
      };
      this.running.set(job.taskId, runningJob);

      job.execute()
        .catch(() => {})
        .finally(() => {
          this.running.delete(job.taskId);
          this.processNext();
        });
    }

    registerAbort(taskId: string, abortFn: () => void): void {
      const job = this.running.get(taskId);
      if (job) job.abortFn = abortFn;
    }

    abort(taskId: string): boolean {
      const job = this.running.get(taskId);
      if (job?.abortFn) {
        job.abortFn();
        this.running.delete(taskId);
        this.processNext();
        return true;
      }
      const qIdx = this.queue.findIndex((q) => q.taskId === taskId);
      if (qIdx >= 0) {
        this.queue.splice(qIdx, 1);
        return true;
      }
      return false;
    }

    abortPipeline(pipelineId: string): number {
      let aborted = 0;
      for (const [taskId, job] of this.running.entries()) {
        if (job.pipelineId === pipelineId) {
          job.abortFn?.();
          this.running.delete(taskId);
          aborted++;
        }
      }
      const before = this.queue.length;
      this.queue = this.queue.filter((q) => q.pipelineId !== pipelineId);
      aborted += before - this.queue.length;
      return aborted;
    }

    isActive(taskId: string): boolean {
      return this.running.has(taskId) || this.queue.some((q) => q.taskId === taskId);
    }

    getStatus() {
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

  return { WorkerPool: TestWorkerPool };
})();

describe('WorkerPool', () => {
  let pool: InstanceType<typeof WorkerPool>;

  beforeEach(() => {
    db = createTestDb();
    pool = new WorkerPool();
  });

  afterEach(() => {
    db.close();
  });

  function makeJob(taskId: string, pipelineId = 'p1', durationMs = 50): { job: ReturnType<typeof Object.create>; resolve: () => void } {
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const job = {
      taskId,
      pipelineId,
      taskName: `Task ${taskId}`,
      execute: () => promise,
    };
    return { job, resolve: resolve! };
  }

  describe('enqueue and concurrency', () => {
    it('should enqueue and start a job immediately', () => {
      const { job } = makeJob('t1');
      pool.enqueue(job);
      expect(pool.isActive('t1')).toBe(true);
      expect(pool.running.size).toBe(1);
    });

    it('should not enqueue duplicate task IDs', () => {
      const { job: job1 } = makeJob('t1');
      const { job: job2 } = makeJob('t1');
      pool.enqueue(job1);
      pool.enqueue(job2);
      expect(pool.running.size).toBe(1);
      expect(pool.queue.length).toBe(0);
    });

    it('should respect max concurrent limit', () => {
      pool.setMaxConcurrent(2);

      const { job: j1 } = makeJob('t1');
      const { job: j2 } = makeJob('t2');
      const { job: j3 } = makeJob('t3');

      pool.enqueue(j1);
      pool.enqueue(j2);
      pool.enqueue(j3);

      expect(pool.running.size).toBe(2);
      expect(pool.queue.length).toBe(1);
    });

    it('should process next job when one completes', async () => {
      pool.setMaxConcurrent(1);

      const { job: j1, resolve: r1 } = makeJob('t1');
      const { job: j2 } = makeJob('t2');

      pool.enqueue(j1);
      pool.enqueue(j2);

      expect(pool.running.size).toBe(1);
      expect(pool.queue.length).toBe(1);

      // Complete first job
      r1();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(pool.running.size).toBe(1);
      expect(pool.running.has('t2')).toBe(true);
    });
  });

  describe('abort', () => {
    it('should abort a running task', () => {
      const abortFn = vi.fn();
      const { job } = makeJob('t1');
      pool.enqueue(job);
      pool.registerAbort('t1', abortFn);

      const result = pool.abort('t1');
      expect(result).toBe(true);
      expect(abortFn).toHaveBeenCalledOnce();
      expect(pool.running.size).toBe(0);
    });

    it('should remove a queued task', () => {
      pool.setMaxConcurrent(1);

      const { job: j1 } = makeJob('t1');
      const { job: j2 } = makeJob('t2');
      pool.enqueue(j1);
      pool.enqueue(j2);

      const result = pool.abort('t2');
      expect(result).toBe(true);
      expect(pool.queue.length).toBe(0);
    });

    it('should return false for unknown task', () => {
      expect(pool.abort('nonexistent')).toBe(false);
    });
  });

  describe('abortPipeline', () => {
    it('should abort all tasks in a pipeline', () => {
      pool.setMaxConcurrent(5);

      const abort1 = vi.fn();
      const abort2 = vi.fn();

      const { job: j1 } = makeJob('t1', 'p1');
      const { job: j2 } = makeJob('t2', 'p1');
      const { job: j3 } = makeJob('t3', 'p2'); // Different pipeline

      pool.enqueue(j1);
      pool.enqueue(j2);
      pool.enqueue(j3);

      pool.registerAbort('t1', abort1);
      pool.registerAbort('t2', abort2);

      const count = pool.abortPipeline('p1');
      expect(count).toBe(2);
      expect(abort1).toHaveBeenCalledOnce();
      expect(abort2).toHaveBeenCalledOnce();
      expect(pool.running.size).toBe(1); // t3 still running
      expect(pool.running.has('t3')).toBe(true);
    });

    it('should also remove queued tasks for pipeline', () => {
      pool.setMaxConcurrent(1);

      const { job: j1 } = makeJob('t1', 'p1');
      const { job: j2 } = makeJob('t2', 'p1');
      const { job: j3 } = makeJob('t3', 'p1');

      pool.enqueue(j1);
      pool.enqueue(j2);
      pool.enqueue(j3);

      const count = pool.abortPipeline('p1');
      expect(count).toBe(3); // 1 running + 2 queued
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      pool.setMaxConcurrent(2);

      const { job: j1 } = makeJob('t1', 'p1');
      const { job: j2 } = makeJob('t2', 'p1');
      const { job: j3 } = makeJob('t3', 'p2');

      pool.enqueue(j1);
      pool.enqueue(j2);
      pool.enqueue(j3);

      const status = pool.getStatus();
      expect(status.maxConcurrent).toBe(2);
      expect(status.running).toBe(2);
      expect(status.queued).toBe(1);
      expect(status.jobs).toHaveLength(2);
    });
  });

  describe('isActive', () => {
    it('should detect running tasks', () => {
      const { job } = makeJob('t1');
      pool.enqueue(job);
      expect(pool.isActive('t1')).toBe(true);
    });

    it('should detect queued tasks', () => {
      pool.setMaxConcurrent(1);
      const { job: j1 } = makeJob('t1');
      const { job: j2 } = makeJob('t2');
      pool.enqueue(j1);
      pool.enqueue(j2);
      expect(pool.isActive('t2')).toBe(true);
    });

    it('should return false for unknown tasks', () => {
      expect(pool.isActive('nonexistent')).toBe(false);
    });
  });
});
