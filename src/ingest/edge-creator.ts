/**
 * Edge creation with type-based weights.
 * Creates both forward and backward edges for graph traversal.
 */

import { createEdges, createOrBoostEdges } from '../storage/edge-store.js';
import type { EdgeInput, ReferenceType } from '../storage/types.js';
import type { TransitionResult } from './edge-detector.js';
import type { VectorClock } from '../temporal/vector-clock.js';

/**
 * Initial weight by reference type.
 * Higher weights for stronger evidence of continuation.
 */
export const TYPE_WEIGHTS: Record<ReferenceType, number> = {
  'file-path': 1.0,           // Strong: explicit file reference
  'code-entity': 0.8,         // Good: shared code identifiers
  'explicit-backref': 0.9,    // Strong: explicit "the error", "that function"
  'error-fragment': 0.9,      // Strong: discussing specific error
  'tool-output': 0.8,         // Good: referencing tool results
  'adjacent': 0.5,            // Weak: just consecutive, no clear link
  'cross-session': 0.7,       // Medium: session continuation
  'brief': 0.9,               // Strong: parent spawning sub-agent
  'debrief': 0.9,             // Strong: sub-agent returning to parent
};

/**
 * Result of edge creation.
 */
export interface EdgeCreationResult {
  /** Number of backward edges created */
  backwardCount: number;
  /** Number of forward edges created */
  forwardCount: number;
  /** Total edges created */
  totalCount: number;
}

/**
 * Options for edge creation.
 */
export interface EdgeCreationOptions {
  /** Vector clock to stamp on edges (optional). */
  vectorClock?: VectorClock;
  /** Use boost mode to dedupe and boost repeated edges. Default: false. */
  useBoostMode?: boolean;
}

/**
 * Create edges from detected transitions.
 * Creates both backward (for retrieval) and forward (for prediction) edges.
 *
 * @param transitions - Detected transitions between chunks
 * @param chunkIds - Array of chunk IDs corresponding to transition indices
 * @param options - Edge creation options
 * @returns Edge creation result
 */
export async function createEdgesFromTransitions(
  transitions: TransitionResult[],
  chunkIds: string[],
  options: EdgeCreationOptions = {}
): Promise<EdgeCreationResult> {
  const { vectorClock, useBoostMode = false } = options;
  const edges: EdgeInput[] = [];

  for (const t of transitions) {
    const sourceId = chunkIds[t.sourceIndex];
    const targetId = chunkIds[t.targetIndex];
    const weight = TYPE_WEIGHTS[t.type] * t.confidence;

    // Backward edge: from target (later) to source (earlier)
    // Used for retrieval: "what context led to this?"
    edges.push({
      sourceChunkId: targetId,
      targetChunkId: sourceId,
      edgeType: 'backward',
      referenceType: t.type,
      initialWeight: weight,
      vectorClock,
    });

    // Forward edge: from source (earlier) to target (later)
    // Used for prediction: "what comes after this?"
    edges.push({
      sourceChunkId: sourceId,
      targetChunkId: targetId,
      edgeType: 'forward',
      referenceType: t.type,
      initialWeight: weight,
      vectorClock,
    });
  }

  if (edges.length > 0) {
    if (useBoostMode) {
      createOrBoostEdges(edges);
    } else {
      createEdges(edges);
    }
  }

  return {
    backwardCount: transitions.length,
    forwardCount: transitions.length,
    totalCount: edges.length,
  };
}

/**
 * Create a single edge pair (backward + forward) between two chunks.
 */
export async function createEdgePair(
  sourceChunkId: string,
  targetChunkId: string,
  referenceType: ReferenceType,
  confidence: number = 1.0,
  vectorClock?: VectorClock
): Promise<void> {
  const weight = TYPE_WEIGHTS[referenceType] * confidence;

  createEdges([
    {
      sourceChunkId: targetChunkId,
      targetChunkId: sourceChunkId,
      edgeType: 'backward',
      referenceType,
      initialWeight: weight,
      vectorClock,
    },
    {
      sourceChunkId,
      targetChunkId,
      edgeType: 'forward',
      referenceType,
      initialWeight: weight,
      vectorClock,
    },
  ]);
}

/**
 * Create cross-session edges between final chunks of old session
 * and first chunk of new (continued) session.
 */
export async function createCrossSessionEdges(
  previousFinalChunkIds: string[],
  newFirstChunkId: string,
  vectorClock?: VectorClock
): Promise<number> {
  const edges: EdgeInput[] = [];
  const weight = TYPE_WEIGHTS['cross-session'];

  for (const prevChunkId of previousFinalChunkIds) {
    // Backward: new session's first chunk can recall prev session context
    edges.push({
      sourceChunkId: newFirstChunkId,
      targetChunkId: prevChunkId,
      edgeType: 'backward',
      referenceType: 'cross-session',
      initialWeight: weight,
      vectorClock,
    });

    // Forward: prev session's final chunks predict continuation
    edges.push({
      sourceChunkId: prevChunkId,
      targetChunkId: newFirstChunkId,
      edgeType: 'forward',
      referenceType: 'cross-session',
      initialWeight: weight,
      vectorClock,
    });
  }

  if (edges.length > 0) {
    createEdges(edges);
  }

  return edges.length;
}

/**
 * Create brief edges: parent chunk → sub-agent's first chunk.
 * These represent the point where a sub-agent is spawned.
 */
export async function createBriefEdges(
  parentChunkId: string,
  subAgentFirstChunkId: string,
  vectorClock: VectorClock,
  spawnDepth: number = 0
): Promise<void> {
  // Apply depth penalty: deeper nesting = weaker connection
  const depthPenalty = Math.pow(0.9, spawnDepth);
  const weight = TYPE_WEIGHTS['brief'] * depthPenalty;

  createEdges([
    {
      sourceChunkId: subAgentFirstChunkId,
      targetChunkId: parentChunkId,
      edgeType: 'backward',
      referenceType: 'brief',
      initialWeight: weight,
      vectorClock,
    },
    {
      sourceChunkId: parentChunkId,
      targetChunkId: subAgentFirstChunkId,
      edgeType: 'forward',
      referenceType: 'brief',
      initialWeight: weight,
      vectorClock,
    },
  ]);
}

/**
 * Create debrief edges: sub-agent's final chunk → parent chunk.
 * These represent the point where a sub-agent returns to the parent.
 */
export async function createDebriefEdges(
  subAgentFinalChunkIds: string[],
  parentChunkId: string,
  vectorClock: VectorClock,
  spawnDepth: number = 0
): Promise<void> {
  // Apply depth penalty: deeper nesting = weaker connection
  const depthPenalty = Math.pow(0.9, spawnDepth);
  const weight = TYPE_WEIGHTS['debrief'] * depthPenalty;
  const edges: EdgeInput[] = [];

  for (const agentChunkId of subAgentFinalChunkIds) {
    edges.push({
      sourceChunkId: parentChunkId,
      targetChunkId: agentChunkId,
      edgeType: 'backward',
      referenceType: 'debrief',
      initialWeight: weight,
      vectorClock,
    });

    edges.push({
      sourceChunkId: agentChunkId,
      targetChunkId: parentChunkId,
      edgeType: 'forward',
      referenceType: 'debrief',
      initialWeight: weight,
      vectorClock,
    });
  }

  if (edges.length > 0) {
    createEdges(edges);
  }
}
