import { Router } from 'express';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { getDb } from '../db/connection.js';
import { validate } from '../middleware/validate.js';
import { GitActionSchema } from '../types/api.js';
import { archiveInheritedFollowUpsForParent } from '../services/task-service.js';
import {
  createTempWorktreeFromRef,
  getCheckoutPathsForBranch,
  getGitRoot,
  getDirtyCheckoutsForBranch,
  isBranchCheckedOut,
  removeWorktreeAndBranch,
} from '../engine/worktree-manager.js';
import { spawnGitConflictFixer } from '../engine/task-runner.js';

const router = Router();

const RECORD_SEP = '\x1e'; // ASCII record separator — safe delimiter for git log

/**
 * Run a git command with arguments passed as an argv array (never a shell
 * string), so branch names / refs from user input can't inject shell commands.
 */
function git(args: string[], opts: { cwd: string; maxBuffer?: number }): string {
  return execFileSync('git', args, {
    cwd: opts.cwd,
    stdio: 'pipe',
    maxBuffer: opts.maxBuffer,
  }).toString();
}

interface TaskRow {
  id: string;
  pipeline_id: string;
  status: string;
  worktree_path: string | null;
  worktree_status: string | null;
  working_dir: string | null;
  branch: string | null;
}

const EDITABLE_BRANCH_STATUSES = new Set(['queued', 'blocked']);

function getBranchName(taskId: string): string {
  return `task/${taskId}`;
}

