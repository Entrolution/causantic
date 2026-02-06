/**
 * Hybrid classifier combining embedding distance with lexical features.
 *
 * Uses tunable weights to combine multiple signals for topic continuity
 * prediction.
 */

import type {
  TurnTransition,
  TransitionFeatures,
  ClassificationResult,
} from './types.js';
import { extractLexicalFeatures, computeLexicalScore } from './lexical-features.js';
import {
  type EmbeddedTransition,
  embeddingDistanceToScore,
} from './embedding-classifier.js';

/**
 * Weight configuration for hybrid classifier.
 */
export interface HybridWeights {
  /** Weight for embedding distance signal. Default: 0.5 */
  embedding: number;
  /** Weight for topic shift marker. Default: 0.2 */
  topicShiftMarker: number;
  /** Weight for continuation marker. Default: 0.15 */
  continuationMarker: number;
  /** Weight for time gap signal. Default: 0.05 */
  timeGap: number;
  /** Weight for file path overlap. Default: 0.05 */
  filePathOverlap: number;
  /** Weight for keyword overlap. Default: 0.05 */
  keywordOverlap: number;
}

export const DEFAULT_WEIGHTS: HybridWeights = {
  embedding: 0.5,
  topicShiftMarker: 0.2,
  continuationMarker: 0.15,
  timeGap: 0.05,
  filePathOverlap: 0.05,
  keywordOverlap: 0.05,
};

/**
 * Compute hybrid continuation score from features.
 */
export function computeHybridScore(
  features: TransitionFeatures,
  weights: HybridWeights = DEFAULT_WEIGHTS,
): number {
  let score = 0;
  let totalWeight = 0;

  // Embedding distance (inverted: low distance = high continuation score)
  const embeddingScore = 1 - features.embeddingDistanceMin;
  score += weights.embedding * embeddingScore;
  totalWeight += weights.embedding;

  // Topic shift marker (binary: presence indicates new topic)
  const topicShiftScore = features.hasTopicShiftMarker ? 0 : 1;
  score += weights.topicShiftMarker * topicShiftScore;
  totalWeight += weights.topicShiftMarker;

  // Continuation marker (binary: presence indicates continuation)
  const continuationScore = features.hasContinuationMarker ? 1 : 0.5;
  score += weights.continuationMarker * continuationScore;
  totalWeight += weights.continuationMarker;

  // Time gap (sigmoid decay: longer gap = lower continuation score)
  const timeGapScore = timeGapToScore(features.timeGapMinutes);
  score += weights.timeGap * timeGapScore;
  totalWeight += weights.timeGap;

  // File path overlap (direct: more overlap = higher continuation)
  score += weights.filePathOverlap * features.filePathOverlap;
  totalWeight += weights.filePathOverlap;

  // Keyword overlap (direct: more overlap = higher continuation)
  score += weights.keywordOverlap * features.keywordOverlap;
  totalWeight += weights.keywordOverlap;

  // Normalize by total weight
  return totalWeight > 0 ? score / totalWeight : 0.5;
}

/**
 * Convert time gap to a continuation score using sigmoid decay.
 * Short gaps -> high score, long gaps -> low score.
 */
function timeGapToScore(timeGapMinutes: number): number {
  // Sigmoid centered at 30 minutes
  const k = 0.1; // Steepness
  const midpoint = 30;
  return 1 / (1 + Math.exp(k * (timeGapMinutes - midpoint)));
}

/**
 * Classify transitions using hybrid approach (requires pre-embedded data).
 */
export function classifyWithHybrid(
  embeddedTransitions: EmbeddedTransition[],
  weights: HybridWeights = DEFAULT_WEIGHTS,
): ClassificationResult[] {
  return embeddedTransitions.map((et) => {
    const lexicalFeatures = extractLexicalFeatures(
      et.transition.prevAssistantText,
      et.transition.nextUserText,
      et.transition.timeGapMs,
    );

    const features: TransitionFeatures = {
      ...lexicalFeatures,
      embeddingDistanceMin: et.embeddingDistanceMin,
      embeddingDistanceMean: et.embeddingDistanceMean,
    };

    const score = computeHybridScore(features, weights);

    return {
      transitionId: et.transition.id,
      groundTruth: et.transition.label,
      continuationScore: score,
      features,
    };
  });
}

/**
 * Classify using lexical features only (no embedding).
 */
export function classifyWithLexicalOnly(
  transitions: TurnTransition[],
): ClassificationResult[] {
  return transitions
    .filter((t) => t.prevAssistantText.trim()) // Skip transitions without prior context
    .map((t) => {
      const lexicalFeatures = extractLexicalFeatures(
        t.prevAssistantText,
        t.nextUserText,
        t.timeGapMs,
      );

      const features: TransitionFeatures = {
        ...lexicalFeatures,
        embeddingDistanceMin: 0.5, // Neutral placeholder
        embeddingDistanceMean: 0.5,
      };

      const score = computeLexicalScore(lexicalFeatures);

      return {
        transitionId: t.id,
        groundTruth: t.label,
        continuationScore: score,
        features,
      };
    });
}

