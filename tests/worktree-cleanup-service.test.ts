import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorktree } from '../server/engine/worktree-manager.js';
import { runWorktreeCleanup } from '../server/engine/worktree-cleanup-service.js';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;
let repoDir: string;
let mainBranch: string;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

function createTestRepo(): { mainBranch: string; repoDir: string } {
  const dir = join(
    tmpdir(),
    `agentflow-worktree-cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
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
  const defaultBranch = execSync('git branch --show-current', {
    cwd: dir,
    stdio: 'pipe',
  }).toString().trim();

  return {
    mainBranch: defaultBranch || 'main',
    repoDir: dir,
  };
}

function archivedDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function branchExists(branch: string): boolean {
  const output = execSync(`git branch --list "${branch}"`, {
    cwd: repoDir,
    stdio: 'pipe',
  }).toString().trim();
  return output.length > 0;
}

function seedTask(taskId: string, worktreePath: string): void {
  db.prepare(
    `
      INSERT INTO pipelines (
        id, name, status, created, working_dir, git_branch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run('p1', 'Pipeline', 'queued', '2026-03-28', repoDir, mainBranch);

  db.prepare(
    `
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage, input,
        sort_order, archived_at, worktree_path, worktree_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    taskId,
    'p1',
    'Task 1',
    'a1',
    'claude:sonnet',
    'auto',
    'completed',
    0,
    '',
    0,
    archivedDaysAgo(11),
    worktreePath,
    'ready_for_review',
  );
}

describe('worktree cleanup service', () => {
  beforeEach(() => {
    db = createTestDb();
    const repo = createTestRepo();
    repoDir = repo.repoDir;
    mainBranch = repo.mainBranch;
  });

  afterEach(() => {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('cleans archived merged worktrees while keeping the branch', async () => {
    const taskId = 't1';
    const worktree = createWorktree(taskId, repoDir);
    writeFileSync(join(worktree.path, 'feature.txt'), 'hello\n');
    execSync('git add -A && git commit -m "task branch change"', {
      cwd: worktree.path,
      stdio: 'pipe',
    });
    execSync(`git merge "task/${taskId}" --no-edit`, {
      cwd: repoDir,
      stdio: 'pipe',
    });

    seedTask(taskId, worktree.path);

    const result = await runWorktreeCleanup();
    const task = db.prepare(
      'SELECT worktree_path, worktree_status FROM tasks WHERE id = ?',
    ).get(taskId) as {
      worktree_path: string | null;
      worktree_status: string | null;
    };

    expect(result.cleaned).toBe(1);
    expect(result.blockedDirty).toBe(0);
    expect(task.worktree_path).toBeNull();
    expect(task.worktree_status).toBe('cleaned');
    expect(branchExists(`task/${taskId}`)).toBe(true);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it('marks dirty merged worktrees as blocked instead of deleting them', async () => {
    const taskId = 't1';
    const worktree = createWorktree(taskId, repoDir);
    writeFileSync(join(worktree.path, 'feature.txt'), 'hello\n');
    execSync('git add -A && git commit -m "task branch change"', {
      cwd: worktree.path,
      stdio: 'pipe',
    });
    execSync(`git merge "task/${taskId}" --no-edit`, {
      cwd: repoDir,
      stdio: 'pipe',
    });
    writeFileSync(join(worktree.path, 'dirty.txt'), 'pending\n');

    seedTask(taskId, worktree.path);

    const result = await runWorktreeCleanup();
    const task = db.prepare(
      'SELECT worktree_path, worktree_status FROM tasks WHERE id = ?',
    ).get(taskId) as {
      worktree_path: string | null;
      worktree_status: string | null;
    };

    expect(result.cleaned).toBe(0);
    expect(result.blockedDirty).toBe(1);
    expect(task.worktree_path).toBe(worktree.path);
    expect(task.worktree_status).toBe('cleanup_blocked_dirty');
    expect(existsSync(worktree.path)).toBe(true);
  });

  it('skips archived worktrees whose branches are not merged', async () => {
    const taskId = 't1';
    const worktree = createWorktree(taskId, repoDir);
    writeFileSync(join(worktree.path, 'feature.txt'), 'hello\n');
    execSync('git add -A && git commit -m "task branch change"', {
      cwd: worktree.path,
      stdio: 'pipe',
    });

    seedTask(taskId, worktree.path);

    const result = await runWorktreeCleanup();
    const task = db.prepare(
      'SELECT worktree_path, worktree_status FROM tasks WHERE id = ?',
    ).get(taskId) as {
      worktree_path: string | null;
      worktree_status: string | null;
    };

    expect(result.cleaned).toBe(0);
    expect(result.blockedDirty).toBe(0);
    expect(task.worktree_path).toBe(worktree.path);
    expect(task.worktree_status).toBe('ready_for_review');
    expect(existsSync(worktree.path)).toBe(true);
  });

  it('cleans stale metadata when the worktree path is already missing', async () => {
    const taskId = 't1';
    const missingPath = join(repoDir, '.agentflow', 'worktrees', 'task-t1');

    seedTask(taskId, missingPath);

    const result = await runWorktreeCleanup();
    const task = db.prepare(
      'SELECT worktree_path, worktree_status FROM tasks WHERE id = ?',
    ).get(taskId) as {
      worktree_path: string | null;
      worktree_status: string | null;
    };

    expect(result.cleaned).toBe(0);
    expect(result.blockedDirty).toBe(0);
    expect(result.missingPathCleaned).toBe(1);
    expect(task.worktree_path).toBeNull();
    expect(task.worktree_status).toBe('cleaned_missing_path');
  });
});
