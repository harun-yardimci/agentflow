import { execFileSync } from 'child_process';
import { resolve, sep } from 'path';

function isPathWithin(parentPath: string, targetPath: string): boolean {
  const normalizedParent = parentPath.endsWith(sep)
    ? parentPath
    : `${parentPath}${sep}`;
  return targetPath === parentPath || targetPath.startsWith(normalizedParent);
}

function compactParentDirs(paths: string[]): string[] {
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  return uniquePaths.filter((path) => !uniquePaths.some(
    (other) => other !== path && isPathWithin(other, path),
  ));
}

function resolveGitPath(workingDir: string, gitPath: string): string {
  return resolve(workingDir, gitPath);
}

/**
 * Git worktrees keep mutable rebase/merge state in the main repo's .git dir.
 * Some CLI agents need those directories added explicitly when the git
 * metadata lives outside the current working directory.
 */
export function getAdditionalWorkspaceDirs(workingDir: string): string[] {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();

    if (!gitDir || !gitCommonDir) {
      return [];
    }

    const workspaceRoot = resolve(workingDir);
    const candidates = compactParentDirs([
      resolveGitPath(workingDir, gitCommonDir),
      resolveGitPath(workingDir, gitDir),
    ]);

    return candidates.filter((path) => !isPathWithin(workspaceRoot, path));
  } catch {
    return [];
  }
}
