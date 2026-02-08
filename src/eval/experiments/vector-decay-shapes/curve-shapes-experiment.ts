/**
 * Test different decay curve SHAPES for graph traversal range.
 *
 * Curves to test:
 * - Exponential: weight = wph^hops
 * - Linear: weight = max(0, 1 - rate * hops)
 * - Delayed Linear: weight = 1 if hops < hold, else max(0, 1 - rate * (hops - hold))
 */

import { getDb } from '../../../storage/db.js';
import { deserialize, hopCount, type VectorClock } from '../../../temporal/vector-clock.js';
import { getReferenceClock } from '../../../storage/clock-store.js';

const MIN_PATH_WEIGHT = 0.001;
const NEGATIVE_SAMPLE_COUNT = 10;

// Curve configurations to test
interface CurveConfig {
  id: string;
  name: string;
  calc: (hops: number) => number;
}

const CURVES: CurveConfig[] = [
  // Exponential variants
  { id: 'exp-80', name: 'Exponential 0.80', calc: h => Math.pow(0.80, h) },
  { id: 'exp-85', name: 'Exponential 0.85', calc: h => Math.pow(0.85, h) },
  { id: 'exp-90', name: 'Exponential 0.90', calc: h => Math.pow(0.90, h) },

  // Linear variants (die at different hop counts)
  { id: 'lin-10', name: 'Linear (dies@10)', calc: h => Math.max(0, 1 - h * 0.1) },
  { id: 'lin-20', name: 'Linear (dies@20)', calc: h => Math.max(0, 1 - h * 0.05) },
  { id: 'lin-30', name: 'Linear (dies@30)', calc: h => Math.max(0, 1 - h * 0.033) },

  // Delayed linear: hold for N hops, then linear decay
  { id: 'del-2-15', name: 'Delayed (2h, dies@15)', calc: h => h < 2 ? 1 : Math.max(0, 1 - (h - 2) * 0.077) },
  { id: 'del-3-15', name: 'Delayed (3h, dies@15)', calc: h => h < 3 ? 1 : Math.max(0, 1 - (h - 3) * 0.083) },
  { id: 'del-3-20', name: 'Delayed (3h, dies@20)', calc: h => h < 3 ? 1 : Math.max(0, 1 - (h - 3) * 0.059) },
  { id: 'del-5-20', name: 'Delayed (5h, dies@20)', calc: h => h < 5 ? 1 : Math.max(0, 1 - (h - 5) * 0.067) },
  { id: 'del-5-25', name: 'Delayed (5h, dies@25)', calc: h => h < 5 ? 1 : Math.max(0, 1 - (h - 5) * 0.05) },
];

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

const db = getDb();

// Load chunks
const chunks = new Map<string, ChunkRow>();
for (const row of db.prepare(`
  SELECT id, session_slug as sessionSlug, vector_clock as vectorClock
  FROM chunks WHERE vector_clock IS NOT NULL
`).all() as ChunkRow[]) {
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

function runExperiment(
  edges: Array<{ sourceChunkId: string; targetChunkId: string; hops: number; projectSlug: string }>,
  curves: CurveConfig[],
  direction: 'backward' | 'forward'
): Map<string, { mrr: number; rank1: number; n: number; mrrByBin: Record<string, number> }> {

  // Group by source
  const bySource = new Map<string, typeof edges>();
  for (const edge of edges) {
    const existing = bySource.get(edge.sourceChunkId) ?? [];
    existing.push(edge);
    bySource.set(edge.sourceChunkId, existing);
  }

  const results = new Map<string, { mrr: number; rank1: number; n: number; mrrByBin: Record<string, number> }>();

  for (const curve of curves) {
    let totalRR = 0;
    let rank1 = 0;
    let queries = 0;
    const bins: Record<string, number[]> = direction === 'backward'
      ? { '4-9': [], '10-14': [], '15-20': [] }
      : { '1-3': [], '4-7': [], '8-12': [], '13-20': [] };

    for (const [sourceChunkId, srcEdges] of bySource) {
      const sourceChunk = chunks.get(sourceChunkId)!;
      const refClock = getRefClock(sourceChunk.sessionSlug);

      const positives = srcEdges.map(e => ({
        chunkId: e.targetChunkId,
        hops: e.hops,
        weight: Math.max(0, curve.calc(e.hops)),
      }));

      const excludeIds = new Set([sourceChunkId, ...positives.map(p => p.chunkId)]);
      const negChunks = sampleNegatives(sourceChunk.sessionSlug, excludeIds, NEGATIVE_SAMPLE_COUNT);
      if (negChunks.length === 0) continue;

      const negatives = negChunks.filter(c => c.vectorClock).map(c => {
        const clock = deserialize(c.vectorClock!);
        const hops = direction === 'backward'
          ? hopCount(clock, refClock)
          : hopCount(deserialize(sourceChunk.vectorClock!), clock);
        return { chunkId: c.id, hops, weight: Math.max(0, curve.calc(Math.abs(hops))) };
      });

      const candidates = [
        ...positives.map(p => ({ ...p, isPositive: true })),
        ...negatives.map(n => ({ ...n, isPositive: false })),
      ];
      candidates.sort((a, b) => b.weight - a.weight);

      let firstPosRank = 0;
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].isPositive) { firstPosRank = i + 1; break; }
      }

      const rr = firstPosRank > 0 ? 1 / firstPosRank : 0;
      totalRR += rr;
      if (firstPosRank === 1) rank1++;
      queries++;

      const minHop = Math.min(...positives.map(p => p.hops));
      let bin: string;
      if (direction === 'backward') {
        bin = minHop < 10 ? '4-9' : minHop < 15 ? '10-14' : '15-20';
      } else {
        bin = minHop <= 3 ? '1-3' : minHop <= 7 ? '4-7' : minHop <= 12 ? '8-12' : '13-20';
      }
      bins[bin]?.push(rr);
    }

    const mrr = queries > 0 ? totalRR / queries : 0;
    const mrrByBin: Record<string, number> = {};
    for (const [bin, rrs] of Object.entries(bins)) {
      mrrByBin[bin] = rrs.length > 0 ? rrs.reduce((a: number, b: number) => a + b, 0) / rrs.length : 0;
    }

    results.set(curve.id, { mrr, rank1, n: queries, mrrByBin });
  }

  return results;
}

