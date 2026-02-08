/**
 * Graph traversal experiment for the 4-20 hop range.
 *
 * This is the "sweet spot" for graph-based retrieval:
 * - 0-3 hops: Claude already has in context
 * - 4-20 hops: Graph traversal with decay
 * - 20+ hops: Vector similarity search (not graph)
 *
 * Also runs forward analysis: how does relevance decay into the future?
 */

import { getDb } from '../../../storage/db.js';
import { deserialize, hopCount, type VectorClock } from '../../../temporal/vector-clock.js';
import { getReferenceClock } from '../../../storage/clock-store.js';

const MIN_HOP = 4;   // Beyond Claude's context
const MAX_HOP = 20;  // Graph traversal limit
const NEGATIVE_SAMPLE_COUNT = 10;
const WPH_VALUES = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
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

function calculatePathWeight(hops: number, wph: number): number {
  const weight = Math.pow(wph, hops);
  return weight >= MIN_PATH_WEIGHT ? weight : 0;
}

const db = getDb();

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

// Group chunks by project
const projectChunks = new Map<string, ChunkRow[]>();
for (const chunk of chunks.values()) {
  const existing = projectChunks.get(chunk.sessionSlug) ?? [];
  existing.push(chunk);
  projectChunks.set(chunk.sessionSlug, existing);
}

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

// ============================================================
// BACKWARD ANALYSIS (4-20 hops)
// ============================================================

console.log('='.repeat(100));
console.log('BACKWARD ANALYSIS: Graph Traversal for 4-20 Hop Range');
console.log('='.repeat(100));

const backwardEdges = db.prepare(`
  SELECT source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
         vector_clock as vectorClock, reference_type as referenceType
  FROM edges
  WHERE edge_type = 'backward' AND vector_clock IS NOT NULL
    AND reference_type IN ('file-path', 'code-entity', 'explicit-backref', 'error-fragment')
`).all() as EdgeRow[];

// Annotate and filter to 4-20 hop range
interface AnnotatedEdge extends EdgeRow {
  hops: number;
  projectSlug: string;
}

const backwardInRange: AnnotatedEdge[] = [];
for (const edge of backwardEdges) {
  const sourceChunk = chunks.get(edge.sourceChunkId);
  if (!sourceChunk?.vectorClock) continue;

  const edgeClock = deserialize(edge.vectorClock);
  const refClock = getRefClock(sourceChunk.sessionSlug);
  const hops = hopCount(edgeClock, refClock);

  if (hops >= MIN_HOP && hops <= MAX_HOP) {
    backwardInRange.push({ ...edge, hops, projectSlug: sourceChunk.sessionSlug });
  }
}

console.log(`\nEdges in 4-20 hop range: ${backwardInRange.length}`);

// Hop distribution
const backwardHopDist: Record<string, number> = {};
for (const edge of backwardInRange) {
  const bin = `${Math.floor(edge.hops / 5) * 5}-${Math.floor(edge.hops / 5) * 5 + 4}`;
  backwardHopDist[bin] = (backwardHopDist[bin] ?? 0) + 1;
}
console.log('\nHop distribution:');
for (const [bin, count] of Object.entries(backwardHopDist).sort()) {
  console.log(`  ${bin}: ${count} (${(count / backwardInRange.length * 100).toFixed(1)}%)`);
}

// Group by source
const backwardBySource = new Map<string, AnnotatedEdge[]>();
for (const edge of backwardInRange) {
  const existing = backwardBySource.get(edge.sourceChunkId) ?? [];
  existing.push(edge);
  backwardBySource.set(edge.sourceChunkId, existing);
}

// Run experiment
console.log('\nPath weight = wph^hops\n');
console.log('wph   | MRR    | Reach% | 4-9    | 10-14  | 15-20  | Rank@1 | n');
console.log('-'.repeat(75));

interface Result {
  wph: number;
  mrr: number;
  reachPct: number;
  mrrByBin: Record<string, number>;
  rank1: number;
  n: number;
}

const backwardResults: Result[] = [];

