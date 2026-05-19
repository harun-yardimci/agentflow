import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedCascadePipeline } from './helpers/test-db.js';

let db: Database.Database;
const cleanupTaskWorktreeNow = vi.fn();

// Mock getDb before importing task-service
vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

vi.mock('../server/engine/worktree-cleanup-service.js', () => ({
  cleanupTaskWorktreeNow,
}));

// Import after mock
const { listTasks, getTask, createTask, updateTask, deleteTask, moveTask, approveTask, rejectTask, completeAndCascade, archiveTask } = await import('../server/services/task-service.js');
const { recalcPipelineStatus } = await import('../server/services/pipeline-service.js');

describe('Task Service', () => {
  beforeEach(() => {
    db = createTestDb();
    cleanupTaskWorktreeNow.mockClear();
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD operations', () => {
    it('should create a task and return it', () => {
      // Setup pipeline + agent
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent A', 'prompt');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'Pipeline', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'My Task',
        agentId: 'a1',
        model: 'claude',
        approval: 'auto',
        stage: 0,
        dependsOn: [],
        input: 'Do something',
      });

      expect(task.name).toBe('My Task');
      expect(task.status).toBe('queued');
      expect(task.agentId).toBe('a1');
      expect(task.input).toBe('Do something');
      expect(task.dependsOn).toEqual([]);
    });

    it('should list tasks for a pipeline', () => {
      seedCascadePipeline(db);
      const tasks = listTasks('p1');
      expect(tasks).toHaveLength(4);
      // Sorted newest-first (DESC sort_order)
      expect(tasks[0]!.name).toBe('Task 4');
      expect(tasks[1]!.name).toBe('Task 3');
    });

    it('should get a single task', () => {
      seedCascadePipeline(db);
      const task = getTask('t1');
      expect(task.id).toBe('t1');
      expect(task.name).toBe('Task 1');
    });

    it('should include source task metadata for follow-up tasks', () => {
      seedCascadePipeline(db);
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, task_type, source_task_id, worktree_status, branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-follow',
        'p1',
        'Follow-up task',
        'a1',
        'claude',
        'auto',
        'completed',
        1,
        '',
        99,
        'spawned',
        't2',
        'ready_for_review',
        null,
      );

      const child = getTask('t-follow');
      expect(child.sourceTaskId).toBe('t2');
      expect(child.sourceTaskName).toBe('Task 2');
      expect(child.sourceTaskStatus).toBe('queued');
      expect(child.sourceTaskArchivedAt).toBeNull();
    });

    it('should throw 404 for missing task', () => {
      expect(() => getTask('nonexistent')).toThrow();
    });

    it('should update task fields', () => {
      seedCascadePipeline(db);
      // t2 is 'queued' — safe to update execution-critical fields
      const updated = updateTask('t2', { name: 'Updated Task', model: 'gpt-4' });
      expect(updated.name).toBe('Updated Task');
      expect(updated.model).toBe('gpt-4');
    });

    it('should reject updating locked fields on a running task', () => {
      seedCascadePipeline(db);
      // t1 is 'running' — locked fields should throw 409
      expect(() => updateTask('t1', { model: 'gpt-4' })).toThrow('Cannot change model while task is running');
      expect(() => updateTask('t1', { agentId: 'other' })).toThrow('Cannot change agentId while task is running');
      expect(() => updateTask('t1', { input: 'new prompt' })).toThrow('Cannot change input while task is running');
      expect(() => updateTask('t1', { stage: 2 })).toThrow('Cannot change stage while task is running');
      expect(() => updateTask('t1', { branch: 'feature/demo' })).toThrow('Cannot change branch while task is running');
      expect(() => updateTask('t1', { useWorktree: false })).toThrow('Cannot change useWorktree while task is running');
      expect(() => updateTask('t1', { dependsOn: ['t2'] })).toThrow('Cannot change dependsOn while task is running');
      // name, priority, tags should still work
      const updated = updateTask('t1', { name: 'Renamed Running Task' });
      expect(updated.name).toBe('Renamed Running Task');
    });

    it('should reject changing start source after task execution has started', () => {
      seedCascadePipeline(db);
      db.prepare("UPDATE tasks SET status = 'completed' WHERE id = 't2'").run();

      expect(() => updateTask('t2', { branch: 'feature/demo' })).toThrow(
        'Cannot change branch after task execution has started',
      );
      expect(() => updateTask('t2', { useWorktree: false })).toThrow(
        'Cannot change useWorktree after task execution has started',
      );
      expect(() => updateTask('t2', { dependsOn: ['t1'] })).toThrow(
        'Cannot change dependsOn after task execution has started',
      );
    });

    it('should invalidate cached worktree when branch changes', () => {
      seedCascadePipeline(db);
      db.prepare(
        "UPDATE tasks SET worktree_path = '/tmp/task-t2', worktree_status = 'active' WHERE id = 't2'"
      ).run();

      const updated = updateTask('t2', { branch: 'feature/demo' });

      expect(updated.branch).toBe('feature/demo');
      expect(updated.worktreePath).toBeNull();
      expect(updated.worktreeStatus).toBe('none');
    });

    it('should invalidate cached worktree when workspace mode changes', () => {
      seedCascadePipeline(db);
      db.prepare(
        "UPDATE tasks SET worktree_path = '/tmp/task-t2', worktree_status = 'active' WHERE id = 't2'"
      ).run();

      const updated = updateTask('t2', { useWorktree: false });

      expect(updated.useWorktree).toBe(false);
      expect(updated.worktreePath).toBeNull();
      expect(updated.worktreeStatus).toBe('none');
    });

    it('should invalidate cached worktree when dependencies change', () => {
      seedCascadePipeline(db);
      db.prepare(
        "UPDATE tasks SET worktree_path = '/tmp/task-t4', worktree_status = 'active' WHERE id = 't4'"
      ).run();

      const updated = updateTask('t4', { dependsOn: ['t3'] });

      expect(updated.dependsOn).toEqual(['t3']);
      expect(updated.worktreePath).toBeNull();
      expect(updated.worktreeStatus).toBe('none');
    });

    it('should delete a task', () => {
      seedCascadePipeline(db);
      db.prepare(
        "UPDATE pipelines SET working_dir = '/tmp/project-root' WHERE id = 'p1'",
      ).run();
      db.prepare(
        "UPDATE tasks SET worktree_path = '/tmp/project-root/.agentflow/worktrees/task-t2' WHERE id = 't2'",
      ).run();

      const result = deleteTask('t2');

      expect(result.deleted).toBe(true);
      expect(cleanupTaskWorktreeNow).toHaveBeenCalledWith({
        id: 't2',
        projectDir: '/tmp/project-root',
        worktreePath: '/tmp/project-root/.agentflow/worktrees/task-t2',
      });
      expect(() => getTask('t2')).toThrow();
    });

    it('should reject deleting a running task', () => {
      seedCascadePipeline(db);
      db.prepare(
        "UPDATE tasks SET status = 'running', worktree_path = '/tmp/project-root/.agentflow/worktrees/task-t1' WHERE id = 't1'",
      ).run();

      expect(() => deleteTask('t1')).toThrow('Cannot delete a running task. Stop it first.');
      expect(cleanupTaskWorktreeNow).not.toHaveBeenCalled();
    });

    it('archives inherited follow-up tasks when parent task is archived', () => {
      seedCascadePipeline(db);
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, task_type, source_task_id, worktree_status, branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-follow',
        'p1',
        'Follow-up task',
        'a1',
        'claude',
        'auto',
        'completed',
        1,
        '',
        99,
        'spawned',
        't2',
        'ready_for_review',
        null,
      );

      archiveTask('t2');

      const child = getTask('t-follow');
      expect(child.archivedAt).toBeTruthy();
      expect(child.worktreeStatus).toBe('archived_with_parent');
    });

    it('archives inherited follow-up descendants recursively when parent task is archived', () => {
      seedCascadePipeline(db);
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, task_type, source_task_id, worktree_status, branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-follow',
        'p1',
        'Follow-up task',
        'a1',
        'claude',
        'auto',
        'completed',
        1,
        '',
        99,
        'spawned',
        't2',
        'ready_for_review',
        null,
      );
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, task_type, source_task_id, worktree_status, branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-follow-child',
        'p1',
        'Follow-up child task',
        'a1',
        'claude',
        'auto',
        'completed',
        2,
        '',
        100,
        'spawned',
        't-follow',
        'ready_for_review',
        null,
      );

      archiveTask('t2');

      const child = getTask('t-follow');
      const grandchild = getTask('t-follow-child');
      expect(child.archivedAt).toBeTruthy();
      expect(child.worktreeStatus).toBe('archived_with_parent');
      expect(grandchild.archivedAt).toBeTruthy();
      expect(grandchild.worktreeStatus).toBe('archived_with_parent');
    });

    it('should create tasks with dependencies', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent A', 'prompt');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'Pipeline', 'queued', '2024-01-01');

      // Create two tasks, second depends on first
      const t1 = createTask('p1', { name: 'Task A', agentId: 'a1', model: 'claude', approval: 'auto', stage: 0, dependsOn: [], input: '' });
      const t2 = createTask('p1', { name: 'Task B', agentId: 'a1', model: 'claude', approval: 'auto', stage: 1, dependsOn: [t1.id], input: '' });

      expect(t2.dependsOn).toContain(t1.id);
    });

    it('should throw 404 for non-existent pipeline', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent A', 'prompt');
      expect(() => createTask('invalid-pipeline', {
        name: 'Task', agentId: 'a1', model: 'claude', approval: 'auto', stage: 0, dependsOn: [], input: '',
      })).toThrow();
    });
  });

  describe('Priority and Tags', () => {
    it('should create a task with priority', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'Urgent Task', agentId: 'a1', model: 'claude', approval: 'auto',
        stage: 0, dependsOn: [], input: '', priority: 'urgent',
      });

      expect(task.priority).toBe('urgent');
    });

    it('should create a task with tags', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'Tagged Task', agentId: 'a1', model: 'claude', approval: 'auto',
        stage: 0, dependsOn: [], input: '', tags: ['frontend', 'urgent-fix'],
      });

      expect(task.tags).toEqual(['frontend', 'urgent-fix']);
    });

    it('should default priority to null and tags to empty array', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'No Priority', agentId: 'a1', model: 'claude', approval: 'auto',
        stage: 0, dependsOn: [], input: '',
      });

      expect(task.priority).toBeNull();
      expect(task.tags).toEqual([]);
    });

    it('should update task priority', () => {
      seedCascadePipeline(db);
      const updated = updateTask('t1', { priority: 'high' });
      expect(updated.priority).toBe('high');
    });

    it('should update task tags', () => {
      seedCascadePipeline(db);
      const updated = updateTask('t1', { tags: ['backend', 'critical'] });
      expect(updated.tags).toEqual(['backend', 'critical']);
    });

    it('should clear priority by setting to null', () => {
      seedCascadePipeline(db);
      updateTask('t1', { priority: 'high' });
      const cleared = updateTask('t1', { priority: null });
      expect(cleared.priority).toBeNull();
    });

    it('should replace tags entirely on update', () => {
      seedCascadePipeline(db);
      updateTask('t1', { tags: ['a', 'b'] });
      const updated = updateTask('t1', { tags: ['c'] });
      expect(updated.tags).toEqual(['c']);
    });

    it('should return tags and priority in listTasks', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      createTask('p1', {
        name: 'T1', agentId: 'a1', model: 'claude', approval: 'auto',
        stage: 0, dependsOn: [], input: '', priority: 'medium', tags: ['ui'],
      });

      const tasks = listTasks('p1');
      expect(tasks[0]!.priority).toBe('medium');
      expect(tasks[0]!.tags).toEqual(['ui']);
    });

    it('should clean up task_tags when task is deleted', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'T1', agentId: 'a1', model: 'claude', approval: 'auto',
        stage: 0, dependsOn: [], input: '', tags: ['temp'],
      });

      deleteTask(task.id);
      const rows = db.prepare('SELECT * FROM task_tags').all();
      expect(rows).toHaveLength(0);
    });
  });

  describe('Timeout configuration', () => {
    it('should use default_task_timeout_ms for new tasks', () => {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
        'default_task_timeout_ms',
        '2700000',
      );
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'Timeout Default',
        agentId: 'a1',
        model: 'claude',
        approval: 'auto',
        stage: 0,
        dependsOn: [],
        input: '',
      });

      expect(task.timeoutMs).toBe(2700000);
    });

    it('should allow explicit timeoutMs when creating task', () => {
      db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent', 'p');
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');

      const task = createTask('p1', {
        name: 'Timeout Explicit',
        agentId: 'a1',
        model: 'claude',
        approval: 'auto',
        stage: 0,
        dependsOn: [],
        input: '',
        timeoutMs: 900000,
      });

      expect(task.timeoutMs).toBe(900000);
    });

    it('should update timeoutMs', () => {
      seedCascadePipeline(db);
      const updated = updateTask('t1', { timeoutMs: 1200000 });
      expect(updated.timeoutMs).toBe(1200000);
    });
  });

  describe('Cascade logic (completeAndCascade)', () => {
    it('should mark task as completed and cascade auto-approved deps to running', () => {
      seedCascadePipeline(db);

      // Complete T1 — T2 (auto) should go to running, T3 (manual) to awaiting_approval
      const result = completeAndCascade('t1', 'T1 output', '5s', 100);

      expect(result.task.status).toBe('completed');
      expect(result.task.output).toBe('T1 output');
      expect(result.cascaded).toContain('t2');
      expect(result.cascaded).toContain('t3');

      // Verify cascaded statuses
      const t2 = getTask('t2');
      const t3 = getTask('t3');
      expect(t2.status).toBe('queued');
      expect(t3.status).toBe('awaiting_approval');

      // T4 should still be queued (waiting for both T2 and T3)
      const t4 = getTask('t4');
      expect(t4.status).toBe('queued');
    });

    it('should not cascade T4 until BOTH T2 and T3 are completed', () => {
      seedCascadePipeline(db);

      // Complete T1
      completeAndCascade('t1', 'T1 done', '5s', 100);

      // Complete T2 — T4 should STILL be queued because T3 is not completed
      const result2 = completeAndCascade('t2', 'T2 done', '3s', 50);
      expect(result2.cascaded).not.toContain('t4');

      const t4 = getTask('t4');
      expect(t4.status).toBe('queued');
    });

    it('should cascade T4 when both T2 and T3 are completed', () => {
      seedCascadePipeline(db);

      // Complete T1 → T2 goes queued (auto), T3 goes awaiting_approval (manual)
      completeAndCascade('t1', 'T1 done', '5s', 100);

      // Complete T2 (set to running first since worker pool would promote it)
      db.prepare("UPDATE tasks SET status = 'running' WHERE id = 't2'").run();
      completeAndCascade('t2', 'T2 done', '3s', 50);

      // Approve T3 (moves to queued) then set to running and complete it
      approveTask('t3');
      db.prepare("UPDATE tasks SET status = 'running' WHERE id = 't3'").run();
      const result3 = completeAndCascade('t3', 'T3 done', '4s', 75);

      // Now T4 should be cascaded (auto approval → queued)
      expect(result3.cascaded).toContain('t4');
      const t4 = getTask('t4');
      expect(t4.status).toBe('queued');
    });

    it('should write task output to pipeline context', () => {
      seedCascadePipeline(db);
      completeAndCascade('t1', 'Task 1 output data', '5s', 100);

      const ctx = db.prepare("SELECT value FROM pipeline_ctx WHERE pipeline_id = 'p1' AND key = 'task_output:Task 1'").get() as { value: string } | undefined;
      expect(ctx?.value).toBe('Task 1 output data');
    });

    it('should create log entries on completion', () => {
      seedCascadePipeline(db);
      completeAndCascade('t1', 'Done', '5s', 100);

      const logs = db.prepare("SELECT * FROM logs WHERE pipeline_id = 'p1' AND type = 'success'").all() as { msg: string }[];
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.msg.includes('Task 1'))).toBe(true);
    });

    it('should update pipeline status after cascade', () => {
      seedCascadePipeline(db);
      completeAndCascade('t1', 'Done', '5s', 100);

      const pipeline = db.prepare("SELECT status FROM pipelines WHERE id = 'p1'").get() as { status: string };
      expect(pipeline.status).toBe('running');
    });

    it('should set pipeline to completed when all tasks complete', () => {
      seedCascadePipeline(db);

      completeAndCascade('t1', 'Done', '1s', 10);
      completeAndCascade('t2', 'Done', '1s', 10);
      approveTask('t3');
      completeAndCascade('t3', 'Done', '1s', 10);
      completeAndCascade('t4', 'Done', '1s', 10);

      const pipeline = db.prepare("SELECT status FROM pipelines WHERE id = 'p1'").get() as { status: string };
      expect(pipeline.status).toBe('completed');
    });

    it('should not cascade tasks that are not in queued status', () => {
      seedCascadePipeline(db);

      // Manually set T2 to 'rejected' status
      db.prepare("UPDATE tasks SET status = 'rejected' WHERE id = 't2'").run();

      const result = completeAndCascade('t1', 'Done', '5s', 100);

      // T2 was rejected, should NOT be cascaded
      expect(result.cascaded).not.toContain('t2');
      // T3 should still be cascaded (it was queued)
      expect(result.cascaded).toContain('t3');
    });
  });

  describe('moveTask', () => {
    it('should move a task to a new status', () => {
      seedCascadePipeline(db);
      // Complete T1 first so T2's dependency is satisfied
      completeAndCascade('t1', 'Done', '1s', 10);
      // T2 was auto-cascaded to running; move it to queued first, then running
      db.prepare("UPDATE tasks SET status = 'queued' WHERE id = 't2'").run();
      const result = moveTask('t2', 'running');
      expect(result.task.status).toBe('running');
    });

    it('should block move to running when deps unsatisfied', () => {
      seedCascadePipeline(db);
      // T1 is still running, so T2 cannot be moved to running
      expect(() => moveTask('t2', 'running')).toThrow(/unsatisfied dependencies/);
    });

    it('should trigger cascade when moving to completed', () => {
      seedCascadePipeline(db);
      const result = moveTask('t1', 'completed');
      expect(result.task.status).toBe('completed');
      expect(result.cascaded.length).toBeGreaterThan(0);
    });
  });

  describe('approveTask / rejectTask', () => {
    it('should approve an awaiting_approval task', () => {
      seedCascadePipeline(db);
      // Complete T1 so T2's dependency is satisfied
      completeAndCascade('t1', 'Done', '1s', 10);
      // T2 was auto-cascaded to running; set to awaiting_approval
      db.prepare("UPDATE tasks SET status = 'awaiting_approval' WHERE id = 't2'").run();

      const result = approveTask('t2');
      expect(result.status).toBe('queued');
    });

    it('should block approve when deps unsatisfied', () => {
      seedCascadePipeline(db);
      // T1 is still running, T2 deps not met
      db.prepare("UPDATE tasks SET status = 'awaiting_approval' WHERE id = 't2'").run();
      expect(() => approveTask('t2')).toThrow(/unsatisfied dependencies/);
    });

    it('should throw when approving a non-pending task', () => {
      seedCascadePipeline(db);
      expect(() => approveTask('t1')).toThrow(); // t1 is running, not awaiting_approval
    });

    it('should reject a task (set to rejected)', () => {
      seedCascadePipeline(db);
      const result = rejectTask('t2');
      expect(result.status).toBe('rejected');
    });
  });
});
