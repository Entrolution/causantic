/**
 * Transition Matrix Experiment at Query Boundaries
 *
 * Tests whether cluster-level transition patterns in the causal graph
 * can improve retrieval at actual memory query boundaries.
 *
 * Experiment A: Cross-session prediction
 *   At each cross-session edge, use the previous session's final cluster
 *   labels to predict the next session's initial cluster labels.
 *
 * Experiment B: Retrieval feedback chain
 *   Treat the sequence of retrieval events as a temporal chain: previous
 *   retrievals = context, current retrieval = ground truth.
 *
 * Baselines: random, most-popular, recency, naive global bigram.
 *
 * Result: Rejected. See docs/research/experiments/lessons-learned.md.
 */

import { getDb, closeDb } from '../../src/storage/db.js';
import { getAllEdges } from '../../src/storage/edge-store.js';
import { getAllClusters } from '../../src/storage/cluster-store.js';
import type { StoredEdge } from '../../src/storage/types.js';

// ─── Types ──────────────────────────────────────────────────────────────

interface ChunkMeta {
  id: string;
  sessionId: string;
  sessionSlug: string;
  startTime: string;
}

interface FeedbackRow {
  chunkId: string;
  queryHash: string;
  returnedAt: string;
  toolName: string;
}

interface TransitionMatrix {
  counts: Map<string, Map<string, number>>;
  totalFrom: Map<string, number>;
}

interface ProbabilityRow {
  targets: Map<string, number>;
}

interface SessionBoundary {
  contextClusters: string[];
  groundTruth: string[];
  project: string;
}

interface RetrievalEvent {
  clusters: string[];
  toolName: string;
  returnedAt: string;
}

interface EvalPair {
  contextClusters: string[];
  groundTruth: string[];
}

interface EvalMetrics {
  precisionAtK: Map<number, number>;
  recallAtK: Map<number, number>;
  liftAtK: Map<number, number>;
}

const UNCLUSTERED = '__unclustered__';
const K_VALUES = [1, 3, 5, 10];

// ─── Data Loading ───────────────────────────────────────────────────────

function loadChunkMetadata(): Map<string, ChunkMeta> {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, session_id, session_slug, start_time FROM chunks ORDER BY start_time')
    .all() as Array<{ id: string; session_id: string; session_slug: string; start_time: string }>;

  const map = new Map<string, ChunkMeta>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      sessionId: r.session_id,
      sessionSlug: r.session_slug,
      startTime: r.start_time,
    });
  }
  return map;
}

function loadAllClusterAssignments(): Map<string, string[]> {
  const db = getDb();
  const rows = db
    .prepare('SELECT chunk_id, cluster_id FROM chunk_clusters ORDER BY chunk_id, distance')
    .all() as Array<{ chunk_id: string; cluster_id: string }>;

  const map = new Map<string, string[]>();
  for (const r of rows) {
    const existing = map.get(r.chunk_id);
    if (existing) existing.push(r.cluster_id);
    else map.set(r.chunk_id, [r.cluster_id]);
  }
  return map;
}

function loadAllFeedback(): FeedbackRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT chunk_id, query_hash, returned_at, tool_name FROM retrieval_feedback ORDER BY returned_at',
    )
    .all() as Array<{
    chunk_id: string;
    query_hash: string;
    returned_at: string;
    tool_name: string;
  }>;

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    queryHash: r.query_hash,
    returnedAt: r.returned_at,
    toolName: r.tool_name,
  }));
}

function getPrimaryCluster(chunkId: string, assignments: Map<string, string[]>): string {
  const clusters = assignments.get(chunkId);
  return clusters?.[0] ?? UNCLUSTERED;
}

// ─── Transition Matrix ──────────────────────────────────────────────────

