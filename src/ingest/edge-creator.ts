/**
 * Edge creation for sequential linked-list graph.
 * Creates only forward edges (earlier → later). Direction is inferred at query time.
 */

import { createEdges } from '../storage/edge-store.js';
import type { EdgeInput } from '../storage/types.js';
import type { TransitionResult } from './edge-detector.js';
import type { TeamEdgePoint } from './team-edge-detector.js';

/**
 * Result of edge creation.
 */
export interface EdgeCreationResult {
  /** Number of forward edges created */
  forwardCount: number;
  /** Total edges created (same as forwardCount) */
  totalCount: number;
}

/**
 * Create forward edges from detected transitions.
 * Each transition produces a single forward edge (source → target).
 */
export async function createEdgesFromTransitions(
  transitions: TransitionResult[],
  chunkIds: string[],
): Promise<EdgeCreationResult> {
  const edges: EdgeInput[] = [];

  for (const t of transitions) {
    const sourceId = chunkIds[t.sourceIndex];
    const targetId = chunkIds[t.targetIndex];

    edges.push({
      sourceChunkId: sourceId,
      targetChunkId: targetId,
      edgeType: 'forward',
      referenceType: t.type,
      initialWeight: 1.0,
    });
  }

  if (edges.length > 0) {
    createEdges(edges);
  }

  return {
    forwardCount: edges.length,
    totalCount: edges.length,
  };
}

/**
 * Create a single forward edge between two chunks.
 */
export async function createForwardEdge(
  sourceChunkId: string,
  targetChunkId: string,
  referenceType: 'within-chain' | 'cross-session' | 'brief' | 'debrief',
): Promise<void> {
  createEdges([
    {
      sourceChunkId,
      targetChunkId,
      edgeType: 'forward',
      referenceType,
      initialWeight: 1.0,
    },
  ]);
}

/**
 * Create a cross-session edge: last chunk of previous session → first chunk of new session.
 */
export async function createCrossSessionEdges(
  previousLastChunkId: string,
  newFirstChunkId: string,
): Promise<number> {
  createEdges([
    {
      sourceChunkId: previousLastChunkId,
      targetChunkId: newFirstChunkId,
      edgeType: 'forward',
      referenceType: 'cross-session',
      initialWeight: 1.0,
    },
  ]);

  return 1;
}

/**
 * Create a brief edge: last parent chunk before spawn → first sub-agent chunk.
 */
export async function createBriefEdge(
  parentLastChunkId: string,
  subAgentFirstChunkId: string,
): Promise<void> {
  createEdges([
    {
      sourceChunkId: parentLastChunkId,
      targetChunkId: subAgentFirstChunkId,
      edgeType: 'forward',
      referenceType: 'brief',
      initialWeight: 1.0,
    },
  ]);
}

/**
 * Create a debrief edge: last sub-agent chunk → first parent chunk after return.
 */
export async function createDebriefEdge(
  subAgentLastChunkId: string,
  parentFirstChunkId: string,
): Promise<void> {
  createEdges([
    {
      sourceChunkId: subAgentLastChunkId,
      targetChunkId: parentFirstChunkId,
      edgeType: 'forward',
      referenceType: 'debrief',
      initialWeight: 1.0,
    },
  ]);
}

/**
 * Create team edges from detected team edge points.
 *
 * Weights by edge type:
 * - team-spawn: 0.9 (lead dispatching work)
 * - team-report: 0.9 (teammate reporting results)
 * - peer-message: 0.85 (lateral communication)
 *
 * @param points - Detected team edge points
 * @returns Number of edges created
 */
export async function createTeamEdges(points: TeamEdgePoint[]): Promise<number> {
  const edges: EdgeInput[] = [];
  const weights: Record<string, number> = {
    'team-spawn': 0.9,
    'team-report': 0.9,
    'peer-message': 0.85,
  };

  for (const point of points) {
    for (const sourceId of point.sourceChunkIds) {
      for (const targetId of point.targetChunkIds) {
        edges.push({
          sourceChunkId: sourceId,
          targetChunkId: targetId,
          edgeType: 'forward',
          referenceType: point.edgeType,
          initialWeight: weights[point.edgeType],
        });
      }
    }
  }

  if (edges.length > 0) {
    createEdges(edges);
  }

  return edges.length;
}
