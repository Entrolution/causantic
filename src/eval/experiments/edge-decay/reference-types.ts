/**
 * Types for turn-to-turn reference extraction and relevance decay experiments.
 */

/**
 * A detected reference from a user turn to a specific earlier assistant turn.
 */
export interface TurnReference {
  /** ID of the user turn that contains the reference */
  userTurnIndex: number;
  /** ID of the referenced assistant turn */
  referencedTurnIndex: number;
  /** Type of reference detected */
  referenceType: ReferenceType;
  /** Confidence in the reference detection */
  confidence: 'high' | 'medium' | 'low';
  /** Evidence that triggered the detection (e.g., matched file path) */
  evidence: string;
  /** Time gap in ms between the referenced turn and the referencing turn */
  timeGapMs: number;
}

/**
 * Types of detectable references.
 */
export type ReferenceType =
  | 'file-path'          // User mentions a file path from earlier assistant output
  | 'error-fragment'     // User references an error message from tool result
  | 'code-entity'        // User mentions function/variable name from earlier code
  | 'explicit-backref'   // User uses explicit backreference ("the error", "that function")
  | 'tool-output'        // User references output from a specific tool use
  | 'adjacent'           // Default: immediate previous turn (weak reference)
  | 'cross-session';     // Reference across session boundaries (continuation)

/**
 * All references extracted from a session.
 */
export interface SessionReferences {
  sessionId: string;
  sessionSlug: string;
  /** Total number of turns in the session */
  turnCount: number;
  /** All detected references */
  references: TurnReference[];
  /** Turns with no detected references (potential new topics) */
  unreferencedTurns: number[];
}

/**
 * A candidate turn for ranking evaluation.
 */
export interface CandidateTurn {
  turnIndex: number;
  timeGapMs: number;
  /** Decay weight at query time (depends on decay model) */
  decayWeight: number;
  /** Whether this turn is actually referenced by the query turn */
  isRelevant: boolean;
}

/**
 * Ranking evaluation for a single query turn.
 */
export interface QueryEvaluation {
  /** Index of the user turn being evaluated */
  queryTurnIndex: number;
  /** Indices of actually-referenced turns */
  relevantTurns: number[];
  /** All candidate turns with their decay-weighted scores */
  rankedCandidates: CandidateTurn[];
  /** Reciprocal rank of first relevant turn (1/rank) */
  reciprocalRank: number;
  /** Rank of first relevant turn */
  firstRelevantRank: number;
}

/**
 * Results of the retrieval ranking experiment for a single decay model.
 */
export interface RetrievalRankingResult {
  /** Decay model ID */
  modelId: string;
  /** Decay model name */
  modelName: string;
  /** Mean Reciprocal Rank across all queries */
  mrr: number;
  /** Number of queries evaluated */
  queryCount: number;
  /** Number of queries with at least one relevant turn */
  queriesWithRelevant: number;
  /** Distribution of first-relevant ranks */
  rankDistribution: {
    rank1: number;   // How many queries had relevant at rank 1
    rank2_5: number; // Rank 2-5
    rank6_10: number;
    rank11_plus: number;
  };
  /** Per-query evaluations */
  evaluations: QueryEvaluation[];
}

/**
 * Time-offset bin for correlation analysis.
 */
export interface TimeOffsetBin {
  /** Bin label (e.g., "0-5min", "5-30min") */
  label: string;
  /** Min time offset in ms */
  minMs: number;
  /** Max time offset in ms */
  maxMs: number;
  /** Number of turn pairs in this bin */
  pairCount: number;
  /** Actual reference rate (% of pairs where later turn references earlier) */
  referenceRate: number;
  /** Mean decay weight from each model */
  meanDecayWeights: Record<string, number>;
}

/**
 * Results of time-offset correlation experiment.
 */
export interface TimeOffsetCorrelationResult {
  /** Time bins analyzed */
  bins: TimeOffsetBin[];
  /** Spearman correlation for each model */
  correlations: Record<string, number>;
}

/**
 * Complete experiment results.
 */
export interface EdgeDecayExperimentResults {
  /** Timestamp when experiment was run */
  generatedAt: string;
  /** Number of sessions analyzed */
  sessionCount: number;
  /** Total turns analyzed */
  turnCount: number;
  /** Total references extracted */
  referenceCount: number;
  /** Retrieval ranking results per model */
  retrievalRanking: RetrievalRankingResult[];
  /** Time-offset correlation results */
  timeOffsetCorrelation?: TimeOffsetCorrelationResult;
}