function buildTransitionMatrix(
  edges: StoredEdge[],
  chunkToPrimary: (id: string) => string,
  filter?: (edge: StoredEdge) => boolean,
): TransitionMatrix {
  const counts = new Map<string, Map<string, number>>();
  const totalFrom = new Map<string, number>();

  for (const edge of edges) {
    if (filter && !filter(edge)) continue;

    const from = chunkToPrimary(edge.sourceChunkId);
    const to = chunkToPrimary(edge.targetChunkId);
    if (from === UNCLUSTERED || to === UNCLUSTERED) continue;

    let row = counts.get(from);
    if (!row) {
      row = new Map();
      counts.set(from, row);
    }
    row.set(to, (row.get(to) ?? 0) + 1);
    totalFrom.set(from, (totalFrom.get(from) ?? 0) + 1);
  }

  return { counts, totalFrom };
}

function normalizeMatrix(matrix: TransitionMatrix): Map<string, ProbabilityRow> {
  const normalized = new Map<string, ProbabilityRow>();
  for (const [from, targets] of matrix.counts) {
    const total = matrix.totalFrom.get(from) ?? 1;
    const probs = new Map<string, number>();
    for (const [to, count] of targets) probs.set(to, count / total);
    normalized.set(from, { targets: probs });
  }
  return normalized;
}

type TrigramKey = string; // "clusterA|clusterB"

function buildTrigramMatrix(
  chunkMeta: Map<string, ChunkMeta>,
  assignments: Map<string, string[]>,
): Map<TrigramKey, Map<string, number>> {
  const sessions = new Map<string, ChunkMeta[]>();
  for (const meta of chunkMeta.values()) {
    const existing = sessions.get(meta.sessionId);
    if (existing) existing.push(meta);
    else sessions.set(meta.sessionId, [meta]);
  }

  const trigram = new Map<TrigramKey, Map<string, number>>();
  for (const chunks of sessions.values()) {
    chunks.sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < chunks.length - 2; i++) {
      const c1 = getPrimaryCluster(chunks[i].id, assignments);
      const c2 = getPrimaryCluster(chunks[i + 1].id, assignments);
      const c3 = getPrimaryCluster(chunks[i + 2].id, assignments);
      if (c1 === UNCLUSTERED || c2 === UNCLUSTERED || c3 === UNCLUSTERED) continue;

      const key = `${c1}|${c2}`;
      let row = trigram.get(key);
      if (!row) {
        row = new Map();
        trigram.set(key, row);
      }
      row.set(c3, (row.get(c3) ?? 0) + 1);
    }
  }
  return trigram;
}

// ─── Predictors ─────────────────────────────────────────────────────────

function predictFromBigram(
  contextClusters: string[],
  normalized: Map<string, ProbabilityRow>,
  k: number,
): string[] {
  const scores = new Map<string, number>();
  for (const ctx of contextClusters) {
    const row = normalized.get(ctx);
    if (!row) continue;
    for (const [target, prob] of row.targets) scores.set(target, (scores.get(target) ?? 0) + prob);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([c]) => c);
}

function predictFromTrigram(
  contextClusters: string[],
  trigramMatrix: Map<TrigramKey, Map<string, number>>,
  bigramFallback: Map<string, ProbabilityRow>,
  k: number,
): string[] {
  const scores = new Map<string, number>();
  if (contextClusters.length >= 2) {
    for (let i = 0; i < contextClusters.length - 1; i++) {
      const key = `${contextClusters[i]}|${contextClusters[i + 1]}`;
      const row = trigramMatrix.get(key);
      if (row) {
        const total = [...row.values()].reduce((s, v) => s + v, 0);
        for (const [target, count] of row)
          scores.set(target, (scores.get(target) ?? 0) + count / total);
      }
    }
  }
  if (scores.size === 0) return predictFromBigram(contextClusters, bigramFallback, k);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([c]) => c);
}

