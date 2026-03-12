/**
 * Tests for project directory scanner.
 */

import { describe, it, expect } from 'vitest';
import { scanProject } from '../../src/repomap/scanner.js';

const PROJECT_ROOT = process.cwd();

describe('scanProject', () => {
  it('finds TypeScript files in the project', () => {
    const files = scanProject(PROJECT_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const tsFiles = files.filter((f) => f.extension === '.ts');
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it('returns files sorted by relative path', () => {
    const files = scanProject(PROJECT_ROOT);
    const paths = files.map((f) => f.relativePath);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('excludes node_modules', () => {
    const files = scanProject(PROJECT_ROOT);
    const inNodeModules = files.filter((f) => f.relativePath.includes('node_modules'));
    expect(inNodeModules).toHaveLength(0);
  });

  it('excludes dist directory', () => {
    const files = scanProject(PROJECT_ROOT);
    const inDist = files.filter((f) => f.relativePath.startsWith('dist/'));
    expect(inDist).toHaveLength(0);
  });

  it('excludes .git directory', () => {
    const files = scanProject(PROJECT_ROOT);
    const inGit = files.filter((f) => f.relativePath.includes('.git/'));
    expect(inGit).toHaveLength(0);
  });

  it('includes source files from src/', () => {
    const files = scanProject(PROJECT_ROOT);
    const srcFiles = files.filter((f) => f.relativePath.startsWith('src/'));
    expect(srcFiles.length).toBeGreaterThan(10);
  });

  it('includes test files from test/', () => {
    const files = scanProject(PROJECT_ROOT);
    const testFiles = files.filter((f) => f.relativePath.startsWith('test/'));
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it('returns valid file metadata', () => {
    const files = scanProject(PROJECT_ROOT);
    for (const file of files.slice(0, 5)) {
      expect(file.absolutePath).toContain(PROJECT_ROOT);
      expect(file.extension).toMatch(/^\.\w+$/);
      expect(file.mtimeMs).toBeGreaterThan(0);
      expect(file.relativePath.startsWith('/')).toBe(false);
    }
  });

  it('respects maxFiles option', () => {
    const files = scanProject(PROJECT_ROOT, { maxFiles: 10 });
    expect(files.length).toBeLessThanOrEqual(10);
  });

  it('respects skipDirs option', () => {
    const files = scanProject(PROJECT_ROOT, { skipDirs: ['test'] });
    const testFiles = files.filter((f) => f.relativePath.startsWith('test/'));
    expect(testFiles).toHaveLength(0);
  });

  it('finds repomap source files', () => {
    const files = scanProject(PROJECT_ROOT);
    const repomapFiles = files.filter((f) => f.relativePath.startsWith('src/repomap/'));
    expect(repomapFiles.length).toBeGreaterThanOrEqual(5);
  });
});
