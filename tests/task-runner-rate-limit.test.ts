import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const emit = vi.fn();
const recalcPipelineStatus = vi.fn();
const createConversationMessage = vi.fn();
const reopenCycle = vi.fn();
const setCycleStatus = vi.fn();

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => db?.close(),
}));

vi.mock('../server/engine/event-bus.js', () => ({
  eventBus: { emit },
}));

vi.mock('../server/services/pipeline-service.js', () => ({
  recalcPipelineStatus,
}));

vi.mock('../server/services/task-cycle-service.js', () => ({
  createConversationMessage,
  reopenCycle,
  setCycleStatus,
  // Unused by the helper but required so the import graph resolves.
  attachPendingFollowUpToRun: vi.fn(),
  closeActiveCycles: vi.fn(),
  describeTriggerEvent: vi.fn(),
  getNextAttemptNumber: vi.fn(),
  getOrCreateActiveCycle: vi.fn(),
  inferAttemptContext: vi.fn(),
  upsertConversationMessage: vi.fn(),
  queuePendingFollowUp: vi.fn(),
}));

vi.mock('../server/lib/log-timestamp.js', () => ({
  logTimestamp: () => '2026-04-18T00:00:00.000Z',
}));

vi.mock('../server/engine/worker-pool.js', () => ({
  workerPool: { enqueue: vi.fn() },
}));

const { holdTaskForRateLimit } = await import('../server/engine/task-runner.js');

type TaskRowLike = {
  id: string;
  pipeline_id: string;
  name: string;
  agent_id: string;
  model: string;
  [k: string]: unknown;
};

function seedTask(): TaskRowLike {
  db.prepare(
    "INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Pipeline', 'running', '2026-04-18T00:00:00.000Z')",
  ).run();
  db.prepare(`
    INSERT INTO tasks (
      id, pipeline_id, name, agent_id, model, approval, status, stage,
      input, original_input, current_input, created_at,
      retry_count, max_retries, iteration, current_run_id
    ) VALUES (?, 'p1', 'Task 1', 'developer', 'claude:sonnet', 'auto', 'running', 0, '', '', '', '2026-04-18T00:00:00.000Z', 0, 2, 0, 'run_active')
  `).run('t1');
  return {
    id: 't1',
    pipeline_id: 'p1',
    name: 'Task 1',
    agent_id: 'developer',
    model: 'claude:sonnet',
  };
}

describe('holdTaskForRateLimit', () => {
  const insertLog = { run: vi.fn() };

  beforeEach(() => {
    db = createTestDb();
    emit.mockReset();
    recalcPipelineStatus.mockReset();
    createConversationMessage.mockReset();
    reopenCycle.mockReset();
    setCycleStatus.mockReset();
    insertLog.run.mockReset();
  });

  afterEach(() => {
    db?.close();
  });

  it('parks the task in rate_limited with resume_at set and retry_count untouched', () => {
    const task = seedTask();
    const resumeAt = new Date(Date.now() + 3_600_000);

    holdTaskForRateLimit({
      task: task as never,
      taskId: 't1',
      cycleId: 'c1',
      runId: 'run_active',
      provider: 'claude',
      attempt: 'first',
      attemptNumber: 1,
      rateLimit: { resumeAt, source: 'resets 12am' },
      errorMsg: "You've hit your limit · resets 12am (Europe/Istanbul)",
      insertLog,
    });

    const row = db.prepare(
      'SELECT status, resume_at, retry_count, current_run_id FROM tasks WHERE id = ?',
    ).get('t1') as {
      status: string; resume_at: string | null; retry_count: number; current_run_id: string | null;
    };

    expect(row.status).toBe('rate_limited');
    expect(row.resume_at).toBe(resumeAt.toISOString());
    expect(row.retry_count).toBe(0);
    expect(row.current_run_id).toBeNull();
  });

  it('keeps the cycle reopened in the queued state', () => {
    const task = seedTask();
    holdTaskForRateLimit({
      task: task as never,
      taskId: 't1',
      cycleId: 'c1',
      runId: 'run_active',
      provider: 'claude',
      attempt: 'retry',
      attemptNumber: 2,
      rateLimit: { resumeAt: new Date(Date.now() + 120_000), source: 'fallback:1h' },
      errorMsg: 'You\'ve hit your limit',
      insertLog,
    });

    expect(reopenCycle).toHaveBeenCalledWith('c1');
    expect(setCycleStatus).toHaveBeenCalledWith('c1', 'queued');
  });

  it('emits task:rate_limited and persists the raw error for diagnostics', () => {
    const task = seedTask();
    const resumeAt = new Date(Date.now() + 600_000);
    const errorMsg = "You've hit your limit · resets 5pm (UTC). Full payload here.";

    holdTaskForRateLimit({
      task: task as never,
      taskId: 't1',
      cycleId: 'c1',
      runId: 'run_active',
      provider: 'claude',
      attempt: 'first',
      attemptNumber: 1,
      rateLimit: { resumeAt, source: 'resets 5pm' },
      errorMsg,
      insertLog,
    });

    expect(emit).toHaveBeenCalledWith('task:rate_limited', expect.objectContaining({
      taskId: 't1',
      pipelineId: 'p1',
      status: 'rate_limited',
      resumeAt: resumeAt.toISOString(),
    }));

    expect(createConversationMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'system',
      messageType: 'event',
      meta: expect.objectContaining({
        rateLimited: true,
        resumeAt: resumeAt.toISOString(),
        matched: 'resets 5pm',
        error: errorMsg,
      }),
    }));

    expect(recalcPipelineStatus).toHaveBeenCalledWith('p1');
    expect(insertLog.run).toHaveBeenCalled();
  });

  it('truncates very long error messages in meta.error', () => {
    const task = seedTask();
    const long = 'X'.repeat(1000);
    holdTaskForRateLimit({
      task: task as never,
      taskId: 't1',
      cycleId: 'c1',
      runId: 'run_active',
      provider: 'claude',
      attempt: 'first',
      attemptNumber: 1,
      rateLimit: { resumeAt: new Date(Date.now() + 60_000), source: 'fallback:1h' },
      errorMsg: long,
      insertLog,
    });

    const call = createConversationMessage.mock.calls[0]![0];
    expect((call.meta.error as string).length).toBe(500);
  });
});