// ============================================================
// BACKWARD (4-20 hops)
// ============================================================

console.log('='.repeat(100));
console.log('BACKWARD: Different Curve Shapes (4-20 hops)');
console.log('='.repeat(100));

const backwardEdges = db.prepare(`
  SELECT source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
         vector_clock as vectorClock, reference_type as referenceType
  FROM edges
  WHERE edge_type = 'backward' AND vector_clock IS NOT NULL
    AND reference_type IN ('file-path', 'code-entity', 'explicit-backref', 'error-fragment')
`).all() as EdgeRow[];

const backwardInRange: Array<{ sourceChunkId: string; targetChunkId: string; hops: number; projectSlug: string }> = [];
for (const edge of backwardEdges) {
  const sourceChunk = chunks.get(edge.sourceChunkId);
  if (!sourceChunk?.vectorClock) continue;
  const edgeClock = deserialize(edge.vectorClock);
  const refClock = getRefClock(sourceChunk.sessionSlug);
  const hops = hopCount(edgeClock, refClock);
  if (hops >= 4 && hops <= 20) {
    backwardInRange.push({ sourceChunkId: edge.sourceChunkId, targetChunkId: edge.targetChunkId, hops, projectSlug: sourceChunk.sessionSlug });
  }
}

console.log(`\nEdges: ${backwardInRange.length}\n`);

const backwardResults = runExperiment(backwardInRange, CURVES, 'backward');

console.log('Curve                     | MRR    | 4-9    | 10-14  | 15-20  | Rank@1');
console.log('-'.repeat(75));

const sortedBackward = [...backwardResults.entries()].sort((a, b) => b[1].mrr - a[1].mrr);
for (const [id, r] of sortedBackward) {
  const curve = CURVES.find(c => c.id === id)!;
  console.log([
    curve.name.padEnd(25),
    r.mrr.toFixed(3).padStart(6),
    r.mrrByBin['4-9'].toFixed(3).padStart(6),
    r.mrrByBin['10-14'].toFixed(3).padStart(6),
    r.mrrByBin['15-20'].toFixed(3).padStart(6),
    r.rank1.toString().padStart(6),
  ].join(' | '));
}

// ============================================================
// FORWARD (1-20 hops)
// ============================================================

console.log('\n' + '='.repeat(100));
console.log('FORWARD: Different Curve Shapes (1-20 hops)');
console.log('='.repeat(100));

const forwardEdges = db.prepare(`
  SELECT source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
         vector_clock as vectorClock, reference_type as referenceType
  FROM edges
  WHERE edge_type = 'forward' AND vector_clock IS NOT NULL
    AND reference_type IN ('file-path', 'code-entity', 'explicit-backref', 'error-fragment')
`).all() as EdgeRow[];

const forwardInRange: Array<{ sourceChunkId: string; targetChunkId: string; hops: number; projectSlug: string }> = [];
for (const edge of forwardEdges) {
  const sourceChunk = chunks.get(edge.sourceChunkId);
  const targetChunk = chunks.get(edge.targetChunkId);
  if (!sourceChunk?.vectorClock || !targetChunk?.vectorClock) continue;
  const sourceClock = deserialize(sourceChunk.vectorClock);
  const targetClock = deserialize(targetChunk.vectorClock);
  const forwardHops = hopCount(sourceClock, targetClock);
  if (forwardHops >= 1 && forwardHops <= 20) {
    forwardInRange.push({ sourceChunkId: edge.sourceChunkId, targetChunkId: edge.targetChunkId, hops: forwardHops, projectSlug: sourceChunk.sessionSlug });
  }
}

console.log(`\nEdges: ${forwardInRange.length}\n`);

const forwardResults = runExperiment(forwardInRange, CURVES, 'forward');

console.log('Curve                     | MRR    | 1-3    | 4-7    | 8-12   | 13-20  | Rank@1');
console.log('-'.repeat(85));

const sortedForward = [...forwardResults.entries()].sort((a, b) => b[1].mrr - a[1].mrr);
for (const [id, r] of sortedForward) {
  const curve = CURVES.find(c => c.id === id)!;
  console.log([
    curve.name.padEnd(25),
    r.mrr.toFixed(3).padStart(6),
    r.mrrByBin['1-3'].toFixed(3).padStart(6),
    r.mrrByBin['4-7'].toFixed(3).padStart(6),
    r.mrrByBin['8-12'].toFixed(3).padStart(6),
    r.mrrByBin['13-20'].toFixed(3).padStart(6),
    r.rank1.toString().padStart(6),
  ].join(' | '));
}

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '='.repeat(100));
console.log('SUMMARY');
console.log('='.repeat(100));

const bestBackward = sortedBackward[0];
const bestForward = sortedForward[0];

console.log(`\nBACKWARD best: ${CURVES.find(c => c.id === bestBackward[0])!.name} (MRR=${bestBackward[1].mrr.toFixed(3)})`);
console.log(`FORWARD best:  ${CURVES.find(c => c.id === bestForward[0])!.name} (MRR=${bestForward[1].mrr.toFixed(3)})`);
