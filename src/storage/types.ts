/**
 * Types for the storage layer.
 *
 * The storage layer provides persistence for the Causantic system.
 * Key data structures include:
 * - **Chunks**: Segments of conversation with metadata
 * - **Edges**: Weighted directional connections between chunks
 * - **Clusters**: Topic groupings of chunks (via HDBSCAN)
 *
 * @module storage/types
 */

/**
 * Edge direction for graph traversal.
 *
 * The memory graph maintains bidirectional edges between chunks:
 * - `backward`: Points from later → earlier chunks (used for recall)
 * - `forward`: Points from earlier → later chunks (used for prediction)
 *
 * Each transition creates both a backward and forward edge.
 */
export type EdgeType = 'backward' | 'forward';

/**
 * Structural roles for causal graph edges.
 *
 * The causal graph is purely causal — semantic association is handled by
 * vector similarity and clustering. Edges represent structural relationships:
 *
 * | Type | Weight | Description |
 * |------|--------|-------------|
 * | `within-chain` | 1.0 | D-T-D causal edge within one thinking entity |
 * | `brief` | 0.9 | Parent spawning sub-agent (× depth penalty) |
 * | `debrief` | 0.9 | Sub-agent returning to parent (× depth penalty) |
 * | `cross-session` | 0.7 | Session continuation |
 *
 * All within-chain edges use m×n all-pairs creation at D-T-D boundaries,
 * with topic-shift gating to omit edges across topic changes.
 */
export type ReferenceType =
  | 'within-chain'
  | 'cross-session'
  | 'brief'
  | 'debrief'
  | 'team-spawn'
  | 'team-report'
  | 'peer-message';

/**
 * A chunk stored in the database.
 *
 * Chunks are the fundamental unit of storage, representing segments of
 * conversation. Each chunk contains one or more turns.
 */
export interface StoredChunk {
  /** Unique identifier (UUID format) */
  id: string;
  /** Claude session ID this chunk belongs to */
  sessionId: string;
  /** Project slug (folder name) for grouping sessions */
  sessionSlug: string;
  /** Turn indices included in this chunk (0-based) */
  turnIndices: number[];
  /** ISO timestamp of first message in chunk */
  startTime: string;
  /** ISO timestamp of last message in chunk */
  endTime: string;
  /** Rendered text content of the chunk */
  content: string;
  /** Number of code blocks (```...```) in content */
  codeBlockCount: number;
  /** Number of tool use blocks in content */
  toolUseCount: number;
  /** Approximate token count for budget calculation */
  approxTokens: number;
  /** ISO timestamp when chunk was stored */
  createdAt: string;
  /** Agent ID for sub-agent chunks, 'ui' for main session */
  agentId: string | null;
  /** Nesting depth: 0=main, 1=sub-agent, 2=nested sub-agent */
  spawnDepth: number;
  /** Full cwd path for project disambiguation (optional) */
  projectPath: string | null;
  /** Team name for agent team sessions (null for non-team sessions) */
  teamName: string | null;
}

/**
 * Input for creating a new chunk.
 *
 * Used when ingesting sessions. The `id` should be pre-generated to allow
 * correlation with edge creation before database insertion.
 */
export interface ChunkInput {
  /** Unique identifier (pre-generated UUID) */
  id: string;
  /** Claude session ID */
  sessionId: string;
  /** Project slug */
  sessionSlug: string;
  /** Turn indices included */
  turnIndices: number[];
  /** ISO start timestamp */
  startTime: string;
  /** ISO end timestamp */
  endTime: string;
  /** Rendered text content */
  content: string;
  /** Code block count */
  codeBlockCount: number;
  /** Tool use count */
  toolUseCount: number;
  /** Approximate tokens */
  approxTokens: number;
  /** Agent ID (optional, defaults to 'ui') */
  agentId?: string;
  /** Spawn depth (optional, defaults to 0) */
  spawnDepth?: number;
  /** Full cwd path for project disambiguation */
  projectPath?: string;
  /** Team name for agent team sessions */
  teamName?: string;
}

/**
 * An edge stored in the database.
 *
 * Edges represent causal connections between chunks. They have:
 * - An `initialWeight` set at creation based on reference type
 * - A `linkCount` that increases when the same edge is created multiple times
 */
