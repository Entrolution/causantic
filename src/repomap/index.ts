/**
 * Repo Map: structural codebase summary.
 *
 * Provides a compact overview of a project's structure — files, definitions,
 * and cross-file relationships — within a token budget. Designed to give
 * Claude Code the structural context it needs without reading individual files.
 *
 * @example
 * ```typescript
 * const map = await buildRepoMap('/path/to/project', { maxTokens: 1024 });
 * console.log(map.text);       // Compact structural summary
 * console.log(map.fileCount);  // Number of files scanned
 * ```
 *
 * @packageDocumentation
 */

import { scanProject, type ScanOptions, type ScannedFile } from './scanner.js';
import { parseFile, type Tag } from './parser.js';
import { buildGraph, type DependencyGraph } from './graph.js';
import { renderMap, renderMinimalSummary, type RenderOptions } from './renderer.js';
import { getProjectCache, type TagCache } from './cache.js';

export type { Tag } from './parser.js';
export type { DependencyGraph, FileNode, FileEdge } from './graph.js';
export type { ScannedFile, ScanOptions } from './scanner.js';
export type { RenderOptions } from './renderer.js';
export { scanProject } from './scanner.js';
export { parseFile, isSupportedExtension } from './parser.js';
export { buildGraph, getRankedDefinitions } from './graph.js';
export { renderMap, renderMinimalSummary } from './renderer.js';
export { getProjectCache, clearAllCaches, TagCache } from './cache.js';

/** Options for building a repo map. */
export interface RepoMapOptions {
  /** Maximum tokens for the output. Default: 1024. */
  maxTokens?: number;
  /** Files to boost to the top of the output. */
  focusFiles?: string[];
  /** Additional extensions to include. */
  extraExtensions?: string[];
  /** Additional directories to skip. */
  skipDirs?: string[];
  /** Whether to show line numbers. Default: true. */
  showLineNumbers?: boolean;
  /** Maximum files to scan. Default: 10000. */
  maxFiles?: number;
}

/** Result of building a repo map. */
export interface RepoMapResult {
  /** The rendered text map. */
  text: string;
  /** Number of source files found. */
  fileCount: number;
  /** Number of definitions extracted. */
  definitionCount: number;
  /** Number of cross-file edges. */
  edgeCount: number;
  /** Number of files that were re-parsed (cache misses). */
  parsedCount: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** The dependency graph (for programmatic access). */
  graph: DependencyGraph;
}

/**
 * Build a structural repo map for a project.
 *
 * Pipeline:
 * 1. Scan directory for source files (filtered by gitignore)
 * 2. Parse files with tree-sitter (cached by mtime)
 * 3. Build dependency graph (files → edges → importance ranking)
 * 4. Render ranked definitions within token budget
 *
 * @param projectPath - Absolute path to the project root
 * @param options - Configuration options
 * @returns Repo map result with text and metadata
 */
export async function buildRepoMap(
  projectPath: string,
  options: RepoMapOptions = {},
): Promise<RepoMapResult> {
  const start = performance.now();

  // 1. Scan
  const scanOptions: ScanOptions = {
    extraExtensions: options.extraExtensions,
    skipDirs: options.skipDirs,
    maxFiles: options.maxFiles,
  };
  const files = scanProject(projectPath, scanOptions);

  // 2. Parse (with caching)
  const cache = getProjectCache(projectPath);
  const { cached, stale } = cache.resolve(files);

  // Parse stale files
  const tagsByFile = new Map<string, Tag[]>(cached);
  for (const file of stale) {
    const tags = await parseFile(file.absolutePath, file.relativePath);
    tagsByFile.set(file.relativePath, tags);
    cache.update(file, tags);
  }

  // 3. Build graph
  const graph = buildGraph(tagsByFile);

  // 4. Render
  const renderOptions: RenderOptions = {
    maxTokens: options.maxTokens ?? 1024,
    focusFiles: options.focusFiles,
    showLineNumbers: options.showLineNumbers,
  };
  const text = renderMap(graph, renderOptions);

  const durationMs = performance.now() - start;

  // Count definitions
  let definitionCount = 0;
  for (const node of graph.nodes.values()) {
    definitionCount += node.definitions.length;
  }

  return {
    text,
    fileCount: files.length,
    definitionCount,
    edgeCount: graph.edges.length,
    parsedCount: stale.length,
    durationMs,
    graph,
  };
}

/**
 * Look up which file defines a given symbol name.
 * Returns the file path and line number, or null if not found.
 */
export function findSymbol(
  graph: DependencyGraph,
  symbolName: string,
): { file: string; line: number; type: string } | null {
  for (const node of graph.rankedFiles) {
    for (const def of node.definitions) {
      if (def.name === symbolName) {
        return { file: def.file, line: def.line, type: def.type };
      }
    }
  }
  return null;
}
