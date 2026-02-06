/**
 * Types for the topic continuity detection experiment.
 *
 * This experiment classifies whether a user's message continues the
 * previous topic or starts a new topic, supporting the D-T-D model's
 * edge creation logic.
 */

export type TransitionLabel = 'continuation' | 'new_topic';
export type Confidence = 'high' | 'medium' | 'low';

/**
 * A transition between two consecutive turns in a session.
 */
export interface TurnTransition {
  /** Unique identifier for this transition. */
  id: string;
  /** Session ID where this transition occurs. */
  sessionId: string;
  /** Session slug (project identifier). */
  sessionSlug: string;
  /** Index of the previous turn (with assistant output). */
  prevTurnIndex: number;
  /** Index of the next turn (with user input). */
  nextTurnIndex: number;
  /** The previous assistant's response text. */
  prevAssistantText: string;
  /** The next user's input text. */
  nextUserText: string;
  /** Time gap in milliseconds between turns. */
  timeGapMs: number;
  /** Ground truth label. */
  label: TransitionLabel;
  /** Confidence in the label. */
  confidence: Confidence;
  /** Source of the label (e.g., 'session-boundary', 'time-gap', 'explicit-marker'). */
  labelSource: string;
}

/**
 * Features extracted for a turn transition.
 */
export interface TransitionFeatures {
  /** Minimum embedding distance between user text and assistant chunks. */
  embeddingDistanceMin: number;
  /** Mean embedding distance between user text and assistant chunks. */
  embeddingDistanceMean: number;
  /** Time gap in minutes. */
  timeGapMinutes: number;
  /** Whether the user text contains topic-shift markers. */
  hasTopicShiftMarker: boolean;
  /** Whether the user text contains continuation markers. */
  hasContinuationMarker: boolean;
  /** Proportion of file paths shared between assistant and user text. */
  filePathOverlap: number;
  /** Proportion of significant keywords shared. */
  keywordOverlap: number;
}

/**
 * Classification result for a single transition.
 */
export interface ClassificationResult {
  /** Transition ID. */
  transitionId: string;
  /** Ground truth label. */
  groundTruth: TransitionLabel;
  /** Predicted probability of continuation (0 = new_topic, 1 = continuation). */
  continuationScore: number;
  /** Extracted features. */
  features: TransitionFeatures;
}

/**
 * Performance metrics for a classifier.
 */
export interface ClassifierMetrics {
  /** ROC AUC score. */
  rocAuc: number;
  /** Precision at optimal threshold. */
  precision: number;
  /** Recall at optimal threshold. */
  recall: number;
  /** F1 score at optimal threshold. */
  f1: number;
  /** Optimal threshold (via Youden's J). */
  threshold: number;
}

/**
 * Results for a single model across all classifier types.
 */
export interface ModelResults {
  modelId: string;
  embeddingOnly: ClassifierMetrics;
  lexicalOnly: ClassifierMetrics;
  hybrid: ClassifierMetrics;
}

/**
 * Feature ablation result showing contribution of each feature.
 */
export interface FeatureAblation {
  featureName: string;
  baselineRocAuc: number;
  withFeatureRocAuc: number;
  deltaRocAuc: number;
}

/**
 * Dataset statistics.
 */
export interface DatasetStats {
  totalTransitions: number;
  continuationCount: number;
  newTopicCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  byLabelSource: Record<string, number>;
}

/**
 * Complete experiment report.
 */
export interface ExperimentReport {
  name: string;
  description: string;
  dataset: DatasetStats;
  modelResults: ModelResults[];
  featureAblation: FeatureAblation[];
  recommendations: string[];
  completedAt: string;
}

/**
 * Threshold sweep result for tuning.
 */
export interface ThresholdSweepRow {
  threshold: number;
  truePositiveRate: number;
  falsePositiveRate: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Time gap threshold sweep result.
 */
export interface TimeGapSweepRow {
  timeGapMinutes: number;
  transitionsLabeled: number;
  newTopicCount: number;
  continuationCount: number;
}
