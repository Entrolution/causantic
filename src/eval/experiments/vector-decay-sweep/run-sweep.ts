/**
 * Vector decay parameter sweep experiment.
 *
 * Tests different weightPerHop values to find optimal decay rate
 * for vector clock-based edge decay.
 *
 * The experiment works by:
 * 1. For each source chunk, get its actual target chunks (positive samples)
 * 2. Sample random chunks from the same project as negatives
 * 3. Rank all candidates using vector clock decay weights
 * 4. Measure if positive samples rank higher than negatives (MRR)
 */

import { getDb } from '../../../storage/db.js';
import { deserialize, type VectorClock, hopCount } from '../../../temporal/vector-clock.js';
import { calculateVectorDecayWeight, type VectorDecayConfig } from '../../../storage/decay.js';
import { getReferenceClock } from '../../../storage/clock-store.js';
import type {
  VectorDecayVariant,
  VectorDecaySweepResult,
  VectorDecaySweepResults,
  VectorQueryEvaluation,
  HopBin,
} from './types.js';
import { WEIGHT_PER_HOP_VALUES, HOP_BIN_BOUNDARIES } from './types.js';

/** Number of negative samples per query */
const NEGATIVE_SAMPLE_COUNT = 10;

/**
 * Create decay variants from weight-per-hop values.
 */
export function createVariants(weightPerHopValues: number[] = WEIGHT_PER_HOP_VALUES): VectorDecayVariant[] {
  return weightPerHopValues.map((wph) => ({
    id: `wph-${(wph * 100).toFixed(0)}`,
    name: `Weight/Hop ${(wph * 100).toFixed(0)}%`,
    config: {
      weightPerHop: wph,
      minWeight: 0.01,
    },
  }));
}

/**
 * Get hop bin for a given hop count.
 */
function getHopBin(hops: number): HopBin {
  if (hops <= HOP_BIN_BOUNDARIES.near.max) return 'near';
  if (hops <= HOP_BIN_BOUNDARIES.medium.max) return 'medium';
  return 'far';
}

/**
 * Edge data from database.
 */
interface EdgeData {
  id: string;
  sourceChunkId: string;
  targetChunkId: string;
  vectorClock: string | null;
  initialWeight: number;
  referenceType: string | null;
}

/**
 * Chunk data from database.
 */
interface ChunkData {
  id: string;
  sessionSlug: string;
  vectorClock: string | null;
}

/**
 * Load edges with vector clocks from database.
 */
function loadEdgesWithClocks(): EdgeData[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
           vector_clock as vectorClock, initial_weight as initialWeight,
           reference_type as referenceType
    FROM edges
    WHERE vector_clock IS NOT NULL
  `).all() as EdgeData[];
}

/**
 * Load chunk metadata.
 */
function loadChunks(): Map<string, ChunkData> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, session_slug as sessionSlug, vector_clock as vectorClock
    FROM chunks
  `).all() as ChunkData[];

  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Group edges by source chunk for retrieval evaluation.
 */
function groupEdgesBySource(edges: EdgeData[]): Map<string, EdgeData[]> {
  const groups = new Map<string, EdgeData[]>();
  for (const edge of edges) {
    const existing = groups.get(edge.sourceChunkId) ?? [];
    existing.push(edge);
    groups.set(edge.sourceChunkId, existing);
  }
  return groups;
}

/**
 * Sample random chunks from a project to use as negative samples.
 */
