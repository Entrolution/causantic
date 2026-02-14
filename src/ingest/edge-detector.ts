/**
 * Causal transition detection for edge creation.
 *
 * Creates sequential linked-list edges between consecutive chunks:
 * - Inter-turn: last chunk of turn A → first chunk of turn B
 * - Intra-turn: C1 → C2 → C3 when a turn splits into multiple chunks
 *
 * The causal graph is a linked list with branch points at sub-agent forks.
 */

import { hasTopicShiftMarker } from '../core/lexical-features.js';
import type { ReferenceType } from '../storage/types.js';
import type { Chunk } from '../parser/types.js';

/**
 * Result of transition detection between two chunks.
 */
export interface TransitionResult {
  /** Index of source chunk in array */
  sourceIndex: number;
  /** Index of target chunk in array */
  targetIndex: number;
  /** Structural role of the edge */
  type: ReferenceType;
  /** Confidence score (always 1.0 for causal transitions) */
  confidence: number;
  /** Evidence for the detection */
  evidence: string;
}

/**
 * Default threshold for time gap (30 minutes) that indicates new topic.
 */
const DEFAULT_TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000;

export interface DetectionOptions {
  /** Time gap threshold in ms. Default: 30 minutes. */
  timeGapThresholdMs?: number;
}

/**
 * Detect causal transitions between chunks using sequential linking.
 *
 * Groups chunks by turn index, then:
 * 1. Intra-turn: sequential edges within a turn (C1→C2→C3)
 * 2. Inter-turn: edge from last chunk of turn A to first chunk of turn B
 *    (gated by topic shift detection)
 *
 * @param chunks - Array of chunks with metadata.turnIndices
 * @param options - Detection options (time gap threshold)
 * @returns Array of causal transitions
 */
export function detectCausalTransitions(
  chunks: Chunk[],
  options: DetectionOptions = {},
): TransitionResult[] {
  const { timeGapThresholdMs = DEFAULT_TIME_GAP_THRESHOLD_MS } = options;

  if (chunks.length < 2) return [];

  // Group chunk indices by turn index
  const chunkIndicesByTurn = new Map<number, number[]>();
  for (let ci = 0; ci < chunks.length; ci++) {
    for (const turnIndex of chunks[ci].metadata.turnIndices) {
      const existing = chunkIndicesByTurn.get(turnIndex) ?? [];
      existing.push(ci);
      chunkIndicesByTurn.set(turnIndex, existing);
    }
  }

  // Sort unique turn indices
  const sortedTurns = [...chunkIndicesByTurn.keys()].sort((a, b) => a - b);

  // Track emitted pairs for deduplication
  const emittedPairs = new Set<string>();
  const results: TransitionResult[] = [];

  function emitEdge(srcIdx: number, tgtIdx: number, type: ReferenceType, evidence: string): void {
    const pairKey = `${srcIdx}:${tgtIdx}`;
    if (emittedPairs.has(pairKey)) return;
    if (srcIdx === tgtIdx) return;
    emittedPairs.add(pairKey);
    results.push({ sourceIndex: srcIdx, targetIndex: tgtIdx, type, confidence: 1.0, evidence });
  }

  for (let ti = 0; ti < sortedTurns.length; ti++) {
    const turn = sortedTurns[ti];
    const chunkIndices = chunkIndicesByTurn.get(turn)!;

    // Intra-turn sequential edges (C1→C2→C3)
    for (let ci = 0; ci < chunkIndices.length - 1; ci++) {
      emitEdge(
        chunkIndices[ci],
        chunkIndices[ci + 1],
        'within-chain',
        `Intra-turn sequential: turn ${turn}, chunk ${ci} → ${ci + 1}`,
      );
    }

    // Inter-turn edge: last chunk of this turn → first chunk of next turn
    if (ti < sortedTurns.length - 1) {
      const nextTurn = sortedTurns[ti + 1];
      const nextChunkIndices = chunkIndicesByTurn.get(nextTurn)!;

      // Topic shift gating
      const lastChunkIdx = chunkIndices[chunkIndices.length - 1];
      const firstNextChunkIdx = nextChunkIndices[0];
      const lastChunk = chunks[lastChunkIdx];
      const firstNextChunk = chunks[firstNextChunkIdx];

      const timeGapMs = getTimeGapMs(lastChunk, firstNextChunk);
      if (timeGapMs > timeGapThresholdMs) continue;

      const userText = extractUserText(firstNextChunk.text);
      if (hasTopicShiftMarker(userText)) continue;

      emitEdge(
        lastChunkIdx,
        firstNextChunkIdx,
        'within-chain',
        `Inter-turn sequential: turn ${turn} → turn ${nextTurn}`,
      );
    }
  }

  return results;
}

/**
 * Legacy alias — detectTransitions now delegates to detectCausalTransitions.
 */
export function detectTransitions(
  chunks: Chunk[],
  options: DetectionOptions = {},
): TransitionResult[] {
  return detectCausalTransitions(chunks, options);
}

/**
 * Extract user text from a chunk's rendered text.
 */
function extractUserText(chunkText: string): string {
  const match = chunkText.match(/\[User\]\n([\s\S]*?)(?=\n\n\[|$)/);
  return match ? match[1] : '';
}

/**
 * Get time gap between two chunks in milliseconds.
 */
export function getTimeGapMs(chunk1: Chunk, chunk2: Chunk): number {
  const end1 = new Date(chunk1.metadata.endTime).getTime();
  const start2 = new Date(chunk2.metadata.startTime).getTime();
  return start2 - end1;
}
