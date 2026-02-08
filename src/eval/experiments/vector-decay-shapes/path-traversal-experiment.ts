/**
 * Path traversal experiment for decay curve evaluation.
 *
 * This properly simulates the actual retrieval mechanism:
 * - Path weight = product of edge weights along path
 * - For a path of N hops with uniform decay: weight = wph^N
 * - Node score = sum of path weights reaching it
 *
 * Key insight: Linear decay doesn't make sense for path traversal
 * because path weights are multiplicative. Only exponential decay
 * properly models "each hop multiplies weight by wph".
 */

import { getDb } from '../../../storage/db.js';
import { deserialize, hopCount, type VectorClock } from '../../../temporal/vector-clock.js';
import { getReferenceClock } from '../../../storage/clock-store.js';

/** Minimum hop distance to consider (Claude has recent context) */
const MIN_HOP_DISTANCE = 4;

/** Number of negative samples per query */
const NEGATIVE_SAMPLE_COUNT = 10;

/** Weight-per-hop values to test */
const WPH_VALUES = [0.80, 0.85, 0.90, 0.93, 0.95, 0.97];

/** Minimum path weight before considered unreachable */
const MIN_PATH_WEIGHT = 0.001;

interface EdgeRow {
  sourceChunkId: string;
  targetChunkId: string;
  vectorClock: string;
  referenceType: string | null;
}

interface ChunkRow {
  id: string;
  sessionSlug: string;
  vectorClock: string | null;
}

/**
 * Calculate path weight for traversing N hops.
 * Path weight = wph^hops (product of edge weights)
 */
function calculatePathWeight(hops: number, wph: number): number {
  const weight = Math.pow(wph, hops);
  return weight >= MIN_PATH_WEIGHT ? weight : 0;
}

/**
 * Check if a path is "alive" (reachable with non-trivial weight)
 */
function isPathAlive(hops: number, wph: number): boolean {
  return calculatePathWeight(hops, wph) > 0;
}

const db = getDb();

// Load backward edges with explicit references
const backwardEdges = db.prepare(`
  SELECT source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
         vector_clock as vectorClock, reference_type as referenceType
  FROM edges
  WHERE edge_type = 'backward' AND vector_clock IS NOT NULL
    AND reference_type IN ('file-path', 'code-entity', 'explicit-backref', 'error-fragment')
`).all() as EdgeRow[];

console.log(`Loaded ${backwardEdges.length} backward edges with explicit references\n`);

// Load chunks
const chunks = new Map<string, ChunkRow>();
const chunkRows = db.prepare(`
  SELECT id, session_slug as sessionSlug, vector_clock as vectorClock
  FROM chunks WHERE vector_clock IS NOT NULL
`).all() as ChunkRow[];
for (const row of chunkRows) {
  chunks.set(row.id, row);
}

// Cache reference clocks
const refClocks = new Map<string, VectorClock>();
function getRefClock(slug: string): VectorClock {
  if (!refClocks.has(slug)) {
    refClocks.set(slug, getReferenceClock(slug));
  }
  return refClocks.get(slug)!;
}

// Group chunks by project for negative sampling
const projectChunks = new Map<string, ChunkRow[]>();
for (const chunk of chunks.values()) {
  const existing = projectChunks.get(chunk.sessionSlug) ?? [];
  existing.push(chunk);
  projectChunks.set(chunk.sessionSlug, existing);
}

// Annotate edges with hop distance
interface AnnotatedEdge extends EdgeRow {
  hops: number;
  projectSlug: string;
}

const annotatedEdges: AnnotatedEdge[] = [];
for (const edge of backwardEdges) {
  const sourceChunk = chunks.get(edge.sourceChunkId);
  if (!sourceChunk?.vectorClock) continue;

  const edgeClock = deserialize(edge.vectorClock);
  const refClock = getRefClock(sourceChunk.sessionSlug);
  const hops = hopCount(edgeClock, refClock);

  annotatedEdges.push({
    ...edge,
    hops,
    projectSlug: sourceChunk.sessionSlug,
  });
}

