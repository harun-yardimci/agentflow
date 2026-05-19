/**
 * Tests for conditional cascade, skip propagation, and auto-retry logic.
 *
 * These tests verify the core business logic introduced by the conditional
 * branching feature: when a task completes, its dependents' conditions are
 * evaluated and unmet conditions cause the dependent to be skipped, which
 * cascades transitively.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedCascadePipeline } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

const {
  completeAndCascade,
  skipAndCascade,
  getTask,
  createTask,
  moveTask,
  listTasks,
} = await import('../server/services/task-service.js');

/** Helper: insert a conditional dependency between two tasks */
function insertCondition(taskId: string, depId: string, type: string, value: string) {
  db.prepare('UPDATE task_deps SET condition = ? WHERE task_id = ? AND depends_on_task_id = ?')
    .run(JSON.stringify({ type, value }), taskId, depId);
}

/** Helper: insert a new dependency with optional condition */
function insertDep(taskId: string, depId: string, condition?: { type: string; value: string }) {
  db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id, condition) VALUES (?, ?, ?)')
    .run(taskId, depId, condition ? JSON.stringify(condition) : null);
}

/** Helper: read raw task status from DB */
function rawStatus(taskId: string): string {
  return (db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string }).status;
}

describe('Conditional Cascade', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // ─── Condition met → normal cascade ──────────────────────────────────
  describe('conditions met → cascade normally', () => {
    it('should cascade when "contains" condition is satisfied', () => {
      seedCascadePipeline(db);
      // T2 depends on T1 with condition: output contains "success"
      insertCondition('t2', 't1', 'contains', 'success');

      const result = completeAndCascade('t1', 'All tests passed: success!', '5s', 100);

      expect(result.cascaded).toContain('t2');
      expect(rawStatus('t2')).toBe('queued');
    });

    it('should cascade when "not_contains" condition is satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'not_contains', 'error');

      const result = completeAndCascade('t1', 'All tests passed successfully', '5s', 100);

      expect(result.cascaded).toContain('t2');
      expect(rawStatus('t2')).toBe('queued');
    });

    it('should cascade when "regex" condition is satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'regex', '\\d+ tests? passed');

      const result = completeAndCascade('t1', '42 tests passed, 0 failed', '5s', 100);

      expect(result.cascaded).toContain('t2');
      expect(rawStatus('t2')).toBe('queued');
    });

    it('should cascade when "status" condition is satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'status', 'completed');

      const result = completeAndCascade('t1', 'Done', '5s', 100);

      expect(result.cascaded).toContain('t2');
      expect(rawStatus('t2')).toBe('queued');
    });
  });

  // ─── Condition NOT met → skip ────────────────────────────────────────
  describe('conditions not met → skip task', () => {
    it('should skip when "contains" condition is NOT satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'contains', 'success');

      const result = completeAndCascade('t1', 'Build failed with errors', '5s', 100);

      expect(result.cascaded).not.toContain('t2');
      expect(rawStatus('t2')).toBe('skipped');
    });

    it('should skip when "not_contains" condition is NOT satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'not_contains', 'error');

      const result = completeAndCascade('t1', 'Build failed with error code 1', '5s', 100);

      expect(result.cascaded).not.toContain('t2');
      expect(rawStatus('t2')).toBe('skipped');
    });

    it('should skip when "regex" condition is NOT satisfied', () => {
      seedCascadePipeline(db);
      insertCondition('t2', 't1', 'regex', '^DEPLOY_READY$');

      const result = completeAndCascade('t1', 'Still building...', '5s', 100);

      expect(result.cascaded).not.toContain('t2');
      expect(rawStatus('t2')).toBe('skipped');
    });

    it('should skip when "status" condition is NOT satisfied (dep was skipped)', () => {
      seedCascadePipeline(db);
      // Remove existing dep t2→t1, instead make t2 depend on t3 with status=completed
      db.prepare('DELETE FROM task_deps WHERE task_id = ? AND depends_on_task_id = ?').run('t2', 't1');
      // Make t3 already skipped
      db.prepare("UPDATE tasks SET status = 'skipped' WHERE id = 't3'").run();
      insertDep('t2', 't3', { type: 'status', value: 'completed' });

      // Complete t1 — t2 depends on t3 (skipped) with status=completed condition → should skip
      const result = completeAndCascade('t1', 'Done', '5s', 100);

      // t2 should be skipped because t3 is skipped, not completed
      expect(rawStatus('t2')).toBe('skipped');
    });
  });

  // ─── Multi-dependency with mixed conditions ──────────────────────────
  describe('multiple dependencies with conditions (AND logic)', () => {
    it('should skip if ANY dependency condition fails', () => {
      // Setup: A→C (contains "pass"), B→C (contains "deploy")
      // A completes with "pass", B completes with "no deploy yet"
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'running', 0, '', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'auto', 'running', 0, '', 1);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c', 'p1', 'C', 'a1', 'auto', 'queued', 1, '', 2);

      insertDep('c', 'a', { type: 'contains', value: 'pass' });
      insertDep('c', 'b', { type: 'contains', value: 'deploy' });

      // Complete A with "pass" — C still waiting for B
      completeAndCascade('a', 'All tests pass', '1s', 10);
      expect(rawStatus('c')).toBe('queued');

      // Complete B WITHOUT "deploy" — C's second condition fails → skip
      completeAndCascade('b', 'Build done, not ready', '1s', 10);
      expect(rawStatus('c')).toBe('skipped');
    });

    it('should cascade when ALL dependency conditions pass', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'running', 0, '', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'auto', 'running', 0, '', 1);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c', 'p1', 'C', 'a1', 'auto', 'queued', 1, '', 2);

      insertDep('c', 'a', { type: 'contains', value: 'pass' });
      insertDep('c', 'b', { type: 'contains', value: 'deploy' });

      completeAndCascade('a', 'All tests pass', '1s', 10);
      completeAndCascade('b', 'Ready to deploy', '1s', 10);

      expect(rawStatus('c')).toBe('queued');
    });
  });

  // ─── Transitive skip cascade ─────────────────────────────────────────
  describe('transitive skip propagation', () => {
    it('should cascade skip through multiple levels: A→B→C', () => {
      // A (running) → B (queued, condition: contains "go") → C (queued, depends on B unconditionally)
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'running', 0, '', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'auto', 'queued', 1, '', 1);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c', 'p1', 'C', 'a1', 'auto', 'queued', 2, '', 2);

      insertDep('b', 'a', { type: 'contains', value: 'go' });
      insertDep('c', 'b'); // unconditional dep on B

      // A completes without "go" → B skipped → C should also cascade (B is "done" as skipped)
      completeAndCascade('a', 'Build failed, abort abort', '5s', 100);

      expect(rawStatus('b')).toBe('skipped');
      // C depends on B unconditionally — B is skipped (counts as done), so C should be queued
      expect(rawStatus('c')).toBe('queued');
    });

    it('should skip C when C has a status=completed condition on skipped B', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'running', 0, '', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'auto', 'queued', 1, '', 1);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('c', 'p1', 'C', 'a1', 'auto', 'queued', 2, '', 2);

      insertDep('b', 'a', { type: 'contains', value: 'go' });
      insertDep('c', 'b', { type: 'status', value: 'completed' }); // C requires B to be "completed"

      // A without "go" → B skipped → C condition (status=completed) fails on B (skipped) → C skipped
      completeAndCascade('a', 'Build failed, nothing here', '5s', 100);

      expect(rawStatus('b')).toBe('skipped');
      expect(rawStatus('c')).toBe('skipped');
    });
  });

  // ─── Unconditional deps still work ───────────────────────────────────
  describe('unconditional dependencies (backward compatibility)', () => {
    it('should cascade normally when no conditions are set', () => {
      seedCascadePipeline(db);
      // No conditions on any deps — standard behavior

      const result = completeAndCascade('t1', 'Done', '5s', 100);

      expect(result.cascaded).toContain('t2');
      expect(result.cascaded).toContain('t3');
      expect(rawStatus('t2')).toBe('queued');
      expect(rawStatus('t3')).toBe('awaiting_approval');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SKIP CASCADE
// ═══════════════════════════════════════════════════════════════════════════

describe('Skip Cascade (manual skip)', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should skip a task and cascade to unconditional dependents', () => {
    seedCascadePipeline(db);
    // T1 is running — first complete it so T2/T3 are unblocked
    completeAndCascade('t1', 'Done', '1s', 10);
    expect(rawStatus('t2')).toBe('queued');

    // Now skip T2 via moveTask → T4 still blocked because T3 is awaiting_approval
    const result = moveTask('t2', 'skipped');

    expect(result.task.status).toBe('skipped');
    // T4 depends on both T2 and T3. T2 is now skipped (done), T3 is awaiting_approval (not done)
    expect(rawStatus('t4')).toBe('queued');
  });

  it('should cascade when skip completes last blocking dep', () => {
    seedCascadePipeline(db);
    completeAndCascade('t1', 'Done', '1s', 10);

    // Complete T2 (promote to running first, simulating worker pool)
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = 't2'").run();
    completeAndCascade('t2', 'Done', '1s', 10);
    // T3 is awaiting_approval — approve then skip it
    db.prepare("UPDATE tasks SET status = 'queued' WHERE id = 't3'").run();
    moveTask('t3', 'skipped');

    // Both deps of T4 are done (T2=completed, T3=skipped) → T4 should be queued
    expect(rawStatus('t4')).toBe('queued');
  });

  it('should mark pipeline completed when all tasks are skipped/completed', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

    db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'completed', 0, '', 0);
    db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'auto', 'queued', 1, '', 1);

    insertDep('b', 'a');

    // Skip B — pipeline should be completed (A=completed, B=skipped)
    moveTask('b', 'skipped');

    const pipeline = db.prepare("SELECT status FROM pipelines WHERE id = 'p1'").get() as { status: string };
    expect(pipeline.status).toBe('completed');
  });

  it('should create log entries for skipped tasks', () => {
    seedCascadePipeline(db);
    moveTask('t2', 'skipped');

    const logs = db.prepare("SELECT * FROM logs WHERE pipeline_id = 'p1' AND msg LIKE '%skipped%'").all();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-RETRY
// ═══════════════════════════════════════════════════════════════════════════

describe('Auto-Retry Logic', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should store auto_retry flag when creating a task', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const task = createTask('p1', {
      name: 'Retry Task',
      agentId: 'a1',
      model: 'claude',
      approval: 'auto',
      stage: 0,
      dependsOn: [],
      input: 'Do something',
      autoRetry: true,
    });

    expect(task.autoRetry).toBe(true);
  });

  it('should default auto_retry to false', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const task = createTask('p1', {
      name: 'Normal Task',
      agentId: 'a1',
      model: 'claude',
      approval: 'auto',
      stage: 0,
      dependsOn: [],
      input: 'Do something',
    });

    expect(task.autoRetry).toBe(false);
  });

  it('should preserve auto_retry=true in DB and getTask', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const task = createTask('p1', {
      name: 'Retry',
      agentId: 'a1',
      model: 'claude',
      approval: 'auto',
      stage: 0,
      dependsOn: [],
      input: '',
      autoRetry: true,
    });

    const fetched = getTask(task.id);
    expect(fetched.autoRetry).toBe(true);

    // Also check raw DB value
    const row = db.prepare('SELECT auto_retry FROM tasks WHERE id = ?').get(task.id) as { auto_retry: number };
    expect(row.auto_retry).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEPENDENCY CONDITIONS IN CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe('Dependency Conditions CRUD', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should create a task with dependency conditions', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const t1 = createTask('p1', {
      name: 'Task A',
      agentId: 'a1',
      model: 'claude',
      approval: 'auto',
      stage: 0,
      dependsOn: [],
      input: '',
    });

    const t2 = createTask('p1', {
      name: 'Task B',
      agentId: 'a1',
      model: 'claude',
      approval: 'auto',
      stage: 1,
      dependsOn: [{ taskId: t1.id, condition: { type: 'contains', value: 'success' } }],
      input: '',
    });

    expect(t2.dependsOn).toContain(t1.id);
    expect(t2.dependencyConditions).toBeDefined();
    expect(t2.dependencyConditions[t1.id]).toEqual({ type: 'contains', value: 'success' });
  });

  it('should store condition in task_deps table', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const t1 = createTask('p1', {
      name: 'A', agentId: 'a1', model: 'claude', approval: 'auto',
      stage: 0, dependsOn: [], input: '',
    });
    createTask('p1', {
      name: 'B', agentId: 'a1', model: 'claude', approval: 'auto',
      stage: 1,
      dependsOn: [{ taskId: t1.id, condition: { type: 'regex', value: '\\d+ passed' } }],
      input: '',
    });

    const row = db.prepare('SELECT condition FROM task_deps WHERE depends_on_task_id = ?').get(t1.id) as { condition: string };
    const parsed = JSON.parse(row.condition);
    expect(parsed.type).toBe('regex');
    expect(parsed.value).toBe('\\d+ passed');
  });

  it('should return empty dependencyConditions for tasks without conditions', () => {
    seedCascadePipeline(db);
    const task = getTask('t2');
    expect(task.dependencyConditions).toEqual({});
  });

  it('should return conditions in listTasks', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

    const t1 = createTask('p1', {
      name: 'A', agentId: 'a1', model: 'claude', approval: 'auto',
      stage: 0, dependsOn: [], input: '',
    });
    createTask('p1', {
      name: 'B', agentId: 'a1', model: 'claude', approval: 'auto',
      stage: 1,
      dependsOn: [{ taskId: t1.id, condition: { type: 'contains', value: 'ok' } }],
      input: '',
    });

    const tasks = listTasks('p1');
    const taskB = tasks.find((t) => t.name === 'B');
    expect(taskB?.dependencyConditions[t1.id]).toEqual({ type: 'contains', value: 'ok' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ON_ERROR APPROVAL MODE
// ═══════════════════════════════════════════════════════════════════════════

describe('on_error approval mode in cascade', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should treat on_error as auto (cascade to running, not awaiting_approval)', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

    db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('a', 'p1', 'A', 'a1', 'auto', 'running', 0, '', 0);
    db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('b', 'p1', 'B', 'a1', 'on_error', 'queued', 1, '', 1);

    insertDep('b', 'a');

    completeAndCascade('a', 'Done', '1s', 10);

    expect(rawStatus('b')).toBe('queued');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RETRY COUNTER RESET
// ═══════════════════════════════════════════════════════════════════════════

describe('Retry counter management', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should reset counters when task is moved to queued (fresh restart)', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

    // Simulate a task that failed after iteration 2
    db.prepare(
      `INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order, iteration, retry_count, current_run_id, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t1', 'p1', 'T1', 'a1', 'auto', 'failed', 0, '', 0, 2, 2, 'run-123', 'old output');

    // Move back to queued (user restart)
    moveTask('t1', 'queued');

    const row = db.prepare('SELECT iteration, retry_count, current_run_id, output FROM tasks WHERE id = ?').get('t1') as {
      iteration: number;
      retry_count: number;
      current_run_id: string | null;
      output: string | null;
    };

    expect(row.iteration).toBe(0);
    expect(row.retry_count).toBe(0);
    expect(row.current_run_id).toBeNull();
    expect(row.output).toBeNull();
  });

  it('should reset counters when moving failed task to running', () => {
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');

    db.prepare(
      `INSERT INTO tasks (id, pipeline_id, name, agent_id, approval, status, stage, input, sort_order, iteration, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t1', 'p1', 'T1', 'a1', 'auto', 'failed', 0, '', 0, 3, 3);

    moveTask('t1', 'running');

    const row = db.prepare('SELECT iteration, retry_count FROM tasks WHERE id = ?').get('t1') as {
      iteration: number;
      retry_count: number;
    };

    expect(row.iteration).toBe(0);
    expect(row.retry_count).toBe(0);
  });
});
