/**
 * Re-scorer Benchmark
 *
 * Compares three re-scoring approaches on the same candidate set:
 *   1. Cross-encoder (ms-marco-MiniLM-L-6-v2) — local ONNX model
 *   2. Query expansion — LLM generates reformulations, max-sim re-scoring
 *   3. LLM reranker — Haiku directly ranks candidates
 *
 * For each approach, measures:
 *   - How many ground-truth chunks get promoted into top-5, top-10
 *   - Budget assembly survival rate (20K token budget)
 *   - Latency per query
 *
 * Usage:
 *   npx tsx src/eval/experiments/rescorer-ceiling/benchmark-rescorers.ts [--sample-size=50]
 */

import { pipeline, type TextClassificationPipeline } from '@huggingface/transformers';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import {
  getIndexEntryCount,
  getIndexedChunkCount,
  dereferenceToChunkIds,
} from '../../../storage/index-entry-store.js';
import { getAllClusters, getClusterChunkIds } from '../../../storage/cluster-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { loadConfig, toRuntimeConfig } from '../../../config/loader.js';
import { cosineSimilarity } from '../../../utils/angular-distance.js';
import { createSecretStore } from '../../../utils/secret-store.js';
import { generateSearchQueries, type ChunkForQueryGen } from '../index-vs-chunk/query-generator.js';

// ── Constants ──────────────────────────────────────────────────────────────

const CROSS_ENCODER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
const CROSS_ENCODER_MAX_CHARS = 512 * 4; // ~512 tokens
const VECTOR_K = 500; // Candidate pool size
const QUERY_EXPANSION_COUNT = 5;
const LLM_RERANK_TOP_N = 30; // Send top-N to LLM for reranking

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

interface Candidate {
  chunkId: string;
  content: string;
  tokens: number;
  vectorScore: number;
}

function budgetSurvival(
  ranked: Array<{ chunkId: string }>,
  targetId: string,
  tokenMap: Map<string, number>,
  budget: number,
): boolean {
  let used = 0;
  for (const item of ranked) {
    const tokens = tokenMap.get(item.chunkId) ?? 500;
    if (used + tokens > budget) return false;
    used += tokens;
    if (item.chunkId === targetId) return true;
  }
  return false;
}

function findRank(items: Array<{ chunkId: string }>, targetId: string): number {
  const idx = items.findIndex((i) => i.chunkId === targetId);
  return idx >= 0 ? idx + 1 : 0;
}

// ── Approach 1: Cross-encoder ──────────────────────────────────────────────

async function loadCrossEncoder(): Promise<TextClassificationPipeline> {
  console.log(`Loading cross-encoder: ${CROSS_ENCODER_MODEL}...`);
  const start = Date.now();
  const pipe = (await pipeline('text-classification', CROSS_ENCODER_MODEL, {
    dtype: 'fp32',
  })) as TextClassificationPipeline;
  console.log(`  Loaded in ${Date.now() - start}ms`);
  return pipe;
}