for (const wph of WPH_VALUES) {
  let totalRR = 0;
  let rank1 = 0;
  let queries = 0;
  let reachable = 0;
  const rrByBin: Record<string, number[]> = { '4-9': [], '10-14': [], '15-20': [] };

  for (const [sourceChunkId, edges] of backwardBySource) {
    const sourceChunk = chunks.get(sourceChunkId)!;
    const refClock = getRefClock(sourceChunk.sessionSlug);

    const positives = edges.map(e => ({
      chunkId: e.targetChunkId,
      hops: e.hops,
      pathWeight: calculatePathWeight(e.hops, wph),
    }));

    const anyReachable = positives.some(p => p.pathWeight > 0);
    if (anyReachable) reachable++;

    const excludeIds = new Set([sourceChunkId, ...positives.map(p => p.chunkId)]);
    const negChunks = sampleNegatives(sourceChunk.sessionSlug, excludeIds, NEGATIVE_SAMPLE_COUNT);
    if (negChunks.length === 0) continue;

    const negatives = negChunks.filter(c => c.vectorClock).map(c => {
      const clock = deserialize(c.vectorClock!);
      const hops = hopCount(clock, refClock);
      return { chunkId: c.id, hops, pathWeight: calculatePathWeight(hops, wph) };
    });

    const candidates = [
      ...positives.map(p => ({ ...p, isPositive: true })),
      ...negatives.map(n => ({ ...n, isPositive: false })),
    ];
    candidates.sort((a, b) => b.pathWeight - a.pathWeight);

    let firstPosRank = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].isPositive) { firstPosRank = i + 1; break; }
    }

    const rr = firstPosRank > 0 ? 1 / firstPosRank : 0;
    totalRR += rr;
    if (firstPosRank === 1) rank1++;
    queries++;

    const minHop = Math.min(...positives.map(p => p.hops));
    const bin = minHop < 10 ? '4-9' : minHop < 15 ? '10-14' : '15-20';
    rrByBin[bin].push(rr);
  }

  const mrr = queries > 0 ? totalRR / queries : 0;
  const mrrByBin: Record<string, number> = {};
  for (const bin of ['4-9', '10-14', '15-20']) {
    mrrByBin[bin] = rrByBin[bin].length > 0
      ? rrByBin[bin].reduce((a, b) => a + b, 0) / rrByBin[bin].length : 0;
  }

  backwardResults.push({ wph, mrr, reachPct: reachable / queries * 100, mrrByBin, rank1, n: queries });

  console.log([
    wph.toFixed(2),
    mrr.toFixed(3).padStart(6),
    `${(reachable / queries * 100).toFixed(0)}%`.padStart(6),
    mrrByBin['4-9'].toFixed(3).padStart(6),
    mrrByBin['10-14'].toFixed(3).padStart(6),
    mrrByBin['15-20'].toFixed(3).padStart(6),
    rank1.toString().padStart(6),
    queries.toString().padStart(5),
  ].join(' | '));
}

// ============================================================
// FORWARD ANALYSIS
// ============================================================

console.log('\n' + '='.repeat(100));
console.log('FORWARD ANALYSIS: Predicting Future References');
console.log('='.repeat(100));
console.log('\nQuestion: Given a chunk, which future chunks (1-20 hops ahead) will reference it?');

const forwardEdges = db.prepare(`
  SELECT source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
         vector_clock as vectorClock, reference_type as referenceType
  FROM edges
  WHERE edge_type = 'forward' AND vector_clock IS NOT NULL
    AND reference_type IN ('file-path', 'code-entity', 'explicit-backref', 'error-fragment')
`).all() as EdgeRow[];

// For forward: source is earlier, target is later (target references source)
// We want to measure: how far ahead is the target from the source?

interface ForwardAnnotatedEdge extends EdgeRow {
  forwardHops: number;  // How many hops ahead the referencing chunk is
  projectSlug: string;
}

const forwardInRange: ForwardAnnotatedEdge[] = [];
for (const edge of forwardEdges) {
  const sourceChunk = chunks.get(edge.sourceChunkId);
  const targetChunk = chunks.get(edge.targetChunkId);
  if (!sourceChunk?.vectorClock || !targetChunk?.vectorClock) continue;

  const sourceClock = deserialize(sourceChunk.vectorClock);
  const targetClock = deserialize(targetChunk.vectorClock);

  // Forward hops: how far ahead is target from source
  // This is the opposite direction of backward hops
  const forwardHops = hopCount(sourceClock, targetClock);

  if (forwardHops >= 1 && forwardHops <= MAX_HOP) {
    forwardInRange.push({ ...edge, forwardHops, projectSlug: sourceChunk.sessionSlug });
  }
}

console.log(`\nForward edges in 1-20 hop range: ${forwardInRange.length}`);

// Hop distribution
const forwardHopDist: Record<string, number> = {};
for (const edge of forwardInRange) {
  const bin = edge.forwardHops <= 3 ? '1-3' :
              edge.forwardHops <= 7 ? '4-7' :
              edge.forwardHops <= 12 ? '8-12' : '13-20';
  forwardHopDist[bin] = (forwardHopDist[bin] ?? 0) + 1;
}
console.log('\nForward hop distribution (how far ahead is the referencing chunk):');
for (const [bin, count] of Object.entries(forwardHopDist)) {
  console.log(`  ${bin} hops ahead: ${count} (${(count / forwardInRange.length * 100).toFixed(1)}%)`);
}

// Group by source (the chunk being referenced)
const forwardBySource = new Map<string, ForwardAnnotatedEdge[]>();
for (const edge of forwardInRange) {
  const existing = forwardBySource.get(edge.sourceChunkId) ?? [];
  existing.push(edge);
  forwardBySource.set(edge.sourceChunkId, existing);
}

