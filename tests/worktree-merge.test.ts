import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createWorktree,
  createWorktreeFromRef,
  branchHasCommits,
  createTempWorktreeFromRef,
  isBranchCheckedOut,
  mergeBranch,
  commitMergeResolution,
  removeWorktree,
} from '../server/engine/worktree-manager.js';

/** Create a temporary git repo for testing */
function createTestRepo(): string {
  const dir = join(tmpdir(), `agentflow-wt-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  // Initial commit
  writeFileSync(join(dir, 'README.md'), '# Test Project\n');
  execSync('git add -A && git commit -m "initial"', { cwd: dir, stdio: 'pipe' });

  return dir;
}

function getCurrentBranch(repoDir: string): string {
  return execSync('git branch --show-current', {
    cwd: repoDir,
    stdio: 'pipe',
  }).toString().trim();
}

describe('Worktree Merge System', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    // Clean up worktrees before removing repo
    try {
      execSync('git worktree prune', { cwd: repoDir, stdio: 'pipe' });
    } catch { /* ignore */ }
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe('createWorktreeFromRef', () => {
    it('should create worktree from a specific branch', () => {
      // Create task A worktree and make changes
      const wtA = createWorktree('taskA', repoDir);
      writeFileSync(join(wtA.path, 'fileA.txt'), 'content from A\n');
      execSync('git add -A && git commit -m "task A changes"', { cwd: wtA.path, stdio: 'pipe' });

      // Create task B worktree from task A's branch
      const wtB = createWorktreeFromRef('taskB', repoDir, 'task/taskA');

      // Verify B has A's changes
      expect(existsSync(join(wtB.path, 'fileA.txt'))).toBe(true);
      expect(wtB.branch).toBe('task/taskB');
    });

    it('should inherit all commits from base branch', () => {
      // Create task A with multiple commits
      const wtA = createWorktree('taskA2', repoDir);
      writeFileSync(join(wtA.path, 'step1.txt'), 'step 1');
      execSync('git add -A && git commit -m "step 1"', { cwd: wtA.path, stdio: 'pipe' });
      writeFileSync(join(wtA.path, 'step2.txt'), 'step 2');
      execSync('git add -A && git commit -m "step 2"', { cwd: wtA.path, stdio: 'pipe' });

      // Create B from A
      const wtB = createWorktreeFromRef('taskB2', repoDir, 'task/taskA2');

      expect(existsSync(join(wtB.path, 'step1.txt'))).toBe(true);
      expect(existsSync(join(wtB.path, 'step2.txt'))).toBe(true);
    });
  });

  describe('branchHasCommits', () => {
    it('should return true when branch has commits ahead of HEAD', () => {
      const wt = createWorktree('taskC', repoDir);
      writeFileSync(join(wt.path, 'newfile.txt'), 'content');
      execSync('git add -A && git commit -m "new commit"', { cwd: wt.path, stdio: 'pipe' });

      expect(branchHasCommits('task/taskC', repoDir)).toBe(true);
    });

    it('should return false when branch has no commits ahead of HEAD', () => {
      createWorktree('taskD', repoDir);
      // No commits made in worktree
      expect(branchHasCommits('task/taskD', repoDir)).toBe(false);
    });

    it('should return false for non-existent branch', () => {
      expect(branchHasCommits('task/nonexistent', repoDir)).toBe(false);
    });

    it('should compare against a custom base ref when provided', () => {
      const wtBase = createWorktree('baseRefA', repoDir);
      writeFileSync(join(wtBase.path, 'base.txt'), 'base ref content');
      execSync('git add -A && git commit -m "base branch change"', {
        cwd: wtBase.path,
        stdio: 'pipe',
      });

      const wtChild = createWorktreeFromRef('baseRefB', repoDir, 'task/baseRefA');

      expect(branchHasCommits('task/baseRefB', repoDir)).toBe(true);
      expect(
        branchHasCommits('task/baseRefB', repoDir, 'task/baseRefA'),
      ).toBe(false);

      removeWorktree('baseRefB', repoDir);
    });
  });

  describe('temp worktrees', () => {
    it('should report when a branch is checked out in another worktree', () => {
      expect(isBranchCheckedOut(repoDir, getCurrentBranch(repoDir))).toBe(true);
    });

    it('should create and clean up a temp worktree from a ref', () => {
      createWorktree('tempSource', repoDir);
      removeWorktree('tempSource', repoDir);

      const temp = createTempWorktreeFromRef(
        repoDir,
        'task/tempSource',
        'merge-test',
      );

      expect(existsSync(temp.path)).toBe(true);
      expect(readFileSync(join(temp.path, 'README.md'), 'utf8')).toContain(
        'Test Project',
      );

      temp.cleanup();
      expect(existsSync(temp.path)).toBe(false);
    });
  });

  describe('mergeBranch', () => {
    it('should merge non-conflicting branches successfully', () => {
      // Task A: create fileA
      const wtA = createWorktree('mergeA', repoDir);
      writeFileSync(join(wtA.path, 'fileA.txt'), 'content A');
      execSync('git add -A && git commit -m "add fileA"', { cwd: wtA.path, stdio: 'pipe' });

      // Task B: create fileB (different file)
      const wtB = createWorktree('mergeB', repoDir);
      writeFileSync(join(wtB.path, 'fileB.txt'), 'content B');
      execSync('git add -A && git commit -m "add fileB"', { cwd: wtB.path, stdio: 'pipe' });

      // Create target worktree from A, merge B
      const wtTarget = createWorktreeFromRef('mergeTarget', repoDir, 'task/mergeA');
      const result = mergeBranch(wtTarget.path, 'task/mergeB');

      expect(result.ok).toBe(true);
      expect(result.branch).toBe('task/mergeB');
      expect(existsSync(join(wtTarget.path, 'fileA.txt'))).toBe(true);
      expect(existsSync(join(wtTarget.path, 'fileB.txt'))).toBe(true);
    });

    it('should detect merge conflicts and return conflict details', () => {
      // Task A: modify README
      const wtA = createWorktree('conflictA', repoDir);
      writeFileSync(join(wtA.path, 'README.md'), 'Version from A\n');
      execSync('git add -A && git commit -m "A changes README"', { cwd: wtA.path, stdio: 'pipe' });

      // Task B: modify same file differently
      const wtB = createWorktree('conflictB', repoDir);
      writeFileSync(join(wtB.path, 'README.md'), 'Version from B\n');
      execSync('git add -A && git commit -m "B changes README"', { cwd: wtB.path, stdio: 'pipe' });

      // Create target from A, try merge B → conflict
      const wtTarget = createWorktreeFromRef('conflictTarget', repoDir, 'task/conflictA');
      const result = mergeBranch(wtTarget.path, 'task/conflictB');

      expect(result.ok).toBe(false);
      expect(result.branch).toBe('task/conflictB');
      expect(result.conflictFiles).toContain('README.md');
      expect(result.mergeOutput).toBeDefined();
    });

    it('should leave worktree clean after conflict (merge aborted)', () => {
      const wtA = createWorktree('cleanA', repoDir);
      writeFileSync(join(wtA.path, 'shared.txt'), 'A version');
      execSync('git add -A && git commit -m "A"', { cwd: wtA.path, stdio: 'pipe' });

      const wtB = createWorktree('cleanB', repoDir);
      writeFileSync(join(wtB.path, 'shared.txt'), 'B version');
      execSync('git add -A && git commit -m "B"', { cwd: wtB.path, stdio: 'pipe' });

      const wtTarget = createWorktreeFromRef('cleanTarget', repoDir, 'task/cleanA');
      mergeBranch(wtTarget.path, 'task/cleanB');

      // Worktree should be clean (merge was aborted)
      const status = execSync('git status --porcelain', { cwd: wtTarget.path, stdio: 'pipe' })
        .toString().trim();
      expect(status).toBe('');
    });
  });

  describe('commitMergeResolution', () => {
    it('should commit staged changes', () => {
      const wt = createWorktree('commitTest', repoDir);
      writeFileSync(join(wt.path, 'resolved.txt'), 'resolved content');

      const result = commitMergeResolution(wt.path, 'Resolved merge conflict');
      expect(result).toBe(true);

      // Verify commit exists
      const log = execSync('git log --oneline -1', { cwd: wt.path, stdio: 'pipe' })
        .toString().trim();
      expect(log).toContain('Resolved merge conflict');
    });
  });

  describe('End-to-end: dependency chain', () => {
    it('should pass changes through A → B → C chain', () => {
      // A creates a file
      const wtA = createWorktree('chainA', repoDir);
      writeFileSync(join(wtA.path, 'chain.txt'), 'step A');
      execSync('git add -A && git commit -m "chain A"', { cwd: wtA.path, stdio: 'pipe' });

      // B branches from A and adds more
      const wtB = createWorktreeFromRef('chainB', repoDir, 'task/chainA');
      writeFileSync(join(wtB.path, 'chain.txt'), 'step A + step B');
      writeFileSync(join(wtB.path, 'extra.txt'), 'extra from B');
      execSync('git add -A && git commit -m "chain B"', { cwd: wtB.path, stdio: 'pipe' });

      // C branches from B — should see all changes
      const wtC = createWorktreeFromRef('chainC', repoDir, 'task/chainB');
      expect(existsSync(join(wtC.path, 'chain.txt'))).toBe(true);
      expect(existsSync(join(wtC.path, 'extra.txt'))).toBe(true);

      // Verify content
      const content = readFileSync(join(wtC.path, 'chain.txt'), 'utf8');
      expect(content).toBe('step A + step B');
    });

    it('should merge parallel branches into downstream task', () => {
      // A and B modify different files (parallel tasks)
      const wtA = createWorktree('parallelA', repoDir);
      writeFileSync(join(wtA.path, 'fromA.txt'), 'A content');
      execSync('git add -A && git commit -m "parallel A"', { cwd: wtA.path, stdio: 'pipe' });

      const wtB = createWorktree('parallelB', repoDir);
      writeFileSync(join(wtB.path, 'fromB.txt'), 'B content');
      execSync('git add -A && git commit -m "parallel B"', { cwd: wtB.path, stdio: 'pipe' });

      // C depends on both A and B
      const wtC = createWorktreeFromRef('parallelC', repoDir, 'task/parallelA');
      const mergeResult = mergeBranch(wtC.path, 'task/parallelB');

      expect(mergeResult.ok).toBe(true);
      expect(existsSync(join(wtC.path, 'fromA.txt'))).toBe(true);
      expect(existsSync(join(wtC.path, 'fromB.txt'))).toBe(true);
    });
  });
});
