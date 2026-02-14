/**
 * Query sampling with seeded PRNG for reproducible benchmarks.
 *
 * Generates benchmark samples from the user's collection, including
 * adjacent pairs (ground truth for recall), cross-session pairs, and
 * cross-project negative controls.
 */

import { getAllChunks } from '../../storage/chunk-store.js';
import { getAllEdges } from '../../storage/edge-store.js';
import type { StoredChunk, StoredEdge, ReferenceType } from '../../storage/types.js';
import type {
  BenchmarkSample,
  SamplerOptions,
  SamplerThresholds,
  AdjacentPair,
  CrossSessionPair,
  CrossProjectPair,
} from './types.js';

/**
 * Deterministic seeded shuffle (same algorithm as annotation-schema.ts).
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Check minimum thresholds for each benchmark type.
 */
export function checkThresholds(chunks: StoredChunk[], edges: StoredEdge[]): SamplerThresholds {
  const reasons = new Map<string, string>();

  // Group chunks by session
  const sessionChunks = new Map<string, StoredChunk[]>();
  for (const chunk of chunks) {
    const list = sessionChunks.get(chunk.sessionId) ?? [];
    list.push(chunk);
    sessionChunks.set(chunk.sessionId, list);
  }

  // Adjacent recall: need >= 2 sessions with >= 3 chunks each
  const sessionsWithEnoughChunks = [...sessionChunks.values()].filter((c) => c.length >= 3);
  const canRunAdjacentRecall = sessionsWithEnoughChunks.length >= 2;
  if (!canRunAdjacentRecall) {
    reasons.set(
      'adjacentRecall',
      `need >=2 sessions with >=3 chunks each, you have ${sessionsWithEnoughChunks.length}`,
    );
  }

  // Cross-session bridging: need >= 3 sessions in same project with cross-session edges
  const projectSessions = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    const sessions = projectSessions.get(chunk.sessionSlug) ?? new Set();
    sessions.add(chunk.sessionId);
    projectSessions.set(chunk.sessionSlug, sessions);
  }

  const crossSessionEdges = edges.filter(
    (e) => e.referenceType === 'cross-session' || e.referenceType === 'within-chain',
  );
  const projectsWithCrossSession = [...projectSessions.entries()].filter(
    ([, sessions]) => sessions.size >= 3,
  );
  const canRunCrossSessionBridging =
    projectsWithCrossSession.length > 0 && crossSessionEdges.length > 0;
  if (!canRunCrossSessionBridging) {
    const sessCount = Math.max(...[...projectSessions.values()].map((s) => s.size), 0);
    reasons.set(
      'crossSessionBridging',
      `need >=3 sessions in same project with cross-session edges, best project has ${sessCount} sessions`,
    );
  }

  // Precision@K: need >= 2 projects with >= 10 chunks each
  const projectChunkCounts = new Map<string, number>();
  for (const chunk of chunks) {
    projectChunkCounts.set(chunk.sessionSlug, (projectChunkCounts.get(chunk.sessionSlug) ?? 0) + 1);
  }
  const projectsWithEnoughChunks = [...projectChunkCounts.entries()].filter(
    ([, count]) => count >= 10,
  );
  const canRunPrecisionAtK = projectsWithEnoughChunks.length >= 2;
  if (!canRunPrecisionAtK) {
    reasons.set(
      'precisionAtK',
      `need >=2 projects with >=10 chunks each, you have ${projectsWithEnoughChunks.length}`,
    );
  }

  return {
    canRunAdjacentRecall,
    canRunCrossSessionBridging,
    canRunPrecisionAtK,
    reasons,
  };
}

/**
 * Generate benchmark samples from the collection.
 */