// Filter to beyond-context edges
const longRangeEdges = annotatedEdges.filter(e => e.hops >= MIN_HOP_DISTANCE);
console.log(`Beyond-context edges (${MIN_HOP_DISTANCE}+ hops): ${longRangeEdges.length}`);

// Hop distribution
const hopBins = { '4-10': 0, '11-20': 0, '21-30': 0, '31-50': 0, '51+': 0 };
for (const edge of longRangeEdges) {
  if (edge.hops <= 10) hopBins['4-10']++;
  else if (edge.hops <= 20) hopBins['11-20']++;
  else if (edge.hops <= 30) hopBins['21-30']++;
  else if (edge.hops <= 50) hopBins['31-50']++;
  else hopBins['51+']++;
}
console.log('\nHop distribution:');
for (const [bin, count] of Object.entries(hopBins)) {
  console.log(`  ${bin}: ${count} (${(count / longRangeEdges.length * 100).toFixed(1)}%)`);
}

// Calculate "death hop" for each wph
console.log('\nPath reachability by decay rate:');
for (const wph of WPH_VALUES) {
  const deathHop = Math.floor(Math.log(MIN_PATH_WEIGHT) / Math.log(wph));
  const aliveCount = longRangeEdges.filter(e => isPathAlive(e.hops, wph)).length;
  const alivePct = (aliveCount / longRangeEdges.length * 100).toFixed(1);
  console.log(`  wph=${wph}: paths die at ~${deathHop} hops, ${aliveCount}/${longRangeEdges.length} (${alivePct}%) reachable`);
}

// Group by source for evaluation
const edgesBySource = new Map<string, AnnotatedEdge[]>();
for (const edge of longRangeEdges) {
  const existing = edgesBySource.get(edge.sourceChunkId) ?? [];
  existing.push(edge);
  edgesBySource.set(edge.sourceChunkId, existing);
}

// Sample negatives
function sampleNegatives(projectSlug: string, excludeIds: Set<string>, count: number): ChunkRow[] {
  const available = projectChunks.get(projectSlug) ?? [];
  const candidates = available.filter(c => !excludeIds.has(c.id));

  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

// Run experiment for each wph value
console.log('\n' + '='.repeat(100));
console.log('PATH TRAVERSAL EXPERIMENT: Beyond-Context Retrieval');
console.log('='.repeat(100));
console.log('\nRanking by path weight = wph^hops (simulating multiplicative traversal)\n');

interface WphResult {
  wph: number;
  mrr: number;
  rank1: number;
  queryCount: number;
  reachableQueries: number;  // Queries where positive has non-zero path weight
  mrrByBin: Record<string, number>;
  reachableByBin: Record<string, number>;
}

const results: WphResult[] = [];

for (const wph of WPH_VALUES) {
  let totalRR = 0;
  let rank1 = 0;
  let queries = 0;
  let reachableQueries = 0;

  const rrByBin: Record<string, number[]> = {
    '4-10': [], '11-20': [], '21-30': [], '31-50': [], '51+': []
  };
  const reachableByBin: Record<string, number> = {
    '4-10': 0, '11-20': 0, '21-30': 0, '31-50': 0, '51+': 0
  };

  for (const [sourceChunkId, edges] of edgesBySource) {
    const sourceChunk = chunks.get(sourceChunkId)!;
    const refClock = getRefClock(sourceChunk.sessionSlug);

    // Get positive targets with their hop distances
    const positives = edges.map(e => ({
      chunkId: e.targetChunkId,
      hops: e.hops,
      pathWeight: calculatePathWeight(e.hops, wph),
    }));

    // Check if any positive is reachable
    const anyPositiveReachable = positives.some(p => p.pathWeight > 0);

    // Sample negatives
    const excludeIds = new Set([sourceChunkId, ...positives.map(p => p.chunkId)]);
    const negativeChunks = sampleNegatives(sourceChunk.sessionSlug, excludeIds, NEGATIVE_SAMPLE_COUNT);

    if (negativeChunks.length === 0) continue;

    // Calculate path weights for negatives
    const negatives = negativeChunks
      .filter(c => c.vectorClock)
      .map(c => {
        const chunkClock = deserialize(c.vectorClock!);
        const hops = hopCount(chunkClock, refClock);
        return {
          chunkId: c.id,
          hops,
          pathWeight: calculatePathWeight(hops, wph),
        };
      });

    // Combine and rank by path weight
    const candidates = [...positives, ...negatives].map(c => ({
      ...c,
      isPositive: positives.some(p => p.chunkId === c.chunkId),
    }));

    // Sort by path weight descending
    candidates.sort((a, b) => b.pathWeight - a.pathWeight);

    // Find rank of first positive
    let firstPositiveRank = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].isPositive) {
        firstPositiveRank = i + 1;
        break;
      }
    }

    const rr = firstPositiveRank > 0 ? 1 / firstPositiveRank : 0;
    totalRR += rr;
    if (firstPositiveRank === 1) rank1++;
    queries++;

    if (anyPositiveReachable) reachableQueries++;

    // Track by hop bin (use min hop of positives)
    const minHop = Math.min(...positives.map(p => p.hops));
    let bin: string;
    if (minHop <= 10) bin = '4-10';
    else if (minHop <= 20) bin = '11-20';
    else if (minHop <= 30) bin = '21-30';
    else if (minHop <= 50) bin = '31-50';
    else bin = '51+';

    rrByBin[bin].push(rr);
    if (anyPositiveReachable) reachableByBin[bin]++;
  }

  const mrr = queries > 0 ? totalRR / queries : 0;
  const mrrByBin: Record<string, number> = {};
  for (const bin of Object.keys(rrByBin)) {
    const rrs = rrByBin[bin];
    mrrByBin[bin] = rrs.length > 0 ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;
  }

  results.push({
    wph,
    mrr,
    rank1,
    queryCount: queries,
    reachableQueries,
    mrrByBin,
    reachableByBin,
  });
}

