/**
 * Shared types for follow-up experiments.
 */

export interface MetricSnapshot {
  rocAuc: number;
  silhouetteScore: number;
  clusterCount: number;
  noiseRatio: number;
  chunkCount: number;
}

export interface MetricDelta {
  rocAuc: number;
  silhouetteScore: number;
  clusterCount: number;
  noiseRatio: number;
  chunkCount: number;
}

export interface ExperimentResult {
  name: string;
  description: string;
  baseline: MetricSnapshot;
  variant: MetricSnapshot;
  delta: MetricDelta;
}

export interface SweepRow {
  minClusterSize: number;
  clusterCount: number;
  noiseRatio: number;
  silhouetteScore: number;
}

export interface SweepResult {
  name: string;
  description: string;
  rows: SweepRow[];
}

export function computeDelta(baseline: MetricSnapshot, variant: MetricSnapshot): MetricDelta {
  return {
    rocAuc: variant.rocAuc - baseline.rocAuc,
    silhouetteScore: variant.silhouetteScore - baseline.silhouetteScore,
    clusterCount: variant.clusterCount - baseline.clusterCount,
    noiseRatio: variant.noiseRatio - baseline.noiseRatio,
    chunkCount: variant.chunkCount - baseline.chunkCount,
  };
}
