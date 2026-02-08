/**
 * Types for the storage layer.
 */

import type { VectorClock } from '../temporal/vector-clock.js';

/**
 * Edge direction for graph traversal.
 */
export type EdgeType = 'backward' | 'forward';

/**
 * Reference types for edges.
 */
export type ReferenceType =
  | 'file-path'
  | 'code-entity'
  | 'explicit-backref'
  | 'error-fragment'
  | 'tool-output'
  | 'adjacent'
  | 'cross-session'
  | 'brief'      // Parent → sub-agent spawn
  | 'debrief';   // Sub-agent → parent return

/**
 * Chunk metadata stored in the database.
 */
export interface StoredChunk {
  id: string;
  sessionId: string;
  sessionSlug: string;
  turnIndices: number[];
  startTime: string;
  endTime: string;
  content: string;
  codeBlockCount: number;
  toolUseCount: number;
  approxTokens: number;
  createdAt: string;
  // v2: Vector clock support
  agentId: string | null;
  vectorClock: VectorClock | null;
  spawnDepth: number;
}

/**
 * Input for creating a new chunk.
 */
export interface ChunkInput {
  id: string;
  sessionId: string;
  sessionSlug: string;
  turnIndices: number[];
  startTime: string;
  endTime: string;
  content: string;
  codeBlockCount: number;
  toolUseCount: number;
  approxTokens: number;
  // v2: Vector clock support (optional for backward compatibility)
  agentId?: string;
  vectorClock?: VectorClock;
  spawnDepth?: number;
}

/**
 * Stored edge with metadata.
 */
export interface StoredEdge {
  id: string;
  sourceChunkId: string;
  targetChunkId: string;
  edgeType: EdgeType;
  referenceType: ReferenceType | null;
  initialWeight: number;
  createdAt: string;
  // v2: Vector clock support
  vectorClock: string | null;  // JSON serialized VectorClock
  linkCount: number;           // Number of times this edge was created
}

/**
 * Input for creating a new edge.
 */
export interface EdgeInput {
  sourceChunkId: string;
  targetChunkId: string;
  edgeType: EdgeType;
  referenceType?: ReferenceType;
  initialWeight: number;
  // v2: Vector clock support (optional for backward compatibility)
  vectorClock?: VectorClock;
}

/**
 * Edge with computed weight at query time.
 */
export interface WeightedEdge extends StoredEdge {
  weight: number;
}

/**
 * Stored cluster metadata.
 */
export interface StoredCluster {
  id: string;
  name: string | null;
  description: string | null;
  centroid: number[] | null;
  exemplarIds: string[];
  membershipHash: string | null;
  createdAt: string;
  refreshedAt: string | null;
}

/**
 * Input for creating/updating a cluster.
 */
export interface ClusterInput {
  id?: string;
  name?: string;
  description?: string;
  centroid?: number[];
  exemplarIds?: string[];
  membershipHash?: string;
}

/**
 * Chunk-cluster assignment.
 */
export interface ChunkClusterAssignment {
  chunkId: string;
  clusterId: string;
  distance: number;
}

/**
 * Chunk with weight from traversal.
 */
export interface WeightedChunk {
  chunkId: string;
  weight: number;
  depth: number;
}

/**
 * Result of graph traversal.
 */
export interface TraversalResult {
  chunks: WeightedChunk[];
  visited: number;
}

/**
 * Vector search result.
 */
export interface VectorSearchResult {
  id: string;
  distance: number;
}