export interface StoredEdge {
  /** Unique identifier (UUID format) */
  id: string;
  /** Source chunk ID (where edge originates) */
  sourceChunkId: string;
  /** Target chunk ID (where edge points) */
  targetChunkId: string;
  /** Direction: backward (recall) or forward (predict) */
  edgeType: EdgeType;
  /** Type of evidence for this connection */
  referenceType: ReferenceType | null;
  /** Weight at creation time (0-1), before decay */
  initialWeight: number;
  /** ISO timestamp when edge was created */
  createdAt: string;
  /** Times this edge was created (boosted on duplicate) */
  linkCount: number;
}

/**
 * Input for creating a new edge.
 *
 * When creating edges, you specify source, target, and type. The system
 * generates an ID and sets createdAt. Use `createOrBoostEdges()` to
 * increment linkCount if the same edge already exists.
 */
export interface EdgeInput {
  /** Source chunk ID */
  sourceChunkId: string;
  /** Target chunk ID */
  targetChunkId: string;
  /** Direction: backward or forward */
  edgeType: EdgeType;
  /** Reference type for initial weight calculation */
  referenceType?: ReferenceType;
  /** Explicit weight (overrides type-based default) */
  initialWeight: number;
}

/**
 * An edge with its computed weight at query time.
 *
 * During traversal, edge weights are computed by applying decay based on
 * the reference clock. The effective weight determines traversal priority.
 *
 * Weight formula: `initialWeight × hopDecay × timeDecay`
 */
export interface WeightedEdge extends StoredEdge {
  /** Computed weight after decay (0-1) */
  weight: number;
}

/**
 * A topic cluster stored in the database.
 *
 * Clusters group semantically related chunks. Created by HDBSCAN clustering
 * on chunk embeddings. Each cluster has:
 * - A centroid vector (mean of member embeddings)
 * - Exemplar IDs (chunks closest to centroid)
 * - A membership hash for detecting when reclustering is needed
 */
export interface StoredCluster {
  /** Unique identifier */
  id: string;
  /** Human-readable name (optional) */
  name: string | null;
  /** Description of cluster contents (optional) */
  description: string | null;
  /** Centroid vector (normalized mean of embeddings) */
  centroid: number[] | null;
  /** IDs of exemplar chunks (closest to centroid) */
  exemplarIds: string[];
  /** Hash of sorted member IDs (for change detection) */
  membershipHash: string | null;
  /** ISO timestamp when cluster was created */
  createdAt: string;
  /** ISO timestamp when cluster was last updated */
  refreshedAt: string | null;
}

/**
 * Input for creating or updating a cluster.
 *
 * All fields are optional for partial updates. Provide `id` to update
 * an existing cluster; omit to create a new one.
 */
export interface ClusterInput {
  /** ID for update, or undefined for create */
  id?: string;
  /** Human-readable name */
  name?: string;
  /** Description */
  description?: string;
  /** Centroid vector */
  centroid?: number[];
  /** Exemplar chunk IDs */
  exemplarIds?: string[];
  /** Membership hash */
  membershipHash?: string;
}

/**
 * Assignment of a chunk to a cluster.
 *
 * A chunk can belong to multiple clusters (soft clustering). The distance
 * indicates how well the chunk fits the cluster (lower = better fit).
 */
export interface ChunkClusterAssignment {
  /** Chunk being assigned */
  chunkId: string;
  /** Cluster to assign to */
  clusterId: string;
  /** Angular distance from chunk to cluster centroid (0-2) */
  distance: number;
}

/**
 * A chunk with its accumulated weight from traversal.
 *
 * During graph traversal, chunks accumulate weight from all paths that
 * reach them (sum rule). The depth is the minimum hop count across paths.
 */
export interface WeightedChunk {
  /** Chunk identifier */
  chunkId: string;
  /** Accumulated weight from all paths (sum rule) */
  weight: number;
  /** Minimum depth across all paths reaching this chunk */
  depth: number;
}

/**
 * Result of a graph traversal operation.
 *
 * Contains weighted chunks sorted by weight descending, plus statistics
 * about the traversal for debugging/monitoring.
 */
export interface TraversalResult {
  /** Chunks reached, sorted by weight descending */
  chunks: WeightedChunk[];
  /** Number of path segments explored */
  visited: number;
}

/**
 * Result from vector similarity search.
 *
 * Vector search returns chunks sorted by angular distance to the query.
 * Lower distance = higher similarity.
 */
export interface VectorSearchResult {
  /** Chunk ID */
  id: string;
  /** Angular distance (0 = identical, 2 = opposite) */
  distance: number;
}