async function crossEncoderRescore(
  pipe: TextClassificationPipeline,
  query: string,
  candidates: Candidate[],
): Promise<Array<{ chunkId: string; score: number }>> {
  const scored: Array<{ chunkId: string; score: number }> = [];

  for (const c of candidates) {
    const truncated = c.content.slice(0, CROSS_ENCODER_MAX_CHARS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HF pipeline() return type is untyped
    const result = await (pipe as any)({ text: query, text_pair: truncated }, { topk: 1 });
    const score = Array.isArray(result)
      ? (result[0] as { score: number }).score
      : (result as { score: number }).score;
    scored.push({ chunkId: c.chunkId, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Approach 2: Query expansion ────────────────────────────────────────────

async function expandQuery(client: Anthropic, query: string, model: string): Promise<string[]> {
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Generate ${QUERY_EXPANSION_COUNT} alternative search queries for finding the same information as: "${query}"

Each query should approach the topic from a different angle (synonyms, related concepts, specific details, broader framing).

Return ONLY the queries, one per line, no numbering or bullets.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, QUERY_EXPANSION_COUNT);
}

async function queryExpansionRescore(
  embedder: Embedder,
  originalEmbedding: number[],
  expansionEmbeddings: number[][],
  candidates: Candidate[],
): Promise<Array<{ chunkId: string; score: number }>> {
  const allEmbeddings = [originalEmbedding, ...expansionEmbeddings];
  const scored: Array<{ chunkId: string; score: number }> = [];

  for (const c of candidates) {
    const chunkEmb = await vectorStore.get(c.chunkId);
    if (!chunkEmb) {
      scored.push({ chunkId: c.chunkId, score: 0 });
      continue;
    }
    // Max similarity across all query variants
    let maxSim = -1;
    for (const qEmb of allEmbeddings) {
      const sim = cosineSimilarity(qEmb, chunkEmb);
      if (sim > maxSim) maxSim = sim;
    }
    scored.push({ chunkId: c.chunkId, score: maxSim });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Approach 3: LLM reranker ───────────────────────────────────────────────

async function llmRerank(
  client: Anthropic,
  query: string,
  candidates: Candidate[],
  model: string,
): Promise<Array<{ chunkId: string; score: number }>> {
  // Take only top-N by vector score to keep prompt small
  const topCandidates = candidates.slice(0, LLM_RERANK_TOP_N);

  const passages = topCandidates
    .map((c, i) => {
      const snippet = c.content.slice(0, 400);
      return `[${i}] ${snippet}`;
    })
    .join('\n\n');

  const response = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `Query: "${query}"

Rank these passages by relevance to the query. Return ONLY the passage numbers in order from most to least relevant, comma-separated. Example: 3,0,7,1,5

${passages}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const indices = text.match(/\d+/g)?.map(Number) ?? [];

  // Build ranked list from LLM ordering, then append unranked candidates
  const ranked: Array<{ chunkId: string; score: number }> = [];
  const seen = new Set<string>();

  for (const idx of indices) {
    if (idx >= 0 && idx < topCandidates.length) {
      const c = topCandidates[idx];
      if (!seen.has(c.chunkId)) {
        ranked.push({ chunkId: c.chunkId, score: topCandidates.length - ranked.length });
        seen.add(c.chunkId);
      }
    }
  }

  // Append remaining candidates not ranked by LLM
  for (const c of candidates) {
    if (!seen.has(c.chunkId)) {
      ranked.push({ chunkId: c.chunkId, score: 0 });
      seen.add(c.chunkId);
    }
  }

  return ranked;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runBenchmark() {
  const args = process.argv.slice(2);
  const sampleSizeArg = args.find((a) => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1], 10) : 30;
  const seed = 42;

  console.log('=== Re-scorer Benchmark ===\n');

  getDb();
  const externalConfig = loadConfig();
  const config = toRuntimeConfig(externalConfig);
  const maxTokens = config.mcpMaxResponseTokens;

  const useIndex = config.semanticIndex.useForSearch && getIndexEntryCount() > 0;
  let entriesPerChunk = 1;
  if (useIndex) {
    const indexedChunks = getIndexedChunkCount();
    entriesPerChunk = indexedChunks > 0 ? getIndexEntryCount() / indexedChunks : 1;
  }

  console.log(`Candidate pool: K=${VECTOR_K}`);
  console.log(`Budget: ${maxTokens} tokens`);
  console.log(`LLM rerank top-N: ${LLM_RERANK_TOP_N}`);

  vectorStore.setModelId(config.embeddingModel);
  if (useIndex) indexVectorStore.setModelId(config.embeddingModel);

  // Get Anthropic client
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const store = createSecretStore();
      const storedKey = await store.get('anthropic-api-key');
      if (storedKey) process.env.ANTHROPIC_API_KEY = storedKey;
    } catch {
      /* */
    }
  }
  const anthropic = new Anthropic();

  // Sample and generate queries
  console.log(`\nSampling ${sampleSize} chunks...`);
  const sampledChunks = sampleChunks(sampleSize, seed);
  console.log(`  Sampled ${sampledChunks.length} chunks`);

  console.log('Generating queries...');
  const queries = await generateSearchQueries(sampledChunks, config.clusterRefreshModel);
  console.log(`  Generated ${queries.length} queries`);

  // Prepare embedder
  const embedder = new Embedder();
  await embedder.load(getModel(config.embeddingModel));

  console.log('Embedding queries...');
  const queryEmbeddings: number[][] = [];
  for (const q of queries) {
    const { embedding } = await embedder.embed(q.query, true);
    queryEmbeddings.push(embedding);
  }
  console.log(`  Embedded ${queryEmbeddings.length} queries`);

  // Build candidate pools
  console.log(`\nBuilding candidate pools (K=${VECTOR_K})...`);
  type QueryData = {
    query: string;
    targetId: string;
    embedding: number[];
    candidates: Candidate[];
    targetInPool: boolean;
  };
  const queryDataList: QueryData[] = [];

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const embedding = queryEmbeddings[qi];
    const targetId = q.groundTruthChunkId;

    // Get candidates via index or chunk path
    let candidateIds: Array<{ id: string; score: number }>;
    if (useIndex) {
      const indexLimit = Math.ceil(VECTOR_K * entriesPerChunk);
      const results = await indexVectorStore.search(embedding, indexLimit);
      // Dereference index entries to chunk IDs
      const chunkScoreMap = new Map<string, number>();
      for (const r of results) {
        const chunkIds = dereferenceToChunkIds([r.id]);
        const score = Math.max(0, 1 - r.distance);
        for (const cid of chunkIds) {
          const existing = chunkScoreMap.get(cid);
          if (existing === undefined || score > existing) {
            chunkScoreMap.set(cid, score);
          }
        }
      }
      candidateIds = [...chunkScoreMap.entries()]
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score);
    } else {
      const results = await vectorStore.search(embedding, VECTOR_K);
      candidateIds = results.map((r) => ({ id: r.id, score: Math.max(0, 1 - r.distance) }));
    }

    // Load chunk content for candidates
    const candidates: Candidate[] = [];
    for (const { id, score } of candidateIds) {
      const chunk = getChunkById(id);
      if (chunk) {
        candidates.push({
          chunkId: id,
          content: chunk.content,
          tokens: chunk.approxTokens || 500,
          vectorScore: score,
        });
      }
    }

    const targetInPool = candidates.some((c) => c.chunkId === targetId);
    queryDataList.push({ query: q.query, targetId, embedding, candidates, targetInPool });
  }

  const inPool = queryDataList.filter((q) => q.targetInPool).length;
  console.log(`  ${inPool}/${queryDataList.length} targets in candidate pool`);

  // Only benchmark queries where target is in the pool (otherwise re-scoring can't help)
  const benchmarkable = queryDataList.filter((q) => q.targetInPool);
  console.log(`  Benchmarking ${benchmarkable.length} queries\n`);

  if (benchmarkable.length === 0) {
    console.log('No benchmarkable queries. Exiting.');
    await embedder.dispose();
    return;
  }

  // Token map for budget calculations
  const tokenMap = new Map<string, number>();
  for (const qd of benchmarkable) {
    for (const c of qd.candidates) {
      tokenMap.set(c.chunkId, c.tokens);
    }
  }

  // ── Baseline: vector score ordering ──────────────────────────────────────

  console.log('── Baseline (vector score) ──');
  let baselineTop5 = 0,
    baselineTop10 = 0,
    baselineBudget = 0;
  const baselineRanks: number[] = [];
  for (const qd of benchmarkable) {
    const rank = findRank(qd.candidates, qd.targetId);
    baselineRanks.push(rank);
    if (rank > 0 && rank <= 5) baselineTop5++;
    if (rank > 0 && rank <= 10) baselineTop10++;
    if (budgetSurvival(qd.candidates, qd.targetId, tokenMap, maxTokens)) baselineBudget++;
  }
  const baselineMedianRank = [...baselineRanks].sort((a, b) => a - b)[
    Math.floor(baselineRanks.length / 2)
  ];
  console.log(
    `  Top-5: ${baselineTop5}/${benchmarkable.length} (${((baselineTop5 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Top-10: ${baselineTop10}/${benchmarkable.length} (${((baselineTop10 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Budget: ${baselineBudget}/${benchmarkable.length} (${((baselineBudget / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(`  Median rank: ${baselineMedianRank}\n`);

  // ── Approach 1: Cross-encoder ────────────────────────────────────────────

  console.log('── Cross-encoder (ms-marco-MiniLM-L-6-v2) ──');
  const crossEncoder = await loadCrossEncoder();
  let ceTop5 = 0,
    ceTop10 = 0,
    ceBudget = 0;
  const ceRanks: number[] = [];
  const ceTimings: number[] = [];

  for (let i = 0; i < benchmarkable.length; i++) {
    const qd = benchmarkable[i];
    const start = Date.now();
    const reranked = await crossEncoderRescore(crossEncoder, qd.query, qd.candidates);
    ceTimings.push(Date.now() - start);

    const rank = findRank(reranked, qd.targetId);
    ceRanks.push(rank);
    if (rank > 0 && rank <= 5) ceTop5++;
    if (rank > 0 && rank <= 10) ceTop10++;
    if (budgetSurvival(reranked, qd.targetId, tokenMap, maxTokens)) ceBudget++;

    if ((i + 1) % 5 === 0) console.log(`  Query ${i + 1}/${benchmarkable.length}`);
  }
  const ceMedianRank = [...ceRanks].sort((a, b) => a - b)[Math.floor(ceRanks.length / 2)];
  const ceMedianTime = [...ceTimings].sort((a, b) => a - b)[Math.floor(ceTimings.length / 2)];
  console.log(
    `  Top-5: ${ceTop5}/${benchmarkable.length} (${((ceTop5 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Top-10: ${ceTop10}/${benchmarkable.length} (${((ceTop10 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Budget: ${ceBudget}/${benchmarkable.length} (${((ceBudget / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(`  Median rank: ${ceMedianRank}`);
  console.log(`  Median latency: ${ceMedianTime}ms\n`);

  // Dispose cross-encoder to free memory before next approach
  await (crossEncoder as unknown as { dispose?: () => Promise<void> }).dispose?.();

  // ── Approach 2: Query expansion ──────────────────────────────────────────

  console.log('── Query expansion (5 reformulations) ──');
  let qeTop5 = 0,
    qeTop10 = 0,
    qeBudget = 0;
  const qeRanks: number[] = [];
  const qeTimings: number[] = [];

  for (let i = 0; i < benchmarkable.length; i++) {
    const qd = benchmarkable[i];
    const start = Date.now();

    // Generate expansions
    const expansions = await expandQuery(anthropic, qd.query, config.clusterRefreshModel);

    // Embed expansions
    const expansionEmbeddings: number[][] = [];
    for (const exp of expansions) {
      const { embedding } = await embedder.embed(exp, true);
      expansionEmbeddings.push(embedding);
    }

    // Re-score candidates
    const reranked = await queryExpansionRescore(
      embedder,
      qd.embedding,
      expansionEmbeddings,
      qd.candidates,
    );
    qeTimings.push(Date.now() - start);

    const rank = findRank(reranked, qd.targetId);
    qeRanks.push(rank);
    if (rank > 0 && rank <= 5) qeTop5++;
    if (rank > 0 && rank <= 10) qeTop10++;
    if (budgetSurvival(reranked, qd.targetId, tokenMap, maxTokens)) qeBudget++;

    if ((i + 1) % 5 === 0) console.log(`  Query ${i + 1}/${benchmarkable.length}`);
  }
  const qeMedianRank = [...qeRanks].sort((a, b) => a - b)[Math.floor(qeRanks.length / 2)];
  const qeMedianTime = [...qeTimings].sort((a, b) => a - b)[Math.floor(qeTimings.length / 2)];
  console.log(
    `  Top-5: ${qeTop5}/${benchmarkable.length} (${((qeTop5 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Top-10: ${qeTop10}/${benchmarkable.length} (${((qeTop10 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Budget: ${qeBudget}/${benchmarkable.length} (${((qeBudget / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(`  Median rank: ${qeMedianRank}`);
  console.log(`  Median latency: ${qeMedianTime}ms\n`);

  // ── Approach 3: LLM reranker ─────────────────────────────────────────────

  console.log(`── LLM reranker (top-${LLM_RERANK_TOP_N} → Haiku) ──`);
  let llmTop5 = 0,
    llmTop10 = 0,
    llmBudget = 0;
  const llmRanks: number[] = [];
  const llmTimings: number[] = [];

  for (let i = 0; i < benchmarkable.length; i++) {
    const qd = benchmarkable[i];
    const start = Date.now();
    const reranked = await llmRerank(
      anthropic,
      qd.query,
      qd.candidates,
      config.clusterRefreshModel,
    );
    llmTimings.push(Date.now() - start);

    const rank = findRank(reranked, qd.targetId);
    llmRanks.push(rank);
    if (rank > 0 && rank <= 5) llmTop5++;
    if (rank > 0 && rank <= 10) llmTop10++;
    if (budgetSurvival(reranked, qd.targetId, tokenMap, maxTokens)) llmBudget++;

    if ((i + 1) % 5 === 0) console.log(`  Query ${i + 1}/${benchmarkable.length}`);
  }
  const llmMedianRank = [...llmRanks].sort((a, b) => a - b)[Math.floor(llmRanks.length / 2)];
  const llmMedianTime = [...llmTimings].sort((a, b) => a - b)[Math.floor(llmTimings.length / 2)];
  console.log(
    `  Top-5: ${llmTop5}/${benchmarkable.length} (${((llmTop5 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Top-10: ${llmTop10}/${benchmarkable.length} (${((llmTop10 / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  Budget: ${llmBudget}/${benchmarkable.length} (${((llmBudget / benchmarkable.length) * 100).toFixed(0)}%)`,
  );
  console.log(`  Median rank: ${llmMedianRank}`);
  console.log(`  Median latency: ${llmMedianTime}ms\n`);

  // ── Summary ──────────────────────────────────────────────────────────────

  const total = queryDataList.length;
  console.log('══ Summary ══\n');
  console.log(`Total queries: ${total}`);
  console.log(
    `In candidate pool (K=${VECTOR_K}): ${inPool}/${total} (${((inPool / total) * 100).toFixed(0)}%)`,
  );
  console.log(`Benchmarkable: ${benchmarkable.length}\n`);

  console.log('  Approach                  Top-5   Top-10   Budget   Med.Rank   Med.Latency');
  console.log('  ──────────────────────────────────────────────────────────────────────────');
  const pct = (n: number) => `${((n / benchmarkable.length) * 100).toFixed(0)}%`.padStart(4);
  console.log(
    `  Baseline (vector)         ${pct(baselineTop5)}    ${pct(baselineTop10)}     ${pct(baselineBudget)}       ${String(baselineMedianRank).padStart(4)}         0ms`,
  );
  console.log(
    `  Cross-encoder             ${pct(ceTop5)}    ${pct(ceTop10)}     ${pct(ceBudget)}       ${String(ceMedianRank).padStart(4)}     ${String(ceMedianTime).padStart(5)}ms`,
  );
  console.log(
    `  Query expansion           ${pct(qeTop5)}    ${pct(qeTop10)}     ${pct(qeBudget)}       ${String(qeMedianRank).padStart(4)}     ${String(qeMedianTime).padStart(5)}ms`,
  );
  console.log(
    `  LLM reranker              ${pct(llmTop5)}    ${pct(llmTop10)}     ${pct(llmBudget)}       ${String(llmMedianRank).padStart(4)}     ${String(llmMedianTime).padStart(5)}ms`,
  );

  await embedder.dispose();
  console.log('\nDone.');
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
