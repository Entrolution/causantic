/**
 * Types for the index entry differentiation experiment.
 *
 * Tests whether semantic index entries within the same cluster are
 * too similar, and whether cluster-aware refinement improves discrimination.
 */

/** Per-cluster similarity analysis. */
export interface ClusterSimilarityResult {
  clusterId: string;
  clusterName: string | null;
  entryCount: number;
  chunkCount: number;

  /** Mean pairwise cosine similarity between index entry embeddings. */
  meanEntryPairSim: number;
  /** Mean pairwise cosine similarity between raw chunk embeddings. */
  meanChunkPairSim: number;
  /**
   * Ratio of entry similarity to chunk similarity.
   * > 1 = entries more similar (compression homogenized)
   * < 1 = entries more different (LLM differentiates naturally)
   * = 1 = no change
   */
  compressionRatio: number;
  /** Standard deviation of pairwise entry similarities. */
  entrySimStdDev: number;
}

/** Discrimination test: can we find the right entry among cluster siblings? */
export interface DiscriminationResult {
  clusterId: string;
  clusterName: string | null;
  entryCount: number;
  /** Mean reciprocal rank for finding the correct entry when querying by its description embedding. */
  meanReciprocalRank: number;
  /** Fraction of entries where correct entry was rank 1 among cluster siblings. */
  hitRate: number;
  /** Per-entry discrimination scores (for analysis). */
  perEntry: Array<{
    entryId: string;
    rankAmongSiblings: number;
    correctSimilarity: number;
    bestSiblingSimilarity: number;
  }>;
}

/** Refinement comparison: baseline vs cluster-aware regeneration. */
export interface RefinementResult {
  clusterId: string;
  clusterName: string | null;
  entryCount: number;
  baselineMRR: number;
  refinedMRR: number;
  baselineHitRate: number;
  refinedHitRate: number;
  /** How much compression ratio changed (negative = more differentiated). */
  compressionRatioDelta: number;
  /** Sample refined descriptions for inspection. */
  sampleRefinements: Array<{
    entryId: string;
    original: string;
    refined: string;
  }>;
}

/** Full experiment report. */
export interface DifferentiationReport {
  timestamp: string;
  /** Total index entries in the system. */
  totalEntries: number;
  /** Total clusters with 3+ index entries (experiment-eligible). */
  eligibleClusters: number;
  /** Total clusters analysed. */
  analysedClusters: number;

  // Phase 1: Similarity
  similarity: {
    results: ClusterSimilarityResult[];
    /** Mean compression ratio across all eligible clusters. */
    meanCompressionRatio: number;
    /** Fraction of clusters where entries are more similar than chunks. */
    homogenizedFraction: number;
  };

  // Phase 2: Discrimination
  discrimination: {
    results: DiscriminationResult[];
    /** Overall MRR across all entries in all clusters. */
    overallMRR: number;
    /** Overall hit rate (correct entry at rank 1). */
    overallHitRate: number;
  };

  // Phase 2b: Alignment
  alignment?: {
    results: Array<{
      clusterId: string;
      clusterName: string | null;
      entryCount: number;
      meanSelfAlignment: number;
      meanSiblingAlignment: number;
      meanAlignmentGap: number;
      uniquelyAlignedFraction: number;
    }>;
    /** Overall mean self-alignment (entry ↔ own chunk). */
    overallSelfAlignment: number;
    /** Overall mean sibling alignment (entry ↔ other chunks). */
    overallSiblingAlignment: number;
    /** Overall mean alignment gap (self - sibling). */
    overallAlignmentGap: number;
    /** Overall fraction of entries uniquely aligned to own chunk. */
    overallUniquelyAligned: number;
  };

  // Phase 3: Refinement (optional)
  refinement?: {
    results: RefinementResult[];
    /** Mean MRR improvement from refinement. */
    meanMRRDelta: number;
    /** Mean compression ratio change. */
    meanCompressionRatioDelta: number;
  };

  /** Human-readable summary. */
  summary: string[];
}
