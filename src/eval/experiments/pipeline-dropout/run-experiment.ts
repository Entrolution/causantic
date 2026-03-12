/**
 * Pipeline Dropout Analysis
 *
 * Traces where target chunks get lost in the retrieval pipeline.
 * For each query, checks whether the ground-truth chunk survives each stage:
 *   1. Vector search (raw top-K)
 *   2. RRF fusion (vector + keyword)
 *   3. Cluster expansion
 *   4. Oversized filtering
 *   5. MMR reranking
 *   6. Budget assembly
 *   7. Chain walking (recall path)
 *
 * Usage:
 *   npx tsx src/eval/experiments/pipeline-dropout/run-experiment.ts [--sample-size=50]
 */

import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  dereferenceToChunkIds,
  searchIndexEntriesByKeyword,
} from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { KeywordStore } from '../../../storage/keyword-store.js';
import { fuseRRF, type RankedItem } from '../../../retrieval/rrf.js';
import { expandViaClusters } from '../../../retrieval/cluster-expander.js';
import { reorderWithMMR } from '../../../retrieval/mmr.js';
import { walkChains, selectBestChain } from '../../../retrieval/chain-walker.js';
import { approximateTokens } from '../../../utils/token-counter.js';
import { generateSearchQueries, type ChunkForQueryGen } from '../index-vs-chunk/query-generator.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface StagePresence {
  vectorSearch: boolean;
  rrfFusion: boolean;
  clusterExpansion: boolean;
  oversizedFilter: boolean;
  mmrRerank: boolean;
  budgetAssembly: boolean;
  chainSeeds: boolean;
  chainOutput: boolean;
}

