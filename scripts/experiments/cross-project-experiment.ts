/**
 * Cross-project experiment: v0.3 chain walking augmentation.
 *
 * Replaces the v0.2 experiment that used traverseMultiple() with sum-product traversal.
 * Uses chain walking from vector seeds to measure how many additional unique chunks
 * the chain walk contributes beyond pure vector search.
 *
 * Methodology (same as v0.2 for apples-to-apples comparison):
 * 1. For each query: embed → vector search → get top-10 seeds
 * 2. Walk chains backward + forward from seeds
 * 3. Count unique additional chunks not in vector results
 * 4. Augmentation ratio = (seeds + chain_additions) / seeds
 */

import { vectorStore } from '../../src/storage/vector-store.js';
import { walkChains } from '../../src/retrieval/chain-walker.js';
import { Embedder } from '../../src/models/embedder.js';
import { getModel } from '../../src/models/model-registry.js';
import { getDb, closeDb } from '../../src/storage/db.js';

// Generic queries that could apply to any software project
const GENERIC_QUERIES = [
  'error handling and exceptions',
  'API endpoint implementation',
  'database query optimization',
  'authentication and authorization',
  'test coverage and testing',
  'configuration and settings',
  'logging and debugging',
  'file parsing and processing',
  'user interface components',
  'data validation',
  'performance optimization',
  'refactoring and cleanup',
  'deployment and CI/CD',
  'dependency management',
  'documentation updates',
];

// Extract project-specific queries from chunk content
async function extractProjectQueries(projectSlug: string, limit: number = 5): Promise<string[]> {
  const db = getDb();

  const chunks = db.prepare(`
    SELECT content FROM chunks
    WHERE session_slug LIKE ?
    ORDER BY RANDOM()
    LIMIT 20
  `).all(`%${projectSlug}%`) as Array<{content: string}>;

  const queries: string[] = [];

  for (const chunk of chunks) {
    const fileMatches = chunk.content.match(/(?:src|lib|app|components?)\/[\w\-\/]+\.\w+/g);
    if (fileMatches) {
      queries.push(...fileMatches.slice(0, 2));
    }

    const codeMatches = chunk.content.match(/(?:function|class|const|def)\s+(\w+)/g);
    if (codeMatches) {
      queries.push(...codeMatches.slice(0, 2).map(m => m.replace(/^(function|class|const|def)\s+/, '')));
    }

    if (queries.length >= limit) break;
  }

  return [...new Set(queries)].slice(0, limit);
}

interface ProjectResult {
  project: string;
  sessionCount: number;
  chunkCount: number;
  queryCount: number;
  avgVectorResults: number;
  avgChainAdditions: number;
  augmentationRatio: number;
  avgChainLength: number;
  queriesProducingChains: number;
  queryResults: Array<{
    query: string;
    vectorCount: number;
    chainAdditions: number;
    chainLengths: number[];
  }>;
}

