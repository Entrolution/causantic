/**
 * File-level cache for parsed tags.
 *
 * Stores parsed tags per file, keyed by file path + mtime.
 * When a file's mtime changes, only that file is re-parsed.
 * When the file list changes (new/deleted files), the file list hash
 * is invalidated and a full rescan is triggered.
 */

import { createHash } from 'crypto';
import type { Tag } from './parser.js';
import type { ScannedFile } from './scanner.js';

/** Cached tags for a single file. */
interface CachedFileTags {
  /** File modification time when tags were extracted. */
  mtimeMs: number;
  /** Extracted tags. */
  tags: Tag[];
}

/** In-memory tag cache for a project. */
export class TagCache {
  /** Cache keyed by relative file path → cached tags. */
  private fileCache = new Map<string, CachedFileTags>();
  /** Hash of the file list for staleness detection. */
  private fileListHash: string = '';

  /**
   * Compute a hash of the file list (just paths, sorted).
   * Used to detect when files are added or removed.
   */
  private computeFileListHash(files: ScannedFile[]): string {
    const paths = files.map((f) => f.relativePath).join('\n');
    return createHash('md5').update(paths).digest('hex');
  }

  /**
   * Get cached tags for files that haven't changed.
   * Returns which files need re-parsing.
   *
   * @param files - Current list of scanned files
   * @returns Object with cached tags and files needing re-parse
   */
  resolve(files: ScannedFile[]): {
    /** Tags from cache (file hasn't changed). */
    cached: Map<string, Tag[]>;
    /** Files that need re-parsing (new or modified). */
    stale: ScannedFile[];
    /** Whether the file list itself changed (files added/removed). */
    fileListChanged: boolean;
  } {
    const newHash = this.computeFileListHash(files);
    const fileListChanged = newHash !== this.fileListHash;

    if (fileListChanged) {
      // File list changed — keep per-file cache entries that still exist,
      // but mark the list as changed so the graph is rebuilt
      this.fileListHash = newHash;

      // Remove entries for files no longer in the list
      const currentPaths = new Set(files.map((f) => f.relativePath));
      for (const path of this.fileCache.keys()) {
        if (!currentPaths.has(path)) {
          this.fileCache.delete(path);
        }
      }
    }

    const cached = new Map<string, Tag[]>();
    const stale: ScannedFile[] = [];

    for (const file of files) {
      const entry = this.fileCache.get(file.relativePath);
      if (entry && entry.mtimeMs === file.mtimeMs) {
        cached.set(file.relativePath, entry.tags);
      } else {
        stale.push(file);
      }
    }

    return { cached, stale, fileListChanged };
  }

  /**
   * Update the cache with newly parsed tags.
   */
  update(file: ScannedFile, tags: Tag[]): void {
    this.fileCache.set(file.relativePath, {
      mtimeMs: file.mtimeMs,
      tags,
    });
  }

  /**
   * Get total number of cached files.
   */
  get size(): number {
    return this.fileCache.size;
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.fileCache.clear();
    this.fileListHash = '';
  }
}

/** Global cache instances per project path. */
const projectCaches = new Map<string, TagCache>();

/**
 * Get or create a cache for a project.
 */
export function getProjectCache(projectPath: string): TagCache {
  let cache = projectCaches.get(projectPath);
  if (!cache) {
    cache = new TagCache();
    projectCaches.set(projectPath, cache);
  }
  return cache;
}

/**
 * Clear all project caches.
 */
export function clearAllCaches(): void {
  projectCaches.clear();
}
