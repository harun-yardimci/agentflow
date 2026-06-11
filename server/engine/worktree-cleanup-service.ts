import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { setTimeout as delay } from 'node:timers/promises';
import { getDb } from '../db/connection.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { getGitRoot, hasChanges, removeWorktree } from './worktree-manager.js';

/** Run a command with argv array (no shell) to avoid injection via refs/args. */
function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, stdio: 'pipe' }).toString();
}

const DEFAULT_RETENTION_DAYS = 5;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 1_500;
const CLEANUP_YIELD_EVERY = 10;
const ONE_TIME_NOT_MERGED_CLEANUP_KEY =
  'worktree_cleanup_not_merged_once_v1_completed';

interface CleanupCandidateRow {
  id: string;
  pipeline_id: string;
  name: string;
  status: string;
  archived_at: string | null;
  worktree_path: string | null;
  working_dir: string | null;
  pipeline_working_dir: string | null;
  pipeline_git_branch: string | null;
  worktree_status: string | null;
}

export interface WorktreeCleanupResult {
  blockedDirty: number;
  cleaned: number;
  dockerImagesCleaned: number;
  eligible: number;
  missingPathCleaned: number;
  notMerged: number;
  scanned: number;
  skipped: number;
  tooRecent: number;
}

interface WorktreeRemovalTarget {
  id: string;
  projectDir: string;
  worktreePath: string | null;
}

interface OneTimeNotMergedCleanupResult {
  cleaned: number;
  dockerImagesCleaned: number;
  scanned: number;
}

function getMainBranch(cwd: string): string {
  try {
    const branches = run('git', ['branch', '--list', 'main', 'master'], cwd).trim();
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
  } catch {
    // Best effort fallback below.
  }

  return 'main';
}

function getPipelineBaseBranch(row: CleanupCandidateRow, gitRoot: string): string {
  const configuredBranch = row.pipeline_git_branch?.trim();
  if (configuredBranch) {
    return configuredBranch;
  }

  return getMainBranch(gitRoot);
}

function isPastRetention(archivedAt: string | null, nowMs: number): boolean {
  if (!archivedAt) return false;
  const archivedMs = Date.parse(archivedAt);
  if (Number.isNaN(archivedMs)) return false;

  return nowMs - archivedMs >= DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function isBranchMerged(gitRoot: string, mainBranch: string, taskBranch: string): boolean {
  try {
    const merged = run('git', ['branch', '--merged', mainBranch], gitRoot);

    return merged
      .split('\n')
      .some((branch) => branch.replace(/^[*+]\s*/, '').trim() === taskBranch);
  } catch {
    return false;
  }
}

function logPipelineEvent(
  pipelineId: string,
  type: 'info' | 'warning',
  message: string,
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)',
  ).run(pipelineId, logTimestamp(), type, message);
}

function removeWorktreeByPath(projectDir: string, worktreePath: string): void {
  const gitRoot = getGitRoot(projectDir);
  run('git', ['worktree', 'remove', worktreePath, '--force'], gitRoot);
  run('git', ['worktree', 'prune'], gitRoot);
}

function listTaskDockerImages(taskId: string): string[] {
  try {
    const output = run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
    const prefix = `task-${taskId}-`;

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('<none>:'))
      .filter((line) => line.startsWith(prefix));
  } catch {
    return [];
  }
}

function taskDockerImageHasContainers(imageRef: string): boolean {
  try {
    const output = run('docker', ['ps', '-a', '--filter', `ancestor=${imageRef}`, '-q']).trim();

    return output.length > 0;
  } catch {
    return true;
  }
}

function cleanupTaskDockerImagesNow(taskId: string): number {
  const imageRefs = listTaskDockerImages(taskId);
  let removed = 0;

  for (const imageRef of imageRefs) {
    if (taskDockerImageHasContainers(imageRef)) {
      continue;
    }

    try {
      run('docker', ['image', 'rm', imageRef]);
      removed += 1;
    } catch {
      // Best effort cleanup only.
    }
  }

  return removed;
}

