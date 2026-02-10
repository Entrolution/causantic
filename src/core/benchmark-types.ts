/**
 * Types shared between benchmark runner and reporter.
 *
 * Extracted from eval/benchmark-runner.ts so production report code
 * does not import from eval directories. Types that originate in eval
 * modules (AlignmentResult, ClusterResult, etc.) are re-declared here
 * with only the fields the reporter actually needs, avoiding a
 * core → eval dependency.
 */

export interface ModelBenchmarkResult {
  modelId: string;
  modelConfig: {
    dims: number;
    contextTokens: number;
  };
  loadStats: {
    loadTimeMs: number;
    heapUsedMB: number;
  };
  rocAuc: number;
  clusterCount: number;
  noiseRatio: number;
  silhouetteScore: number;
  codeNLAlignment: {
    alignmentRatio: number;
  };
  meanInferenceMs: number;
  totalInferenceMs: number;
  clusterResult: {
    numClusters: number;
    noiseRatio: number;
    clusterSizes: number[];
  };
  clusterMembership: Map<number, number[]>;
  embeddings: Map<string, number[]>;
}

export interface BenchmarkResult {
  models: ModelBenchmarkResult[];
  contextWindowComparison: {
    totalChunks: number;
    longChunks: number;
    meanDriftLongChunks: number;
    meanDriftShortChunks: number;
    longChunkDrifts: { chunkId: string; tokens: number; drift: number }[];
  } | null;
  corpus: {
    chunkCount: number;
    pairCount: number;
  };
  completedAt: string;
}

export interface BenchmarkOptions {
  /** Model IDs to benchmark. Default: all. */
  modelIds?: string[];
  /** HDBSCAN min cluster size. Default: 3. */
  minClusterSize?: number;
}
