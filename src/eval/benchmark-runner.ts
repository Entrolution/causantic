/**
 * Orchestrate full embedding model evaluation.
 *
 * Runs all 4 models sequentially against the corpus,
 * collecting all metrics for comparison.
 */

import { Embedder } from '../models/embedder.js';
import { getModel, getAllModelIds } from '../models/model-registry.js';
import { clusterEmbeddings, getClusterMembership } from './cluster-evaluator.js';
import { evaluateCodeNLAlignment } from './code-nl-alignment.js';
import { evaluateContextWindowImpact, type ContextWindowResult } from './context-window-test.js';
import { scorePairs, rocAuc, silhouetteScore } from './metrics.js';
import type { LabeledPair } from './annotation-schema.js';
import type { Chunk } from '../parser/types.js';
import type {
  ModelBenchmarkResult,
  BenchmarkResult,
  BenchmarkOptions,
} from '../core/benchmark-types.js';

export type { ModelBenchmarkResult, BenchmarkResult, BenchmarkOptions };

/**
 * Run the full benchmark suite.
 */
export async function runBenchmark(
  chunks: Chunk[],
  pairs: LabeledPair[],
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const { modelIds = getAllModelIds(), minClusterSize = 3 } = options;

  const embedder = new Embedder();
  const modelResults: ModelBenchmarkResult[] = [];

  for (const modelId of modelIds) {
    console.log(`\n--- Benchmarking: ${modelId} ---`);
    const config = getModel(modelId);

    // Load model
    console.log(`  Loading model...`);
    const loadStats = await embedder.load(config);
    console.log(
      `  Loaded in ${loadStats.loadTimeMs.toFixed(0)}ms, heap delta: ${loadStats.heapUsedMB.toFixed(1)}MB`,
    );

    // Embed all chunks
    console.log(`  Embedding ${chunks.length} chunks...`);
    const embeddings = new Map<string, number[]>();
    let totalInferenceMs = 0;

    for (let i = 0; i < chunks.length; i++) {
      const result = await embedder.embed(chunks[i].text);
      embeddings.set(chunks[i].id, result.embedding);
      totalInferenceMs += result.inferenceMs;

      if ((i + 1) % 20 === 0 || i === chunks.length - 1) {
        console.log(`    ${i + 1}/${chunks.length} chunks embedded`);
      }
    }

    const meanInferenceMs = totalInferenceMs / chunks.length;

    // Score labeled pairs
    console.log(`  Scoring ${pairs.length} labeled pairs...`);
    const scored = scorePairs(pairs, embeddings);
    const auc = rocAuc(scored);

    // Cluster
    console.log(`  Clustering...`);
    const embeddingArray = chunks.map((c) => embeddings.get(c.id)!);
    const clusterResult = clusterEmbeddings(embeddingArray, { minClusterSize });
    const membership = getClusterMembership(clusterResult.labels);

    // Silhouette
    const silhouette = silhouetteScore(embeddingArray, clusterResult.labels);

    // Code-NL alignment
    const alignment = evaluateCodeNLAlignment(pairs, embeddings);

    modelResults.push({
      modelId,
      modelConfig: config,
      loadStats,
      rocAuc: auc,
      clusterCount: clusterResult.numClusters,
      noiseRatio: clusterResult.noiseRatio,
      silhouetteScore: silhouette,
      codeNLAlignment: alignment,
      meanInferenceMs,
      totalInferenceMs,
      clusterResult,
      clusterMembership: membership,
      embeddings,
    });

    console.log(
      `  ROC AUC: ${auc.toFixed(3)}, Clusters: ${clusterResult.numClusters}, ` +
        `Noise: ${(clusterResult.noiseRatio * 100).toFixed(1)}%, ` +
        `Silhouette: ${silhouette.toFixed(3)}`,
    );
  }

  // Context window comparison
  let contextWindowComparison: ContextWindowResult | null = null;
  const bgeResult = modelResults.find((r) => r.modelId === 'bge-small');
  const longContextResult = modelResults.find(
    (r) => r.modelId !== 'bge-small' && r.modelConfig.contextTokens > 512,
  );

  if (bgeResult && longContextResult) {
    console.log(`\n--- Context Window: ${bgeResult.modelId} vs ${longContextResult.modelId} ---`);
    contextWindowComparison = evaluateContextWindowImpact(
      bgeResult.embeddings,
      longContextResult.embeddings,
      chunks,
    );
    console.log(
      `  Long chunks: ${contextWindowComparison.longChunks}/${contextWindowComparison.totalChunks}`,
    );
  }

  // Dispose
  await embedder.dispose();

  return {
    models: modelResults,
    contextWindowComparison,
    corpus: {
      chunkCount: chunks.length,
      pairCount: pairs.length,
    },
    completedAt: new Date().toISOString(),
  };
}
