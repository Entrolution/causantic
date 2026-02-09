/**
 * Cross-project experiment to validate graph augmentation claims.
 *
 * Tests retrieval across multiple independent projects with diverse queries
 * to produce a more robust estimate of graph augmentation benefit.
 */

import { vectorStore } from '../src/storage/vector-store.js';
import { traverseMultiple } from '../src/retrieval/traverser.js';
import { getReferenceClock } from '../src/storage/clock-store.js';
import { getChunkById, getChunksBySession } from '../src/storage/chunk-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { getDb, closeDb } from '../src/storage/db.js';

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

// We'll also extract project-specific queries from chunk content
async function extractProjectQueries(projectSlug: string, limit: number = 5): Promise<string[]> {
  const db = getDb();

  // Get random chunks from this project and extract key phrases
  const chunks = db.prepare(`
    SELECT content FROM chunks
    WHERE session_slug LIKE ?
    ORDER BY RANDOM()
    LIMIT 20
  `).all(`%${projectSlug}%`) as Array<{content: string}>;

  const queries: string[] = [];

  for (const chunk of chunks) {
    // Extract file paths mentioned
    const fileMatches = chunk.content.match(/(?:src|lib|app|components?)\/[\w\-\/]+\.\w+/g);
    if (fileMatches) {
      queries.push(...fileMatches.slice(0, 2));
    }

    // Extract function/class names
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
  avgGraphAdditions: number;
  augmentationRatio: number;
  queryResults: Array<{
    query: string;
    vectorCount: number;
    graphAdditions: number;
  }>;
}

async function analyzeProject(
  embedder: Embedder,
  projectSlug: string,
  queries: string[]
): Promise<ProjectResult> {
  const db = getDb();

  // Get project stats
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT session_slug) as sessions,
      COUNT(*) as chunks
    FROM chunks
    WHERE session_slug LIKE ?
  `).get(`%${projectSlug}%`) as {sessions: number, chunks: number};

  const queryResults: ProjectResult['queryResults'] = [];
  let totalVectorResults = 0;
  let totalGraphAdditions = 0;

  for (const query of queries) {
    try {
      const { embedding } = await embedder.embed(query, true);
      const vectorResults = await vectorStore.search(embedding, 10);

      if (vectorResults.length === 0) continue;

      const vectorChunkIds = new Set(vectorResults.map(r => r.id));

      // Get reference clock
      const firstChunk = getChunkById(vectorResults[0]?.id);
      if (!firstChunk) continue;

      const referenceClock = getReferenceClock(firstChunk.sessionSlug);

      const startIds = vectorResults.map(r => r.id);
      const startWeights = vectorResults.map(r => Math.max(0, 1 - r.distance));

      // Traverse both directions
      const backwardResult = await traverseMultiple(startIds, startWeights, Date.now(), {
        direction: 'backward',
        referenceClock,
      });

      const forwardResult = await traverseMultiple(startIds, startWeights, Date.now(), {
        direction: 'forward',
        referenceClock,
      });

      const allGraphChunks = [...backwardResult.chunks, ...forwardResult.chunks];
      const graphAdditions = allGraphChunks.filter(c => !vectorChunkIds.has(c.chunkId)).length;

      queryResults.push({
        query: query.slice(0, 50),
        vectorCount: vectorResults.length,
        graphAdditions,
      });

      totalVectorResults += vectorResults.length;
      totalGraphAdditions += graphAdditions;
    } catch (e) {
      // Skip failed queries
      continue;
    }
  }

  const validQueries = queryResults.length;
  const avgVector = validQueries > 0 ? totalVectorResults / validQueries : 0;
  const avgGraph = validQueries > 0 ? totalGraphAdditions / validQueries : 0;
  const augmentation = avgVector > 0 ? (avgVector + avgGraph) / avgVector : 1;

  return {
    project: projectSlug,
    sessionCount: stats.sessions,
    chunkCount: stats.chunks,
    queryCount: validQueries,
    avgVectorResults: avgVector,
    avgGraphAdditions: avgGraph,
    augmentationRatio: augmentation,
    queryResults,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('CROSS-PROJECT GRAPH AUGMENTATION EXPERIMENT');
  console.log('='.repeat(100));

  const db = getDb();

  // Find all projects with sufficient data
  const projects = db.prepare(`
    SELECT
      session_slug,
      COUNT(*) as chunk_count
    FROM chunks
    GROUP BY session_slug
    HAVING chunk_count >= 20
    ORDER BY chunk_count DESC
  `).all() as Array<{session_slug: string, chunk_count: number}>;

  // Group by project (extract project name from session_slug)
  const projectMap = new Map<string, number>();
  for (const p of projects) {
    // Extract project identifier (e.g., "apolitical-assistant" from full slug)
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

    // Combine generic queries with project-specific ones
    const projectQueries = await extractProjectQueries(project, 5);
    const allQueries = [...GENERIC_QUERIES, ...projectQueries];

    const result = await analyzeProject(embedder, project, allQueries);
    results.push(result);

    console.log(`${result.augmentationRatio.toFixed(2)}x (${result.queryCount} queries)`);
  }

  // Print detailed results
  console.log('\n' + '='.repeat(100));
  console.log('RESULTS BY PROJECT');
  console.log('='.repeat(100));

  console.log('\nProject'.padEnd(45) + ' | Sessions | Chunks | Queries | Vector | +Graph | Augment');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      r.project.slice(0, 43).padEnd(45) + ' | ' +
      String(r.sessionCount).padStart(8) + ' | ' +
      String(r.chunkCount).padStart(6) + ' | ' +
      String(r.queryCount).padStart(7) + ' | ' +
      r.avgVectorResults.toFixed(1).padStart(6) + ' | ' +
      ('+' + r.avgGraphAdditions.toFixed(1)).padStart(6) + ' | ' +
      (r.augmentationRatio.toFixed(2) + 'x').padStart(7)
    );
  }

  // Aggregate statistics
  console.log('\n' + '='.repeat(100));
  console.log('AGGREGATE STATISTICS');
  console.log('='.repeat(100));

  const totalSessions = results.reduce((s, r) => s + r.sessionCount, 0);
  const totalChunks = results.reduce((s, r) => s + r.chunkCount, 0);
  const totalQueries = results.reduce((s, r) => s + r.queryCount, 0);

  // Weighted average by query count
  const weightedAugmentation = results.reduce((s, r) => s + r.augmentationRatio * r.queryCount, 0) / totalQueries;

  // Simple average
  const simpleAvgAugmentation = results.reduce((s, r) => s + r.augmentationRatio, 0) / results.length;

  // Min/max
  const minAug = Math.min(...results.map(r => r.augmentationRatio));
  const maxAug = Math.max(...results.map(r => r.augmentationRatio));

  console.log('\nDataset:');
  console.log(`  Projects analyzed:     ${results.length}`);
  console.log(`  Total sessions:        ${totalSessions}`);
  console.log(`  Total chunks:          ${totalChunks}`);
  console.log(`  Total queries:         ${totalQueries}`);

  console.log('\nGraph Augmentation:');
  console.log(`  Weighted average:      ${weightedAugmentation.toFixed(2)}x`);
  console.log(`  Simple average:        ${simpleAvgAugmentation.toFixed(2)}x`);
  console.log(`  Range:                 ${minAug.toFixed(2)}x - ${maxAug.toFixed(2)}x`);

  // Statistical summary
  const augmentations = results.map(r => r.augmentationRatio).sort((a, b) => a - b);
  const median = augmentations[Math.floor(augmentations.length / 2)];
  const q1 = augmentations[Math.floor(augmentations.length * 0.25)];
  const q3 = augmentations[Math.floor(augmentations.length * 0.75)];

  console.log(`  Median:                ${median.toFixed(2)}x`);
  console.log(`  IQR:                   ${q1.toFixed(2)}x - ${q3.toFixed(2)}x`);

  console.log('\n' + '='.repeat(100));
  console.log('CONCLUSION');
  console.log('='.repeat(100));
  console.log(`\nAcross ${results.length} independent projects and ${totalQueries} queries:`);
  console.log(`Graph-augmented retrieval provides ${weightedAugmentation.toFixed(2)}× the context vs semantic embedding alone.`);

  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
