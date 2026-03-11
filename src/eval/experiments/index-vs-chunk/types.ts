/**
 * Types for the index-vs-chunk retrieval benchmark.
 *
 * Compares search quality when using the semantic index layer
 * vs direct chunk search, using LLM-generated natural language queries.
 */

/** A single benchmark query with ground truth. */
export interface BenchmarkQuery {
  /** LLM-generated natural language search query. */
  query: string;
  /** Ground truth chunk ID that should be found. */
  groundTruthChunkId: string;
  /** Session slug for context. */
  sessionSlug: string;
  /** Cluster ID the chunk belongs to. */
  clusterId: string;
  /** Cluster name (for display). */
  clusterName: string | null;
}

/** Result for a single query across both search paths. */
export interface QueryResult {
  query: string;
  groundTruthChunkId: string;

  /** Index-based search path results. */
  index: {
    /** Rank of ground truth chunk (1-indexed, 0 = not found). */
    rank: number;
    /** Total chunks returned. */
    totalReturned: number;
    /** Duration in milliseconds. */
    durationMs: number;
  };

  /** Chunk-based search path results. */
  chunk: {
    rank: number;
    totalReturned: number;
    durationMs: number;
  };
}

/** Aggregate metrics for one search path. */
export interface PathMetrics {
  /** Recall at K = fraction of queries where ground truth was in top K. */
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  /** Mean Reciprocal Rank. */
  mrr: number;
  /** Hit rate = fraction of queries where ground truth was found at all. */
  hitRate: number;
  /** Mean latency in ms. */
  meanLatencyMs: number;
  /** Median latency in ms. */
  medianLatencyMs: number;
}

/** Full benchmark report. */
export interface IndexVsChunkReport {
  timestamp: string;
  /** Number of queries used. */
  queryCount: number;
  /** Number of queries that failed to generate. */
  failedQueryCount: number;

  /** Index-based search path metrics. */
  indexMetrics: PathMetrics;
  /** Chunk-based search path metrics. */
  chunkMetrics: PathMetrics;

  /** Per-query results. */
  perQuery: QueryResult[];

  /** Human-readable summary. */
  summary: string[];
}
