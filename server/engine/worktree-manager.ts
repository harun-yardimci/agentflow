import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, symlinkSync } from 'fs';
import { join, resolve } from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskId: string;
}

export interface TempWorktreeInfo {
  path: string;
  ref: string;
  cleanup: () => void;
}

const WORKTREE_DIR = '.agentflow/worktrees';
const TEMP_WORKTREE_DIR = '.agentflow/temp-worktrees';

/** Check if we're in a git repo */
function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get the git root directory */
export function getGitRoot(dir: string): string {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: dir, stdio: 'pipe' }).toString().trim();
  } catch {
    return dir;
  }
}

/** Ensure git repo is initialized with at least one commit */
function ensureGitRepo(gitRoot: string): void {
  if (!isGitRepo(gitRoot)) {
    execSync('git init', { cwd: gitRoot, stdio: 'pipe' });
    try {
      execSync('git log --oneline -1', { cwd: gitRoot, stdio: 'pipe' });
    } catch {
      execSync('git add -A && git commit -m "initial commit" --allow-empty', {
        cwd: gitRoot,
        stdio: 'pipe',
      });
    }
  }
}

/** Symlink node_modules from git root into worktree so CLI agents can resolve dependencies */
function symlinkNodeModules(gitRoot: string, worktreePath: string): void {
  const src = join(gitRoot, 'node_modules');
  const dst = join(worktreePath, 'node_modules');
  if (existsSync(src) && !existsSync(dst)) {
    try {
      symlinkSync(src, dst, 'junction');
    } catch (err) {
      console.warn(`[worktree] Failed to symlink node_modules: ${(err as Error).message}`);
    }
  }
}

/** Prepare a clean worktree directory and branch for a task */
function prepareWorktreeSlot(taskId: string, gitRoot: string): { branchName: string; worktreePath: string; worktreeBase: string } {
  const worktreeBase = join(gitRoot, WORKTREE_DIR);
  if (!existsSync(worktreeBase)) {
    mkdirSync(worktreeBase, { recursive: true });
  }

  const branchName = `task/${taskId}`;
  const worktreePath = join(worktreeBase, `task-${taskId}`);

  // Clean up stale worktree if it exists
  if (existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, { cwd: gitRoot, stdio: 'pipe' });
    } catch { /* might be stale */ }
  }

  // Delete stale branch
  try {
    execSync(`git branch -D "${branchName}"`, { cwd: gitRoot, stdio: 'pipe' });
  } catch { /* didn't exist */ }

  return { branchName, worktreePath, worktreeBase };
}

/** Create a worktree for a task from a base ref. */
export function createWorktree(
  taskId: string,
  projectDir: string,
  baseRef = 'HEAD',
): WorktreeInfo {
  return createWorktreeFromRef(taskId, projectDir, baseRef);
}

/** Create a worktree for a task from a specific ref (e.g. a dependency branch) */
export function createWorktreeFromRef(taskId: string, projectDir: string, baseRef: string): WorktreeInfo {
  const gitRoot = getGitRoot(projectDir);
  ensureGitRepo(gitRoot);

  const { branchName, worktreePath } = prepareWorktreeSlot(taskId, gitRoot);

  execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${baseRef}"`, {
    cwd: gitRoot,
    stdio: 'pipe',
  });

  // Symlink node_modules from main project so CLI agents can resolve dependencies
  symlinkNodeModules(gitRoot, worktreePath);

  return { path: resolve(worktreePath), branch: branchName, taskId };
}

/** Check if a branch exists and has commits beyond a base ref */
export function branchHasCommits(
  branch: string,
  projectDir: string,
  baseRef = 'HEAD',
): boolean {
  const gitRoot = getGitRoot(projectDir);
  try {
    // Check branch exists
    const exists = execSync(`git branch --list "${branch}"`, { cwd: gitRoot, stdio: 'pipe' })
      .toString().trim();
    if (!exists) return false;

    // Check if branch has commits ahead of the selected base ref
    const log = execSync(`git log "${baseRef}".."${branch}" --oneline -1`, { cwd: gitRoot, stdio: 'pipe' })
      .toString().trim();
    return log.length > 0;
  } catch {
    return false;
  }
}

function parseWorktreeBlocks(
  projectDir: string,
): Array<{ path: string; branch: string | null }> {
  const gitRoot = getGitRoot(projectDir);

  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: gitRoot,
      stdio: 'pipe',
    }).toString();

    return output
      .split('\n\n')
      .map((block) => {
        const lines = block.trim().split('\n');
        const pathLine = lines.find((line) => line.startsWith('worktree '));
        const branchLine = lines.find((line) => line.startsWith('branch '));

        return {
          path: pathLine?.replace('worktree ', '') ?? '',
          branch: branchLine
            ? branchLine.replace('branch refs/heads/', '')
            : null,
        };
      })
      .filter((entry) => entry.path);
  } catch {
    return [];
  }
}

export function isBranchCheckedOut(projectDir: string, branch: string): boolean {
  return parseWorktreeBlocks(projectDir).some((entry) => entry.branch === branch);
}

