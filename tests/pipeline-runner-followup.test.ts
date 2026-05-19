import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const enqueue = vi.fn();
const runTask = vi.fn();
const closeActiveCycles = vi.fn();
const queuePendingFollowUp = vi.fn();
const recalcPipelineStatus = vi.fn();
const checkDependenciesSatisfied = vi.fn(() => ({ ok: true as const }));

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

vi.mock('../server/services/pipeline-service.js', () => ({
  recalcPipelineStatus,
}));

vi.mock('../server/services/task-service.js', () => ({
  checkDependenciesSatisfied,
}));

vi.mock('../server/services/task-cycle-service.js', () => ({
  closeActiveCycles,
  queuePendingFollowUp,
}));

vi.mock('../server/lib/log-timestamp.js', () => ({
  logTimestamp: () => '2026-04-02T12:00:00.000Z',
}));

vi.mock('../server/engine/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

vi.mock('../server/engine/worker-pool.js', () => ({
  workerPool: {
    enqueue,
    abortPipeline: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock('../server/engine/task-runner.js', () => ({
  runTask,
}));

vi.mock('../server/services/condition-evaluator.js', () => ({
  evaluateCondition: vi.fn(),
  parseCondition: vi.fn(),
}));

const { restartTaskFresh, retryTask } = await import('../server/engine/pipeline-runner.js');

function seedTask(): void {
  db.prepare(
    "INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Pipeline', 'queued', '2026-04-02T00:00:00.000Z')"
  ).run();
  db.prepare(`
    INSERT INTO tasks (
      id, pipeline_id, name, agent_id, model, approval, status, stage, input,
      original_input, current_input, created_at, output
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    't1',
    'p1',
    'Task 1',
    'developer',
    'claude:sonnet',
    'auto',
    'completed',
    0,
    'original input',
    'original input',
    'original input',
    '2026-04-02T00:00:00.000Z',
    'done',
  );
}

describe('pipeline-runner follow-up restarts', () => {
  beforeEach(() => {
    db = createTestDb();
    enqueue.mockReset();
    runTask.mockReset();
    closeActiveCycles.mockReset();
    queuePendingFollowUp.mockReset();
    recalcPipelineStatus.mockReset();
    checkDependenciesSatisfied.mockClear();
    checkDependenciesSatisfied.mockReturnValue({ ok: true });
    seedTask();
  });

  afterEach(() => {
    db.close();
  });

  it('forwards follow-up guidance when restarting fresh', async () => {
    restartTaskFresh('t1', undefined, 'Please continue from the last output');

    expect(closeActiveCycles).toHaveBeenCalledWith(
      't1',
      'Please continue from the last output',
    );
    expect(queuePendingFollowUp).toHaveBeenCalledWith({
      taskId: 't1',
      content: 'Please continue from the last output',
      agentId: 'developer',
      modelUsed: 'claude:sonnet',
      provider: 'claude',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);

    const queuedJob = enqueue.mock.calls[0]?.[0] as
      | { execute: () => Promise<void> | void }
      | undefined;
    expect(queuedJob).toBeTruthy();

    await queuedJob?.execute();

    expect(runTask).toHaveBeenCalledWith(
      't1',
      'Please continue from the last output',
    );
  });

  it('queues a pending follow-up before retry execution starts', async () => {
    retryTask('t1', 'Tighten the final answer');

    expect(queuePendingFollowUp).toHaveBeenCalledWith({
      taskId: 't1',
      content: 'Tighten the final answer',
      agentId: 'developer',
      modelUsed: 'claude:sonnet',
      provider: 'claude',
    });

    const queuedJob = enqueue.mock.calls[0]?.[0] as
      | { execute: () => Promise<void> | void }
      | undefined;
    await queuedJob?.execute();

    expect(runTask).toHaveBeenCalledWith('t1', 'Tighten the final answer');
  });
});