function sampleNegativeChunks(
  projectSlug: string,
  excludeChunkIds: Set<string>,
  count: number,
  projectChunks: Map<string, ChunkData[]>,
): ChunkData[] {
  const available = projectChunks.get(projectSlug) ?? [];
  const candidates = available.filter((c) => !excludeChunkIds.has(c.id) && c.vectorClock);

  if (candidates.length === 0) return [];

  // Fisher-Yates shuffle and take first `count`
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

/**
 * Evaluate a single query (source chunk) with positive and negative samples.
 */
function evaluateQuery(
  sourceChunkId: string,
  positiveEdges: EdgeData[],
  projectSlug: string,
  referenceClock: VectorClock,
  config: VectorDecayConfig,
  projectChunks: Map<string, ChunkData[]>,
): VectorQueryEvaluation | null {
  // Filter to edges with explicit references (not just adjacent)
  const relevantTypes = ['file-path', 'code-entity', 'explicit-backref', 'error-fragment', 'tool-output'];
  const relevantEdges = positiveEdges.filter((e) => relevantTypes.includes(e.referenceType ?? ''));

  if (relevantEdges.length === 0) {
    return null;
  }

  // Get the positive target chunk IDs
  const positiveTargetIds = new Set(relevantEdges.map((e) => e.targetChunkId));

  // Sample negative chunks
  const excludeIds = new Set([sourceChunkId, ...positiveTargetIds]);
  const negativeChunks = sampleNegativeChunks(projectSlug, excludeIds, NEGATIVE_SAMPLE_COUNT, projectChunks);

  if (negativeChunks.length === 0) {
    return null;
  }

  // Build candidates: positives + negatives
  interface Candidate {
    chunkId: string;
    isPositive: boolean;
    hops: number;
    weight: number;
  }

  const candidates: Candidate[] = [];

  // Add positive samples (from edges)
  for (const edge of relevantEdges) {
    if (!edge.vectorClock) continue;
    const edgeClock = deserialize(edge.vectorClock);
    const hops = hopCount(edgeClock, referenceClock);
    const weight = calculateVectorDecayWeight(edgeClock, referenceClock, config);
    candidates.push({
      chunkId: edge.targetChunkId,
      isPositive: true,
      hops,
      weight,
    });
  }

  // Add negative samples
  for (const chunk of negativeChunks) {
    if (!chunk.vectorClock) continue;
    const chunkClock = deserialize(chunk.vectorClock);
    const hops = hopCount(chunkClock, referenceClock);
    // For negative samples, calculate weight based on chunk's clock
    const weight = calculateVectorDecayWeight(chunkClock, referenceClock, config);
    candidates.push({
      chunkId: chunk.id,
      isPositive: false,
      hops,
      weight,
    });
  }

  if (candidates.filter((c) => c.isPositive).length === 0) {
    return null;
  }

  // Sort by weight descending (best candidates first)
  candidates.sort((a, b) => b.weight - a.weight);

  // Find rank of first positive (relevant) sample
  let firstRelevantRank = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].isPositive) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  const reciprocalRank = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;

  return {
    sourceChunkId,
    projectSlug,
    relevantHops: candidates.filter((c) => c.isPositive).map((c) => c.hops),
    allHops: candidates.map((c) => c.hops),
    reciprocalRank,
    firstRelevantRank,
  };
}

/**
 * Run the vector decay sweep experiment.
 */
export async function runVectorDecaySweep(
  options: {
    weightPerHopValues?: number[];
    verbose?: boolean;
    maxQueries?: number;
  } = {},
): Promise<VectorDecaySweepResults> {
  const {
    weightPerHopValues = WEIGHT_PER_HOP_VALUES,
    verbose = true,
    maxQueries = Infinity,
  } = options;

  if (verbose) {
    console.log('=== Vector Decay Parameter Sweep ===\n');
  }

  // Create variants
  const variants = createVariants(weightPerHopValues);

  if (verbose) {
    console.log('Variants to test:');
    for (const v of variants) {
      console.log(`  ${v.id}: ${v.name}`);
    }
    console.log();
  }

  // Load edges
  if (verbose) {
    console.log('Loading edges with vector clocks...');
  }
  const allEdges = loadEdgesWithClocks();
  const chunks = loadChunks();

  if (verbose) {
    console.log(`  Found ${allEdges.length} edges with vector clocks`);
  }

  // Group by source
  const edgesBySource = groupEdgesBySource(allEdges);
  if (verbose) {
    console.log(`  ${edgesBySource.size} unique source chunks`);
    console.log();
  }

  // Get all unique project slugs
  const projectSlugs = new Set<string>();
  for (const chunk of chunks.values()) {
    projectSlugs.add(chunk.sessionSlug);
  }

  // Pre-load reference clocks
  const referenceClocks = new Map<string, VectorClock>();
  for (const slug of projectSlugs) {
    referenceClocks.set(slug, getReferenceClock(slug));
  }

  // Group chunks by project for negative sampling
  const projectChunks = new Map<string, ChunkData[]>();
  for (const chunk of chunks.values()) {
    const existing = projectChunks.get(chunk.sessionSlug) ?? [];
    existing.push(chunk);
    projectChunks.set(chunk.sessionSlug, existing);
  }

  // Run sweep for each variant
  const results: VectorDecaySweepResult[] = [];

  for (const variant of variants) {
    if (verbose) {
      console.log(`Evaluating ${variant.name}...`);
    }

    const evaluations: VectorQueryEvaluation[] = [];
    let queriesProcessed = 0;

    for (const [sourceChunkId, edges] of edgesBySource) {
      if (queriesProcessed >= maxQueries) break;

      const chunk = chunks.get(sourceChunkId);
      if (!chunk) continue;

      const refClock = referenceClocks.get(chunk.sessionSlug);
      if (!refClock) continue;

      const evaluation = evaluateQuery(
        sourceChunkId,
        edges,
        chunk.sessionSlug,
        refClock,
        variant.config,
        projectChunks,
      );
      if (evaluation) {
        evaluations.push(evaluation);
        queriesProcessed++;
      }
    }

    // Calculate metrics
    const mrr = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + e.reciprocalRank, 0) / evaluations.length
      : 0;

    // Rank distribution
    const rankDistribution = {
      rank1: 0,
      rank2_5: 0,
      rank6_10: 0,
      rank11_plus: 0,
    };

    for (const e of evaluations) {
      if (e.firstRelevantRank === 1) rankDistribution.rank1++;
      else if (e.firstRelevantRank <= 5) rankDistribution.rank2_5++;
      else if (e.firstRelevantRank <= 10) rankDistribution.rank6_10++;
      else rankDistribution.rank11_plus++;
    }

    // Stratified by hop distance (use minimum hop from relevant edges)
    const stratified: Record<HopBin, VectorQueryEvaluation[]> = {
      near: [],
      medium: [],
      far: [],
    };

    for (const e of evaluations) {
      if (e.relevantHops.length === 0) continue;
      const minHop = Math.min(...e.relevantHops);
      const bin = getHopBin(minHop);
      stratified[bin].push(e);
    }

    const stratifiedMRR: Record<HopBin, number> = {
      near: stratified.near.length > 0
        ? stratified.near.reduce((s, e) => s + e.reciprocalRank, 0) / stratified.near.length
        : 0,
      medium: stratified.medium.length > 0
        ? stratified.medium.reduce((s, e) => s + e.reciprocalRank, 0) / stratified.medium.length
        : 0,
      far: stratified.far.length > 0
        ? stratified.far.reduce((s, e) => s + e.reciprocalRank, 0) / stratified.far.length
        : 0,
    };

    const result: VectorDecaySweepResult = {
      variantId: variant.id,
      variantName: variant.name,
      weightPerHop: variant.config.weightPerHop,
      mrr,
      queryCount: evaluations.length,
      rankDistribution,
      stratifiedMRR,
      stratifiedCounts: {
        near: stratified.near.length,
        medium: stratified.medium.length,
        far: stratified.far.length,
      },
    };

    results.push(result);

    if (verbose) {
      console.log(`  MRR: ${mrr.toFixed(3)}, Queries: ${evaluations.length}`);
      console.log(`    Near: ${stratifiedMRR.near.toFixed(3)} (${stratified.near.length})`);
      console.log(`    Medium: ${stratifiedMRR.medium.toFixed(3)} (${stratified.medium.length})`);
      console.log(`    Far: ${stratifiedMRR.far.toFixed(3)} (${stratified.far.length})`);
    }
  }

  // Find best variants
  const sortedByMRR = [...results].sort((a, b) => b.mrr - a.mrr);
  const sortedByFar = [...results].sort((a, b) => b.stratifiedMRR.far - a.stratifiedMRR.far);

  const sweepResults: VectorDecaySweepResults = {
    generatedAt: new Date().toISOString(),
    edgeCount: allEdges.length,
    edgesWithClocks: allEdges.length,
    results,
    bestVariantId: sortedByMRR[0]?.variantId ?? '',
    bestFarHopVariantId: sortedByFar[0]?.variantId ?? '',
  };

  if (verbose) {
    console.log('\n' + formatSweepResults(sweepResults));
  }

  return sweepResults;
}