export function getCheckoutPathsForBranch(
  projectDir: string,
  branch: string,
): string[] {
  return parseWorktreeBlocks(projectDir)
    .filter((entry) => entry.branch === branch)
    .map((entry) => entry.path);
}

export function getDirtyCheckoutsForBranch(
  projectDir: string,
  branch: string,
): string[] {
  return getCheckoutPathsForBranch(projectDir, branch)
    .filter((worktreePath) => hasChanges(worktreePath));
}

export function createTempWorktreeFromRef(
  projectDir: string,
  ref: string,
  label: string,
): TempWorktreeInfo {
  const gitRoot = getGitRoot(projectDir);
  ensureGitRepo(gitRoot);

  const tempBase = join(gitRoot, TEMP_WORKTREE_DIR);
  if (!existsSync(tempBase)) {
    mkdirSync(tempBase, { recursive: true });
  }

  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
  const tempPath = join(
    tempBase,
    `${safeLabel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  execSync(`git worktree add "${tempPath}" "${ref}"`, {
    cwd: gitRoot,
    stdio: 'pipe',
  });

  symlinkNodeModules(gitRoot, tempPath);

  return {
    path: resolve(tempPath),
    ref,
    cleanup: () => {
      try {
        execSync(`git worktree remove "${tempPath}" --force`, {
          cwd: gitRoot,
          stdio: 'pipe',
        });
      } catch {
        // Best effort
      }

      try {
        execSync('git worktree prune', { cwd: gitRoot, stdio: 'pipe' });
      } catch {
        // Best effort
      }
    },
  };
}

/** Merge result from a branch merge attempt */
export interface MergeResult {
  ok: boolean;
  branch: string;
  conflictFiles?: string[];
  mergeOutput?: string;
}

/** Merge a branch into the current worktree. Aborts on conflict. */
export function mergeBranch(worktreePath: string, branch: string): MergeResult {
  try {
    execSync(`git merge "${branch}" --no-edit -m "Merge ${branch} for pipeline"`, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return { ok: true, branch };
  } catch (err) {
    // Merge failed — likely conflict
    let conflictFiles: string[] = [];
    try {
      const output = execSync('git diff --name-only --diff-filter=U', {
        cwd: worktreePath,
        stdio: 'pipe',
      }).toString().trim();
      conflictFiles = output.split('\n').filter(Boolean);
    } catch { /* best effort */ }

    // Abort the failed merge to leave worktree clean
    try {
      execSync('git merge --abort', { cwd: worktreePath, stdio: 'pipe' });
    } catch { /* might not be in merge state */ }

    return {
      ok: false,
      branch,
      conflictFiles,
      mergeOutput: (err as Error).message?.slice(0, 4000),
    };
  }
}

/** Result of promoting a conflict-fixer temp worktree back onto the base branch */
export interface FinalizeFixerResult {
  ok: boolean;
  reason?: 'not_merge_commit' | 'not_fast_forward' | 'no_worktree' | 'exec_failed';
  commit?: string;
  message?: string;
}

/**
 * Fast-forward `baseBranch` to the merge commit sitting at HEAD of a temp
 * fixer worktree. Used after a `Git Conflict (merge)` fixer task completes so
 * the resolved commit is actually promoted to the branch instead of living on
 * a detached HEAD.
 *
 * - Validates the fixer worktree's HEAD is a real merge commit (>=2 parents)
 * - Requires a true fast-forward from base tip; if base moved on, aborts so
 *   the caller can re-run the merge path from the updated base
 * - Advances base in every existing checkout (matches `git-action` merge path)
 */
export function finalizeTempMergeWorktree(
  projectDir: string,
  baseBranch: string,
  fixerWorktreePath: string,
): FinalizeFixerResult {
  if (!existsSync(fixerWorktreePath)) {
    return { ok: false, reason: 'no_worktree' };
  }

  const gitRoot = getGitRoot(projectDir);

  try {
    const fixerHead = execSync('git rev-parse HEAD', {
      cwd: fixerWorktreePath,
      stdio: 'pipe',
    }).toString().trim();

    const parentLine = execSync('git rev-list --parents -n 1 HEAD', {
      cwd: fixerWorktreePath,
      stdio: 'pipe',
    }).toString().trim();
    const parents = parentLine.split(' ').slice(1);
    if (parents.length < 2) {
      return { ok: false, reason: 'not_merge_commit', commit: fixerHead };
    }

    const baseTip = execSync(`git rev-parse --verify "${baseBranch}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    }).toString().trim();

    try {
      execSync(`git merge-base --is-ancestor "${baseTip}" "${fixerHead}"`, {
        cwd: gitRoot,
        stdio: 'pipe',
      });
    } catch {
      return { ok: false, reason: 'not_fast_forward', commit: fixerHead };
    }

    const checkoutPaths = getCheckoutPathsForBranch(projectDir, baseBranch);
    if (checkoutPaths.length > 0) {
      for (const checkoutPath of checkoutPaths) {
        execSync(`git merge --ff-only "${fixerHead}"`, {
          cwd: checkoutPath,
          stdio: 'pipe',
        });
      }
    } else {
      execSync(
        `git update-ref "refs/heads/${baseBranch}" "${fixerHead}" "${baseTip}"`,
        { cwd: gitRoot, stdio: 'pipe' },
      );
    }

    return { ok: true, commit: fixerHead };
  } catch (err) {
    return {
      ok: false,
      reason: 'exec_failed',
      message: (err as Error).message?.slice(0, 500),
    };
  }
}

