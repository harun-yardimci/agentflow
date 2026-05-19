import { execSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorktree } from '../server/engine/worktree-manager.js';
import { getAdditionalWorkspaceDirs } from '../server/executor/codex-sandbox.js';

function createTestRepo(): string {
  const dir = join(
    tmpdir(),
    `agentflow-codex-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# Sandbox Test\n');
  execSync('git add -A && git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('getAdditionalWorkspaceDirs', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    try {
      execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
    } catch {
      // Best-effort test cleanup
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns no extra dirs for the main repo root', () => {
    expect(getAdditionalWorkspaceDirs(repoDir)).toEqual([]);
  });

  it('returns the shared .git dir for git worktrees', () => {
    const worktree = createWorktree('sandbox-task', repoDir);

    expect(getAdditionalWorkspaceDirs(worktree.path)).toEqual([
      join(realpathSync(repoDir), '.git'),
    ]);
  });
});
