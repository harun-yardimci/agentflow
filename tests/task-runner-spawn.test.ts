import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const enqueue = vi.fn();

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

vi.mock('../server/engine/worker-pool.js', () => ({
  workerPool: {
    enqueue,
    registerAbort: vi.fn(),
  },
}));

const { triggerSpawnFromOutput } = await import('../server/engine/task-runner.js');

describe('task-runner spawn flow', () => {
  beforeEach(() => {
    db = createTestDb();
    enqueue.mockReset();

    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'max_spawned_tasks_per_completion',
      '10',
    );

    db.prepare('INSERT INTO agents (id, name, prompt, default_model) VALUES (?, ?, ?, ?)').run(
      'developer',
      'Developer',
      'Ship the fix',
      'claude:opus',
    );

    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run(
      'p1',
      'Pipeline',
      'completed',
      '2024-01-01',
    );
  });

  afterEach(() => {
    db.close();
  });

  it('creates auto-approved spawned tasks as queued and enqueues them', () => {
    const output = `Done.

<!-- SPAWN_TASKS
[
  {
    "name": "Follow-up implementation",
    "agentId": "developer",
    "approval": "auto",
    "input": "Apply the change"
  }
]
SPAWN_TASKS -->`;

    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage,
        input, output, sort_order, timeout_ms, created_at, worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'source-task',
      'p1',
      'Source Task',
      'developer',
      'claude:sonnet',
      'auto',
      'completed',
      0,
      'Initial work',
      output,
      0,
      600000,
      '2024-01-01',
      '/tmp/worktree',
    );

    const spawnedIds = triggerSpawnFromOutput('source-task');

    expect(spawnedIds).toHaveLength(1);

    const spawned = db.prepare(`
      SELECT status, approval, model, worktree_path, stage
      FROM tasks
      WHERE id = ?
    `).get(spawnedIds[0]) as {
      status: string;
      approval: string;
      model: string;
      worktree_path: string | null;
      stage: number;
    };

    expect(spawned.status).toBe('queued');
    expect(spawned.approval).toBe('auto');
    expect(spawned.model).toBe('claude:opus');
    expect(spawned.worktree_path).toBe('/tmp/worktree');
    expect(spawned.stage).toBe(0); // inherits source task's stage, not +1

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      taskId: spawnedIds[0],
      pipelineId: 'p1',
      taskName: 'Follow-up implementation',
    }));
  });

  it('serializes inherited spawned siblings so only the first starts immediately', () => {
    const output = `Done.

<!-- SPAWN_TASKS
[
  {
    "name": "Follow-up implementation",
    "agentId": "developer",
    "approval": "auto",
    "input": "Apply the change"
  },
  {
    "name": "Add tests",
    "agentId": "developer",
    "approval": "auto",
    "input": "Add regression tests"
  }
]
SPAWN_TASKS -->`;

    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage,
        input, output, sort_order, timeout_ms, created_at, worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'source-task',
      'p1',
      'Source Task',
      'developer',
      'claude:sonnet',
      'auto',
      'completed',
      0,
      'Initial work',
      output,
      0,
      600000,
      '2024-01-01',
      '/tmp/worktree',
    );

    const spawnedIds = triggerSpawnFromOutput('source-task');

    expect(spawnedIds).toHaveLength(2);

    const siblingDep = db.prepare(`
      SELECT 1
      FROM task_deps
      WHERE task_id = ? AND depends_on_task_id = ?
    `).get(spawnedIds[1], spawnedIds[0]);

    expect(siblingDep).toBeTruthy();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      taskId: spawnedIds[0],
      taskName: 'Follow-up implementation',
    }));
  });

  it('places spawned task in the stage matching the agent role', () => {
    // Add a qa agent
    db.prepare('INSERT INTO agents (id, name, prompt, default_model) VALUES (?, ?, ?, ?)').run(
      'qa', 'QA Engineer', 'Test everything', 'claude:sonnet',
    );

    // Add pipeline stages: Development (0), Testing (1), Deploy (2)
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-dev', 'p1', 'Development', 0);
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-test', 'p1', 'Testing', 1);
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-deploy', 'p1', 'Deploy', 2);

    const output = `Done.

<!-- SPAWN_TASKS
[
  {
    "name": "Run test suite",
    "agentId": "qa",
    "approval": "auto",
    "input": "Run all tests"
  }
]
SPAWN_TASKS -->`;

    // Source task is in Development (stage 0)
    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage,
        input, output, sort_order, timeout_ms, created_at, worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'source-task', 'p1', 'Build feature', 'developer', 'claude:opus',
      'auto', 'completed', 0, 'Build it', output, 0, 600000, '2024-01-01',
      '/tmp/worktree',
    );

    const spawnedIds = triggerSpawnFromOutput('source-task');
    expect(spawnedIds).toHaveLength(1);

    const spawned = db.prepare('SELECT stage, stage_id FROM tasks WHERE id = ?')
      .get(spawnedIds[0]) as { stage: number; stage_id: string | null };

    // QA agent should land in Testing (stage 1), not Development (stage 0)
    expect(spawned.stage).toBe(1);
    expect(spawned.stage_id).toBe('s-test');
  });

  it('falls back to source stage when agent has no stage match', () => {
    // Add a custom agent with no keyword match
    db.prepare('INSERT INTO agents (id, name, prompt, default_model) VALUES (?, ?, ?, ?)').run(
      'custom-bot', 'Custom Bot', 'Do stuff', 'claude:sonnet',
    );

    // Add pipeline stages
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-dev', 'p1', 'Development', 0);
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-test', 'p1', 'Testing', 1);

    const output = `Done.

<!-- SPAWN_TASKS
[
  {
    "name": "Custom work",
    "agentId": "custom-bot",
    "approval": "auto",
    "input": "Do something"
  }
]
SPAWN_TASKS -->`;

    // Source task is in Testing (stage 1)
    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage,
        input, output, sort_order, timeout_ms, created_at, worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'source-task', 'p1', 'Test task', 'developer', 'claude:opus',
      'auto', 'completed', 1, 'Test it', output, 0, 600000, '2024-01-01',
      '/tmp/worktree',
    );

    const spawnedIds = triggerSpawnFromOutput('source-task');
    expect(spawnedIds).toHaveLength(1);

    const spawned = db.prepare('SELECT stage, stage_id FROM tasks WHERE id = ?')
      .get(spawnedIds[0]) as { stage: number; stage_id: string | null };

    // No match — should fall back to source task's stage (1 = Testing)
    expect(spawned.stage).toBe(1);
    expect(spawned.stage_id).toBe('s-test');
  });

  it('uses directive stage when explicitly provided', () => {
    // Add pipeline stages
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-dev', 'p1', 'Development', 0);
    db.prepare(
      'INSERT INTO pipeline_stages (id, pipeline_id, name, sort_order) VALUES (?, ?, ?, ?)',
    ).run('s-deploy', 'p1', 'Deploy', 1);

    const output = `Done.

<!-- SPAWN_TASKS
[
  {
    "name": "Hotfix deploy",
    "agentId": "developer",
    "approval": "auto",
    "stage": 1,
    "input": "Deploy hotfix"
  }
]
SPAWN_TASKS -->`;

    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage,
        input, output, sort_order, timeout_ms, created_at, worktree_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'source-task', 'p1', 'Source', 'developer', 'claude:opus',
      'auto', 'completed', 0, 'Fix', output, 0, 600000, '2024-01-01',
      '/tmp/worktree',
    );

    const spawnedIds = triggerSpawnFromOutput('source-task');
    expect(spawnedIds).toHaveLength(1);

    const spawned = db.prepare('SELECT stage, stage_id FROM tasks WHERE id = ?')
      .get(spawnedIds[0]) as { stage: number; stage_id: string | null };

    // Directive says stage 1 — should override agent matching
    expect(spawned.stage).toBe(1);
    expect(spawned.stage_id).toBe('s-deploy');
  });
});