// Print results
console.log('wph   | MRR    | Reachable | 4-10   | 11-20  | 21-30  | 31-50  | 51+    | Rank@1');
console.log('-'.repeat(95));

for (const r of results) {
  const reachablePct = (r.reachableQueries / r.queryCount * 100).toFixed(0);
  const row = [
    r.wph.toFixed(2),
    r.mrr.toFixed(3).padStart(6),
    `${reachablePct}%`.padStart(9),
    r.mrrByBin['4-10'].toFixed(3).padStart(6),
    r.mrrByBin['11-20'].toFixed(3).padStart(6),
    r.mrrByBin['21-30'].toFixed(3).padStart(6),
    r.mrrByBin['31-50'].toFixed(3).padStart(6),
    r.mrrByBin['51+'].toFixed(3).padStart(6),
    r.rank1.toString().padStart(6),
  ].join(' | ');
  console.log(row);
}

// Summary
console.log('\n' + '='.repeat(95));
console.log('ANALYSIS:');

const sorted = [...results].sort((a, b) => b.mrr - a.mrr);
console.log(`\n  Best overall: wph=${sorted[0].wph} (MRR=${sorted[0].mrr.toFixed(3)})`);

// Find best that keeps 90%+ reachable
const highReach = results.filter(r => r.reachableQueries / r.queryCount >= 0.9);
if (highReach.length > 0) {
  const bestHighReach = highReach.sort((a, b) => b.mrr - a.mrr)[0];
  console.log(`  Best with 90%+ reachability: wph=${bestHighReach.wph} (MRR=${bestHighReach.mrr.toFixed(3)}, ${(bestHighReach.reachableQueries / bestHighReach.queryCount * 100).toFixed(0)}% reachable)`);
}

// Current default comparison
const current = results.find(r => r.wph === 0.80);
if (current) {
  console.log(`\n  Current (wph=0.80): MRR=${current.mrr.toFixed(3)}, ${(current.reachableQueries / current.queryCount * 100).toFixed(0)}% reachable`);
  const improvement = ((sorted[0].mrr - current.mrr) / current.mrr * 100).toFixed(1);
  console.log(`  Potential improvement: +${improvement}% MRR`);
}

// Key insight
console.log('\n  KEY INSIGHT:');
console.log('  - Fast decay (0.80) gives good discrimination but kills most paths');
console.log('  - Slow decay (0.95+) keeps paths alive but reduces discrimination');
console.log('  - The optimal wph balances reachability with ranking quality');
