/**
 * Config tuning recommendations based on benchmark results.
 *
 * Maps benchmark metrics to specific causantic.config.json knobs,
 * providing actionable advice for improving collection performance.
 */

import { loadConfig } from '../../config/loader.js';
import type { CollectionBenchmarkResult, TuningRecommendation } from './types.js';

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
  const chain = result.chainQuality;
  const latency = result.latency;

  // Cluster coverage < 70%
  if (health.clusterCoverage < 0.7) {
    const currentThreshold = config.clustering?.threshold ?? 0.1;
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
    const currentThreshold = config.clustering?.threshold ?? 0.1;
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
    const currentThreshold = config.clustering?.threshold ?? 0.1;
    recommendations.push({
      metric: 'Intra-cluster similarity',
      currentValue: `clustering.threshold: ${currentThreshold}`,
      suggestedValue: 'clustering.threshold: 0.12',
      configPath: 'clustering.threshold',
      impact: 'Broader threshold allows more similar chunks into clusters',
      priority: 'medium',
    });
  }

  // Chain coverage < 50%
  if (chain && chain.chainCoverage < 0.5) {
    if (health.edgeToChunkRatio < 1) {
      recommendations.push({
        metric: 'Chain coverage (sparse edges)',
        currentValue: `${health.edgeCount} edges for ${health.chunkCount} chunks`,
        suggestedValue: 'Re-ingest with latest parser or run rebuild-edges',
        configPath: '(action)',
        impact:
          'Edges are sparse; re-ingesting or rebuilding edges creates sequential chains for walking',
        priority: 'high',
      });
    } else {
      recommendations.push({
        metric: 'Chain coverage',
        currentValue: `${(chain.chainCoverage * 100).toFixed(0)}% of queries produce chains`,
        suggestedValue: 'Run `npx causantic maintenance rebuild-edges`',
        configPath: '(action)',
        impact: 'Rebuild edges as sequential linked-list to improve chain connectivity',
        priority: 'medium',
      });
    }
  }

  // Mean chain length < 3
  if (chain && chain.meanChainLength > 0 && chain.meanChainLength < 3) {
    const currentMaxDepth = config.traversal?.maxDepth ?? 50;
    recommendations.push({
      metric: 'Mean chain length',
      currentValue: `${chain.meanChainLength.toFixed(1)} chunks per chain, traversal.maxDepth: ${currentMaxDepth}`,
      suggestedValue: 'traversal.maxDepth: 100',
      configPath: 'traversal.maxDepth',
      impact: 'Increase max depth to allow longer chain walks for richer narratives',
      priority: 'low',
    });
  }

  // Recall latency p95 > 200ms
  if (latency && latency.recall.p95 > 200) {
    const currentMaxDepth = config.traversal?.maxDepth ?? 50;
    recommendations.push({
      metric: 'Recall latency p95',
      currentValue: `traversal.maxDepth: ${currentMaxDepth}`,
      suggestedValue: 'traversal.maxDepth: 30',
      configPath: 'traversal.maxDepth',
      impact: `May reduce p95 from ${latency.recall.p95.toFixed(0)}ms by limiting chain walk depth`,
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
    recommendations.push({
      metric: 'Cross-session bridging',
      currentValue: `${(retrieval.bridgingRecallAt10 * 100).toFixed(0)}% bridging recall`,
      suggestedValue: 'Run `npx causantic maintenance rebuild-edges`',
      configPath: '(action)',
      impact: 'Rebuild edges to ensure cross-session links exist between sequential sessions',
      priority: 'medium',
    });
  }

  // Precision@K low (cross-project bleed)
  if (retrieval && retrieval.precisionAt10 < 0.7 && retrieval.precisionAt10 > 0) {
    recommendations.push({
      metric: 'Precision@K (cross-project bleed)',
      currentValue: `${(retrieval.precisionAt10 * 100).toFixed(0)}% precision`,
      suggestedValue: 'Use project parameter in recall/search queries',
      configPath: '(info)',
      impact: 'Filter queries by project to reduce cross-project noise in results',
      priority: 'medium',
    });
  }

  // Token efficiency < 60%
  if (retrieval && retrieval.tokenEfficiency < 0.6 && retrieval.tokenEfficiency > 0) {
    const currentBudget = config.tokens?.mcpMaxResponse ?? 20000;
    recommendations.push({
      metric: 'Token efficiency',
      currentValue: `tokens.mcpMaxResponse: ${currentBudget}`,
      suggestedValue: `tokens.mcpMaxResponse: ${Math.floor(currentBudget * 0.75)}`,
      configPath: 'tokens.mcpMaxResponse',
      impact: 'Reduce response budget to increase information density',
      priority: 'low',
    });
  }

  // High fallback rate — chains not forming
  if (chain && chain.fallbackRate > 0.8 && health.edgeCount > 0) {
    recommendations.push({
      metric: 'High chain fallback rate',
      currentValue: `${(chain.fallbackRate * 100).toFixed(0)}% of queries fall back to search`,
      suggestedValue: 'Run `npx causantic maintenance rebuild-edges`',
      configPath: '(action)',
      impact:
        'Most queries cannot form chains. Rebuild edges to create sequential linked-list structure.',
      priority: 'medium',
    });
  }

  // within-chain edges absent
  const hasWithinChainEdges = health.edgeTypeDistribution.some((d) => d.type === 'within-chain');
  if (!hasWithinChainEdges && health.edgeCount > 0) {
    recommendations.push({
      metric: 'Within-chain edges',
      currentValue: 'No within-chain edges found',
      suggestedValue: 'Re-ingest sessions with latest parser',
      configPath: '(action)',
      impact: 'Older sessions may have legacy edge types; re-ingesting creates causal edges',
      priority: 'low',
    });
  }

  // MMR diversity — cluster sources absent despite healthy cluster coverage
  if (
    retrieval?.sourceMix &&
    retrieval.sourceMix.cluster === 0 &&
    health.clusterCoverage >= 0.5 &&
    retrieval.sourceMix.total >= 10
  ) {
    const currentLambda = config.retrieval?.mmrLambda ?? 0.7;
    recommendations.push({
      metric: 'Source diversity (no cluster sources)',
      currentValue: `retrieval.mmrLambda: ${currentLambda}`,
      suggestedValue: 'retrieval.mmrLambda: 0.5',
      configPath: 'retrieval.mmrLambda',
      impact:
        'Cluster coverage is healthy but no cluster-expanded chunks appear in results. Lowering MMR lambda increases diversity, giving cluster siblings a chance to compete with near-duplicate vector hits.',
      priority: 'medium',
    });
  }

  // Cluster expansion — if clusters exist but coverage is low, reclustering may help
  if (health.clusterCount > 0 && health.clusterCoverage < 0.5) {
    recommendations.push({
      metric: 'Cluster expansion',
      currentValue: `${(health.clusterCoverage * 100).toFixed(0)}% cluster coverage`,
      suggestedValue: 'Run `npx causantic maintenance recluster`',
      configPath: '(action)',
      impact:
        'Low cluster coverage reduces seed diversity for chain walking. Try reclustering to refresh memberships.',
      priority: 'low',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
