/**
 * Reciprocal Rank Fusion (RRF) for combining ranked lists from different retrieval sources.
 *
 * Merges results from vector search, keyword search, and cluster expansion
 * into a single ranked list using the formula:
 *   score(chunk) = Sum(weight_i / (k + rank_i))
 */

export interface RankedItem {
  chunkId: string;
  score: number;
  source?: 'vector' | 'keyword' | 'cluster' | 'graph';
}

export interface RRFSource {
  items: RankedItem[];
  weight: number;
}

const DEFAULT_K = 60;

/**
 * Fuse multiple ranked lists using Reciprocal Rank Fusion.
 *
 * @param sources - Ranked lists with weights
 * @param k - RRF constant (default: 60). Higher values reduce the impact of high-ranked items.
 * @returns Merged list sorted by fused score descending, deduplicated by chunkId
 */
export function fuseRRF(sources: RRFSource[], k: number = DEFAULT_K): RankedItem[] {
  if (sources.length === 0) return [];

  // Map: chunkId → { fusedScore, sources[] }
  const scoreMap = new Map<string, { score: number; sources: Set<string> }>();

  for (const source of sources) {
    for (let rank = 0; rank < source.items.length; rank++) {
      const item = source.items[rank];
      const rrfScore = source.weight / (k + rank + 1); // rank is 0-based, formula uses 1-based

      const existing = scoreMap.get(item.chunkId);
      if (existing) {
        existing.score += rrfScore;
        if (item.source) existing.sources.add(item.source);
      } else {
        const sources = new Set<string>();
        if (item.source) sources.add(item.source);
        scoreMap.set(item.chunkId, { score: rrfScore, sources });
      }
    }
  }

  // Convert to array and sort by fused score descending
  const results: RankedItem[] = [];
  for (const [chunkId, { score, sources }] of scoreMap) {
    // Credit the most informative source (graph > cluster > keyword > vector).
    // Vector is the baseline — rarer sources that also found this chunk
    // represent added value from the graph/keyword/cluster pipeline stages.
    const priority = ['graph', 'cluster', 'keyword', 'vector'];
    let bestSource: RankedItem['source'] = undefined;
    for (const p of priority) {
      if (sources.has(p)) {
        bestSource = p as RankedItem['source'];
        break;
      }
    }

    results.push({ chunkId, score, source: bestSource });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
