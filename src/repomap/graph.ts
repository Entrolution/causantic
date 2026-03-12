/**
 * File dependency graph construction and importance ranking.
 *
 * Builds a graph where files are nodes and cross-file references are edges.
 * Ranks files by importance using degree-weighted scoring.
 */

import type { Tag } from './parser.js';

/** A node in the dependency graph (one per file). */
export interface FileNode {
  /** Relative file path. */
  path: string;
  /** Definitions in this file. */
  definitions: Tag[];
  /** All tags (definitions + references). */
  tags: Tag[];
  /** Importance score (higher = more important). */
  score: number;
}

/** An edge in the dependency graph. */
export interface FileEdge {
  /** File that references a symbol. */
  from: string;
  /** File that defines the symbol. */
  to: string;
  /** Total weight of this edge. */
  weight: number;
  /** Symbol names that create this link. */
  symbols: string[];
}

/** The complete dependency graph. */
export interface DependencyGraph {
  /** All file nodes, keyed by relative path. */
  nodes: Map<string, FileNode>;
  /** All edges between files. */
  edges: FileEdge[];
  /** Files ranked by importance (descending). */
  rankedFiles: FileNode[];
}

/**
 * Build a dependency graph from parsed tags.
 *
 * @param tagsByFile - Map from relative file path to tags extracted from that file
 * @returns The complete dependency graph with importance ranking
 */
export function buildGraph(tagsByFile: Map<string, Tag[]>): DependencyGraph {
  // Build index of definitions: symbol name → file paths
  const definitionIndex = new Map<string, Set<string>>();

  const nodes = new Map<string, FileNode>();

  for (const [filePath, tags] of tagsByFile) {
    const definitions = tags.filter((t) => t.kind === 'def');

    nodes.set(filePath, {
      path: filePath,
      definitions,
      tags,
      score: 0,
    });

    for (const def of definitions) {
      const files = definitionIndex.get(def.name) ?? new Set();
      files.add(filePath);
      definitionIndex.set(def.name, files);
    }
  }

  // Build edges: file A references a symbol defined in file B
  const edgeMap = new Map<string, { weight: number; symbols: Set<string> }>();

  for (const [filePath, tags] of tagsByFile) {
    const references = tags.filter((t) => t.kind === 'ref');

    for (const ref of references) {
      const defFiles = definitionIndex.get(ref.name);
      if (!defFiles) continue;

      for (const defFile of defFiles) {
        if (defFile === filePath) continue; // Skip self-references

        const edgeKey = `${filePath}→${defFile}`;
        const existing = edgeMap.get(edgeKey);

        // Weight bonus for specific identifier names (longer names = more specific)
        const nameWeight = Math.max(1, Math.log2(ref.name.length));

        if (existing) {
          existing.weight += nameWeight;
          existing.symbols.add(ref.name);
        } else {
          edgeMap.set(edgeKey, {
            weight: nameWeight,
            symbols: new Set([ref.name]),
          });
        }
      }
    }
  }

  const edges: FileEdge[] = [];
  for (const [key, { weight, symbols }] of edgeMap) {
    const [from, to] = key.split('→');
    edges.push({ from, to, weight, symbols: [...symbols] });
  }

  // Compute importance: sum of weighted in-edges (files that are referenced most)
  for (const edge of edges) {
    const targetNode = nodes.get(edge.to);
    if (targetNode) {
      targetNode.score += edge.weight;
    }
  }

  // Also give a small base score based on definition count
  // (files with many definitions are structurally important even if not referenced)
  for (const node of nodes.values()) {
    node.score += node.definitions.length * 0.1;
  }

  // Rank by score descending
  const rankedFiles = [...nodes.values()].sort((a, b) => b.score - a.score);

  return { nodes, edges, rankedFiles };
}

/**
 * Get the most important definitions across all files,
 * respecting file ranking order.
 *
 * Returns definitions from the most important files first,
 * with definitions within each file ordered by type priority.
 */
export function getRankedDefinitions(graph: DependencyGraph): Tag[] {
  const typePriority: Record<string, number> = {
    class: 0,
    interface: 1,
    type: 2,
    enum: 3,
    function: 4,
    variable: 5,
    method: 6,
    export: 7,
    import: 8,
    identifier: 9,
  };

  const result: Tag[] = [];

  for (const node of graph.rankedFiles) {
    const sorted = [...node.definitions].sort((a, b) => {
      const pa = typePriority[a.type] ?? 99;
      const pb = typePriority[b.type] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.line - b.line;
    });
    result.push(...sorted);
  }

  return result;
}