/** Remove a temp merge worktree and prune stale entries. Best-effort. */
export function cleanupTempWorktree(projectDir: string, tempWorktreePath: string): void {
  const gitRoot = getGitRoot(projectDir);
  try {
    execSync(`git worktree remove "${tempWorktreePath}" --force`, {
      cwd: gitRoot,
      stdio: 'pipe',
    });
  } catch { /* best effort */ }
  try {
    execSync('git worktree prune', { cwd: gitRoot, stdio: 'pipe' });
  } catch { /* best effort */ }
}

/** Commit a resolved merge (used by fixer tasks after resolving conflicts) */
export function commitMergeResolution(worktreePath: string, message: string): boolean {
  try {
    execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });
    execSync(`git commit --no-edit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/** Remove a worktree directory but PRESERVE the branch.
 *  Task branches must survive so spawned/downstream tasks can resolve deps.
 *  Use `removeWorktreeAndBranch` for full cleanup (e.g. after merge to main). */
export function removeWorktree(taskId: string, projectDir: string): void {
  const gitRoot = getGitRoot(projectDir);
  const worktreePath = join(gitRoot, WORKTREE_DIR, `task-${taskId}`);

  try {
    if (existsSync(worktreePath)) {
      execSync(`git worktree remove "${worktreePath}" --force`, { cwd: gitRoot, stdio: 'pipe' });
    }
  } catch {
    // Best effort
  }

  // Prune stale worktree references so branch is no longer "checked out"
  try {
    execSync('git worktree prune', { cwd: gitRoot, stdio: 'pipe' });
  } catch {
    // Best effort
  }
}

/** Remove both worktree AND branch — only for final cleanup after merge to main */
export function removeWorktreeAndBranch(taskId: string, projectDir: string): void {
  const gitRoot = getGitRoot(projectDir);
  const worktreePath = join(gitRoot, WORKTREE_DIR, `task-${taskId}`);
  const branchName = `task/${taskId}`;

  try {
    if (existsSync(worktreePath)) {
      execSync(`git worktree remove "${worktreePath}" --force`, { cwd: gitRoot, stdio: 'pipe' });
    }
  } catch {
    // Best effort
  }

  try {
    execSync('git worktree prune', { cwd: gitRoot, stdio: 'pipe' });
  } catch {
    // Best effort
  }

  try {
    execSync(`git branch -D "${branchName}"`, { cwd: gitRoot, stdio: 'pipe' });
  } catch {
    // Best effort
  }
}

/** List all active worktrees */
export function listWorktrees(projectDir: string): WorktreeInfo[] {
  const gitRoot = getGitRoot(projectDir);
  const worktreeBase = join(gitRoot, WORKTREE_DIR);

  if (!existsSync(worktreeBase)) return [];

  try {
    const output = execSync('git worktree list --porcelain', { cwd: gitRoot, stdio: 'pipe' }).toString();
    const worktrees: WorktreeInfo[] = [];

    const blocks = output.split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const pathLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));

      if (pathLine && branchLine) {
        const path = pathLine.replace('worktree ', '');
        const branch = branchLine.replace('branch refs/heads/', '');

        // Only include our managed worktrees
        if (branch.startsWith('task/')) {
          const taskId = branch.replace('task/', '');
          worktrees.push({ path, branch, taskId });
        }
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/** Check if a worktree has uncommitted changes */
export function hasChanges(worktreePath: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: worktreePath,
      stdio: 'pipe',
    }).toString();

    return output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .some((line) => {
        const path = line.slice(3);
        return !path.startsWith('.agentflow/');
      });
  } catch {
    return false;
  }
}

/** Get diff of worktree against base branch */
export function getWorktreeDiff(worktreePath: string): string {
  try {
    // Get diff against the branch point
    const diff = execSync('git diff HEAD', { cwd: worktreePath, stdio: 'pipe', maxBuffer: 1024 * 1024 }).toString();
    return diff;
  } catch {
    return '';
  }
}

/** Ensure .agentflow directory is in .gitignore */
export function ensureGitignore(projectDir: string): void {
  const gitRoot = getGitRoot(projectDir);
  const gitignorePath = join(gitRoot, '.gitignore');
  const entry = '.agentflow/';

  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8');
      if (!content.includes(entry)) {
        appendFileSync(gitignorePath, `\n# AgentFlow worktrees\n${entry}\n`);
      }
    } else {
      writeFileSync(gitignorePath, `# AgentFlow worktrees\n${entry}\n`);
    }
  } catch {
    // Best effort
  }
}
