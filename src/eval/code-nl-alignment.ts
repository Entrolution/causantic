/**
 * Code/NL pair extraction and alignment scoring.
 *
 * Measures how well a model captures the relationship between
 * code chunks and their natural language explanations.
 */

import { angularDistance } from '../utils/angular-distance.js';
import type { LabeledPair } from './annotation-schema.js';

export interface AlignmentResult {
  /** Mean angular distance of code/NL pairs. */
  meanCodeNLDistance: number;
  /** Mean angular distance of random baseline pairs. */
  meanRandomDistance: number;
  /** Ratio of code-NL distance to random distance. Lower = better alignment. */
  alignmentRatio: number;
  /** Number of code/NL pairs evaluated. */
  pairCount: number;
}

/**
 * Evaluate code-NL alignment quality.
 *
 * Compares the mean distance of code/NL pairs against a random baseline
 * drawn from unrelated pairs.
 */
export function evaluateCodeNLAlignment(
  pairs: LabeledPair[],
  embeddings: Map<string, number[]>,
): AlignmentResult {
  const codeNLPairs = pairs.filter((p) => p.label === 'code-nl-pair');
  const unrelatedPairs = pairs.filter((p) => p.label === 'unrelated');

  // Score code/NL pairs
  const codeNLDistances: number[] = [];
  for (const pair of codeNLPairs) {
    const a = embeddings.get(pair.chunkIdA);
    const b = embeddings.get(pair.chunkIdB);
    if (a && b) {
      codeNLDistances.push(angularDistance(a, b));
    }
  }

  // Score random baseline from unrelated pairs
  const randomDistances: number[] = [];
  for (const pair of unrelatedPairs) {
    const a = embeddings.get(pair.chunkIdA);
    const b = embeddings.get(pair.chunkIdB);
    if (a && b) {
      randomDistances.push(angularDistance(a, b));
    }
  }

  const meanCodeNL = mean(codeNLDistances);
  const meanRandom = mean(randomDistances);

  return {
    meanCodeNLDistance: meanCodeNL,
    meanRandomDistance: meanRandom,
    alignmentRatio: meanRandom > 0 ? meanCodeNL / meanRandom : 1,
    pairCount: codeNLDistances.length,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