async function analyzeProject(
  embedder: Embedder,
  projectSlug: string,
  queries: string[]
): Promise<ProjectResult> {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT session_slug) as sessions,
      COUNT(*) as chunks
    FROM chunks
    WHERE session_slug LIKE ?
  `).get(`%${projectSlug}%`) as {sessions: number, chunks: number};

  const queryResults: ProjectResult['queryResults'] = [];
  let totalVectorResults = 0;
  let totalChainAdditions = 0;
  let totalChainLengths = 0;
  let totalChainCount = 0;
  let queriesWithChains = 0;

  for (const query of queries) {
    try {
      const { embedding } = await embedder.embed(query, true);
      const vectorResults = await vectorStore.search(embedding, 10);

      if (vectorResults.length === 0) continue;

      const vectorChunkIds = new Set(vectorResults.map(r => r.id));
      const startIds = vectorResults.map(r => r.id);

      // Walk chains backward + forward from seeds
      const backwardChains = await walkChains(startIds, {
        direction: 'backward',
        tokenBudget: 20000,
        queryEmbedding: embedding,
        maxDepth: 50,
      });

      const forwardChains = await walkChains(startIds, {
        direction: 'forward',
        tokenBudget: 20000,
        queryEmbedding: embedding,
        maxDepth: 50,
      });

      const allChainChunkIds = new Set<string>();
      const chainLengths: number[] = [];

      for (const chain of [...backwardChains, ...forwardChains]) {
        chainLengths.push(chain.chunkIds.length);
        for (const id of chain.chunkIds) {
          allChainChunkIds.add(id);
        }
      }

      const chainAdditions = [...allChainChunkIds].filter(id => !vectorChunkIds.has(id)).length;

      queryResults.push({
        query: query.slice(0, 50),
        vectorCount: vectorResults.length,
        chainAdditions,
        chainLengths,
      });

      totalVectorResults += vectorResults.length;
      totalChainAdditions += chainAdditions;
      totalChainLengths += chainLengths.reduce((s, l) => s + l, 0);
      totalChainCount += chainLengths.length;
      if (chainLengths.length > 0) queriesWithChains++;
    } catch (_e) {
      continue;
    }
  }

  const validQueries = queryResults.length;
  const avgVector = validQueries > 0 ? totalVectorResults / validQueries : 0;
  const avgChain = validQueries > 0 ? totalChainAdditions / validQueries : 0;
  const augmentation = avgVector > 0 ? (avgVector + avgChain) / avgVector : 1;
  const avgChainLength = totalChainCount > 0 ? totalChainLengths / totalChainCount : 0;

  return {
    project: projectSlug,
    sessionCount: stats.sessions,
    chunkCount: stats.chunks,
    queryCount: validQueries,
    avgVectorResults: avgVector,
    avgChainAdditions: avgChain,
    augmentationRatio: augmentation,
    avgChainLength,
    queriesProducingChains: queriesWithChains,
    queryResults,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('CROSS-PROJECT CHAIN WALKING AUGMENTATION EXPERIMENT (v0.3)');
  console.log('='.repeat(100));
  console.log('\nMethodology: vector search → chain walk (backward + forward) → count additional chunks');
  console.log('Comparable to v0.2 experiment (traverseMultiple → sum-product graph traversal)');

  const db = getDb();

  const projects = db.prepare(`
    SELECT
      session_slug,
      COUNT(*) as chunk_count
    FROM chunks
    GROUP BY session_slug
    HAVING chunk_count >= 20
    ORDER BY chunk_count DESC
  `).all() as Array<{session_slug: string, chunk_count: number}>;

  const projectMap = new Map<string, number>();
  for (const p of projects) {
    const parts = p.session_slug.split('/');
    const projectName = parts[parts.length - 1] || p.session_slug;
    projectMap.set(projectName, (projectMap.get(projectName) || 0) + p.chunk_count);
  }

  const topProjects = [...projectMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name]) => name);

  console.log('\nProjects to analyze:', topProjects.length);
  console.log('Generic queries:', GENERIC_QUERIES.length);
  console.log();

  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));

  const results: ProjectResult[] = [];

  for (const project of topProjects) {
    process.stdout.write(`\nAnalyzing: ${project.slice(0, 40).padEnd(42)}... `);

    const projectQueries = await extractProjectQueries(project, 5);
    const allQueries = [...GENERIC_QUERIES, ...projectQueries];

    const result = await analyzeProject(embedder, project, allQueries);
    results.push(result);

    console.log(`${result.augmentationRatio.toFixed(2)}x (${result.queryCount} queries, avg chain: ${result.avgChainLength.toFixed(1)})`);
  }

  // Print detailed results
  console.log('\n' + '='.repeat(120));
  console.log('RESULTS BY PROJECT');
  console.log('='.repeat(120));

  console.log('\nProject'.padEnd(45) + ' | Sessions | Chunks | Queries | Vector | +Chain | Augment | Avg Chain | % w/ Chain');
  console.log('-'.repeat(120));

  for (const r of results) {
    const chainPct = r.queryCount > 0 ? (r.queriesProducingChains / r.queryCount * 100) : 0;
    console.log(
      r.project.slice(0, 43).padEnd(45) + ' | ' +
      String(r.sessionCount).padStart(8) + ' | ' +
      String(r.chunkCount).padStart(6) + ' | ' +
      String(r.queryCount).padStart(7) + ' | ' +
      r.avgVectorResults.toFixed(1).padStart(6) + ' | ' +
      ('+' + r.avgChainAdditions.toFixed(1)).padStart(6) + ' | ' +
      (r.augmentationRatio.toFixed(2) + 'x').padStart(7) + ' | ' +
      r.avgChainLength.toFixed(1).padStart(9) + ' | ' +
      (chainPct.toFixed(0) + '%').padStart(9)
    );
  }

  // Aggregate statistics
  console.log('\n' + '='.repeat(120));
  console.log('AGGREGATE STATISTICS');
  console.log('='.repeat(120));

  const totalSessions = results.reduce((s, r) => s + r.sessionCount, 0);
  const totalChunks = results.reduce((s, r) => s + r.chunkCount, 0);
  const totalQueries = results.reduce((s, r) => s + r.queryCount, 0);
  const totalQueriesWithChains = results.reduce((s, r) => s + r.queriesProducingChains, 0);

  const weightedAugmentation = results.reduce((s, r) => s + r.augmentationRatio * r.queryCount, 0) / totalQueries;
  const simpleAvgAugmentation = results.reduce((s, r) => s + r.augmentationRatio, 0) / results.length;

  const minAug = Math.min(...results.map(r => r.augmentationRatio));
  const maxAug = Math.max(...results.map(r => r.augmentationRatio));

  const avgChainLength = results.reduce((s, r) => s + r.avgChainLength, 0) / results.length;

  console.log('\nDataset:');
  console.log(`  Projects analyzed:     ${results.length}`);
  console.log(`  Total sessions:        ${totalSessions}`);
  console.log(`  Total chunks:          ${totalChunks}`);
  console.log(`  Total queries:         ${totalQueries}`);

  console.log('\nChain Walking Augmentation (v0.3):');
  console.log(`  Weighted average:      ${weightedAugmentation.toFixed(2)}x`);
  console.log(`  Simple average:        ${simpleAvgAugmentation.toFixed(2)}x`);
  console.log(`  Range:                 ${minAug.toFixed(2)}x - ${maxAug.toFixed(2)}x`);

  const augmentations = results.map(r => r.augmentationRatio).sort((a, b) => a - b);
  const median = augmentations[Math.floor(augmentations.length / 2)];
  const q1 = augmentations[Math.floor(augmentations.length * 0.25)];
  const q3 = augmentations[Math.floor(augmentations.length * 0.75)];

  console.log(`  Median:                ${median.toFixed(2)}x`);
  console.log(`  IQR:                   ${q1.toFixed(2)}x - ${q3.toFixed(2)}x`);

  console.log('\nChain-Specific Metrics:');
  console.log(`  Mean chain length:     ${avgChainLength.toFixed(1)} chunks`);
  console.log(`  Queries producing chains: ${totalQueriesWithChains}/${totalQueries} (${(totalQueriesWithChains / totalQueries * 100).toFixed(0)}%)`);

  console.log('\nComparison to v0.2 (sum-product traversal, m×n edges):');
  console.log(`  v0.2 weighted average: 4.65x (492 queries, 25 projects)`);
  console.log(`  v0.3 weighted average: ${weightedAugmentation.toFixed(2)}x (${totalQueries} queries, ${results.length} projects)`);

  console.log('\n' + '='.repeat(120));
  console.log('CONCLUSION');
  console.log('='.repeat(120));
  console.log(`\nAcross ${results.length} independent projects and ${totalQueries} queries:`);
  console.log(`Chain walking provides ${weightedAugmentation.toFixed(2)}× augmentation vs vector search alone.`);
  console.log(`${(totalQueriesWithChains / totalQueries * 100).toFixed(0)}% of queries produce episodic chains (avg ${avgChainLength.toFixed(1)} chunks).`);

  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