export function cleanupTaskWorktreeNow(target: WorktreeRemovalTarget): number {
  const worktreePath = target.worktreePath?.trim();
  if (worktreePath && existsSync(worktreePath)) {
    removeWorktreeByPath(target.projectDir, worktreePath);
  }

  return cleanupTaskDockerImagesNow(target.id);
}

async function runOneTimeNotMergedCleanup(): Promise<OneTimeNotMergedCleanupResult> {
  const db = getDb();
  const alreadyCompleted = db.prepare(
    'SELECT value FROM settings WHERE key = ?',
  ).get(ONE_TIME_NOT_MERGED_CLEANUP_KEY) as { value: string } | undefined;
  if (alreadyCompleted?.value === 'true') {
    return { cleaned: 0, dockerImagesCleaned: 0, scanned: 0 };
  }

  const candidates = db.prepare(`
    SELECT
      t.id,
      t.pipeline_id,
      t.name,
      t.archived_at,
      t.worktree_path,
      t.working_dir,
      p.working_dir AS pipeline_working_dir
    FROM tasks t
    JOIN pipelines p ON p.id = t.pipeline_id
    WHERE t.archived_at IS NOT NULL
      AND t.worktree_path IS NOT NULL
      AND t.status != 'running'
  `).all() as Array<{
    id: string;
    pipeline_id: string;
    name: string;
    archived_at: string | null;
    worktree_path: string | null;
    working_dir: string | null;
    pipeline_working_dir: string | null;
  }>;

  let cleaned = 0;
  let dockerImagesCleaned = 0;
  let scanned = 0;
  const nowMs = Date.now();
  const markCleaned = db.prepare(
    'UPDATE tasks SET worktree_path = NULL, worktree_status = ? WHERE id = ?',
  );

  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0 && index % CLEANUP_YIELD_EVERY === 0) {
      await delay(0);
    }

    const row = candidates[index]!;
    if (!isPastRetention(row.archived_at, nowMs)) {
      continue;
    }

    const worktreePath = row.worktree_path?.trim();
    if (!worktreePath || !existsSync(worktreePath)) {
      continue;
    }

    scanned += 1;
    const projectDir =
      row.working_dir?.trim()
      || row.pipeline_working_dir?.trim()
      || process.cwd();

    dockerImagesCleaned += cleanupTaskWorktreeNow({
      id: row.id,
      projectDir,
      worktreePath,
    });
    markCleaned.run('cleaned', row.id);
    logPipelineEvent(
      row.pipeline_id,
      'info',
      `'${row.name}' worktree cleaned by one-time archived cleanup for unmerged tasks`,
    );
    cleaned += 1;
  }

  db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
  ).run(ONE_TIME_NOT_MERGED_CLEANUP_KEY, 'true');

  return { cleaned, dockerImagesCleaned, scanned };
}