export function generateSamples(options: SamplerOptions): BenchmarkSample {
  const { sampleSize, seed = 42, projectFilter } = options;

  let chunks = getAllChunks();
  let edges = getAllEdges();

  // Apply project filter if specified
  if (projectFilter) {
    chunks = chunks.filter((c) => c.sessionSlug === projectFilter);
    const chunkIds = new Set(chunks.map((c) => c.id));
    edges = edges.filter((e) => chunkIds.has(e.sourceChunkId) || chunkIds.has(e.targetChunkId));
  }

  const thresholds = checkThresholds(chunks, edges);

  // Group chunks by session, sorted by start_time
  const sessionChunks = new Map<string, StoredChunk[]>();
  for (const chunk of chunks) {
    const list = sessionChunks.get(chunk.sessionId) ?? [];
    list.push(chunk);
    sessionChunks.set(chunk.sessionId, list);
  }
  for (const list of sessionChunks.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // Sample query chunk IDs
  const shuffledChunks = seededShuffle(chunks, seed);
  const queryChunkIds = shuffledChunks.slice(0, sampleSize).map((c) => c.id);

  // Generate adjacent pairs
  const adjacentPairs: AdjacentPair[] = [];
  if (thresholds.canRunAdjacentRecall) {
    let pairSeed = seed + 100;
    for (const [sessionId, sessionList] of sessionChunks) {
      if (sessionList.length < 3) continue;
      // Exclude first and last chunks, sample from middle
      const middleIndices = Array.from({ length: sessionList.length - 2 }, (_, i) => i + 1);
      const shuffled = seededShuffle(middleIndices, pairSeed++);
      const limit = Math.min(shuffled.length, Math.ceil(sampleSize / sessionChunks.size) + 1);
      for (let k = 0; k < limit && adjacentPairs.length < sampleSize; k++) {
        const idx = shuffled[k];
        const chunk = sessionList[idx];
        // Pick one adjacent (previous or next)
        const adjacentIdx = pairSeed++ % 2 === 0 ? idx - 1 : idx + 1;
        if (adjacentIdx >= 0 && adjacentIdx < sessionList.length) {
          adjacentPairs.push({
            queryChunkId: chunk.id,
            adjacentChunkId: sessionList[adjacentIdx].id,
            sessionId,
          });
        }
      }
    }
  }

  // Generate cross-session pairs from edges
  const crossSessionPairs: CrossSessionPair[] = [];
  if (thresholds.canRunCrossSessionBridging) {
    const chunkSessionMap = new Map<string, string>();
    for (const chunk of chunks) {
      chunkSessionMap.set(chunk.id, chunk.sessionId);
    }

    const bridgingEdges = edges.filter((e) => {
      const srcSession = chunkSessionMap.get(e.sourceChunkId);
      const tgtSession = chunkSessionMap.get(e.targetChunkId);
      return (
        srcSession &&
        tgtSession &&
        srcSession !== tgtSession &&
        (e.referenceType === 'cross-session' || e.referenceType === 'within-chain')
      );
    });

    const shuffledEdges = seededShuffle(bridgingEdges, seed + 200);
    for (const edge of shuffledEdges.slice(0, sampleSize)) {
      crossSessionPairs.push({
        chunkIdA: edge.sourceChunkId,
        chunkIdB: edge.targetChunkId,
        edgeType: edge.referenceType as ReferenceType,
      });
    }
  }

  // Generate cross-project pairs (negative controls)
  const crossProjectPairs: CrossProjectPair[] = [];
  if (thresholds.canRunPrecisionAtK) {
    const projectChunks = new Map<string, StoredChunk[]>();
    for (const chunk of chunks) {
      const list = projectChunks.get(chunk.sessionSlug) ?? [];
      list.push(chunk);
      projectChunks.set(chunk.sessionSlug, list);
    }

    const projectKeys = [...projectChunks.keys()].filter(
      (k) => (projectChunks.get(k)?.length ?? 0) >= 10,
    );

    if (projectKeys.length >= 2) {
      const shuffledKeys = seededShuffle(projectKeys, seed + 300);
      let count = 0;
      for (let pi = 0; pi < shuffledKeys.length - 1 && count < sampleSize; pi++) {
        const chunksA = seededShuffle(projectChunks.get(shuffledKeys[pi])!, seed + 301);
        for (let pj = pi + 1; pj < shuffledKeys.length && count < sampleSize; pj++) {
          const chunksB = seededShuffle(projectChunks.get(shuffledKeys[pj])!, seed + 302);
          const limit = Math.min(chunksA.length, chunksB.length, sampleSize - count);
          for (let i = 0; i < limit; i++) {
            crossProjectPairs.push({
              chunkIdA: chunksA[i].id,
              projectA: shuffledKeys[pi],
              chunkIdB: chunksB[i].id,
              projectB: shuffledKeys[pj],
            });
            count++;
          }
        }
      }
    }
  }

  return {
    queryChunkIds,
    adjacentPairs,
    crossSessionPairs,
    crossProjectPairs,
    thresholds,
  };
}
