/**
 * Resolves canonical project paths from git worktree directories.
 *
 * Claude Code v2.1.47+ supports worktree isolation, passing worktree paths
 * (e.g., /tmp/claude-worktree-abc123/) as `cwd`. This utility resolves
 * worktree paths back to the main repository path so project identity
 * remains consistent across worktree and non-worktree sessions.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('project-path');

/** Module-level cache: worktree path → canonical path. */
const cache = new Map<string, string>();

/**
 * Resolve a working directory to its canonical project path.
 *
 * For normal repos, returns the input unchanged.
 * For linked worktrees, resolves to the main repository path.
 * For non-git directories, returns the input unchanged.
 *
 * @param cwd - The working directory (possibly a worktree path)
 * @returns The canonical project path (main repo root)
 */
export function resolveCanonicalProjectPath(cwd: string): string {
  if (!cwd) return cwd;

  const cached = cache.get(cwd);
  if (cached !== undefined) return cached;

  const resolved = resolveWorktree(cwd);
  cache.set(cwd, resolved);
  return resolved;
}

/**
 * Clear the path cache. Intended for testing.
 */
export function clearProjectPathCache(): void {
  cache.clear();
}

/**
 * Internal resolution logic.
 */
function resolveWorktree(cwd: string): string {
  // Check if .git exists and what type it is
  let gitStat;
  try {
    gitStat = statSync(join(cwd, '.git'));
  } catch {
    // No .git — not a git repo (or inaccessible), return as-is
    return cwd;
  }

  // Normal repo: .git is a directory
  if (gitStat.isDirectory()) {
    return cwd;
  }

  // Linked worktree: .git is a file containing "gitdir: <path>"
  if (gitStat.isFile()) {
    return resolveFromGitCommand(cwd) ?? resolveFromGitFile(cwd) ?? cwd;
  }

  return cwd;
}

/**
 * Try resolving via `git worktree list --porcelain`.
 * The first line is always the main worktree: "worktree /path/to/main"
 */
function resolveFromGitCommand(cwd: string): string | null {
  try {
    const output = execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      timeout: 500,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // First line: "worktree /path/to/main/repo"
    const firstLine = output.split('\n')[0];
    if (firstLine?.startsWith('worktree ')) {
      const mainPath = firstLine.slice('worktree '.length).trim();
      if (mainPath && mainPath !== cwd) {
        log.debug('Resolved worktree via git command', { from: cwd, to: mainPath });
        return mainPath;
      }
      // If mainPath === cwd, this IS the main worktree
      return mainPath || null;
    }
  } catch (error) {
    log.debug('git worktree list failed, trying .git file fallback', {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

/**
 * Fallback: parse the .git file to find the main repo.
 *
 * Worktree .git files contain: "gitdir: /path/to/main/.git/worktrees/<name>"
 * Submodule .git files contain: "gitdir: /path/to/main/.git/modules/<name>"
 *
 * We only resolve worktrees (path contains /worktrees/), not submodules.
 */
function resolveFromGitFile(cwd: string): string | null {
  try {
    const gitFileContent = readFileSync(join(cwd, '.git'), 'utf-8').trim();

    if (!gitFileContent.startsWith('gitdir: ')) {
      return null;
    }

    const gitdir = gitFileContent.slice('gitdir: '.length).trim();

    // Only resolve worktrees, not submodules
    if (!gitdir.includes('/worktrees/')) {
      return null;
    }

    // Walk up from gitdir to find main repo root:
    // gitdir is like /path/to/main/.git/worktrees/<name>
    // We need /path/to/main (parent of .git)
    const worktreesIdx = gitdir.lastIndexOf('/worktrees/');
    const dotGitDir = gitdir.slice(0, worktreesIdx);

    // dotGitDir should end with .git (or be the .git directory itself)
    const mainPath = dirname(dotGitDir);
    if (mainPath) {
      log.debug('Resolved worktree via .git file', { from: cwd, to: mainPath });
      return mainPath;
    }
  } catch (error) {
    log.debug('Failed to parse .git file', {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}