function branchExists(branch: string, cwd: string): boolean {
  try {
    const out = git(['branch', '--list', branch], { cwd }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function getMainBranch(cwd: string): string {
  try {
    const branches = git(['branch', '--list', 'main', 'master'], { cwd }).trim();
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
    return 'main';
  } catch {
    return 'main';
  }
}

function getPipelineBaseBranch(
  pipelineId: string,
  fallbackCwd: string,
): string {
  const db = getDb();
  const pipeline = db.prepare(
    'SELECT git_branch FROM pipelines WHERE id = ?'
  ).get(pipelineId) as { git_branch: string | null } | undefined;
  return pipeline?.git_branch?.trim() || getMainBranch(fallbackCwd);
}

function getConflictFiles(cwd: string): string[] {
  try {
    const output = git(['diff', '--name-only', '--diff-filter=U'], { cwd }).trim();
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function resolveTaskGitContext(taskId: string) {
  const db = getDb();
  const task = db.prepare(
    'SELECT id, pipeline_id, status, worktree_path, worktree_status, working_dir, branch FROM tasks WHERE id = ?'
  ).get(taskId) as TaskRow | undefined;

  if (!task) return null;

  // Fallback: task.working_dir → pipeline.working_dir → cwd
  let projectDir = task.working_dir;
  if (!projectDir) {
    const pipeline = db.prepare(
      'SELECT working_dir FROM pipelines WHERE id = ?'
    ).get(task.pipeline_id) as { working_dir: string } | undefined;
    projectDir = pipeline?.working_dir || process.cwd();
  }

  const gitRoot = getGitRoot(projectDir);
  const branch = getBranchName(task.id);
  const mainBranch = getPipelineBaseBranch(task.pipeline_id, gitRoot);

  return { task, projectDir, gitRoot, branch, mainBranch };
}

// GET /api/tasks/:id/git-status
router.get('/tasks/:id/git-status', (req, res) => {
  const ctx = resolveTaskGitContext(req.params.id as string);
  if (!ctx) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const { task, gitRoot, branch, mainBranch } = ctx;

  if (!branchExists(branch, gitRoot)) {
    res.json({
      branch,
      mainBranch,
      exists: false,
      commitsAhead: 0,
      commitsBehind: 0,
      hasUncommitted: false,
      isMerged: false,
      changedFiles: [],
      commitLog: [],
      worktreePath: task.worktree_path,
      worktreeStatus: task.worktree_status,
    });
    return;
  }

  // Commits ahead/behind main
  let commitsAhead = 0;
  let commitsBehind = 0;
  try {
    const revList = git(
      ['rev-list', '--left-right', '--count', `${mainBranch}...${branch}`],
      { cwd: gitRoot }
    ).trim();
    const [behind, ahead] = revList.split('\t').map(Number);
    commitsAhead = ahead ?? 0;
    commitsBehind = behind ?? 0;
  } catch { /* branch may not share history */ }

  // Uncommitted changes in worktree
  let hasUncommitted = false;
  if (task.worktree_path && existsSync(task.worktree_path)) {
    try {
      const status = git(['status', '--porcelain'], { cwd: task.worktree_path }).trim();
      hasUncommitted = status.length > 0;
    } catch { /* best effort */ }
  }

  // Is branch merged into main?
  let isMerged = false;
  try {
    const merged = git(['branch', '--merged', mainBranch], { cwd: gitRoot });
    isMerged = merged.split('\n').some(b => b.replace(/^[*+]\s*/, '').trim() === branch);
  } catch { /* best effort */ }

  // Changed files (branch vs main)
  let changedFiles: string[] = [];
  try {
    const diff = git(
      ['diff', '--name-only', `${mainBranch}...${branch}`],
      { cwd: gitRoot }
    ).trim();
    changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
  } catch { /* best effort */ }

  // Commit log on branch (ahead of main) — use record separator to avoid delimiter collision
  let commitLog: { hash: string; message: string; date: string }[] = [];
  if (commitsAhead > 0) {
    try {
      const log = git(
        ['log', `${mainBranch}..${branch}`, `--format=%h${RECORD_SEP}%s${RECORD_SEP}%ci`, '--max-count=20'],
        { cwd: gitRoot }
      ).trim();
      commitLog = log.split('\n').filter(Boolean).map(line => {
        const parts = line.split(RECORD_SEP);
        return { hash: parts[0]!, message: parts[1]!, date: parts[2]! };
      });
    } catch { /* best effort */ }
  }

  res.json({
    branch,
    mainBranch,
    exists: true,
    commitsAhead,
    commitsBehind,
    hasUncommitted,
    isMerged,
    changedFiles,
    commitLog,
    worktreePath: task.worktree_path,
    worktreeStatus: task.worktree_status,
  });
});

// GET /api/tasks/:id/git-diff
router.get('/tasks/:id/git-diff', (req, res) => {
  const ctx = resolveTaskGitContext(req.params.id as string);
  if (!ctx) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const { gitRoot, branch, mainBranch } = ctx;

  try {
    const diff = git(
      ['diff', `${mainBranch}...${branch}`],
      { cwd: gitRoot, maxBuffer: 2 * 1024 * 1024 }
    );
    res.json({ diff });
  } catch {
    res.json({ diff: '' });
  }
});

// POST /api/tasks/:id/git-action
router.post('/tasks/:id/git-action', validate(GitActionSchema), (req, res) => {
  const ctx = resolveTaskGitContext(req.params.id as string);
  if (!ctx) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const db = getDb();
  const { task, projectDir, gitRoot, branch, mainBranch } = ctx;
  const { action } = req.body as { action: 'merge' | 'rebase' | 'cleanup' };

  if (task.status === 'running') {
    res.status(409).json({
      error: 'Task is running',
      message: 'Stop the task before changing its git state.',
    });
    return;
  }

  switch (action) {
    case 'merge': {
      const baseCheckoutPaths = getCheckoutPathsForBranch(
        projectDir,
        mainBranch,
      );
      const dirtyBaseCheckouts = getDirtyCheckoutsForBranch(
        projectDir,
        mainBranch,
      );

      if (dirtyBaseCheckouts.length > 0) {
        const blockingPath = dirtyBaseCheckouts[0]!;
        res.status(409).json({
          error: 'Finalize blocked',
          message: `${mainBranch} has uncommitted changes in ${blockingPath}. Commit, stash, or discard those changes before finalizing.`,
        });
        return;
      }

      const baseCommit = git(
        ['rev-parse', '--verify', mainBranch],
        { cwd: gitRoot },
      ).trim();

      const integrationWorktree = createTempWorktreeFromRef(
        projectDir,
        baseCommit,
        `merge-${task.id}`,
      );

      try {
        git(['merge', branch, '--no-edit', '-m', `Merge ${branch} into ${mainBranch}`], {
          cwd: integrationWorktree.path,
        });

        const mergedCommit = git(['rev-parse', 'HEAD'], {
          cwd: integrationWorktree.path,
        }).trim();

        if (baseCheckoutPaths.length > 0) {
          for (const checkoutPath of baseCheckoutPaths) {
            git(['merge', '--ff-only', mergedCommit], {
              cwd: checkoutPath,
            });
          }
        } else {
          git(
            ['update-ref', `refs/heads/${mainBranch}`, mergedCommit, baseCommit],
            { cwd: gitRoot },
          );
        }

        integrationWorktree.cleanup();
        db.prepare(
          'UPDATE tasks SET worktree_status = ? WHERE id = ?'
        ).run('merged', task.id);
        archiveInheritedFollowUpsForParent(task.id, 'merged_with_parent');
        res.json({ ok: true, message: `Merged ${branch} into ${mainBranch}` });
      } catch (err) {
        // Detect conflict files before aborting
        const conflictFiles = getConflictFiles(integrationWorktree.path);
        let branchSha: string | null = null;
        try {
          branchSha = git(['rev-parse', '--verify', branch], {
            cwd: gitRoot,
          }).trim();
        } catch { /* branch missing — leave null */ }
        try {
          git(['merge', '--abort'], {
            cwd: integrationWorktree.path,
          });
        } catch { /* */ }
        db.prepare(
          'UPDATE tasks SET worktree_status = ? WHERE id = ?'
        ).run('blocked_by_conflict', task.id);

        // Spawn fixer task to resolve the conflict
        const fixerId = spawnGitConflictFixer(
          task.id, task.pipeline_id, conflictFiles, 'merge',
          branch,
          mainBranch,
          integrationWorktree.path,
          baseCommit,
          branchSha,
          (err as Error).message?.slice(0, 2000),
        );

        res.status(409).json({
          error: 'Merge conflict',
          conflictFiles,
          fixerTaskId: fixerId,
          message: fixerId
            ? `Merge conflict — fixer task spawned to resolve ${conflictFiles.length} conflicting file(s)`
            : 'Merge conflict — could not spawn fixer task',
        });
      }
      break;
    }

    case 'rebase': {
      const persistentWorktree =
        task.worktree_path && existsSync(task.worktree_path)
          ? task.worktree_path
          : null;
      let tempWorktree:
        | ReturnType<typeof createTempWorktreeFromRef>
        | null = null;

      if (!persistentWorktree) {
        if (isBranchCheckedOut(projectDir, branch)) {
          res.status(409).json({
            error: 'Sync blocked',
            message: `${branch} is currently checked out in another workspace. Re-open that workspace or clean it up before syncing.`,
          });
          return;
        }

        tempWorktree = createTempWorktreeFromRef(
          projectDir,
          branch,
          `rebase-${task.id}`,
        );
      }

      const rebaseCwd = persistentWorktree ?? tempWorktree!.path;

      try {
        git(['rebase', mainBranch], {
          cwd: rebaseCwd,
        });
        tempWorktree?.cleanup();
        db.prepare(
          'UPDATE tasks SET worktree_status = ? WHERE id = ?'
        ).run('active', task.id);
        res.json({ ok: true, message: `Rebased ${branch} onto ${mainBranch}` });
      } catch (err) {
        const conflictFiles = getConflictFiles(rebaseCwd);
        let baseSha: string | null = null;
        let branchSha: string | null = null;
        try {
          baseSha = git(['rev-parse', '--verify', mainBranch], {
            cwd: gitRoot,
          }).trim();
        } catch { /* leave null */ }
        try {
          branchSha = git(['rev-parse', '--verify', branch], {
            cwd: gitRoot,
          }).trim();
        } catch { /* leave null */ }
        try { git(['rebase', '--abort'], { cwd: rebaseCwd }); } catch { /* */ }
        if (!persistentWorktree) {
          db.prepare(
            'UPDATE tasks SET worktree_path = ?, worktree_status = ? WHERE id = ?'
          ).run(rebaseCwd, 'blocked_by_conflict', task.id);
        } else {
          db.prepare(
            'UPDATE tasks SET worktree_status = ? WHERE id = ?'
          ).run('blocked_by_conflict', task.id);
        }

        // Spawn fixer task to resolve the conflict
        const fixerId = spawnGitConflictFixer(
          task.id, task.pipeline_id, conflictFiles, 'rebase',
          branch,
          mainBranch,
          rebaseCwd,
          baseSha,
          branchSha,
          (err as Error).message?.slice(0, 2000),
        );

        res.status(409).json({
          error: 'Rebase conflict',
          conflictFiles,
          fixerTaskId: fixerId,
          message: fixerId
            ? `Rebase conflict — fixer task spawned to resolve ${conflictFiles.length} conflicting file(s)`
            : 'Rebase conflict — could not spawn fixer task',
        });
      }
      break;
    }

    case 'cleanup': {
      try {
        removeWorktreeAndBranch(task.id, projectDir);
        db.prepare(
          'UPDATE tasks SET worktree_path = NULL, worktree_status = ? WHERE id = ?'
        ).run('none', task.id);
        res.json({ ok: true, message: `Cleaned up worktree and branch for ${branch}` });
      } catch (err) {
        res.status(500).json({ error: 'Cleanup failed', details: (err as Error).message?.slice(0, 2000) });
      }
      break;
    }
  }
});

// GET /api/pipelines/:id/branches — list all git branches for a pipeline's repo
router.get('/pipelines/:id/branches', (req, res) => {
  const db = getDb();
  const pipeline = db.prepare(
    'SELECT working_dir FROM pipelines WHERE id = ?'
  ).get(req.params.id as string) as { working_dir: string } | undefined;

  if (!pipeline?.working_dir) {
    res.status(404).json({ error: 'Pipeline not found or no working directory' });
    return;
  }

  const gitRoot = getGitRoot(pipeline.working_dir);
  try {
    const raw = git(['branch', '--no-color'], { cwd: gitRoot }).trim();
    const branches = raw
      .split('\n')
      .map(b => b.replace(/^[*+]\s*/, '').trim())
      .filter(Boolean);
    res.json({ branches });
  } catch {
    res.json({ branches: [] });
  }
});

// POST /api/tasks/:id/switch-branch — validate and switch task branch
router.post('/tasks/:id/switch-branch', (req, res) => {
  const db = getDb();
  const { branch: newBranch } = req.body as { branch: string };

  if (!newBranch || typeof newBranch !== 'string') {
    res.status(400).json({ error: 'branch is required' });
    return;
  }

  const task = db.prepare(
    'SELECT id, pipeline_id, status, worktree_path, worktree_status, working_dir, branch FROM tasks WHERE id = ?'
  ).get(req.params.id as string) as (TaskRow & { status: string; branch: string | null }) | undefined;

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (!EDITABLE_BRANCH_STATUSES.has(task.status)) {
    res.status(409).json({
      error: 'Cannot switch branch after task execution has started',
      message: 'Start source can only be changed while the task is queued or blocked.',
    });
    return;
  }

  // Resolve project dir
  let projectDir = task.working_dir;
  if (!projectDir) {
    const pipeline = db.prepare(
      'SELECT working_dir FROM pipelines WHERE id = ?'
    ).get(task.pipeline_id) as { working_dir: string } | undefined;
    projectDir = pipeline?.working_dir || process.cwd();
  }

  const gitRoot = getGitRoot(projectDir);

  if (task.branch === newBranch) {
    res.json({ ok: true, branch: newBranch });
    return;
  }

  // Validate: new branch must exist in repo
  if (!branchExists(newBranch, gitRoot)) {
    res.status(400).json({ error: `Branch "${newBranch}" does not exist` });
    return;
  }

  // Check for uncommitted changes in current worktree
  if (task.worktree_path && existsSync(task.worktree_path)) {
    try {
      const status = git(['status', '--porcelain'], {
        cwd: task.worktree_path,
      }).trim();
      if (status.length > 0) {
        res.status(409).json({
          error: 'uncommitted_changes',
          message: 'Current worktree has uncommitted changes. Commit or discard them first.',
          files: status.split('\n').filter(Boolean),
        });
        return;
      }
    } catch { /* best effort */ }
  }

  // Update DB and invalidate any cached worktree so the next run provisions
  // from the new source branch.
  db.prepare(
    'UPDATE tasks SET branch = ?, worktree_path = NULL, worktree_status = ? WHERE id = ?'
  ).run(newBranch, 'none', task.id);

  res.json({ ok: true, branch: newBranch });
});

export default router;
