/**
 * Config tuning recommendations based on benchmark results.
 *
 * Maps benchmark metrics to specific causantic.config.json knobs,
 * providing actionable advice for improving collection performance.
 */

import { loadConfig } from '../../config/loader.js';
import type {
  CollectionBenchmarkResult,
  TuningRecommendation,
} from './types.js';

/**
 * Generate tuning recommendations from benchmark results.
 */
export function generateTuningRecommendations(
  result: CollectionBenchmarkResult,
): TuningRecommendation[] {
  const recommendations: TuningRecommendation[] = [];
  const config = loadConfig();

  const health = result.collectionStats;
  const retrieval = result.retrieval;
  const graph = result.graphValue;
  const latency = result.latency;

  // Cluster coverage < 70%
  if (health.clusterCoverage < 0.7) {
    const currentThreshold = config.clustering?.threshold ?? 0.09;
    recommendations.push({
      metric: 'Cluster coverage',
      currentValue: `clustering.threshold: ${currentThreshold}`,
      suggestedValue: 'clustering.threshold: 0.12',
      configPath: 'clustering.threshold',
      impact: `Broader clusters may capture more chunks, improving coverage from ${(health.clusterCoverage * 100).toFixed(0)}% to ~80%`,
      priority: 'high',
    });

    // Also suggest lowering min cluster size for small sessions
    if (health.sessionSizeStats && health.sessionSizeStats.median < 5) {
      const currentMinSize = config.clustering?.minClusterSize ?? 4;
      recommendations.push({
        metric: 'Cluster coverage (small sessions)',
        currentValue: `clustering.minClusterSize: ${currentMinSize}`,
        suggestedValue: 'clustering.minClusterSize: 3',
        configPath: 'clustering.minClusterSize',
        impact: 'Lower minimum allows smaller sessions to form clusters',
        priority: 'medium',
      });
    }
  }

  // Orphan chunk % > 30%
  if (health.orphanChunkPercentage > 0.3) {
    recommendations.push({
      metric: 'Orphan chunk rate',
      currentValue: `${(health.orphanChunkPercentage * 100).toFixed(1)}% orphans`,
      suggestedValue: 'Re-ingest sessions',
      configPath: '(action)',
      impact: 'Run `npx causantic ingest --reprocess` to build missing edges',
      priority: 'high',
    });
  }

  // Cluster coherence: inter-cluster separation low
  if (health.clusterQuality && health.clusterQuality.interClusterSeparation < 0.3) {
    const currentThreshold = config.clustering?.threshold ?? 0.09;
    recommendations.push({
      metric: 'Inter-cluster separation',
      currentValue: `clustering.threshold: ${currentThreshold}`,
      suggestedValue: 'clustering.threshold: 0.07',
      configPath: 'clustering.threshold',
      impact: 'Tighter threshold creates more distinct, separated clusters',
      priority: 'medium',
    });
  }

  // Cluster coherence: intra-cluster similarity low
  if (health.clusterQuality && health.clusterQuality.intraClusterSimilarity < 0.5) {
    const currentThreshold = config.clustering?.threshold ?? 0.09;
    recommendations.push({
      metric: 'Intra-cluster similarity',
      currentValue: `clustering.threshold: ${currentThreshold}`,
      suggestedValue: 'clustering.threshold: 0.12',
      configPath: 'clustering.threshold',
      impact: 'Broader threshold allows more similar chunks into clusters',
      priority: 'medium',
    });
  }

  // Graph-sourced % < 10%
  if (graph && graph.sourceAttribution.graphPercentage < 0.1) {
    const currentDepth = config.traversal?.maxDepth ?? 20;
    if (health.edgeToChunkRatio < 1) {
      recommendations.push({
        metric: 'Graph utilization (sparse edges)',
        currentValue: `${health.edgeCount} edges for ${health.chunkCount} chunks`,
        suggestedValue: 'Re-ingest with latest parser',
        configPath: '(action)',
        impact: 'Edges are sparse; re-ingesting may extract more connections',
        priority: 'high',
      });
    } else {
      recommendations.push({
        metric: 'Graph utilization',
        currentValue: `traversal.maxDepth: ${currentDepth}`,
        suggestedValue: 'traversal.maxDepth: 25',
        configPath: 'traversal.maxDepth',
        impact: 'Deeper traversal may surface more graph-connected results',
        priority: 'medium',
      });
    }
  }

  // Augmentation ratio < 1.2
  if (graph && graph.sourceAttribution.augmentationRatio < 1.2) {
    const currentMinWeight = config.traversal?.minWeight ?? 0.01;
    recommendations.push({
      metric: 'Augmentation ratio',
      currentValue: `traversal.minWeight: ${currentMinWeight}`,
      suggestedValue: 'traversal.minWeight: 0.005',
      configPath: 'traversal.minWeight',
      impact: 'Lower threshold follows weaker edges, finding more graph results',
      priority: 'low',
    });
  }

  // Recall latency p95 > 200ms
  if (latency && latency.recall.p95 > 200) {
    const currentDepth = config.traversal?.maxDepth ?? 20;
    recommendations.push({
      metric: 'Recall latency p95',
      currentValue: `traversal.maxDepth: ${currentDepth}`,
      suggestedValue: 'traversal.maxDepth: 15',
      configPath: 'traversal.maxDepth',
      impact: `May reduce p95 from ${latency.recall.p95.toFixed(0)}ms by limiting traversal depth`,
      priority: 'medium',
    });

    if (health.chunkCount > 5000) {
      recommendations.push({
        metric: 'Recall latency (large collection)',
        currentValue: `${health.chunkCount} chunks`,
        suggestedValue: 'vectors.ttlDays: 60',
        configPath: 'vectors.ttlDays',
        impact: 'Prune old vectors to reduce search space',
        priority: 'low',
      });
    }
  }

  // Cross-session bridging low
  if (retrieval && retrieval.bridgingRecallAt10 < 0.3) {
    const currentDiesAt = config.decay?.forward?.diesAtHops ?? 20;
    recommendations.push({
      metric: 'Cross-session bridging',
      currentValue: `decay.forward.diesAtHops: ${currentDiesAt}`,
      suggestedValue: 'decay.forward.diesAtHops: 25',
      configPath: 'decay.forward.diesAtHops',
      impact: 'Increase forward decay range to strengthen cross-session connections',
      priority: 'medium',
    });
  }

  // Precision@K low (cross-project bleed)
  if (retrieval && retrieval.precisionAt10 < 0.7 && retrieval.precisionAt10 > 0) {
    const currentDepth = config.traversal?.maxDepth ?? 20;
    recommendations.push({
      metric: 'Precision@K (cross-project bleed)',
      currentValue: `traversal.maxDepth: ${currentDepth}`,
      suggestedValue: 'traversal.maxDepth: 10',
      configPath: 'traversal.maxDepth',
      impact: 'Tighter traversal reduces noise from distant hops',
      priority: 'medium',
    });
  }

  // Token efficiency < 60%
  if (retrieval && retrieval.tokenEfficiency < 0.6 && retrieval.tokenEfficiency > 0) {
    const currentBudget = config.tokens?.mcpMaxResponse ?? 2000;
    recommendations.push({
      metric: 'Token efficiency',
      currentValue: `tokens.mcpMaxResponse: ${currentBudget}`,
      suggestedValue: 'tokens.mcpMaxResponse: 1500',
      configPath: 'tokens.mcpMaxResponse',
      impact: 'Reduce response budget to increase information density',
      priority: 'low',
    });
  }

  // Keyword-sourced % very low
  if (graph && graph.sourceAttribution.keywordPercentage < 0.02 && health.chunkCount > 50) {
    recommendations.push({
      metric: 'Keyword search utilization',
      currentValue: `${(graph.sourceAttribution.keywordPercentage * 100).toFixed(1)}% of results from keywords`,
      suggestedValue: 'Rebuild FTS5 index',
      configPath: '(action)',
      impact: 'FTS5 index may be empty or corrupted. Try re-indexing.',
      priority: 'low',
    });
  }

  // file-path edges absent
  const hasFilePathEdges = health.edgeTypeDistribution.some(d => d.type === 'file-path');
  if (!hasFilePathEdges && health.edgeCount > 0) {
    recommendations.push({
      metric: 'File-path edges',
      currentValue: 'No file-path edges found',
      suggestedValue: 'Check ingestion parser',
      configPath: '(action)',
      impact: 'Parser may not be extracting file references; check ingestion pipeline',
      priority: 'low',
    });
  }

  // Cluster expansion sourcing 0%
  if (graph && graph.sourceAttribution.clusterPercentage === 0 && health.clusterCount > 0) {
    recommendations.push({
      metric: 'Cluster expansion',
      currentValue: '0% of results from cluster expansion',
      suggestedValue: 'clusterExpansion.maxClusters: 5, maxSiblings: 8',
      configPath: 'clusterExpansion',
      impact: 'Increase expansion limits to leverage existing clusters',
      priority: 'low',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