/**
 * Feature ablation: classify with only a subset of features enabled.
 */
export interface FeatureFlags {
  useEmbedding: boolean;
  useTopicShiftMarker: boolean;
  useContinuationMarker: boolean;
  useTimeGap: boolean;
  useFilePathOverlap: boolean;
  useKeywordOverlap: boolean;
}

export const ALL_FEATURES: FeatureFlags = {
  useEmbedding: true,
  useTopicShiftMarker: true,
  useContinuationMarker: true,
  useTimeGap: true,
  useFilePathOverlap: true,
  useKeywordOverlap: true,
};

export const EMBEDDING_ONLY: FeatureFlags = {
  useEmbedding: true,
  useTopicShiftMarker: false,
  useContinuationMarker: false,
  useTimeGap: false,
  useFilePathOverlap: false,
  useKeywordOverlap: false,
};

export const LEXICAL_ONLY: FeatureFlags = {
  useEmbedding: false,
  useTopicShiftMarker: true,
  useContinuationMarker: true,
  useTimeGap: true,
  useFilePathOverlap: true,
  useKeywordOverlap: true,
};

/**
 * Compute score with specific features enabled/disabled.
 */
export function computeAblatedScore(
  features: TransitionFeatures,
  flags: FeatureFlags,
  baseWeights: HybridWeights = DEFAULT_WEIGHTS,
): number {
  // Zero out disabled features
  const weights: HybridWeights = {
    embedding: flags.useEmbedding ? baseWeights.embedding : 0,
    topicShiftMarker: flags.useTopicShiftMarker ? baseWeights.topicShiftMarker : 0,
    continuationMarker: flags.useContinuationMarker ? baseWeights.continuationMarker : 0,
    timeGap: flags.useTimeGap ? baseWeights.timeGap : 0,
    filePathOverlap: flags.useFilePathOverlap ? baseWeights.filePathOverlap : 0,
    keywordOverlap: flags.useKeywordOverlap ? baseWeights.keywordOverlap : 0,
  };

  return computeHybridScore(features, weights);
}

/**
 * Classify with specific features enabled for ablation study.
 */
export function classifyWithAblation(
  embeddedTransitions: EmbeddedTransition[],
  flags: FeatureFlags,
): ClassificationResult[] {
  return embeddedTransitions.map((et) => {
    const lexicalFeatures = extractLexicalFeatures(
      et.transition.prevAssistantText,
      et.transition.nextUserText,
      et.transition.timeGapMs,
    );

    const features: TransitionFeatures = {
      ...lexicalFeatures,
      embeddingDistanceMin: et.embeddingDistanceMin,
      embeddingDistanceMean: et.embeddingDistanceMean,
    };

    const score = computeAblatedScore(features, flags);

    return {
      transitionId: et.transition.id,
      groundTruth: et.transition.label,
      continuationScore: score,
      features,
    };
  });
}

/**
 * Named ablation configurations for experiment.
 */
export const ABLATION_CONFIGS: { name: string; flags: FeatureFlags }[] = [
  { name: 'time-gap-only', flags: { ...LEXICAL_ONLY, useTopicShiftMarker: false, useContinuationMarker: false, useFilePathOverlap: false, useKeywordOverlap: false } },
  { name: 'shift-markers-only', flags: { ...LEXICAL_ONLY, useTimeGap: false, useContinuationMarker: false, useFilePathOverlap: false, useKeywordOverlap: false } },
  { name: 'continuation-markers-only', flags: { ...LEXICAL_ONLY, useTimeGap: false, useTopicShiftMarker: false, useFilePathOverlap: false, useKeywordOverlap: false } },
  { name: 'file-path-overlap-only', flags: { ...LEXICAL_ONLY, useTimeGap: false, useTopicShiftMarker: false, useContinuationMarker: false, useKeywordOverlap: false } },
  { name: 'keyword-overlap-only', flags: { ...LEXICAL_ONLY, useTimeGap: false, useTopicShiftMarker: false, useContinuationMarker: false, useFilePathOverlap: false } },
  { name: 'all-lexical', flags: LEXICAL_ONLY },
  { name: 'embedding-only', flags: EMBEDDING_ONLY },
  { name: 'embedding+time-gap', flags: { ...EMBEDDING_ONLY, useTimeGap: true } },
  { name: 'embedding+markers', flags: { ...EMBEDDING_ONLY, useTopicShiftMarker: true, useContinuationMarker: true } },
  { name: 'embedding+paths', flags: { ...EMBEDDING_ONLY, useFilePathOverlap: true } },
  { name: 'embedding+keywords', flags: { ...EMBEDDING_ONLY, useKeywordOverlap: true } },
  { name: 'all-features', flags: ALL_FEATURES },
];