export async function runWorktreeCleanup(): Promise<WorktreeCleanupResult> {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT
      t.id,
      t.pipeline_id,
      t.name,
      t.status,
      t.archived_at,
      t.worktree_path,
      t.working_dir,
      p.working_dir AS pipeline_working_dir,
      p.git_branch AS pipeline_git_branch,
      t.worktree_status
    FROM tasks t
    JOIN pipelines p ON p.id = t.pipeline_id
    WHERE t.archived_at IS NOT NULL
      AND t.worktree_path IS NOT NULL
      AND t.status != 'running'
  `).all() as CleanupCandidateRow[];

  const nowMs = Date.now();
  let cleaned = 0;
  let blockedDirty = 0;
  let dockerImagesCleaned = 0;
  let eligible = 0;
  let missingPathCleaned = 0;
  let notMerged = 0;
  let tooRecent = 0;

  const markCleaned = db.prepare(
    'UPDATE tasks SET worktree_path = NULL, worktree_status = ? WHERE id = ?',
  );
  const markMissingPathCleaned = db.prepare(
    'UPDATE tasks SET worktree_path = NULL, worktree_status = ? WHERE id = ?',
  );
  const markBlockedDirty = db.prepare(
    'UPDATE tasks SET worktree_status = ? WHERE id = ?',
  );

  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0 && index % CLEANUP_YIELD_EVERY === 0) {
      await delay(0);
    }

    const row = candidates[index]!;

    if (!isPastRetention(row.archived_at, nowMs)) {
      tooRecent += 1;
      continue;
    }

    const worktreePath = row.worktree_path;
    if (!worktreePath || !existsSync(worktreePath)) {
      dockerImagesCleaned += cleanupTaskDockerImagesNow(row.id);
      markMissingPathCleaned.run('cleaned_missing_path', row.id);
      logPipelineEvent(
        row.pipeline_id,
        'info',
        `'${row.name}' workspace metadata cleaned — worktree path was missing on disk`,
      );
      missingPathCleaned += 1;
      continue;
    }

    const projectDir =
      row.working_dir?.trim()
      || row.pipeline_working_dir?.trim()
      || process.cwd();
    const gitRoot = getGitRoot(projectDir);
    const mainBranch = getPipelineBaseBranch(row, gitRoot);
    const taskBranch = `task/${row.id}`;

    if (!isBranchMerged(gitRoot, mainBranch, taskBranch)) {
      notMerged += 1;
      continue;
    }

    eligible += 1;

    if (hasChanges(worktreePath)) {
      if (row.worktree_status !== 'cleanup_blocked_dirty') {
        markBlockedDirty.run('cleanup_blocked_dirty', row.id);
        logPipelineEvent(
          row.pipeline_id,
          'warning',
          `'${row.name}' cleanup blocked — worktree has uncommitted changes`,
        );
      }
      blockedDirty += 1;
      continue;
    }

    removeWorktree(row.id, projectDir);
    dockerImagesCleaned += cleanupTaskDockerImagesNow(row.id);
    markCleaned.run('cleaned', row.id);
    logPipelineEvent(
      row.pipeline_id,
      'info',
      `'${row.name}' worktree cleaned after archive retention`,
    );
    cleaned += 1;
  }

  return {
    blockedDirty,
    cleaned,
    dockerImagesCleaned,
    eligible,
    missingPathCleaned,
    notMerged,
    scanned: candidates.length,
    skipped: tooRecent + notMerged,
    tooRecent,
  };
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupInFlight = false;

async function runCleanupPass(reason: 'startup' | 'scheduled'): Promise<void> {
  if (cleanupInFlight) {
    console.log(`[WorktreeCleanup:${reason}] skipped because another cleanup run is still in progress`);
    return;
  }

  cleanupInFlight = true;
  const startedAt = Date.now();
  try {
    console.log(`[WorktreeCleanup:${reason}] starting background cleanup scan`);
    const result = await runWorktreeCleanup();
    const durationMs = Date.now() - startedAt;
    console.log(
      `[WorktreeCleanup:${reason}] completed in ${durationMs}ms scanned=${result.scanned} eligible=${result.eligible} cleaned=${result.cleaned} docker_images_cleaned=${result.dockerImagesCleaned} blocked_dirty=${result.blockedDirty} cleaned_missing_path=${result.missingPathCleaned} too_recent=${result.tooRecent} not_merged=${result.notMerged} skipped=${result.skipped}`,
    );

    if (reason === 'startup') {
      const oneTimeStartedAt = Date.now();
      console.log(
        '[WorktreeCleanup:startup] starting one-time archived cleanup for unmerged tasks',
      );
      const oneTime = await runOneTimeNotMergedCleanup();
      console.log(
        `[WorktreeCleanup:startup] one-time unmerged cleanup completed in ${Date.now() - oneTimeStartedAt}ms scanned=${oneTime.scanned} cleaned=${oneTime.cleaned} docker_images_cleaned=${oneTime.dockerImagesCleaned}`,
      );
    }
  } catch (err) {
    console.error(
      `[WorktreeCleanup:${reason}] failed: ${(err as Error).message}`,
    );
  } finally {
    cleanupInFlight = false;
  }
}

export function startWorktreeCleanupScheduler(): void {
  if (!startupTimer) {
    console.log(
      `[WorktreeCleanup:startup] scheduled in background after ${STARTUP_DELAY_MS}ms`,
    );
    startupTimer = setTimeout(() => {
      startupTimer = null;
      void runCleanupPass('startup');
    }, STARTUP_DELAY_MS);
    startupTimer.unref?.();
  }

  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      void runCleanupPass('scheduled');
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }
}

export function stopWorktreeCleanupScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
