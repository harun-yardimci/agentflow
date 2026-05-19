import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

const {
  attachPendingFollowUpToRun,
  createConversationMessage,
  getOrCreateActiveCycle,
  inferAttemptContext,
  listCycleAttempts,
  listCycleMessages,
  listTaskCycles,
  queuePendingFollowUp,
} = await import('../server/services/task-cycle-service.js');

function seedTask(): void {
  db.prepare(
    "INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'queued', '2024-01-01T00:00:00.000Z')"
  ).run();
  db.prepare(
    "INSERT INTO tasks (id, pipeline_id, name, agent_id, model, input, original_input, current_input, created_at) VALUES ('t1', 'p1', 'Task 1', 'developer', 'claude:sonnet', 'original', 'original', 'original', '2024-01-01T00:00:00.000Z')"
  ).run();
}

describe('Task Cycle Service', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTask();
  });

  afterEach(() => {
    db.close();
  });

  it('creates a single active cycle and reuses it', () => {
    const first = getOrCreateActiveCycle('t1', 'executor');
    const second = getOrCreateActiveCycle('t1', 'executor');

    expect(second.id).toBe(first.id);
    expect(first.cycle_number).toBe(1);

    const cycles = listTaskCycles('t1');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.cycleNumber).toBe(1);
    expect(cycles[0]?.attemptCount).toBe(0);
  });

  it('tracks attempts and conversation messages per cycle', () => {
    const cycle = getOrCreateActiveCycle('t1', 'executor');

    db.prepare(`
      INSERT INTO execution_runs (
        id, task_id, cycle_id, attempt, attempt_number, status, started_at,
        executor_type, model_used, agent_id, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run-1',
      't1',
      cycle.id,
      1,
      1,
      'completed',
      '2024-01-01T00:01:00.000Z',
      'cli',
      'claude:sonnet',
      'developer',
      'claude',
    );

    createConversationMessage({
      taskId: 't1',
      cycleId: cycle.id,
      runId: 'run-1',
      role: 'user',
      messageType: 'follow_up',
      content: 'Can you continue from the previous result?',
      meta: { source: 'test' },
    });

    const attempts = listCycleAttempts('t1', cycle.id);
    const messages = listCycleMessages('t1', cycle.id);
    const cycles = listTaskCycles('t1');

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attempt_number).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageType).toBe('follow_up');
    expect(messages[0]?.meta).toEqual({ source: 'test' });
    expect(cycles[0]?.attemptCount).toBe(1);
    expect(cycles[0]?.lastAttemptAt).toBe('2024-01-01T00:01:00.000Z');
  });

  it('infers follow-up, agent switch, provider switch, model switch, and auto-retry triggers', () => {
    const cycle = getOrCreateActiveCycle('t1', 'executor');

    const insertRun = db.prepare(`
      INSERT INTO execution_runs (
        id, task_id, cycle_id, attempt, attempt_number, status, started_at,
        executor_type, model_used, follow_up_prompt, agent_id, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRun.run(
      'run-1',
      't1',
      cycle.id,
      1,
      1,
      'completed',
      '2024-01-01T00:01:00.000Z',
      'cli',
      'claude:sonnet',
      null,
      'developer',
      'claude',
    );

    expect(
      inferAttemptContext('t1', cycle.id, 'developer', 'claude:sonnet', 'Please refine this')
        .triggerType
    ).toBe('follow_up');

    expect(
      inferAttemptContext('t1', cycle.id, 'qa', 'claude:sonnet').triggerType
    ).toBe('agent_switch');

    expect(
      inferAttemptContext('t1', cycle.id, 'developer', 'gemini:2.5-pro').triggerType
    ).toBe('provider_switch');

    expect(
      inferAttemptContext('t1', cycle.id, 'developer', 'claude:opus').triggerType
    ).toBe('model_switch');

    expect(
      inferAttemptContext('t1', cycle.id, 'developer', 'claude:sonnet', undefined, 1)
        .triggerType
    ).toBe('auto_retry');
  });

  it('reuses the same pending follow-up message while a run has not started', () => {
    const first = queuePendingFollowUp({
      taskId: 't1',
      content: 'Please continue from the last output',
      agentId: 'developer',
      provider: 'claude',
      modelUsed: 'claude:sonnet',
    });

    const second = queuePendingFollowUp({
      taskId: 't1',
      content: 'Please continue from the last output',
      agentId: 'developer',
      provider: 'claude',
      modelUsed: 'claude:sonnet',
    });

    const messages = listCycleMessages('t1', first.cycleId);

    expect(second.cycleId).toBe(first.cycleId);
    expect(second.messageId).toBe(first.messageId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.runId).toBeNull();
    expect(messages[0]?.meta).toEqual({ pending: true });
  });

  it('attaches a pending follow-up to the real run instead of duplicating it', () => {
    const pending = queuePendingFollowUp({
      taskId: 't1',
      content: 'Tighten the final answer',
      agentId: 'developer',
      provider: 'claude',
      modelUsed: 'claude:sonnet',
    });

    db.prepare(`
      INSERT INTO execution_runs (
        id, task_id, cycle_id, attempt, attempt_number, status, started_at,
        executor_type, model_used, follow_up_prompt, agent_id, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run-1',
      't1',
      pending.cycleId,
      1,
      1,
      'running',
      '2024-01-01T00:01:00.000Z',
      'cli',
      'claude:sonnet',
      'Tighten the final answer',
      'developer',
      'claude',
    );

    const messageId = attachPendingFollowUpToRun({
      taskId: 't1',
      cycleId: pending.cycleId,
      runId: 'run-1',
      content: 'Tighten the final answer',
      agentId: 'developer',
      provider: 'claude',
      modelUsed: 'claude:sonnet',
      attempt: 1,
      attemptNumber: 1,
      triggerType: 'follow_up',
    });

    const messages = listCycleMessages('t1', pending.cycleId);

    expect(messageId).toBe(pending.messageId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.runId).toBe('run-1');
    expect(messages[0]?.meta).toEqual({
      attempt: 1,
      attemptNumber: 1,
      pending: false,
      triggerType: 'follow_up',
    });
  });
});
