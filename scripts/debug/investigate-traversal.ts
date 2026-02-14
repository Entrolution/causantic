/**
 * Thorough investigation of graph traversal contribution.
 */

import { vectorStore } from '../src/storage/vector-store.js';
import { getChunkById } from '../src/storage/chunk-store.js';
import { getOutgoingEdges } from '../src/storage/edge-store.js';
import { Embedder } from '../src/models/embedder.js';
import { getModel } from '../src/models/model-registry.js';
import { traverseMultiple } from '../src/retrieval/traverser.js';
import { getDb, closeDb } from '../src/storage/db.js';

const TEST_QUERIES = [
  'vector clock decay curves',
  'HDBSCAN clustering algorithm',
  'file path reference parsing',
  'sub-agent brief debrief edges',
  'semantic embedding retrieval',
  'MCP server implementation',
  'TypeScript error handling',
  'database schema migration',
  'git commit workflow',
  'API authentication tokens',
];

interface QueryResult {
  query: string;
  vectorCount: number;
  backwardAdded: number;
  forwardAdded: number;
  avgBackwardEdgesPerChunk: number;
  avgForwardEdgesPerChunk: number;
  chunksWithBackEdges: number;
  chunksWithFwdEdges: number;
}

async function analyzeQuery(embedder: Embedder, query: string): Promise<QueryResult> {
  const { embedding } = await embedder.embed(query, true);
  const vectorResults = await vectorStore.search(embedding, 10);
  
  const vectorChunkIds = new Set(vectorResults.map(r => r.id));
  
  // Analyze edge density on vector results
  let totalBackEdges = 0;
  let totalFwdEdges = 0;
  let chunksWithBack = 0;
  let chunksWithFwd = 0;

  for (const r of vectorResults) {
    const _chunk = getChunkById(r.id);
    const backEdges = getOutgoingEdges(r.id, 'backward');
    const fwdEdges = getOutgoingEdges(r.id, 'forward');
    
    totalBackEdges += backEdges.length;
    totalFwdEdges += fwdEdges.length;
    if (backEdges.length > 0) chunksWithBack++;
    if (fwdEdges.length > 0) chunksWithFwd++;
  }
  
  const startIds = vectorResults.map(r => r.id);

  // Traverse (uses config defaults: maxDepth=50, minWeight=0.01)
  const backwardResult = traverseMultiple(startIds, {
    direction: 'backward',
  });

  const forwardResult = traverseMultiple(startIds, {
    direction: 'forward',
  });
  
  const backwardAdded = backwardResult.chunks.filter(c => !vectorChunkIds.has(c.chunkId)).length;
  const forwardAdded = forwardResult.chunks.filter(c => !vectorChunkIds.has(c.chunkId)).length;
  
  return {
    query,
    vectorCount: vectorResults.length,
    backwardAdded,
    forwardAdded,
    avgBackwardEdgesPerChunk: totalBackEdges / vectorResults.length,
    avgForwardEdgesPerChunk: totalFwdEdges / vectorResults.length,
    chunksWithBackEdges: chunksWithBack,
    chunksWithFwdEdges: chunksWithFwd,
  };
}

async function globalEdgeAnalysis() {
  const db = getDb();
  
  console.log('\n' + '='.repeat(80));
  console.log('GLOBAL EDGE ANALYSIS');
  console.log('='.repeat(80));
  
  // Edge counts
  const edgeCounts = db.prepare(`
    SELECT edge_type, COUNT(*) as count FROM edges GROUP BY edge_type
  `).all() as Array<{edge_type: string, count: number}>;
  
  console.log('\nEdge counts:');
  for (const e of edgeCounts) {
    console.log('  ' + e.edge_type + ': ' + e.count);
  }
  
  // Chunks with edges
  const chunkEdgeDist = db.prepare(`
    SELECT 
      back_count,
      COUNT(*) as chunks
    FROM (
      SELECT 
        c.id,
        (SELECT COUNT(*) FROM edges WHERE source_chunk_id = c.id AND edge_type = 'backward') as back_count
      FROM chunks c
    )
    GROUP BY back_count
    ORDER BY back_count
    LIMIT 10
  `).all() as Array<{back_count: number, chunks: number}>;
  
  console.log('\nBackward edge distribution (edges per chunk):');
  for (const d of chunkEdgeDist) {
    console.log('  ' + d.back_count + ' edges: ' + d.chunks + ' chunks');
  }
  
  // Reference type distribution
  const refTypes = db.prepare(`
    SELECT reference_type, COUNT(*) as count 
    FROM edges 
    WHERE reference_type IS NOT NULL
    GROUP BY reference_type
    ORDER BY count DESC
  `).all() as Array<{reference_type: string, count: number}>;
  
  console.log('\nEdge reference types:');
  for (const r of refTypes) {
    console.log('  ' + r.reference_type + ': ' + r.count);
  }
  
}