// Run forward experiment
console.log('\nForward decay: predicting which future chunks reference this one');
console.log('Path weight = wph^forwardHops (decay into the future)\n');
console.log('wph   | MRR    | Reach% | 1-3    | 4-7    | 8-12   | 13-20  | Rank@1 | n');
console.log('-'.repeat(80));

const forwardResults: Result[] = [];

for (const wph of WPH_VALUES) {
  let totalRR = 0;
  let rank1 = 0;
  let queries = 0;
  let reachable = 0;
  const rrByBin: Record<string, number[]> = { '1-3': [], '4-7': [], '8-12': [], '13-20': [] };

  for (const [sourceChunkId, edges] of forwardBySource) {
    const sourceChunk = chunks.get(sourceChunkId)!;
    const sourceClock = deserialize(sourceChunk.vectorClock!);

    // Positives are the target chunks that reference this source
    const positives = edges.map(e => ({
      chunkId: e.targetChunkId,
      forwardHops: e.forwardHops,
      pathWeight: calculatePathWeight(e.forwardHops, wph),
    }));

    const anyReachable = positives.some(p => p.pathWeight > 0);
    if (anyReachable) reachable++;

    // Sample negatives from same project
    const excludeIds = new Set([sourceChunkId, ...positives.map(p => p.chunkId)]);
    const negChunks = sampleNegatives(sourceChunk.sessionSlug, excludeIds, NEGATIVE_SAMPLE_COUNT);
    if (negChunks.length === 0) continue;

    // Calculate forward hops for negatives
    const negatives = negChunks.filter(c => c.vectorClock).map(c => {
      const negClock = deserialize(c.vectorClock!);
      const forwardHops = hopCount(sourceClock, negClock);
      return {
        chunkId: c.id,
        forwardHops,
        pathWeight: calculatePathWeight(Math.abs(forwardHops), wph),
      };
    });

    const candidates = [
      ...positives.map(p => ({ ...p, isPositive: true })),
      ...negatives.map(n => ({ ...n, isPositive: false })),
    ];
    candidates.sort((a, b) => b.pathWeight - a.pathWeight);

    let firstPosRank = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].isPositive) { firstPosRank = i + 1; break; }
    }

    const rr = firstPosRank > 0 ? 1 / firstPosRank : 0;
    totalRR += rr;
    if (firstPosRank === 1) rank1++;
    queries++;

    const minHop = Math.min(...positives.map(p => p.forwardHops));
    const bin = minHop <= 3 ? '1-3' : minHop <= 7 ? '4-7' : minHop <= 12 ? '8-12' : '13-20';
    rrByBin[bin].push(rr);
  }

  const mrr = queries > 0 ? totalRR / queries : 0;
  const mrrByBin: Record<string, number> = {};
  for (const bin of ['1-3', '4-7', '8-12', '13-20']) {
    mrrByBin[bin] = rrByBin[bin].length > 0
      ? rrByBin[bin].reduce((a, b) => a + b, 0) / rrByBin[bin].length : 0;
  }

  forwardResults.push({ wph, mrr, reachPct: reachable / queries * 100, mrrByBin, rank1, n: queries });

  console.log([
    wph.toFixed(2),
    mrr.toFixed(3).padStart(6),
    `${(reachable / queries * 100).toFixed(0)}%`.padStart(6),
    mrrByBin['1-3'].toFixed(3).padStart(6),
    mrrByBin['4-7'].toFixed(3).padStart(6),
    mrrByBin['8-12'].toFixed(3).padStart(6),
    mrrByBin['13-20'].toFixed(3).padStart(6),
    rank1.toString().padStart(6),
    queries.toString().padStart(5),
  ].join(' | '));
}

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '='.repeat(100));
console.log('SUMMARY');
console.log('='.repeat(100));

const bestBackward = backwardResults.reduce((a, b) => a.mrr > b.mrr ? a : b);
const bestForward = forwardResults.reduce((a, b) => a.mrr > b.mrr ? a : b);

console.log('\nBACKWARD (4-20 hops, retrieval):');
console.log(`  Best: wph=${bestBackward.wph} (MRR=${bestBackward.mrr.toFixed(3)}, ${bestBackward.reachPct.toFixed(0)}% reachable)`);

console.log('\nFORWARD (1-20 hops, prediction):');
console.log(`  Best: wph=${bestForward.wph} (MRR=${bestForward.mrr.toFixed(3)}, ${bestForward.reachPct.toFixed(0)}% reachable)`);

// Check if different curves are optimal
if (bestBackward.wph !== bestForward.wph) {
  console.log('\n  → Different optimal decay rates for backward vs forward!');
  console.log(`    Backward: ${bestBackward.wph}, Forward: ${bestForward.wph}`);
}