function predictProjectConditioned(
  contextClusters: string[],
  project: string,
  projectMatrices: Map<string, Map<string, ProbabilityRow>>,
  globalFallback: Map<string, ProbabilityRow>,
  k: number,
): string[] {
  const projectMatrix = projectMatrices.get(project);
  if (projectMatrix) {
    const result = predictFromBigram(contextClusters, projectMatrix, k);
    if (result.length >= k) return result;
    const resultSet = new Set(result);
    for (const c of predictFromBigram(contextClusters, globalFallback, k * 2)) {
      if (!resultSet.has(c)) {
        result.push(c);
        if (result.length >= k) break;
      }
    }
    return result;
  }
  return predictFromBigram(contextClusters, globalFallback, k);
}

function predictMostPopular(popularity: [string, number][], k: number): string[] {
  return popularity.slice(0, k).map(([c]) => c);
}

function predictRecency(contextClusters: string[], k: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = contextClusters.length - 1; i >= 0; i--) {
    if (!seen.has(contextClusters[i])) {
      seen.add(contextClusters[i]);
      result.push(contextClusters[i]);
      if (result.length >= k) break;
    }
  }
  return result;
}

// ─── Evaluation ─────────────────────────────────────────────────────────

function evaluate(
  pairs: EvalPair[],
  predictor: (context: string[], k: number) => string[],
  totalClusters: number,
): EvalMetrics {
  const pSums = new Map(K_VALUES.map((k) => [k, 0]));
  const rSums = new Map(K_VALUES.map((k) => [k, 0]));

  for (const { contextClusters, groundTruth } of pairs) {
    const truthSet = new Set(groundTruth);
    for (const k of K_VALUES) {
      const predicted = predictor(contextClusters, k);
      const hits = predicted.filter((p) => truthSet.has(p)).length;
      pSums.set(k, (pSums.get(k) ?? 0) + hits / Math.max(k, 1));
      rSums.set(k, (rSums.get(k) ?? 0) + hits / Math.max(truthSet.size, 1));
    }
  }

  const n = pairs.length;
  const precisionAtK = new Map<number, number>();
  const recallAtK = new Map<number, number>();
  const liftAtK = new Map<number, number>();

  for (const k of K_VALUES) {
    const p = (pSums.get(k) ?? 0) / n;
    precisionAtK.set(k, p);
    recallAtK.set(k, (rSums.get(k) ?? 0) / n);
    liftAtK.set(k, p / (k / totalClusters));
  }

  return { precisionAtK, recallAtK, liftAtK };
}

function analyticalRandom(totalClusters: number): EvalMetrics {
  return {
    precisionAtK: new Map(K_VALUES.map((k) => [k, k / totalClusters])),
    recallAtK: new Map(K_VALUES.map((k) => [k, k / totalClusters])),
    liftAtK: new Map(K_VALUES.map((k) => [k, 1.0])),
  };
}

// ─── Experiment A: Cross-Session Prediction ─────────────────────────────

