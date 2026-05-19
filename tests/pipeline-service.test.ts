import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;
const cleanupTaskWorktreeNow = vi.fn();

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

vi.mock('../server/engine/worktree-cleanup-service.js', () => ({
  cleanupTaskWorktreeNow,
}));

const { listPipelines, getPipeline, createPipeline, updatePipeline, deletePipeline, recalcPipelineStatus } = await import('../server/services/pipeline-service.js');

describe('Pipeline Service', () => {
  beforeEach(() => {
    db = createTestDb();
    cleanupTaskWorktreeNow.mockClear();
    // Seed an agent for task creation
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('a1', 'Agent A', 'prompt');
  });

  afterEach(() => {
    db.close();
  });

  describe('CRUD', () => {
    it('should create a pipeline', () => {
      const pipeline = createPipeline({
        name: 'My Pipeline',
        workingDir: '/tmp/my-pipeline',
      });
      expect(pipeline.name).toBe('My Pipeline');
      expect(pipeline.status).toBe('queued');
      expect(pipeline.workingDir).toBe('/tmp/my-pipeline');
      expect(pipeline.gitBranch).toBeNull();
      expect(pipeline.tasks).toHaveLength(0);
      expect(pipeline.logs).toHaveLength(1); // 'Pipeline initialized'
    });

    it('should persist pipeline default code line', () => {
      const pipeline = createPipeline({
        name: 'Branch Aware',
        workingDir: '/tmp/branch-aware',
        gitBranch: 'release/2026-q1',
      });

      expect(pipeline.gitBranch).toBe('release/2026-q1');
    });

    it('should create a pipeline with tasks', () => {
      const pipeline = createPipeline({
        name: 'Full Pipeline',
        workingDir: '/tmp/full-pipeline',
        tasks: [
          { name: 'T1', agentId: 'a1', model: 'claude', approval: 'auto', stage: 0, dependsOn: [], input: 'step 1' },
          { name: 'T2', agentId: 'a1', model: 'claude', approval: 'manual', stage: 1, dependsOn: [], input: 'step 2' },
        ],
      });

      expect(pipeline.tasks).toHaveLength(2);
      // Sorted newest-first (DESC sort_order)
      expect(pipeline.tasks[0]!.name).toBe('T2');
      expect(pipeline.tasks[1]!.name).toBe('T1');
      expect(pipeline.tasks[0]!.approval).toBe('manual');
    });

    it('should list all pipelines', () => {
      createPipeline({ name: 'Pipeline A', workingDir: '/tmp/pipeline-a' });
      createPipeline({ name: 'Pipeline B', workingDir: '/tmp/pipeline-b' });
      const list = listPipelines();
      expect(list).toHaveLength(2);
    });

    it('should get a single pipeline', () => {
      const created = createPipeline({ name: 'Test', workingDir: '/tmp/test-pipeline' });
      const fetched = getPipeline(created.id);
      expect(fetched.name).toBe('Test');
    });

    it('should throw 404 for non-existent pipeline', () => {
      expect(() => getPipeline('nonexistent')).toThrow();
    });

    it('should update pipeline name', () => {
      const created = createPipeline({ name: 'Old Name', workingDir: '/tmp/old-name' });
      const updated = updatePipeline(created.id, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('should update pipeline status', () => {
      const created = createPipeline({ name: 'Test', workingDir: '/tmp/status-test' });
      const updated = updatePipeline(created.id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('should update pipeline default code line', () => {
      const created = createPipeline({ name: 'Test', workingDir: '/tmp/git-branch-test' });
      const updated = updatePipeline(created.id, {
        gitBranch: 'develop',
      });
      expect(updated.gitBranch).toBe('develop');
    });

    it('should reject create without working directory', () => {
      expect(() => createPipeline({
        name: 'Missing Directory',
        workingDir: '   ',
      })).toThrow('Working directory is required');
    });

    it('should reject clearing working directory during update', () => {
      const created = createPipeline({
        name: 'Has Directory',
        workingDir: '/tmp/has-directory',
      });

      expect(() => updatePipeline(created.id, {
        workingDir: ' ',
      })).toThrow('Working directory is required');
    });

    it('should delete a pipeline', () => {
      const created = createPipeline({ name: 'To Delete', workingDir: '/tmp/to-delete' });
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, worktree_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-delete',
        created.id,
        'Task to delete',
        'a1',
        'claude',
        'auto',
        'completed',
        0,
        '',
        0,
        '/tmp/to-delete/.agentflow/worktrees/task-t-delete',
      );
      const result = deletePipeline(created.id);
      expect(result.deleted).toBe(true);
      expect(cleanupTaskWorktreeNow).toHaveBeenCalledWith({
        id: 't-delete',
        projectDir: '/tmp/to-delete',
        worktreePath: '/tmp/to-delete/.agentflow/worktrees/task-t-delete',
      });
      expect(() => getPipeline(created.id)).toThrow();
    });

    it('should reject deleting a pipeline with running tasks', () => {
      const created = createPipeline({ name: 'Busy Pipeline', workingDir: '/tmp/busy-pipeline' });
      db.prepare(`
        INSERT INTO tasks (
          id, pipeline_id, name, agent_id, model, approval, status, stage, input,
          sort_order, worktree_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        't-running',
        created.id,
        'Running task',
        'a1',
        'claude',
        'auto',
        'running',
        0,
        '',
        0,
        '/tmp/busy-pipeline/.agentflow/worktrees/task-t-running',
      );

      expect(() => deletePipeline(created.id)).toThrow(
        "Cannot delete pipeline while task 't-running' is running. Stop it first.",
      );
      expect(cleanupTaskWorktreeNow).not.toHaveBeenCalled();
    });

    it('should throw 404 when deleting non-existent pipeline', () => {
      expect(() => deletePipeline('nonexistent')).toThrow();
    });
  });

  describe('recalcPipelineStatus', () => {
    it('should be queued when no tasks', () => {
      const p = createPipeline({ name: 'Empty', workingDir: '/tmp/empty' });
      recalcPipelineStatus(p.id);
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get(p.id) as { status: string };
      expect(row.status).toBe('queued');
    });

    it('should be running when tasks are running', () => {
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 'p1', 'T1', 'a1', 'running', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t2', 'p1', 'T2', 'a1', 'queued', 1);

      recalcPipelineStatus('p1');
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get('p1') as { status: string };
      expect(row.status).toBe('running');
    });

    it('should be completed when all tasks completed', () => {
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 'p1', 'T1', 'a1', 'completed', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t2', 'p1', 'T2', 'a1', 'completed', 1);

      recalcPipelineStatus('p1');
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get('p1') as { status: string };
      expect(row.status).toBe('completed');
    });

    it('should be blocked when a task is blocked', () => {
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'running', '2024-01-01');
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 'p1', 'T1', 'a1', 'completed', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t2', 'p1', 'T2', 'a1', 'rejected', 1);

      recalcPipelineStatus('p1');
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get('p1') as { status: string };
      expect(row.status).toBe('blocked');
    });

    it('should prioritize running over blocked', () => {
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 'p1', 'T1', 'a1', 'running', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t2', 'p1', 'T2', 'a1', 'rejected', 1);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t3', 'p1', 'T3', 'a1', 'queued', 2);

      recalcPipelineStatus('p1');
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get('p1') as { status: string };
      expect(row.status).toBe('running');
    });

    it('should detect awaiting_approval as running', () => {
      db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'P', 'queued', '2024-01-01');
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 'p1', 'T1', 'a1', 'awaiting_approval', 0);
      db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run('t2', 'p1', 'T2', 'a1', 'queued', 1);

      recalcPipelineStatus('p1');
      const row = db.prepare('SELECT status FROM pipelines WHERE id = ?').get('p1') as { status: string };
      expect(row.status).toBe('running');
    });
  });
});
