/**
 * Run hop-based decay shape experiments.
 *
 * Tests different decay curve shapes (exponential, linear, delayed-linear, multi-linear)
 * for both backward (retrieval) and forward (prediction) traversal.
 */

import { getDb } from '../../../storage/db.js';
import { deserialize, type VectorClock, hopCount } from '../../../temporal/vector-clock.js';
import { getReferenceClock } from '../../../storage/clock-store.js';
import { calculateHopDecayWeight } from './hop-decay.js';
import type {
  HopDecayConfig,
  HopDecayShapeResult,
  HopDecayShapeResults,
  HopQueryEvaluation,
  HopBin,
  HOP_BIN_BOUNDARIES,
} from './types.js';
import { ALL_HOP_DECAY_CONFIGS, QUICK_TEST_CONFIGS } from './presets.js';

/** Number of negative samples per query */
const NEGATIVE_SAMPLE_COUNT = 10;

/**
 * Hop bin boundaries for stratification.
 */
const HOP_BINS = {
  near: { min: 0, max: 3 },
  medium: { min: 4, max: 7 },
  far: { min: 8, max: Infinity },
};

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
  edgeType: string;
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
 * Get hop bin for a given hop count.
 */
function getHopBin(hops: number): HopBin {
  if (hops <= HOP_BINS.near.max) return 'near';
  if (hops <= HOP_BINS.medium.max) return 'medium';
  return 'far';
}

/**
 * Load edges with vector clocks from database.
 */
