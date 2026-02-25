import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

// Mock child_process and fs before imports
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import {
  resolveCanonicalProjectPath,
  clearProjectPathCache,
} from '../../src/utils/project-path.js';
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';

const mockExecFileSync = vi.mocked(execFileSync);
const mockStatSync = vi.mocked(statSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('resolveCanonicalProjectPath', () => {
  beforeEach(() => {
    clearProjectPathCache();
    vi.clearAllMocks();
  });

  it('returns empty string for empty input', () => {
    expect(resolveCanonicalProjectPath('')).toBe('');
  });

  it('returns unchanged for normal repo (.git is directory)', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as ReturnType<
      typeof statSync
    >);

    expect(resolveCanonicalProjectPath('/Users/test/my-project')).toBe('/Users/test/my-project');
  });

  it('returns unchanged for non-git directory (no .git)', () => {
    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(resolveCanonicalProjectPath('/tmp/random-dir')).toBe('/tmp/random-dir');
  });

  it('resolves linked worktree via git command', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    mockExecFileSync.mockReturnValue(
      'worktree /Users/test/my-project\nbare\n\nworktree /tmp/claude-worktree-abc123\nbranch refs/heads/feature\n',
    );

    expect(resolveCanonicalProjectPath('/tmp/claude-worktree-abc123')).toBe(
      '/Users/test/my-project',
    );
  });

  it('falls back to .git file parsing when git command fails', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    mockReadFileSync.mockReturnValue(
      'gitdir: /Users/test/my-project/.git/worktrees/feature-branch',
    );

    expect(resolveCanonicalProjectPath('/tmp/claude-worktree-abc123')).toBe(
      '/Users/test/my-project',
    );
  });

  it('does not resolve submodule .git files (no /worktrees/ in path)', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    mockReadFileSync.mockReturnValue('gitdir: /Users/test/main-project/.git/modules/my-submodule');

    expect(resolveCanonicalProjectPath('/Users/test/main-project/my-submodule')).toBe(
      '/Users/test/main-project/my-submodule',
    );
  });

  it('returns original cwd when both methods fail', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    expect(resolveCanonicalProjectPath('/tmp/broken-worktree')).toBe('/tmp/broken-worktree');
  });

  it('caches results (second call does not spawn subprocess)', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as ReturnType<
      typeof statSync
    >);

    resolveCanonicalProjectPath('/Users/test/cached-project');
    resolveCanonicalProjectPath('/Users/test/cached-project');

    // statSync called only once (first call), not on second
    expect(mockStatSync).toHaveBeenCalledTimes(1);
  });

  it('returns cwd when .git file has unexpected format', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    mockReadFileSync.mockReturnValue('unexpected content without gitdir prefix');

    expect(resolveCanonicalProjectPath('/tmp/weird-git')).toBe('/tmp/weird-git');
  });

  it('handles main worktree correctly (worktree path === cwd)', () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<
      typeof statSync
    >);

    // When git worktree list returns the same path as cwd, it IS the main worktree
    mockExecFileSync.mockReturnValue('worktree /Users/test/my-project\nbare\n');

    expect(resolveCanonicalProjectPath('/Users/test/my-project')).toBe('/Users/test/my-project');
  });
});

describe('resolveCanonicalProjectPath integration', () => {
  // Integration test using real git operations
  // Only runs if git is available
  let tempDir: string;
  let worktreePath: string;
  let hasGit = false;

  beforeEach(async () => {
    clearProjectPathCache();

    try {
      const { execSync } = await import('node:child_process');
      execSync('git --version', { stdio: 'ignore' });
      hasGit = true;
    } catch {
      hasGit = false;
    }
  });

  afterEach(async () => {
    if (!hasGit || !tempDir) return;

    // Cleanup: remove worktree first, then temp dir
    try {
      const { execSync } = await import('node:child_process');
      const { rmSync } = await import('node:fs');
      if (worktreePath) {
        execSync(`git -C "${tempDir}" worktree remove "${worktreePath}" --force`, {
          stdio: 'ignore',
        });
      }
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('resolves real git worktree to main repo path', async () => {
    if (!hasGit) return; // Skip if git unavailable

    // Restore real implementations for this test
    vi.restoreAllMocks();
    clearProjectPathCache();

    const { execSync } = await import('node:child_process');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    // Create a real git repo
    tempDir = mkdtempSync(join(tmpdir(), 'causantic-worktree-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit --allow-empty -m "init"', { cwd: tempDir, stdio: 'ignore' });

    // Create a worktree
    worktreePath = join(tmpdir(), 'causantic-worktree-test-wt-' + Date.now());
    execSync(`git worktree add "${worktreePath}" -b test-branch`, {
      cwd: tempDir,
      stdio: 'ignore',
    });

    // Re-import to get un-mocked version
    const { resolveCanonicalProjectPath: resolve, clearProjectPathCache: clearCache } =
      await import('../../src/utils/project-path.js');
    clearCache();

    const result = resolve(worktreePath);
    expect(result).toBe(tempDir);
  });
});
