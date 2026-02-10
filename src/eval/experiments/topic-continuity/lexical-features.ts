/**
 * Lexical feature extraction for topic continuity classification.
 *
 * Re-exports shared functions from src/core/lexical-features.ts and adds
 * eval-specific functions that depend on TransitionFeatures.
 */

import type { TransitionFeatures } from './types.js';
import {
  hasTopicShiftMarker as coreHasTopicShiftMarker,
  hasContinuationMarker as coreHasContinuationMarker,
  computeFilePathOverlap as coreComputeFilePathOverlap,
  computeKeywordOverlap as coreComputeKeywordOverlap,
} from '../../../core/lexical-features.js';

// Re-export all shared functions from core
export {
  hasTopicShiftMarker,
  hasContinuationMarker,
  extractFilePaths,
  computeFilePathOverlap,
  extractKeywords,
  computeKeywordOverlap,
} from '../../../core/lexical-features.js';

/**
 * Extract all lexical features for a transition.
 */
export function extractLexicalFeatures(
  prevAssistantText: string,
  nextUserText: string,
  timeGapMs: number,
): Omit<TransitionFeatures, 'embeddingDistanceMin' | 'embeddingDistanceMean'> {
  return {
    timeGapMinutes: timeGapMs / (1000 * 60),
    hasTopicShiftMarker: coreHasTopicShiftMarker(nextUserText),
    hasContinuationMarker: coreHasContinuationMarker(nextUserText),
    filePathOverlap: coreComputeFilePathOverlap(prevAssistantText, nextUserText),
    keywordOverlap: coreComputeKeywordOverlap(prevAssistantText, nextUserText),
  };
}

/**
 * Compute a lexical-only continuation score.
 * Higher score = more likely to be a continuation.
 */
export function computeLexicalScore(
  features: Omit<TransitionFeatures, 'embeddingDistanceMin' | 'embeddingDistanceMean'>,
): number {
  let score = 0.5; // Start at neutral

  // Topic shift markers strongly indicate new topic
  if (features.hasTopicShiftMarker) {
    score -= 0.4;
  }

  // Continuation markers strongly indicate continuation
  if (features.hasContinuationMarker) {
    score += 0.3;
  }

  // File path overlap suggests continuation
  score += features.filePathOverlap * 0.2;

  // Keyword overlap suggests continuation
  score += features.keywordOverlap * 0.15;

  // Large time gap suggests new topic
  if (features.timeGapMinutes > 30) {
    score -= 0.25;
  } else if (features.timeGapMinutes > 10) {
    score -= 0.1;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

export interface LexicalClassificationResult {
  score: number;
  features: Omit<TransitionFeatures, 'embeddingDistanceMin' | 'embeddingDistanceMean'>;
}

/**
 * Classify a transition using only lexical features.
 */
export function classifyWithLexicalFeatures(
  prevAssistantText: string,
  nextUserText: string,
  timeGapMs: number,
): LexicalClassificationResult {
  const features = extractLexicalFeatures(prevAssistantText, nextUserText, timeGapMs);
  const score = computeLexicalScore(features);
  return { score, features };
}