interface QueryTrace {
  query: string;
  groundTruthChunkId: string;
  stages: StagePresence;
  /** Stage where the chunk was first lost (null if survived all) */
  droppedAt: string | null;
  /** Rank in vector search (0 = not found) */
  vectorRank: number;
  /** Rank after RRF (0 = not found) */
  rrfRank: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function sampleChunks(sampleSize: number, seed: number): ChunkForQueryGen[] {
  getDb();
  const clusters = getAllClusters();
  if (clusters.length === 0) throw new Error('No clusters found.');

  const rng = createRng(seed);
  const result: ChunkForQueryGen[] = [];
  const shuffled = [...clusters].sort(() => rng() - 0.5);

  for (const cluster of shuffled) {
    if (result.length >= sampleSize) break;
    const chunkIds = getClusterChunkIds(cluster.id);
    if (chunkIds.length < 2) continue;

    const numPicks = Math.min(2, Math.ceil(sampleSize / clusters.length), chunkIds.length);
    const shuffledIds = [...chunkIds].sort(() => rng() - 0.5);

    for (let i = 0; i < numPicks && result.length < sampleSize; i++) {
      const chunk = getChunkById(shuffledIds[i]);
      if (!chunk || chunk.content.length < 100) continue;
      result.push({
        id: chunk.id,
        sessionSlug: chunk.sessionSlug,
        content: chunk.content,
        clusterId: cluster.id,
        clusterName: cluster.name,
      });
    }
  }
  return result;
}

function findIn(items: Array<{ chunkId: string }>, targetId: string): number {
  const idx = items.findIndex((i) => i.chunkId === targetId);
  return idx >= 0 ? idx + 1 : 0;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runAnalysis() {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 50;
  const seed = 42;

  console.log('=== Pipeline Dropout Analysis ===\n');

  getDb();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);
  const { hybridSearch, clusterExpansion, mmrReranking, embeddingModel } = config;
  const maxTokens = config.mcpMaxResponseTokens;

  const useIndexSearch = config.semanticIndex.useForSearch && getIndexEntryCount() > 0;
  console.log(`Search path: ${useIndexSearch ? 'INDEX' : 'CHUNK'}`);
  console.log(`Max tokens: ${maxTokens}`);

  vectorStore.setModelId(embeddingModel);
  if (useIndexSearch) indexVectorStore.setModelId(embeddingModel);

  // 1. Sample and generate queries
  console.log(`\nSampling ${sampleSize} chunks...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(`  Sampled ${sampledChunks.length} chunks`);

  console.log('Generating queries...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(`  Generated ${queries.length} queries\n`);

  // 2. Prepare embedder
  const embedder = new Embedder();
  await embedder.load(getModel(embeddingModel));

  let keywordStore: KeywordStore | null = null;
  try { keywordStore = new KeywordStore(); } catch { /* unavailable */ }

  const vectorLimits = [20, 50, 100, 200];
  console.log(`Vector search limits: ${vectorLimits.join(', ')}`);

  // Pre-embed all queries
  console.log('Embedding queries...');
  const queryEmbeddings: number[][] = [];
  for (let i = 0; i < queries.length; i++) {
    const { embedding } = await embedder.embed(queries[i].query, true);
    queryEmbeddings.push(embedding);
  }
  console.log(`  Embedded ${queryEmbeddings.length} queries\n`);

  // 3. Sweep vector search limits
  for (const vectorSearchLimit of vectorLimits) {
    console.log(`── Vector limit: ${vectorSearchLimit} ──`);
    const traces: QueryTrace[] = [];

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      const embedding = queryEmbeddings[qi];
      const targetId = q.groundTruthChunkId;

      const stages: StagePresence = {
        vectorSearch: false,
        rrfFusion: false,
        clusterExpansion: false,
        oversizedFilter: false,
        mmrRerank: false,
        budgetAssembly: false,
        chainSeeds: false,
        chainOutput: false,
      };

      let vectorRank = 0;
      let rrfRank = 0;
      let fusedResults: RankedItem[];

      if (useIndexSearch) {
        const entryCount = getIndexEntryCount();
        const indexedChunks = getIndexedChunkCount();
        const entriesPerChunk = indexedChunks > 0 ? entryCount / indexedChunks : 1;
        const indexSearchLimit = Math.ceil(vectorSearchLimit * entriesPerChunk);

        const indexSimilar = await indexVectorStore.search(embedding, indexSearchLimit);

        for (let i = 0; i < indexSimilar.length; i++) {
          const chunkIds = dereferenceToChunkIds([indexSimilar[i].id]);
          if (chunkIds.includes(targetId)) {
            stages.vectorSearch = true;
            if (vectorRank === 0) vectorRank = i + 1;
            break;
          }
        }

        let indexKeywordResults: Array<{ id: string; score: number }> = [];
        try {
          indexKeywordResults = searchIndexEntriesByKeyword(q.query, hybridSearch.keywordSearchLimit);
        } catch { /* unavailable */ }

        const indexVectorItems: RankedItem[] = indexSimilar.map((s) => ({
          chunkId: s.id,
          score: Math.max(0, 1 - s.distance),
          source: 'vector' as const,
        }));
        const indexKeywordItems: RankedItem[] = indexKeywordResults.map((r) => ({
          chunkId: r.id,
          score: r.score,
          source: 'keyword' as const,
        }));

        const indexFused = fuseRRF(
          [
            { items: indexVectorItems, weight: hybridSearch.vectorWeight },
            ...(indexKeywordItems.length > 0
              ? [{ items: indexKeywordItems, weight: hybridSearch.keywordWeight }]
              : []),
          ],
          hybridSearch.rrfK,
        );

        const chunkScoreMap = new Map<string, { score: number; source: RankedItem['source'] }>();
        for (const item of indexFused) {
          const entryChunkIds = dereferenceToChunkIds([item.chunkId]);
          for (const cid of entryChunkIds) {
            const existing = chunkScoreMap.get(cid);
            if (!existing || item.score > existing.score) {
              chunkScoreMap.set(cid, { score: item.score, source: item.source });
            }
          }
        }

        const allChunkIds = [...chunkScoreMap.keys()];
        fusedResults = allChunkIds.map((cid) => {
          const entry = chunkScoreMap.get(cid)!;
          return { chunkId: cid, score: entry.score, source: entry.source };
        });

        rrfRank = fusedResults.findIndex((r) => r.chunkId === targetId) + 1;
        if (rrfRank > 0) stages.rrfFusion = true;
      } else {
        const similar = await vectorStore.search(embedding, vectorSearchLimit);
        vectorRank = similar.findIndex((s) => s.id === targetId) + 1;
        if (vectorRank > 0) stages.vectorSearch = true;

        let keywordResults: Array<{ id: string; score: number }> = [];
        if (keywordStore) {
          try { keywordResults = keywordStore.search(q.query, hybridSearch.keywordSearchLimit); }
          catch { /* */ }
        }

        const vectorItems: RankedItem[] = similar.map((s) => ({
          chunkId: s.id,
          score: Math.max(0, 1 - s.distance),
          source: 'vector' as const,
        }));
        const keywordItems: RankedItem[] = keywordResults.map((r) => ({
          chunkId: r.id,
          score: r.score,
          source: 'keyword' as const,
        }));

        fusedResults = fuseRRF(
          [
            { items: vectorItems, weight: hybridSearch.vectorWeight },
            ...(keywordItems.length > 0
              ? [{ items: keywordItems, weight: hybridSearch.keywordWeight }]
              : []),
          ],
          hybridSearch.rrfK,
        );

        rrfRank = findIn(fusedResults, targetId);
        if (rrfRank > 0) stages.rrfFusion = true;
      }

      // Cluster expansion
      const expanded = expandViaClusters(
        fusedResults,
        clusterExpansion,
        undefined,
        undefined,
        config.feedbackWeight,
      );
      if (findIn(expanded, targetId) > 0) stages.clusterExpansion = true;

      // Dedupe
      const seen = new Set<string>();
      const deduped = expanded.filter((r) => {
        if (seen.has(r.chunkId)) return false;
        seen.add(r.chunkId);
        return true;
      });

      const chunkTokenMap = new Map<string, number>();
      for (const item of deduped) {
        const chunk = getChunkById(item.chunkId);
        if (chunk) chunkTokenMap.set(item.chunkId, chunk.approxTokens || 500);
      }

      // Oversized filter
      const sizeBounded = deduped.filter((item) => {
        const tokens = chunkTokenMap.get(item.chunkId);
        return tokens !== undefined && tokens <= maxTokens;
      });
      if (findIn(sizeBounded, targetId) > 0) stages.oversizedFilter = true;

      // MMR reranking
      const reordered = await reorderWithMMR(sizeBounded, embedding, mmrReranking, {
        tokenBudget: maxTokens,
        chunkTokenCounts: chunkTokenMap,
      });
      const mmrRank = findIn(reordered, targetId);
      if (mmrRank > 0) stages.mmrRerank = true;

      // Log MMR dropout details
      if (stages.oversizedFilter && !stages.mmrRerank) {
        const preRank = findIn(sizeBounded, targetId);
        const targetTokens = chunkTokenMap.get(targetId) ?? 0;
        const totalTokensInReordered = reordered.reduce(
          (s, r) => s + (chunkTokenMap.get(r.chunkId) ?? 0), 0,
        );
        console.log(`    MMR DROP: pre-rank=${preRank}/${sizeBounded.length} target=${targetTokens}tok reordered=${reordered.length} reorderedTokens=${totalTokensInReordered} budget=${maxTokens}`);
      }

      // Budget assembly
      let budgetUsed = 0;
      for (const item of reordered) {
        const tokens = chunkTokenMap.get(item.chunkId) ?? 500;
        if (budgetUsed + tokens > maxTokens) break;
        budgetUsed += tokens;
        if (item.chunkId === targetId) {
          stages.budgetAssembly = true;
          break;
        }
      }

      // Chain walking
      const seedIds = expanded.slice(0, 5).map((r) => r.chunkId);
      stages.chainSeeds = seedIds.includes(targetId);

      try {
        const chains = await walkChains(seedIds, {
          direction: 'backward',
          tokenBudget: maxTokens,
          queryEmbedding: embedding,
        });
        const bestChain = selectBestChain(chains);
        if (bestChain && bestChain.chunkIds.includes(targetId)) {
          stages.chainOutput = true;
        }
      } catch { /* chain walk failed */ }

      let droppedAt: string | null = null;
      const stageOrder: [keyof StagePresence, string][] = [
        ['vectorSearch', 'Vector Search'],
        ['rrfFusion', 'RRF Fusion'],
        ['clusterExpansion', 'Cluster Expansion'],
        ['oversizedFilter', 'Oversized Filter'],
        ['mmrRerank', 'MMR Rerank'],
        ['budgetAssembly', 'Budget Assembly'],
      ];

      for (const [key, name] of stageOrder) {
        if (!stages[key]) {
          droppedAt = name;
          break;
        }
      }

      traces.push({
        query: q.query,
        groundTruthChunkId: targetId,
        stages,
        droppedAt,
        vectorRank,
        rrfRank,
      });
    }

    // Aggregate for this limit
    const total = traces.length;
    const stageCounts: Record<string, number> = {};
    for (const trace of traces) {
      for (const [key, val] of Object.entries(trace.stages)) {
        stageCounts[key] = (stageCounts[key] ?? 0) + (val ? 1 : 0);
      }
    }

    const stageLabels: [string, string][] = [
      ['vectorSearch', 'Vector'],
      ['rrfFusion', 'RRF'],
      ['clusterExpansion', 'Cluster'],
      ['oversizedFilter', 'Size'],
      ['mmrRerank', 'MMR'],
      ['budgetAssembly', 'Budget'],
      ['chainSeeds', 'Seeds'],
      ['chainOutput', 'Chain'],
    ];

    const rates = stageLabels.map(([key, label]) => {
      const count = stageCounts[key] ?? 0;
      return `${label}: ${((count / total) * 100).toFixed(0)}%`;
    });
    console.log(`  ${rates.join(' → ')}`);
  }

  await embedder.dispose();

  console.log('\nDone.');
}

runAnalysis().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
