/**
 * Labeled pair types and auto-generation for evaluation.
 *
 * Pairs are auto-labeled based on structural relationships:
 * - same-session adjacent = related
 * - same-project cross-session = related (medium confidence)
 * - cross-project random = unrelated
 * - code block + its NL explanation = code-nl-pair
 */

import type { Chunk } from '../parser/types.js';

export type PairLabel =
  | 'related'
  | 'unrelated'
  | 'code-nl-pair';

export type Confidence = 'high' | 'medium' | 'low';

export interface LabeledPair {
  chunkIdA: string;
  chunkIdB: string;
  label: PairLabel;
  confidence: Confidence;
  source: string;
}

export interface AnnotationSet {
  pairs: LabeledPair[];
  generatedAt: string;
  chunkCount: number;
}

/**
 * Group chunks by session ID.
 */
function groupBySession(chunks: Chunk[]): Map<string, Chunk[]> {
  const groups = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const sid = chunk.metadata.sessionId;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid)!.push(chunk);
  }
  return groups;
}

/**
 * Group chunks by project (derived from session slug or cwd prefix).
 */
function groupByProject(chunks: Chunk[]): Map<string, Chunk[]> {
  const groups = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    // Use session slug as a proxy for project
    const proj = chunk.metadata.sessionSlug;
    if (!groups.has(proj)) groups.set(proj, []);
    groups.get(proj)!.push(chunk);
  }
  return groups;
}

/**
 * Deterministic seeded shuffle.
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
 * Check if a chunk likely contains code (has code blocks or tool results).
 */
function isCodeHeavy(chunk: Chunk): boolean {
  return (
    chunk.metadata.codeBlockCount > 0 ||
    chunk.text.includes('```') ||
    chunk.metadata.toolUseCount > 2
  );
}

/**
 * Check if a chunk is primarily natural language explanation.
 */
function isNLHeavy(chunk: Chunk): boolean {
  return (
    chunk.metadata.codeBlockCount === 0 &&
    chunk.metadata.toolUseCount <= 1 &&
    !chunk.text.includes('```')
  );
}

export interface GenerateOptions {
  /** Target number of same-session adjacent pairs. Default: 30. */
  adjacentPairs?: number;
  /** Target number of same-project cross-session pairs. Default: 20. */
  crossSessionPairs?: number;
  /** Target number of cross-project random pairs. Default: 40. */
  crossProjectPairs?: number;
  /** Target number of code/NL pairs. Default: 10. */
  codeNLPairs?: number;
  /** Seed for deterministic sampling. Default: 42. */
  seed?: number;
}

/**
 * Auto-generate labeled pairs from a corpus of chunks.
 */
export function generateLabeledPairs(
  chunks: Chunk[],
  options: GenerateOptions = {},
): AnnotationSet {
  const {
    adjacentPairs = 30,
    crossSessionPairs = 20,
    crossProjectPairs = 40,
    codeNLPairs = 10,
    seed = 42,
  } = options;

  const pairs: LabeledPair[] = [];
  const bySession = groupBySession(chunks);
  const byProject = groupByProject(chunks);

  // 1. Same-session adjacent pairs (high confidence related)
  let adjacentCount = 0;
  for (const sessionChunks of bySession.values()) {
    if (adjacentCount >= adjacentPairs) break;
    const shuffled = seededShuffle(
      Array.from({ length: sessionChunks.length - 1 }, (_, i) => i),
      seed,
    );
    for (const i of shuffled) {
      if (adjacentCount >= adjacentPairs) break;
      pairs.push({
        chunkIdA: sessionChunks[i].id,
        chunkIdB: sessionChunks[i + 1].id,
        label: 'related',
        confidence: 'high',
        source: 'same-session-adjacent',
      });
      adjacentCount++;
    }
  }

  // 2. Same-project cross-session pairs (medium confidence related)
  let crossCount = 0;
  for (const projectChunks of byProject.values()) {
    if (crossCount >= crossSessionPairs) break;
    const sessionIds = [
      ...new Set(projectChunks.map((c) => c.metadata.sessionId)),
    ];
    if (sessionIds.length < 2) continue;

    const shuffled = seededShuffle(projectChunks, seed + 1);
    for (let i = 0; i < shuffled.length - 1 && crossCount < crossSessionPairs; i++) {
      for (let j = i + 1; j < shuffled.length && crossCount < crossSessionPairs; j++) {
        if (shuffled[i].metadata.sessionId !== shuffled[j].metadata.sessionId) {
          pairs.push({
            chunkIdA: shuffled[i].id,
            chunkIdB: shuffled[j].id,
            label: 'related',
            confidence: 'medium',
            source: 'same-project-cross-session',
          });
          crossCount++;
        }
      }
    }
  }

  // 3. Cross-project random pairs (unrelated)
  const projectKeys = [...byProject.keys()];
  if (projectKeys.length >= 2) {
    let unrelatedCount = 0;
    const shuffledKeys = seededShuffle(projectKeys, seed + 2);
    outer: for (let pi = 0; pi < shuffledKeys.length - 1; pi++) {
      const chunksA = seededShuffle(byProject.get(shuffledKeys[pi])!, seed + 3);
      for (let pj = pi + 1; pj < shuffledKeys.length; pj++) {
        const chunksB = seededShuffle(byProject.get(shuffledKeys[pj])!, seed + 4);
        for (let i = 0; i < chunksA.length && unrelatedCount < crossProjectPairs; i++) {
          const j = i % chunksB.length;
          pairs.push({
            chunkIdA: chunksA[i].id,
            chunkIdB: chunksB[j].id,
            label: 'unrelated',
            confidence: 'high',
            source: 'cross-project-random',
          });
          unrelatedCount++;
        }
        if (unrelatedCount >= crossProjectPairs) break outer;
      }
    }
  }

  // 4. Code/NL pairs
  let codeNLCount = 0;
  for (const sessionChunks of bySession.values()) {
    if (codeNLCount >= codeNLPairs) break;
    for (let i = 0; i < sessionChunks.length - 1 && codeNLCount < codeNLPairs; i++) {
      const a = sessionChunks[i];
      const b = sessionChunks[i + 1];
      if (
        (isCodeHeavy(a) && isNLHeavy(b)) ||
        (isNLHeavy(a) && isCodeHeavy(b))
      ) {
        pairs.push({
          chunkIdA: a.id,
          chunkIdB: b.id,
          label: 'code-nl-pair',
          confidence: 'medium',
          source: 'code-nl-adjacent',
        });
        codeNLCount++;
      }
    }
  }

  return {
    pairs,
    generatedAt: new Date().toISOString(),
    chunkCount: chunks.length,
  };
}