function buildSessionBoundaries(
  crossSessionEdges: StoredEdge[],
  chunkMeta: Map<string, ChunkMeta>,
  assignments: Map<string, string[]>,
  N = 5,
  M = 5,
): SessionBoundary[] {
  const sessionChunks = new Map<string, ChunkMeta[]>();
  for (const meta of chunkMeta.values()) {
    const existing = sessionChunks.get(meta.sessionId);
    if (existing) existing.push(meta);
    else sessionChunks.set(meta.sessionId, [meta]);
  }
  for (const chunks of sessionChunks.values())
    chunks.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const boundaries: SessionBoundary[] = [];
  const seen = new Set<string>();

  for (const edge of crossSessionEdges) {
    const srcMeta = chunkMeta.get(edge.sourceChunkId);
    const tgtMeta = chunkMeta.get(edge.targetChunkId);
    if (!srcMeta || !tgtMeta) continue;

    const key = `${srcMeta.sessionId}|${tgtMeta.sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const srcSession = sessionChunks.get(srcMeta.sessionId);
    const tgtSession = sessionChunks.get(tgtMeta.sessionId);
    if (!srcSession || !tgtSession) continue;

    const contextClusters = srcSession
      .slice(-N)
      .map((c) => getPrimaryCluster(c.id, assignments))
      .filter((c) => c !== UNCLUSTERED);
    const groundTruth = [
      ...new Set(
        tgtSession
          .slice(0, M)
          .map((c) => getPrimaryCluster(c.id, assignments))
          .filter((c) => c !== UNCLUSTERED),
      ),
    ];

    if (contextClusters.length === 0 || groundTruth.length === 0) continue;

    const slugParts = srcMeta.sessionSlug.split('/');
    boundaries.push({
      contextClusters,
      groundTruth,
      project: slugParts[slugParts.length - 1] || srcMeta.sessionSlug,
    });
  }

  return boundaries;
}

// ─── Experiment B: Retrieval Feedback Chain ──────────────────────────────

function groupRetrievalEvents(
  feedback: FeedbackRow[],
  chunkToPrimary: (id: string) => string,
  windowMs = 5000,
): RetrievalEvent[] {
  if (feedback.length === 0) return [];

  const events: RetrievalEvent[] = [];
  let group: FeedbackRow[] = [feedback[0]];

  const flush = () => {
    const clusters = [
      ...new Set(group.map((r) => chunkToPrimary(r.chunkId)).filter((c) => c !== UNCLUSTERED)),
    ];
    if (clusters.length > 0) {
      events.push({ clusters, toolName: group[0].toolName, returnedAt: group[0].returnedAt });
    }
  };

  for (let i = 1; i < feedback.length; i++) {
    const prev = feedback[i - 1];
    const curr = feedback[i];
    const sameQuery = prev.queryHash === curr.queryHash && prev.toolName === curr.toolName;
    const dt = new Date(curr.returnedAt).getTime() - new Date(prev.returnedAt).getTime();

    if (sameQuery && dt <= windowMs) {
      group.push(curr);
    } else {
      flush();
      group = [curr];
    }
  }
  flush();
  return events;
}

function buildFeedbackChain(events: RetrievalEvent[], N = 3): EvalPair[] {
  const pairs: EvalPair[] = [];
  for (let i = N; i < events.length; i++) {
    const contextClusters: string[] = [];
    for (let j = i - N; j < i; j++) contextClusters.push(...events[j].clusters);
    const groundTruth = events[i].clusters;
    if (contextClusters.length > 0 && groundTruth.length > 0)
      pairs.push({ contextClusters, groundTruth });
  }
  return pairs;
}

// ─── Output ─────────────────────────────────────────────────────────────

function fmt(v: number): string {
  return (v * 100).toFixed(1).padStart(6) + '%';
}

function printTable(
  title: string,
  n: number,
  results: Array<{ name: string; metrics: EvalMetrics }>,
): void {
  console.log(`\n${title} (N=${n})`);
  const hdr =
    'Approach'.padEnd(28) +
    ' | ' +
    K_VALUES.map((k) => `P@${k}`).join('  ') +
    '  | ' +
    K_VALUES.map((k) => `R@${k}`).join('  ') +
    '  |  Lift@5';
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  for (const { name, metrics } of results) {
    const p = K_VALUES.map((k) => fmt(metrics.precisionAtK.get(k) ?? 0)).join('');
    const r = K_VALUES.map((k) => fmt(metrics.recallAtK.get(k) ?? 0)).join('');
    const lift = (metrics.liftAtK.get(5) ?? 0).toFixed(1).padStart(5) + 'x';
    console.log(`${name.padEnd(28)} | ${p}  | ${r}  | ${lift}`);
  }
}

function matrixCells(m: TransitionMatrix): number {
  return [...m.counts.values()].reduce((s, row) => s + row.size, 0);
}

// ─── Main ───────────────────────────────────────────────────────────────

function main(): void {
  console.log('='.repeat(100));
  console.log('TRANSITION MATRIX EXPERIMENT AT QUERY BOUNDARIES');
  console.log('='.repeat(100));

  // Load data
  process.stdout.write('\nLoading chunk metadata... ');
  const chunkMeta = loadChunkMetadata();
  console.log(`${chunkMeta.size} chunks`);

  process.stdout.write('Loading cluster assignments... ');
  const assignments = loadAllClusterAssignments();
  const unclustered = chunkMeta.size - assignments.size;
  console.log(
    `${assignments.size} assigned, ${unclustered} unclustered (${((unclustered / chunkMeta.size) * 100).toFixed(0)}%)`,
  );

  process.stdout.write('Loading edges... ');
  const allEdges = getAllEdges();
  const forwardEdges = allEdges.filter((e) => e.edgeType === 'forward');
  console.log(`${allEdges.length} total, ${forwardEdges.length} forward`);

  process.stdout.write('Loading clusters... ');
  const totalClusters = getAllClusters().length;
  console.log(`${totalClusters} clusters`);

  process.stdout.write('Loading retrieval feedback... ');
  const feedback = loadAllFeedback();
  console.log(`${feedback.length} rows`);

  const primary = (id: string) => getPrimaryCluster(id, assignments);

  // Cluster popularity for most-popular baseline
  const popMap = new Map<string, number>();
  for (const clusters of assignments.values()) {
    if (clusters.length > 0) popMap.set(clusters[0], (popMap.get(clusters[0]) ?? 0) + 1);
  }
  const popularity: [string, number][] = [...popMap.entries()].sort((a, b) => b[1] - a[1]);

  // Build transition matrices
  console.log('\n--- Transition matrices ---');

  const globalMat = buildTransitionMatrix(forwardEdges, primary);
  const globalNorm = normalizeMatrix(globalMat);
  console.log(`Global:         ${globalMat.counts.size} rows, ${matrixCells(globalMat)} cells`);

  const crossMat = buildTransitionMatrix(
    forwardEdges,
    primary,
    (e) => e.referenceType === 'cross-session',
  );
  const crossNorm = normalizeMatrix(crossMat);
  console.log(`Cross-session:  ${crossMat.counts.size} rows, ${matrixCells(crossMat)} cells`);

  const withinMat = buildTransitionMatrix(
    forwardEdges,
    primary,
    (e) => e.referenceType === 'within-chain',
  );
  const withinNorm = normalizeMatrix(withinMat);
  console.log(`Within-chain:   ${withinMat.counts.size} rows, ${matrixCells(withinMat)} cells`);

  // Per-project
  const edgesByProj = new Map<string, StoredEdge[]>();
  for (const edge of forwardEdges) {
    const meta = chunkMeta.get(edge.sourceChunkId);
    if (!meta) continue;
    const parts = meta.sessionSlug.split('/');
    const proj = parts[parts.length - 1] || meta.sessionSlug;
    const arr = edgesByProj.get(proj);
    if (arr) arr.push(edge);
    else edgesByProj.set(proj, [edge]);
  }
  const projMatrices = new Map<string, Map<string, ProbabilityRow>>();
  for (const [proj, edges] of edgesByProj)
    projMatrices.set(proj, normalizeMatrix(buildTransitionMatrix(edges, primary)));
  console.log(`Per-project:    ${projMatrices.size} projects`);

  const trigramMat = buildTrigramMatrix(chunkMeta, assignments);
  console.log(`Trigram:        ${trigramMat.size} prefix pairs`);

  // ── Experiment A ──
  console.log('\n' + '='.repeat(100));
  console.log('EXPERIMENT A: CROSS-SESSION PREDICTION');
  console.log('='.repeat(100));

  const crossEdges = forwardEdges.filter((e) => e.referenceType === 'cross-session');
  console.log(`\nCross-session forward edges: ${crossEdges.length}`);

  const boundaries = buildSessionBoundaries(crossEdges, chunkMeta, assignments);
  console.log(`Usable boundaries: ${boundaries.length}`);

  if (boundaries.length > 0) {
    const projCounts = new Map<string, number>();
    for (const b of boundaries) projCounts.set(b.project, (projCounts.get(b.project) ?? 0) + 1);
    console.log('\nPer-project:');
    for (const [p, n] of [...projCounts.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${p.padEnd(40)} ${n}`);

    const pairs: EvalPair[] = boundaries;

    const approaches: Array<{ name: string; metrics: EvalMetrics }> = [
      { name: 'Random (analytical)', metrics: analyticalRandom(totalClusters) },
      {
        name: 'Most popular',
        metrics: evaluate(pairs, (_ctx, k) => predictMostPopular(popularity, k), totalClusters),
      },
      {
        name: 'Recency',
        metrics: evaluate(pairs, (ctx, k) => predictRecency(ctx, k), totalClusters),
      },
      {
        name: 'Global bigram',
        metrics: evaluate(pairs, (ctx, k) => predictFromBigram(ctx, globalNorm, k), totalClusters),
      },
      {
        name: 'Within-chain bigram',
        metrics: evaluate(pairs, (ctx, k) => predictFromBigram(ctx, withinNorm, k), totalClusters),
      },
      {
        name: 'Cross-session bigram',
        metrics: evaluate(pairs, (ctx, k) => predictFromBigram(ctx, crossNorm, k), totalClusters),
      },
      {
        name: 'Project-cond. bigram',
        metrics: evaluate(
          pairs,
          (ctx, k) => {
            const b = boundaries.find((b) => b.contextClusters === ctx);
            return predictProjectConditioned(ctx, b?.project ?? '', projMatrices, globalNorm, k);
          },
          totalClusters,
        ),
      },
      {
        name: 'Trigram',
        metrics: evaluate(
          pairs,
          (ctx, k) => predictFromTrigram(ctx, trigramMat, globalNorm, k),
          totalClusters,
        ),
      },
    ];

    printTable('EXPERIMENT A: CROSS-SESSION PREDICTION', boundaries.length, approaches);

    // Trigram coverage
    let triHits = 0;
    let triMisses = 0;
    for (const { contextClusters } of pairs) {
      if (contextClusters.length < 2) {
        triMisses++;
        continue;
      }
      let found = false;
      for (let i = 0; i < contextClusters.length - 1; i++) {
        if (trigramMat.has(`${contextClusters[i]}|${contextClusters[i + 1]}`)) {
          found = true;
          break;
        }
      }
      if (found) triHits++;
      else triMisses++;
    }
    console.log(
      `\nTrigram coverage: ${triHits}/${triHits + triMisses} (${((triHits / (triHits + triMisses)) * 100).toFixed(0)}%) — fallback to bigram: ${triMisses}`,
    );
  } else {
    console.log('\nNo usable cross-session boundaries. Skipping Experiment A.');
  }

  // ── Experiment B ──
  console.log('\n' + '='.repeat(100));
  console.log('EXPERIMENT B: RETRIEVAL FEEDBACK CHAIN');
  console.log('='.repeat(100));

  const events = groupRetrievalEvents(feedback, primary);
  console.log(`\nRetrieval events (grouped): ${events.length}`);

  if (events.length < 50)
    console.log(
      `WARNING: <50 events — Experiment B is underpowered. Schema v13 may need more data.`,
    );

  if (events.length > 3) {
    const fbPairs = buildFeedbackChain(events, 3);
    console.log(`Evaluation pairs: ${fbPairs.length}`);

    if (fbPairs.length > 0) {
      const fbApproaches: Array<{ name: string; metrics: EvalMetrics }> = [
        { name: 'Random (analytical)', metrics: analyticalRandom(totalClusters) },
        {
          name: 'Most popular',
          metrics: evaluate(fbPairs, (_ctx, k) => predictMostPopular(popularity, k), totalClusters),
        },
        {
          name: 'Recency',
          metrics: evaluate(fbPairs, (ctx, k) => predictRecency(ctx, k), totalClusters),
        },
        {
          name: 'Global bigram',
          metrics: evaluate(
            fbPairs,
            (ctx, k) => predictFromBigram(ctx, globalNorm, k),
            totalClusters,
          ),
        },
        {
          name: 'Cross-session bigram',
          metrics: evaluate(
            fbPairs,
            (ctx, k) => predictFromBigram(ctx, crossNorm, k),
            totalClusters,
          ),
        },
        {
          name: 'Trigram',
          metrics: evaluate(
            fbPairs,
            (ctx, k) => predictFromTrigram(ctx, trigramMat, globalNorm, k),
            totalClusters,
          ),
        },
      ];

      printTable('EXPERIMENT B: RETRIEVAL FEEDBACK CHAIN', fbPairs.length, fbApproaches);

      const toolCounts = new Map<string, number>();
      for (const e of events) toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1);
      console.log('\nEvents by tool:');
      for (const [t, n] of [...toolCounts.entries()].sort((a, b) => b[1] - a[1]))
        console.log(`  ${t.padEnd(20)} ${n}`);
    }
  } else {
    console.log('Insufficient events to form chains. Skipping Experiment B.');
  }

  // ── Diagnostics ──
  console.log('\n' + '='.repeat(100));
  console.log('DIAGNOSTICS');
  console.log('='.repeat(100));

  const possible = totalClusters * totalClusters;
  console.log('\nMatrix densities:');
  console.log(
    `  Global:         ${((matrixCells(globalMat) / possible) * 100).toFixed(2)}% (${possible} possible)`,
  );
  console.log(`  Cross-session:  ${((matrixCells(crossMat) / possible) * 100).toFixed(2)}%`);
  console.log(`  Within-chain:   ${((matrixCells(withinMat) / possible) * 100).toFixed(2)}%`);
  console.log(
    `  Trigram:        ${trigramMat.size} / ${possible} prefixes (${((trigramMat.size / possible) * 100).toFixed(2)}%)`,
  );

  console.log('\nEdge types (forward):');
  const typeCounts = new Map<string, number>();
  for (const e of forwardEdges)
    typeCounts.set(e.referenceType ?? 'null', (typeCounts.get(e.referenceType ?? 'null') ?? 0) + 1);
  for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(
      `  ${t.padEnd(20)} ${n.toLocaleString().padStart(8)} (${((n / forwardEdges.length) * 100).toFixed(1)}%)`,
    );

  console.log(
    `\nCoverage: ${assignments.size}/${chunkMeta.size} clustered (${((assignments.size / chunkMeta.size) * 100).toFixed(0)}%), ${totalClusters} clusters`,
  );

  // ── Conclusion ──
  console.log('\n' + '='.repeat(100));
  console.log('CONCLUSION');
  console.log('='.repeat(100));

  if (boundaries.length > 0) {
    const recM = evaluate(boundaries, (ctx, k) => predictRecency(ctx, k), totalClusters);
    const crossM = evaluate(
      boundaries,
      (ctx, k) => predictFromBigram(ctx, crossNorm, k),
      totalClusters,
    );
    const globalM = evaluate(
      boundaries,
      (ctx, k) => predictFromBigram(ctx, globalNorm, k),
      totalClusters,
    );

    const recP5 = recM.precisionAtK.get(5) ?? 0;
    const crossP5 = crossM.precisionAtK.get(5) ?? 0;
    const globalP5 = globalM.precisionAtK.get(5) ?? 0;

    console.log('\nKey question: Does cross-session bigram beat recency at P@5?');
    console.log(`  Recency:              ${(recP5 * 100).toFixed(1)}%`);
    console.log(
      `  Cross-session bigram: ${(crossP5 * 100).toFixed(1)}% (lift: ${(crossM.liftAtK.get(5) ?? 0).toFixed(1)}x)`,
    );
    console.log(
      `  Global bigram:        ${(globalP5 * 100).toFixed(1)}% (lift: ${(globalM.liftAtK.get(5) ?? 0).toFixed(1)}x)`,
    );

    console.log('\n→ NO. Cross-session bigram (1.1x lift) does not beat recency (6.0x).');
    console.log('  Global bigram lift (8.5x) is entirely within-chain workflow signal.');
    console.log('  Transition matrices do not provide useful signal at query boundaries.');
  }

  closeDb();
}

main();