function loadEdges(edgeType: 'backward' | 'forward'): EdgeData[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, source_chunk_id as sourceChunkId, target_chunk_id as targetChunkId,
           vector_clock as vectorClock, initial_weight as initialWeight,
           reference_type as referenceType, edge_type as edgeType
    FROM edges
    WHERE vector_clock IS NOT NULL AND edge_type = ?
  `).all(edgeType) as EdgeData[];
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
 * Group edges by source chunk for backward evaluation.
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
 * Group edges by target chunk for forward evaluation.
 */
function groupEdgesByTarget(edges: EdgeData[]): Map<string, EdgeData[]> {
  const groups = new Map<string, EdgeData[]>();
  for (const edge of edges) {
    const existing = groups.get(edge.targetChunkId) ?? [];
    existing.push(edge);
    groups.set(edge.targetChunkId, existing);
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
 * Evaluate a backward query (retrieval: what context led to this chunk?).
 */
function evaluateBackwardQuery(
  sourceChunkId: string,
  positiveEdges: EdgeData[],
  projectSlug: string,
  referenceClock: VectorClock,
  config: HopDecayConfig,
  projectChunks: Map<string, ChunkData[]>,
): HopQueryEvaluation | null {
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
    const weight = calculateHopDecayWeight(config, hops);
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
    const weight = calculateHopDecayWeight(config, hops);
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
    direction: 'backward',
  };
}

/**
 * Evaluate a forward query (prediction: which future chunks will reference this source?).
 *
 * Forward semantics: Given source chunk S, predict which future targets T will reference S.
 * We rank candidates by "forward decay" - how much does relevance decay as we look further into the future.
 */
function evaluateForwardQuery(
  sourceChunkId: string,
  positiveEdges: EdgeData[],  // These are forward edges FROM this source
  projectSlug: string,
  referenceClock: VectorClock,
  config: HopDecayConfig,
  projectChunks: Map<string, ChunkData[]>,
  chunks: Map<string, ChunkData>,
): HopQueryEvaluation | null {
  // Filter to edges with explicit references
  const relevantTypes = ['file-path', 'code-entity', 'explicit-backref', 'error-fragment', 'tool-output'];
  const relevantEdges = positiveEdges.filter((e) => relevantTypes.includes(e.referenceType ?? ''));

  if (relevantEdges.length === 0) {
    return null;
  }

  // Get the positive target chunk IDs (future chunks that reference this source)
  const positiveTargetIds = new Set(relevantEdges.map((e) => e.targetChunkId));

  // Sample negative chunks (potential future chunks that don't reference source)
  const excludeIds = new Set([sourceChunkId, ...positiveTargetIds]);
  const negativeChunks = sampleNegativeChunks(projectSlug, excludeIds, NEGATIVE_SAMPLE_COUNT, projectChunks);

  if (negativeChunks.length === 0) {
    return null;
  }

  interface Candidate {
    chunkId: string;
    isPositive: boolean;
    hops: number;
    weight: number;
  }

  const candidates: Candidate[] = [];

  // Get source chunk clock
  const sourceChunk = chunks.get(sourceChunkId);
  if (!sourceChunk?.vectorClock) return null;
  const sourceClock = deserialize(sourceChunk.vectorClock);

  // Add positive samples (future chunks that DO reference this source)
  for (const edge of relevantEdges) {
    const targetChunk = chunks.get(edge.targetChunkId);
    if (!targetChunk?.vectorClock) continue;
    const targetClock = deserialize(targetChunk.vectorClock);
    // Hops from source to target: how far "ahead" is the referencing chunk
    // This measures the forward distance: target is newer than source
    const hops = hopCount(sourceClock, targetClock);
    const weight = calculateHopDecayWeight(config, hops);
    candidates.push({
      chunkId: edge.targetChunkId,
      isPositive: true,
      hops,
      weight,
    });
  }

  // Add negative samples (chunks that don't reference source)
  for (const chunk of negativeChunks) {
    if (!chunk.vectorClock) continue;
    const chunkClock = deserialize(chunk.vectorClock);
    // Same calculation: hops from source to candidate
    const hops = hopCount(sourceClock, chunkClock);
    const weight = calculateHopDecayWeight(config, hops);
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

  // Sort by weight descending (higher weight = predicted to be more likely to reference)
  candidates.sort((a, b) => b.weight - a.weight);

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
    direction: 'forward',
  };
}

/**
 * Calculate result metrics from evaluations.
 */
function calculateResult(
  config: HopDecayConfig,
  evaluations: HopQueryEvaluation[],
  direction: 'backward' | 'forward',
): HopDecayShapeResult {
  const mrr = evaluations.length > 0
    ? evaluations.reduce((sum, e) => sum + e.reciprocalRank, 0) / evaluations.length
    : 0;

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

  // Stratified by hop distance
  const stratified: Record<HopBin, HopQueryEvaluation[]> = {
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

  const stratifiedMRR = {
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

  return {
    configId: config.id,
    configName: config.name,
    direction,
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
}

/**
 * Run the hop decay shape experiment.
 */
export async function runHopDecayShapeExperiment(
  options: {
    configs?: HopDecayConfig[];
    verbose?: boolean;
    maxQueries?: number;
  } = {},
): Promise<HopDecayShapeResults> {
  const {
    configs = ALL_HOP_DECAY_CONFIGS,
    verbose = true,
    maxQueries = Infinity,
  } = options;

  if (verbose) {
    console.log('=== Hop-Based Decay Shape Experiment ===\n');
  }

  // Load data
  if (verbose) console.log('Loading edges...');
  const backwardEdges = loadEdges('backward');
  const forwardEdges = loadEdges('forward');
  const chunks = loadChunks();

  if (verbose) {
    console.log(`  Backward edges: ${backwardEdges.length}`);
    console.log(`  Forward edges: ${forwardEdges.length}`);
    console.log(`  Chunks: ${chunks.size}`);
    console.log();
  }

  // Group edges by source for both backward and forward eval
  const backwardEdgesBySource = groupEdgesBySource(backwardEdges);
  const forwardEdgesBySource = groupEdgesBySource(forwardEdges);

  // Get project slugs and chunks
  const projectSlugs = new Set<string>();
  for (const chunk of chunks.values()) {
    projectSlugs.add(chunk.sessionSlug);
  }

  const referenceClocks = new Map<string, VectorClock>();
  for (const slug of projectSlugs) {
    referenceClocks.set(slug, getReferenceClock(slug));
  }

  const projectChunks = new Map<string, ChunkData[]>();
  for (const chunk of chunks.values()) {
    const existing = projectChunks.get(chunk.sessionSlug) ?? [];
    existing.push(chunk);
    projectChunks.set(chunk.sessionSlug, existing);
  }

  const results: HopDecayShapeResult[] = [];

  // Test each config
  for (const config of configs) {
    if (verbose) {
      console.log(`Testing ${config.name}...`);
    }

    // Backward evaluation
    const backwardEvals: HopQueryEvaluation[] = [];
    let backwardQueries = 0;

    for (const [sourceChunkId, edges] of backwardEdgesBySource) {
      if (backwardQueries >= maxQueries) break;

      const chunk = chunks.get(sourceChunkId);
      if (!chunk) continue;

      const refClock = referenceClocks.get(chunk.sessionSlug);
      if (!refClock) continue;

      const evaluation = evaluateBackwardQuery(
        sourceChunkId,
        edges,
        chunk.sessionSlug,
        refClock,
        config,
        projectChunks,
      );
      if (evaluation) {
        backwardEvals.push(evaluation);
        backwardQueries++;
      }
    }

    const backwardResult = calculateResult(config, backwardEvals, 'backward');
    results.push(backwardResult);

    if (verbose) {
      console.log(`  Backward: MRR=${backwardResult.mrr.toFixed(3)}, n=${backwardResult.queryCount}`);
      console.log(`    Near: ${backwardResult.stratifiedMRR.near.toFixed(3)} (${backwardResult.stratifiedCounts.near})`);
      console.log(`    Far: ${backwardResult.stratifiedMRR.far.toFixed(3)} (${backwardResult.stratifiedCounts.far})`);
    }

    // Forward evaluation
    const forwardEvals: HopQueryEvaluation[] = [];
    let forwardQueries = 0;

    for (const [sourceChunkId, edges] of forwardEdgesBySource) {
      if (forwardQueries >= maxQueries) break;

      const chunk = chunks.get(sourceChunkId);
      if (!chunk) continue;

      const refClock = referenceClocks.get(chunk.sessionSlug);
      if (!refClock) continue;

      const evaluation = evaluateForwardQuery(
        sourceChunkId,
        edges,
        chunk.sessionSlug,
        refClock,
        config,
        projectChunks,
        chunks,
      );
      if (evaluation) {
        forwardEvals.push(evaluation);
        forwardQueries++;
      }
    }

    const forwardResult = calculateResult(config, forwardEvals, 'forward');
    results.push(forwardResult);

    if (verbose) {
      console.log(`  Forward: MRR=${forwardResult.mrr.toFixed(3)}, n=${forwardResult.queryCount}`);
      console.log(`    Near: ${forwardResult.stratifiedMRR.near.toFixed(3)} (${forwardResult.stratifiedCounts.near})`);
      console.log(`    Far: ${forwardResult.stratifiedMRR.far.toFixed(3)} (${forwardResult.stratifiedCounts.far})`);
      console.log();
    }
  }

  // Find best variants
  const backwardResults = results.filter((r) => r.direction === 'backward');
  const forwardResults = results.filter((r) => r.direction === 'forward');

  const bestBackward = [...backwardResults].sort((a, b) => b.mrr - a.mrr)[0];
  const bestForward = [...forwardResults].sort((a, b) => b.mrr - a.mrr)[0];
  const bestFarBackward = [...backwardResults].sort((a, b) => b.stratifiedMRR.far - a.stratifiedMRR.far)[0];
  const bestFarForward = [...forwardResults].sort((a, b) => b.stratifiedMRR.far - a.stratifiedMRR.far)[0];

  const sweepResults: HopDecayShapeResults = {
    generatedAt: new Date().toISOString(),
    edgeCount: backwardEdges.length + forwardEdges.length,
    results,
    bestBackwardId: bestBackward?.configId ?? '',
    bestForwardId: bestForward?.configId ?? '',
    bestFarBackwardId: bestFarBackward?.configId ?? '',
    bestFarForwardId: bestFarForward?.configId ?? '',
  };

  if (verbose) {
    console.log(formatResults(sweepResults));
  }

  return sweepResults;
}

/**
 * Format results as a comparison table.
 */
export function formatResults(results: HopDecayShapeResults): string {
  const lines: string[] = [];

  lines.push('='.repeat(100));
  lines.push('  HOP-BASED DECAY SHAPE EXPERIMENT RESULTS');
  lines.push('='.repeat(100));
  lines.push(`\nEdges analyzed: ${results.edgeCount}\n`);

  // Backward results
  lines.push('BACKWARD (Retrieval): What context led to this chunk?');
  lines.push('-'.repeat(100));
  lines.push(formatDirectionTable(results.results.filter((r) => r.direction === 'backward'), results.bestBackwardId, results.bestFarBackwardId));

  lines.push('\nFORWARD (Prediction): Which future chunks reference this?');
  lines.push('-'.repeat(100));
  lines.push(formatDirectionTable(results.results.filter((r) => r.direction === 'forward'), results.bestForwardId, results.bestFarForwardId));

  // Recommendations
  lines.push('\n' + '='.repeat(100));
  lines.push('RECOMMENDATIONS:');

  const bestBackward = results.results.find((r) => r.configId === results.bestBackwardId && r.direction === 'backward');
  const bestForward = results.results.find((r) => r.configId === results.bestForwardId && r.direction === 'forward');
  const bestFarBackward = results.results.find((r) => r.configId === results.bestFarBackwardId && r.direction === 'backward');
  const bestFarForward = results.results.find((r) => r.configId === results.bestFarForwardId && r.direction === 'forward');

  if (bestBackward) {
    lines.push(`  Backward overall: ${bestBackward.configName} (MRR=${bestBackward.mrr.toFixed(3)})`);
  }
  if (bestFarBackward && bestFarBackward.configId !== results.bestBackwardId) {
    lines.push(`  Backward far-hop: ${bestFarBackward.configName} (Far MRR=${bestFarBackward.stratifiedMRR.far.toFixed(3)})`);
  }
  if (bestForward) {
    lines.push(`  Forward overall: ${bestForward.configName} (MRR=${bestForward.mrr.toFixed(3)})`);
  }
  if (bestFarForward && bestFarForward.configId !== results.bestForwardId) {
    lines.push(`  Forward far-hop: ${bestFarForward.configName} (Far MRR=${bestFarForward.stratifiedMRR.far.toFixed(3)})`);
  }

  lines.push('='.repeat(100));

  return lines.join('\n');
}

function formatDirectionTable(results: HopDecayShapeResult[], bestId: string, bestFarId: string): string {
  const lines: string[] = [];

  const header = [
    'Config'.padEnd(25),
    'MRR'.padEnd(8),
    'Near'.padEnd(8),
    'Medium'.padEnd(8),
    'Far'.padEnd(8),
    'Rank@1'.padEnd(8),
    'n'.padEnd(6),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(80));

  const sorted = [...results].sort((a, b) => b.mrr - a.mrr);

  for (const r of sorted) {
    const row = [
      r.configName.slice(0, 25).padEnd(25),
      r.mrr.toFixed(3).padEnd(8),
      r.stratifiedMRR.near.toFixed(3).padEnd(8),
      r.stratifiedMRR.medium.toFixed(3).padEnd(8),
      r.stratifiedMRR.far.toFixed(3).padEnd(8),
      r.rankDistribution.rank1.toString().padEnd(8),
      r.queryCount.toString().padEnd(6),
    ].join(' | ');

    let suffix = '';
    if (r.configId === bestId) suffix = ' *BEST*';
    if (r.configId === bestFarId && r.configId !== bestId) suffix = ' *BEST-FAR*';

    lines.push(row + suffix);
  }

  return lines.join('\n');
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runHopDecayShapeExperiment({ verbose: true }).catch(console.error);
}
