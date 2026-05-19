import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

const { executeHook, runPreTaskHook, runPostTaskHook } = await import('../server/engine/task-hooks.js');

describe('Task Hooks', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('executeHook', () => {
    it('should load legacy hook keys as fallback aliases', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_task_hook', 'echo legacy')").run();

      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'Test Task',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });

      expect(result).not.toBeNull();
      expect(result!.stdout.trim()).toBe('legacy');
    });

    it('should return null when no hook is configured', async () => {
      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'Test',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });
      expect(result).toBeNull();
    });

    it('should return null for empty hook script', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', '')").run();
      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'Test',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });
      expect(result).toBeNull();
    });

    it('should execute a simple hook and return result', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', 'echo hello')").run();

      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'Test Task',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });

      expect(result).not.toBeNull();
      expect(result!.exitCode).toBe(0);
      expect(result!.stdout.trim()).toBe('hello');
    });

    it('should pass environment variables to hook', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', 'echo $AGENTFLOW_TASK_NAME')").run();

      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'My Task',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });

      expect(result).not.toBeNull();
      expect(result!.stdout.trim()).toBe('My Task');
    });

    it('should report non-zero exit codes', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', 'exit 1')").run();

      const result = await executeHook('pre_run_hook', {
        taskId: 't1',
        taskName: 'Test',
        pipelineId: 'p1',
        workingDir: '/tmp',
      });

      expect(result).not.toBeNull();
      expect(result!.exitCode).toBe(1);
    });

    it('should pass post-hook specific env vars', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('post_run_hook', 'printf \"%s|%s|%s|%s\" \"$AGENTFLOW_TASK_STATUS\" \"$AGENTFLOW_TASK_OUTPUT\" \"$AGENTFLOW_TASK_TOKENS\" \"$AGENTFLOW_TASK_DURATION_MS\"')").run();

      const result = await executeHook('post_run_hook', {
        taskId: 't1',
        taskName: 'Test',
        pipelineId: 'p1',
        workingDir: '/tmp',
        taskStatus: 'done',
        taskExitCode: 0,
        taskOutput: 'hello',
        taskTokens: 42,
        taskDurationMs: 1500,
      });

      expect(result).not.toBeNull();
      expect(result!.stdout.trim()).toBe('done|hello|42|1500');
    });
  });

  describe('runPreTaskHook', () => {
    it('should return ok:true when no hook configured', async () => {
      const result = await runPreTaskHook('t1', 'Test', 'p1', '/tmp');
      expect(result.ok).toBe(true);
      expect(result.result).toBeNull();
    });

    it('should return ok:true for successful hook', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', 'echo ok')").run();
      // Need a pipeline for the log entry
      db.prepare("INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'running', '2024-01-01')").run();

      const result = await runPreTaskHook('t1', 'Test', 'p1', '/tmp', 'dev', 'claude:sonnet');
      expect(result.ok).toBe(true);

      const logs = db.prepare("SELECT type, msg FROM logs WHERE pipeline_id = 'p1' ORDER BY rowid").all() as { type: string; msg: string }[];
      expect(logs.some((log) => log.msg.includes('Pre-run hook started'))).toBe(true);
      expect(logs.some((log) => log.msg.includes('Pre-run hook completed'))).toBe(true);
      expect(logs.some((log) => log.msg.includes('Pre-run hook stdout: ok'))).toBe(true);
    });

    it('should return ok:false for failed hook', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('pre_run_hook', 'exit 1')").run();
      db.prepare("INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'running', '2024-01-01')").run();

      const result = await runPreTaskHook('t1', 'Test', 'p1', '/tmp', 'dev', 'claude:sonnet');
      expect(result.ok).toBe(false);
      expect(result.result!.exitCode).toBe(1);

      // Should have logged the failure
      const logs = db.prepare("SELECT type, msg FROM logs WHERE pipeline_id = 'p1' ORDER BY rowid").all() as { type: string; msg: string }[];
      expect(logs.some((log) => log.msg.includes('Pre-run hook failed'))).toBe(true);
    });
  });

  describe('runPostTaskHook', () => {
    it('should return null when no hook configured', async () => {
      const result = await runPostTaskHook('t1', 'Test', 'p1', '/tmp', 'done', 0);
      expect(result).toBeNull();
    });

    it('should execute post-hook and return result', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('post_run_hook', 'echo done')").run();
      db.prepare("INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'running', '2024-01-01')").run();

      const result = await runPostTaskHook('t1', 'Test', 'p1', '/tmp', 'done', 0, {
        agentId: 'dev',
        model: 'claude:sonnet',
        taskDurationMs: 1234,
        taskOutput: 'completed output',
        taskTokens: 99,
      });
      expect(result).not.toBeNull();
      expect(result!.exitCode).toBe(0);

      const logs = db.prepare("SELECT type, msg FROM logs WHERE pipeline_id = 'p1' ORDER BY rowid").all() as { type: string; msg: string }[];
      expect(logs.some((log) => log.msg.includes('Post-run hook started'))).toBe(true);
      expect(logs.some((log) => log.msg.includes('Post-run hook completed'))).toBe(true);
      expect(logs.some((log) => log.msg.includes('Post-run hook stdout: done'))).toBe(true);
    });

    it('should log warning for failed post-hook but not block task', async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('post_run_hook', 'exit 42')").run();
      db.prepare("INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'running', '2024-01-01')").run();

      const result = await runPostTaskHook('t1', 'Test', 'p1', '/tmp', 'done', 0);
      expect(result).not.toBeNull();
      expect(result!.exitCode).toBe(42);

      // Post-hook failure is logged as warning
      const logs = db.prepare("SELECT type, msg FROM logs WHERE pipeline_id = 'p1' ORDER BY rowid").all() as { type: string; msg: string }[];
      expect(logs.some((log) => log.msg.includes('Post-run hook failed'))).toBe(true);
    });
  });
});
