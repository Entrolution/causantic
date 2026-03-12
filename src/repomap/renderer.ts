/**
 * Render ranked definitions into a compact text repo map.
 *
 * Produces a token-budgeted structural summary showing file paths
 * and key definitions with structural context.
 */

import type { Tag } from './parser.js';
import type { DependencyGraph, FileNode } from './graph.js';
import { approximateTokens } from '../utils/token-counter.js';

export interface RenderOptions {
  /** Maximum tokens for the output. Default: 1024. */
  maxTokens?: number;
  /** Files to boost to the top of the output. */
  focusFiles?: string[];
  /** Whether to show line numbers. Default: true. */
  showLineNumbers?: boolean;
}

/** Type label for compact display. */
const TYPE_LABELS: Record<string, string> = {
  class: 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  function: 'fn',
  variable: 'const',
  method: 'method',
  export: 'export',
};

/**
 * Render a dependency graph into a compact text map.
 *
 * Output format:
 * ```
 * src/retrieval/search-assembler.ts
 *   fn searchContext (42)
 *   fn findSimilarChunkIds (180)
 *
 * src/storage/chunk-store.ts
 *   fn getDistinctProjects (15)
 *   fn getSessionsForProject (45)
 * ```
 *
 * @param graph - The dependency graph with ranked files
 * @param options - Render options
 * @returns Compact text representation
 */
export function renderMap(graph: DependencyGraph, options: RenderOptions = {}): string {
  const maxTokens = options.maxTokens ?? 1024;
  const showLineNumbers = options.showLineNumbers ?? true;
  const focusFiles = new Set(options.focusFiles ?? []);

  // Build ordered list of files: focus files first, then by rank
  const orderedFiles = orderFiles(graph.rankedFiles, focusFiles);

  // Binary search for the maximum number of files we can include
  const result = fitToTokenBudget(orderedFiles, maxTokens, showLineNumbers);
  return result;
}

/**
 * Order files: focus files first (in rank order), then remaining by rank.
 */
function orderFiles(rankedFiles: FileNode[], focusFiles: Set<string>): FileNode[] {
  if (focusFiles.size === 0) return rankedFiles;

  const focused: FileNode[] = [];
  const rest: FileNode[] = [];

  for (const file of rankedFiles) {
    if (focusFiles.has(file.path)) {
      focused.push(file);
    } else {
      rest.push(file);
    }
  }

  return [...focused, ...rest];
}

/**
 * Fit files and definitions into the token budget.
 * Uses a greedy approach: add files one by one until budget is exhausted.
 */
function fitToTokenBudget(
  orderedFiles: FileNode[],
  maxTokens: number,
  showLineNumbers: boolean,
): string {
  const sections: string[] = [];
  let currentTokens = 0;

  for (const file of orderedFiles) {
    if (file.definitions.length === 0) continue;

    const section = renderFileSection(file, showLineNumbers);
    const sectionTokens = approximateTokens(section);

    if (currentTokens + sectionTokens > maxTokens) {
      // Try a truncated version with fewer definitions
      const truncated = renderFileSectionTruncated(file, maxTokens - currentTokens, showLineNumbers);
      if (truncated) {
        sections.push(truncated);
      }
      break;
    }

    sections.push(section);
    currentTokens += sectionTokens;
  }

  if (sections.length === 0) {
    return '(no definitions found)';
  }

  return sections.join('\n\n');
}

/**
 * Render a single file's section.
 */
function renderFileSection(file: FileNode, showLineNumbers: boolean): string {
  const lines: string[] = [file.path];

  // Deduplicate and sort definitions
  const seen = new Set<string>();
  const defs = file.definitions.filter((d) => {
    const key = `${d.type}:${d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const def of defs) {
    const label = TYPE_LABELS[def.type] ?? def.type;
    const lineRef = showLineNumbers ? ` (${def.line})` : '';
    lines.push(`  ${label} ${def.name}${lineRef}`);
  }

  return lines.join('\n');
}

/**
 * Render a truncated file section that fits within a token budget.
 * Returns null if even the file header doesn't fit.
 */
function renderFileSectionTruncated(
  file: FileNode,
  remainingTokens: number,
  showLineNumbers: boolean,
): string | null {
  if (remainingTokens < 10) return null;

  const lines: string[] = [file.path];
  let currentTokens = approximateTokens(file.path + '\n');

  const seen = new Set<string>();
  const defs = file.definitions.filter((d) => {
    const key = `${d.type}:${d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const def of defs) {
    const label = TYPE_LABELS[def.type] ?? def.type;
    const lineRef = showLineNumbers ? ` (${def.line})` : '';
    const line = `  ${label} ${def.name}${lineRef}`;
    const lineTokens = approximateTokens(line + '\n');

    if (currentTokens + lineTokens > remainingTokens) break;

    lines.push(line);
    currentTokens += lineTokens;
  }

  if (lines.length <= 1) return null;

  return lines.join('\n');
}

/**
 * Render a minimal summary of the graph for very tight budgets.
 * Just lists the top N files with definition counts.
 */
export function renderMinimalSummary(graph: DependencyGraph, maxFiles: number = 20): string {
  const lines: string[] = [];

  for (const file of graph.rankedFiles.slice(0, maxFiles)) {
    if (file.definitions.length === 0) continue;
    const defCount = file.definitions.length;
    const topDefs = file.definitions
      .slice(0, 3)
      .map((d) => d.name)
      .join(', ');
    lines.push(`${file.path} (${defCount} defs: ${topDefs}${defCount > 3 ? ', ...' : ''})`);
  }

  return lines.join('\n');
}
