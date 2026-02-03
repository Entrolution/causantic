/**
 * Reusable single-model embedding + scoring + clustering pipeline.
 *
 * Extracts the per-model logic from benchmark-runner.ts so each
 * experiment can run it without duplicating the pipeline.
 */

import { Embedder } from '../../models/embedder.js';
import { getModel } from '../../models/model-registry.js';
import { clusterEmbeddings, getClusterMembership, type ClusterResult } from '../cluster-evaluator.js';
import { evaluateCodeNLAlignment, type AlignmentResult } from '../code-nl-alignment.js';
import {
  scorePairs,
  rocAuc,
  silhouetteScore,
} from '../metrics.js';
import type { LabeledPair } from '../annotation-schema.js';
import type { Chunk } from '../../parser/types.js';
import type { MetricSnapshot } from './types.js';

export interface SingleModelResult {
  rocAuc: number;
  silhouetteScore: number;
  clusterCount: number;
  noiseRatio: number;
  clusterResult: ClusterResult;
  clusterMembership: Map<number, number[]>;
  embeddings: Map<string, number[]>;
  codeNLAlignment: AlignmentResult;
  meanInferenceMs: number;
}

export interface SingleModelRunOptions {
  minClusterSize?: number;
}

/**
 * Embed chunks with a model, score pairs, and cluster.
 *
 * Loads the model, embeds all chunks, scores labeled pairs,
 * runs HDBSCAN clustering, computes silhouette, and returns
 * a complete result.
 */
export async function singleModelRun(
  modelId: string,
  chunks: Chunk[],
  pairs: LabeledPair[],
  options: SingleModelRunOptions = {},
): Promise<SingleModelResult> {
  const { minClusterSize = 3 } = options;
  const config = getModel(modelId);
  const embedder = new Embedder();

  try {
    console.log(`  Loading ${modelId}...`);
    await embedder.load(config);

    // Embed all chunks
    console.log(`  Embedding ${chunks.length} chunks...`);
    const embeddings = new Map<string, number[]>();
    let totalInferenceMs = 0;

    for (let i = 0; i < chunks.length; i++) {
      const result = await embedder.embed(chunks[i].text);
      embeddings.set(chunks[i].id, result.embedding);
      totalInferenceMs += result.inferenceMs;

      if ((i + 1) % 50 === 0 || i === chunks.length - 1) {
        console.log(`    ${i + 1}/${chunks.length} chunks embedded`);
      }
    }

    return buildResult(chunks, pairs, embeddings, totalInferenceMs, minClusterSize);
  } finally {
    await embedder.dispose();
  }
}

/**
 * Embed chunk texts directly (for experiments that modify text before embedding).
 *
 * Takes an array of {id, text} instead of Chunk objects, allowing experiments
 * to pass modified text (e.g. truncated, filtered) while keeping original chunk IDs.
 */
export async function embedTextsAndScore(
  modelId: string,
  texts: { id: string; text: string }[],
  pairs: LabeledPair[],
  options: SingleModelRunOptions = {},
): Promise<SingleModelResult> {
  const { minClusterSize = 3 } = options;
  const config = getModel(modelId);
  const embedder = new Embedder();

  try {
    console.log(`  Loading ${modelId}...`);
    await embedder.load(config);

    console.log(`  Embedding ${texts.length} texts...`);
    const embeddings = new Map<string, number[]>();
    let totalInferenceMs = 0;

    for (let i = 0; i < texts.length; i++) {
      const result = await embedder.embed(texts[i].text);
      embeddings.set(texts[i].id, result.embedding);
      totalInferenceMs += result.inferenceMs;

      if ((i + 1) % 50 === 0 || i === texts.length - 1) {
        console.log(`    ${i + 1}/${texts.length} texts embedded`);
      }
    }

    // Build fake chunks array for clustering (just needs id ordering)
    const fakeChunks = texts.map((t) => ({ id: t.id })) as Chunk[];
    return buildResult(fakeChunks, pairs, embeddings, totalInferenceMs, minClusterSize);
  } finally {
    await embedder.dispose();
  }
}

/**
 * Score and cluster from pre-computed embeddings (no model loading needed).
 */
export function scoreFromEmbeddings(
  chunks: Chunk[],
  pairs: LabeledPair[],
  embeddings: Map<string, number[]>,
  options: SingleModelRunOptions = {},
): Omit<SingleModelResult, 'meanInferenceMs'> & { meanInferenceMs: number } {
  return buildResult(chunks, pairs, embeddings, 0, options.minClusterSize ?? 3);
}

function buildResult(
  chunks: Chunk[] | { id: string }[],
  pairs: LabeledPair[],
  embeddings: Map<string, number[]>,
  totalInferenceMs: number,
  minClusterSize: number,
): SingleModelResult {
  // Score labeled pairs
  const scored = scorePairs(pairs, embeddings);
  const auc = rocAuc(scored);

  // Cluster
  const orderedIds = chunks.map((c) => c.id);
  const embeddingArray = orderedIds.map((id) => embeddings.get(id)!).filter(Boolean);
  const clusterResult = clusterEmbeddings(embeddingArray, { minClusterSize });
  const membership = getClusterMembership(clusterResult.labels);

  // Silhouette
  const silhouette = silhouetteScore(embeddingArray, clusterResult.labels);

  // Code-NL alignment
  const alignment = evaluateCodeNLAlignment(pairs, embeddings);

  const count = chunks.length;

  return {
    rocAuc: auc,
    silhouetteScore: silhouette,
    clusterCount: clusterResult.numClusters,
    noiseRatio: clusterResult.noiseRatio,
    clusterResult,
    clusterMembership: membership,
    embeddings,
    codeNLAlignment: alignment,
    meanInferenceMs: count > 0 ? totalInferenceMs / count : 0,
  };
}

/**
 * Extract a MetricSnapshot from a SingleModelResult.
 */
export function toSnapshot(result: SingleModelResult, chunkCount: number): MetricSnapshot {
  return {
    rocAuc: result.rocAuc,
    silhouetteScore: result.silhouetteScore,
    clusterCount: result.clusterCount,
    noiseRatio: result.noiseRatio,
    chunkCount,
  };
}