async function main() {
  console.log('='.repeat(80));
  console.log('GRAPH TRAVERSAL INVESTIGATION');
  console.log('='.repeat(80));
  
  const embedder = new Embedder();
  await embedder.load(getModel('jina-small'));
  
  console.log('\nRunning ' + TEST_QUERIES.length + ' test queries...\n');
  
  const results: QueryResult[] = [];
  
  for (const query of TEST_QUERIES) {
    process.stdout.write('Testing: ' + query.slice(0, 40) + '... ');
    const result = await analyzeQuery(embedder, query);
    results.push(result);
    console.log('done');
  }
  
  // Print results table
  console.log('\n' + '='.repeat(80));
  console.log('QUERY RESULTS');
  console.log('='.repeat(80));
  console.log('\nQuery                              | Vec | +Back | +Fwd | Back/Ch | Fwd/Ch');
  console.log('-'.repeat(80));
  
  for (const r of results) {
    const queryShort = r.query.slice(0, 34).padEnd(34);
    console.log(
      queryShort + ' | ' +
      String(r.vectorCount).padStart(3) + ' | ' +
      String(r.backwardAdded).padStart(5) + ' | ' +
      String(r.forwardAdded).padStart(4) + ' | ' +
      r.avgBackwardEdgesPerChunk.toFixed(1).padStart(7) + ' | ' +
      r.avgForwardEdgesPerChunk.toFixed(1).padStart(6)
    );
  }
  
  // Summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));
  
  const totalBackward = results.reduce((s, r) => s + r.backwardAdded, 0);
  const totalForward = results.reduce((s, r) => s + r.forwardAdded, 0);
  const totalVector = results.reduce((s, r) => s + r.vectorCount, 0);
  const avgBackEdges = results.reduce((s, r) => s + r.avgBackwardEdgesPerChunk, 0) / results.length;
  const avgFwdEdges = results.reduce((s, r) => s + r.avgForwardEdgesPerChunk, 0) / results.length;
  const queriesWithBackward = results.filter(r => r.backwardAdded > 0).length;
  const queriesWithForward = results.filter(r => r.forwardAdded > 0).length;
  
  console.log('\nAcross ' + results.length + ' queries:');
  console.log('  Total chunks from vector search: ' + totalVector);
  console.log('  Total chunks from backward:      ' + totalBackward + ' (' + (totalBackward/totalVector*100).toFixed(1) + '% increase)');
  console.log('  Total chunks from forward:       ' + totalForward + ' (' + (totalForward/totalVector*100).toFixed(1) + '% increase)');
  console.log('  Combined graph contribution:     ' + (totalBackward + totalForward) + ' (' + ((totalBackward+totalForward)/totalVector*100).toFixed(1) + '% increase)');
  console.log('');
  console.log('  Queries with backward additions: ' + queriesWithBackward + '/' + results.length);
  console.log('  Queries with forward additions:  ' + queriesWithForward + '/' + results.length);
  console.log('');
  console.log('  Avg backward edges per chunk:    ' + avgBackEdges.toFixed(2));
  console.log('  Avg forward edges per chunk:     ' + avgFwdEdges.toFixed(2));
  
  // Global analysis
  await globalEdgeAnalysis();
  
  await embedder.dispose();
  closeDb();
}

main().catch(console.error);
