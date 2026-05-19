import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const enqueue = vi.fn();
const runTask = vi.fn();
const recalcPipelineStatus = vi.fn();
const emit = vi.fn();

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => db?.close(),
}));

vi.mock('../server/engine/event-bus.js', () => ({
  eventBus: { emit },
}));

vi.mock('../server/engine/worker-pool.js', () => ({
  workerPool: { enqueue },
}));

vi.mock('../server/services/pipeline-service.js', () => ({
  recalcPipelineStatus,
}));

vi.mock('../server/engine/task-runner.js', () => ({
  runTask,
}));

vi.mock('../server/lib/log-timestamp.js', () => ({
  logTimestamp: () => '2026-04-18T00:00:00.000Z',
}));

const { resumeDueRateLimitedTasks } = await import('../server/engine/rate-limit-resumer.js');

function seedTask(opts: {
  id: string;
  status: string;
  resumeAt: string | null;
}): void {
  db.prepare(
    "INSERT OR IGNORE INTO pipelines (id, name, status, created) VALUES ('p1', 'Pipeline', 'queued', '2026-04-18T00:00:00.000Z')",
  ).run();
  db.prepare(`
    INSERT INTO tasks (
      id, pipeline_id, name, agent_id, model, approval, status, stage,
      input, original_input, current_input, created_at, resume_at
    ) VALUES (?, 'p1', ?, 'developer', 'claude:sonnet', 'auto', ?, 0, '', '', '', '2026-04-18T00:00:00.000Z', ?)
  `).run(opts.id, `Task ${opts.id}`, opts.status, opts.resumeAt);
}

describe('resumeDueRateLimitedTasks', () => {
  beforeEach(() => {
    db = createTestDb();
    enqueue.mockReset();
    runTask.mockReset();
    recalcPipelineStatus.mockReset();
    emit.mockReset();
  });

  afterEach(() => {
    db?.close();
  });

  it('promotes due tasks to queued and enqueues them', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedTask({ id: 't1', status: 'rate_limited', resumeAt: past });

    const resumed = resumeDueRateLimitedTasks();

    expect(resumed).toBe(1);
    const row = db.prepare('SELECT status, resume_at FROM tasks WHERE id = ?').get('t1') as {
      status: string; resume_at: string | null;
    };
    expect(row.status).toBe('queued');
    expect(row.resume_at).toBeNull();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't1',
      pipelineId: 'p1',
      taskName: 'Task t1',
    }));
    expect(emit).toHaveBeenCalledWith('task:rate_limit_resumed', expect.objectContaining({
      taskId: 't1',
      status: 'queued',
    }));
    expect(recalcPipelineStatus).toHaveBeenCalledWith('p1');
  });

  it('leaves tasks whose resume_at is still in the future', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    seedTask({ id: 't2', status: 'rate_limited', resumeAt: future });

    expect(resumeDueRateLimitedTasks()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get('t2') as { status: string };
    expect(row.status).toBe('rate_limited');
  });

  it('ignores tasks in other statuses even when resume_at is stale', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedTask({ id: 't3', status: 'failed', resumeAt: past });

    expect(resumeDueRateLimitedTasks()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('is idempotent — a second pass finds nothing to do', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedTask({ id: 't4', status: 'rate_limited', resumeAt: past });

    resumeDueRateLimitedTasks();
    enqueue.mockClear();
    emit.mockClear();

    expect(resumeDueRateLimitedTasks()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('processes multiple due tasks in one pass', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedTask({ id: 't5', status: 'rate_limited', resumeAt: past });
    seedTask({ id: 't6', status: 'rate_limited', resumeAt: past });

    expect(resumeDueRateLimitedTasks()).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
