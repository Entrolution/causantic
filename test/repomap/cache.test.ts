/**
 * Tests for file tag cache.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TagCache } from '../../src/repomap/cache.js';
import type { ScannedFile } from '../../src/repomap/scanner.js';
import type { Tag } from '../../src/repomap/parser.js';

function makeFile(path: string, mtimeMs: number = Date.now()): ScannedFile {
  return {
    absolutePath: `/project/${path}`,
    relativePath: path,
    extension: '.ts',
    mtimeMs,
  };
}

function makeTag(name: string, file: string): Tag {
  return { name, kind: 'def', line: 1, file, type: 'function' };
}

describe('TagCache', () => {
  let cache: TagCache;

  beforeEach(() => {
    cache = new TagCache();
  });

  it('reports all files as stale on first run', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const result = cache.resolve(files);

    expect(result.stale.length).toBe(2);
    expect(result.cached.size).toBe(0);
    expect(result.fileListChanged).toBe(true);
  });

  it('returns cached tags for unchanged files', () => {
    const file = makeFile('a.ts', 1000);
    const tags = [makeTag('foo', 'a.ts')];

    // First resolve
    cache.resolve([file]);
    cache.update(file, tags);

    // Second resolve with same mtime
    const result = cache.resolve([file]);
    expect(result.cached.size).toBe(1);
    expect(result.cached.get('a.ts')).toEqual(tags);
    expect(result.stale.length).toBe(0);
  });

  it('marks files as stale when mtime changes', () => {
    const file1 = makeFile('a.ts', 1000);
    const tags = [makeTag('foo', 'a.ts')];

    cache.resolve([file1]);
    cache.update(file1, tags);

    // File modified
    const file2 = makeFile('a.ts', 2000);
    const result = cache.resolve([file2]);
    expect(result.stale.length).toBe(1);
    expect(result.stale[0].relativePath).toBe('a.ts');
  });

  it('detects when file list changes (new files)', () => {
    const files1 = [makeFile('a.ts', 1000)];
    cache.resolve(files1);
    cache.update(files1[0], [makeTag('foo', 'a.ts')]);

    const files2 = [makeFile('a.ts', 1000), makeFile('b.ts', 1000)];
    const result = cache.resolve(files2);

    expect(result.fileListChanged).toBe(true);
    expect(result.cached.size).toBe(1); // a.ts is still cached
    expect(result.stale.length).toBe(1); // b.ts is new
  });

  it('detects when file list changes (deleted files)', () => {
    const files1 = [makeFile('a.ts', 1000), makeFile('b.ts', 1000)];
    cache.resolve(files1);
    cache.update(files1[0], [makeTag('foo', 'a.ts')]);
    cache.update(files1[1], [makeTag('bar', 'b.ts')]);

    const files2 = [makeFile('a.ts', 1000)];
    const result = cache.resolve(files2);

    expect(result.fileListChanged).toBe(true);
    expect(result.cached.size).toBe(1);
    expect(cache.size).toBe(1); // b.ts entry was cleaned up
  });

  it('clears all entries', () => {
    const file = makeFile('a.ts', 1000);
    cache.resolve([file]);
    cache.update(file, [makeTag('foo', 'a.ts')]);

    cache.clear();
    expect(cache.size).toBe(0);

    const result = cache.resolve([file]);
    expect(result.stale.length).toBe(1);
  });

  it('reports no file list change on same file list', () => {
    const files = [makeFile('a.ts', 1000), makeFile('b.ts', 1000)];

    cache.resolve(files);
    const result = cache.resolve(files);
    expect(result.fileListChanged).toBe(false);
  });
});