/**
 * Format sweep results as a table.
 */
export function formatSweepResults(results: VectorDecaySweepResults): string {
  const lines: string[] = [];

  lines.push('='.repeat(90));
  lines.push('  VECTOR DECAY PARAMETER SWEEP RESULTS');
  lines.push('='.repeat(90));

  lines.push('\nEdges analyzed: ' + results.edgeCount);
  lines.push('');

  // Header
  const header = [
    'Variant'.padEnd(20),
    'Weight/Hop'.padEnd(12),
    'MRR'.padEnd(10),
    'Rank@1'.padEnd(10),
    'Near MRR'.padEnd(10),
    'Med MRR'.padEnd(10),
    'Far MRR'.padEnd(10),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(90));

  // Sort by overall MRR descending
  const sorted = [...results.results].sort((a, b) => b.mrr - a.mrr);

  for (const r of sorted) {
    const row = [
      r.variantName.padEnd(20),
      r.weightPerHop.toFixed(2).padEnd(12),
      r.mrr.toFixed(3).padEnd(10),
      r.rankDistribution.rank1.toString().padEnd(10),
      r.stratifiedMRR.near.toFixed(3).padEnd(10),
      r.stratifiedMRR.medium.toFixed(3).padEnd(10),
      r.stratifiedMRR.far.toFixed(3).padEnd(10),
    ].join(' | ');

    // Mark best overall and best far
    let suffix = '';
    if (r.variantId === results.bestVariantId) suffix += ' *BEST*';
    if (r.variantId === results.bestFarHopVariantId && r.variantId !== results.bestVariantId) {
      suffix += ' *BEST-FAR*';
    }

    lines.push(row + suffix);
  }

  lines.push('='.repeat(90));

  // Recommendations
  lines.push('\nRecommendations:');
  const best = sorted[0];
  lines.push(`  Best overall: ${best.variantName} (MRR=${best.mrr.toFixed(3)})`);

  if (results.bestFarHopVariantId !== results.bestVariantId) {
    const bestFar = sorted.find((r) => r.variantId === results.bestFarHopVariantId);
    if (bestFar) {
      lines.push(`  Best for far-hop: ${bestFar.variantName} (Far MRR=${bestFar.stratifiedMRR.far.toFixed(3)})`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
