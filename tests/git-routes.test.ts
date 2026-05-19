import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDb } from './helpers/test-db.js';
import { createWorktree } from '../server/engine/worktree-manager.js';

let db: Database.Database;
let repoDir: string;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

vi.mock('../server/engine/task-runner.js', () => ({
  spawnGitConflictFixer: vi.fn(() => null),
}));

const gitRouter = (await import('../server/routes/git.js')).default;

function createTestRepo(): string {
  const dir = join(
    tmpdir(),
    `agentflow-git-route-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Test Project\n');
  execSync('git add -A && git commit -m "initial"', {
    cwd: dir,
    stdio: 'pipe',
  });
  return dir;
}

interface MockResponse {
  body: unknown;
  status: number;
}

function matchRoutePath(
  routePath: string,
  actualPath: string,
): Record<string, string> | null {
  const routeParts = routePath.split('/').filter(Boolean);
  const actualParts = actualPath.split('/').filter(Boolean);
  if (routeParts.length !== actualParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index]!;
    const actualPart = actualParts[index]!;
    if (routePart.startsWith(':')) {
      params[routePart.slice(1)] = actualPart;
      continue;
    }
    if (routePart !== actualPart) {
      return null;
    }
  }

  return params;
}

async function invokeRoute(
  method: 'post',
  path: string,
  body?: unknown,
): Promise<MockResponse> {
  const stack = (gitRouter as unknown as {
    stack?: Array<{
      route?: {
        methods?: Record<string, boolean>;
        path?: string;
        stack?: Array<{ handle: Function }>;
      };
    }>;
  }).stack ?? [];

  for (const layer of stack) {
    const route = layer.route;
    if (!route?.path || !route.methods?.[method]) continue;

    const params = matchRoutePath(route.path, path);
    if (!params) continue;

    const handlers = route.stack?.map((entry) => entry.handle) ?? [];
    const req = {
      body,
      method: method.toUpperCase(),
      params,
    } as {
      body?: unknown;
      method: string;
      params: Record<string, string>;
    };

    return await new Promise<MockResponse>((resolve, reject) => {
      let statusCode = 200;
      let settled = false;
      const res = {
        json(payload: unknown) {
          if (!settled) {
            settled = true;
            resolve({ body: payload, status: statusCode });
          }
          return res;
        },
        status(code: number) {
          statusCode = code;
          return res;
        },
      };

      const runHandler = (index: number) => {
        const handler = handlers[index];
        if (!handler) {
          if (!settled) {
            settled = true;
            resolve({ body: undefined, status: statusCode });
          }
          return;
        }

        const next = (error?: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          runHandler(index + 1);
        };

        try {
          const maybePromise = handler(req, res, next);
          if (
            maybePromise
            && typeof maybePromise === 'object'
            && 'then' in maybePromise
            && typeof maybePromise.then === 'function'
          ) {
            void maybePromise.then(() => {
              if (!settled) {
                runHandler(index + 1);
              }
            }, reject);
          }
        } catch (error) {
          reject(error);
        }
      };

      runHandler(0);
    });
  }

  throw new Error(`No route matched ${method.toUpperCase()} ${path}`);
}

describe('git routes', () => {
  beforeEach(() => {
    db = createTestDb();
    repoDir = createTestRepo();
    db.prepare(
      'INSERT INTO pipelines (id, name, status, created, working_dir) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'Pipeline', 'queued', '2026-03-25', repoDir);
    db.prepare(
      'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('t1', 'p1', 'Task 1', 'a1', 'claude:sonnet', 'auto', 'queued', 0, '', 0);
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('allows finalize when the pipeline base branch is checked out but clean', async () => {
    const wt = createWorktree('t1', repoDir);
    writeFileSync(join(wt.path, 'feature.txt'), 'hello');
    execSync('git add -A && git commit -m "task branch change"', {
      cwd: wt.path,
      stdio: 'pipe',
    });
    db.prepare(
      "UPDATE tasks SET worktree_path = ?, worktree_status = 'ready_for_review' WHERE id = 't1'",
    ).run(wt.path);
    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage, input,
        sort_order, task_type, source_task_id, worktree_status, branch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      't1-follow',
      'p1',
      'Follow-up task',
      'a1',
      'claude:sonnet',
      'auto',
      'completed',
      1,
      '',
      1,
      'spawned',
      't1',
      'ready_for_review',
      null,
    );
    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage, input,
        sort_order, task_type, source_task_id, worktree_status, branch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      't1-follow-child',
      'p1',
      'Follow-up child task',
      'a1',
      'claude:sonnet',
      'auto',
      'completed',
      2,
      '',
      2,
      'spawned',
      't1-follow',
      'ready_for_review',
      null,
    );

    {
      const response = await invokeRoute('post', '/tasks/t1/git-action', {
        action: 'merge',
      });
      const body = response.body as { ok?: boolean };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      const mergedBranches = execSync(
        'git branch --merged main',
        { cwd: repoDir, stdio: 'pipe' },
      ).toString();
      expect(mergedBranches).toContain('task/t1');
      const child = db.prepare(
        'SELECT archived_at, worktree_status FROM tasks WHERE id = ?',
      ).get('t1-follow') as {
        archived_at: string | null;
        worktree_status: string | null;
      };
      const grandchild = db.prepare(
        'SELECT archived_at, worktree_status FROM tasks WHERE id = ?',
      ).get('t1-follow-child') as {
        archived_at: string | null;
        worktree_status: string | null;
      };
      expect(child.archived_at).toBeTruthy();
      expect(child.worktree_status).toBe('merged_with_parent');
      expect(grandchild.archived_at).toBeTruthy();
      expect(grandchild.worktree_status).toBe('merged_with_parent');
    }
  });

  it('blocks finalize when the pipeline base branch checkout is dirty', async () => {
    const wt = createWorktree('t1', repoDir);
    writeFileSync(join(wt.path, 'feature.txt'), 'hello');
    execSync('git add -A && git commit -m "task branch change"', {
      cwd: wt.path,
      stdio: 'pipe',
    });
    db.prepare(
      "UPDATE tasks SET worktree_path = ?, worktree_status = 'ready_for_review' WHERE id = 't1'",
    ).run(wt.path);
    writeFileSync(join(repoDir, 'dirty.txt'), 'local root change');

    {
      const response = await invokeRoute('post', '/tasks/t1/git-action', {
        action: 'merge',
      });
      const body = response.body as { error?: string; message?: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe('Finalize blocked');
      expect(body.message).toContain(repoDir);
    }
  });

  it('clears cached workspace metadata when switching start source', async () => {
    execSync('git branch develop', { cwd: repoDir, stdio: 'pipe' });
    db.prepare(
      "UPDATE tasks SET worktree_path = '/tmp/task-t1', worktree_status = 'active' WHERE id = 't1'",
    ).run();

    {
      const response = await invokeRoute('post', '/tasks/t1/switch-branch', {
        branch: 'develop',
      });

      expect(response.status).toBe(200);

      const row = db.prepare(
        'SELECT branch, worktree_path, worktree_status FROM tasks WHERE id = ?',
      ).get('t1') as {
        branch: string | null;
        worktree_path: string | null;
        worktree_status: string;
      };

      expect(row.branch).toBe('develop');
      expect(row.worktree_path).toBeNull();
      expect(row.worktree_status).toBe('none');
    }
  });

  it('rejects switching start source for a completed task', async () => {
    execSync('git branch develop', { cwd: repoDir, stdio: 'pipe' });
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = 't1'").run();

    {
      const response = await invokeRoute('post', '/tasks/t1/switch-branch', {
        branch: 'develop',
      });
      const body = response.body as { error?: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe(
        'Cannot switch branch after task execution has started',
      );
    }
  });
});
