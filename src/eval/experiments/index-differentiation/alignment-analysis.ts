/**
 * Phase 2b: Entry-to-chunk alignment analysis.
 *
 * Measures how well each index entry's embedding preserves the semantic
 * direction of its source chunk. Complements the discrimination test
 * (Phase 2) which uses the chunk→entry direction.
 *
 * For each entry in a cluster, compute:
 * - Self-alignment: cosine similarity between entry embedding and its own chunk embedding
 * - Sibling alignment: mean cosine similarity between entry embedding and other chunks' embeddings
 * - Alignment gap: self - mean sibling (positive = entry preserves chunk-specific signal)
 *
 * If the gap is small, the LLM summarization shifts the entry into a
 * cluster-generic direction, losing chunk-specific retrievability.
 */

import { cosineSimilarity } from '../../../utils/angular-distance.js';
import type { ClusterForAnalysis } from './similarity-analysis.js';

/** Per-entry alignment measurement. */
export interface EntryAlignment {
  entryId: string;
  /** Cosine similarity between this entry's embedding and its own chunk embedding. */
  selfAlignment: number;
  /** Mean cosine similarity between this entry's embedding and all sibling chunk embeddings. */
  meanSiblingAlignment: number;
  /** self - meanSibling (positive = preserves chunk-specific signal). */
  alignmentGap: number;
  /** Max cosine similarity to any sibling chunk (worst-case confusion). */
  maxSiblingAlignment: number;
}

/** Per-cluster alignment summary. */
export interface ClusterAlignmentResult {
  clusterId: string;
  clusterName: string | null;
  entryCount: number;
  /** Mean self-alignment across all entries. */
  meanSelfAlignment: number;
  /** Mean sibling alignment across all entries. */
  meanSiblingAlignment: number;
  /** Mean alignment gap (self - sibling). */
  meanAlignmentGap: number;
  /** Fraction of entries where self > max sibling (entry points more to own chunk than any sibling). */
  uniquelyAlignedFraction: number;
  /** Per-entry details. */
  perEntry: EntryAlignment[];
}

/**
 * Run alignment analysis for a single cluster.
 */
export function analyseClusterAlignment(
  cluster: ClusterForAnalysis,
): ClusterAlignmentResult {
  const entries = cluster.entries;
  const perEntry: EntryAlignment[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryEmb = entry.entryEmbedding;
    const ownChunkEmb = entry.chunkEmbeddings[0];

    if (!ownChunkEmb || ownChunkEmb.length === 0) {
      perEntry.push({
        entryId: entry.entryId,
        selfAlignment: 0,
        meanSiblingAlignment: 0,
        alignmentGap: 0,
        maxSiblingAlignment: 0,
      });
      continue;
    }

    const selfSim = cosineSimilarity(entryEmb, ownChunkEmb);

    // Compute similarity to all sibling chunks
    const siblingChunkEmbs: number[][] = [];
    for (let j = 0; j < entries.length; j++) {
      if (j === i) continue;
      for (const chunkEmb of entries[j].chunkEmbeddings) {
        if (chunkEmb.length > 0) siblingChunkEmbs.push(chunkEmb);
      }
    }

    let meanSibSim = 0;
    let maxSibSim = 0;
    if (siblingChunkEmbs.length > 0) {
      const sibSims = siblingChunkEmbs.map((se) => cosineSimilarity(entryEmb, se));
      meanSibSim = sibSims.reduce((a, b) => a + b, 0) / sibSims.length;
      maxSibSim = Math.max(...sibSims);
    }

    perEntry.push({
      entryId: entry.entryId,
      selfAlignment: selfSim,
      meanSiblingAlignment: meanSibSim,
      alignmentGap: selfSim - meanSibSim,
      maxSiblingAlignment: maxSibSim,
    });
  }

  const valid = perEntry.filter((e) => e.selfAlignment > 0);
  const meanSelf = valid.length > 0
    ? valid.reduce((s, e) => s + e.selfAlignment, 0) / valid.length
    : 0;
  const meanSib = valid.length > 0
    ? valid.reduce((s, e) => s + e.meanSiblingAlignment, 0) / valid.length
    : 0;
  const meanGap = valid.length > 0
    ? valid.reduce((s, e) => s + e.alignmentGap, 0) / valid.length
    : 0;
  const uniquelyAligned = valid.filter(
    (e) => e.selfAlignment > e.maxSiblingAlignment,
  ).length;

  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    entryCount: entries.length,
    meanSelfAlignment: meanSelf,
    meanSiblingAlignment: meanSib,
    meanAlignmentGap: meanGap,
    uniquelyAlignedFraction: valid.length > 0 ? uniquelyAligned / valid.length : 0,
    perEntry,
  };
}

/**
 * Run alignment analysis across all eligible clusters.
 */
export function runAlignmentAnalysis(
  clusters: ClusterForAnalysis[],
): ClusterAlignmentResult[] {
  return clusters.map(analyseClusterAlignment);
}
