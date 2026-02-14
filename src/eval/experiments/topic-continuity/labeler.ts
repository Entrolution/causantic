/**
 * Auto-labeling heuristics for turn transitions.
 *
 * Generates labeled TurnTransition records from session data using
 * structural cues, temporal gaps, and explicit markers.
 */

import { readSessionMessages } from '../../../parser/session-reader.js';
import { assembleTurns } from '../../../parser/turn-assembler.js';
import type { Turn, TextBlock, ContentBlock } from '../../../parser/types.js';
import type { TurnTransition, TransitionLabel, Confidence, DatasetStats } from './types.js';

/** Boilerplate prefix indicating a continued session. */
const CONTINUATION_BOILERPLATE = 'This session is being continued from a previous conversation';

/** Patterns indicating explicit topic shift. */
const TOPIC_SHIFT_PATTERNS = [
  /^actually,?\s*(let'?s?|can we|could we)/i,
  /^(new|different|another)\s+(question|topic|issue)/i,
  /^switching\s+(to|gears)/i,
  /^(on|about)\s+a\s+(different|separate)\s+(note|topic)/i,
  /^(ok|okay),?\s*(so|now)\s+/i,
  /^moving\s+on/i,
  /^forget\s+(about\s+)?(that|this)/i,
  /^let'?s\s+(change|switch|move)/i,
  /^(unrelated|separate)\s*(question|topic|issue)?/i,
  /^(btw|by the way)/i,
];

/** Patterns indicating continuation of the previous topic. */
const CONTINUATION_PATTERNS = [
  /^(yes|no|right|correct|exactly)/i,
  /^(it|that|this)\s+(is|was|shows|works|doesn'?t)/i,
  /^(the|your)\s+(error|output|result|fix|solution)/i,
  /^(thanks|thank\s+you)/i,
  /^(ok|okay|got\s+it|makes\s+sense)/i,
  /^(but|however|although|though)/i,
  /^(also|additionally|and\s+also)/i,
  /^(what\s+about|how\s+about)/i,
  /^(can you|could you)\s+(also|explain|show)/i,
  /^(I\s+(see|understand|get\s+it))/i,
];

/** Default time gap threshold in minutes for labeling as new topic. */
const DEFAULT_TIME_GAP_MINUTES = 30;

export interface LabelerOptions {
  /** Time gap threshold in minutes. Default: 30. */
  timeGapMinutes?: number;
  /** Include transitions with low confidence. Default: true. */
  includeLowConfidence?: boolean;
}

/**
 * Extract plain text from assistant content blocks.
 */
function extractAssistantText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Check if text contains continuation boilerplate (resumed session).
 */
function hasContinuationBoilerplate(text: string): boolean {
  return text.includes(CONTINUATION_BOILERPLATE);
}

/**
 * Check if text contains topic-shift markers.
 */
function hasTopicShiftMarker(text: string): boolean {
  const trimmed = text.trim();
  return TOPIC_SHIFT_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Check if text contains continuation markers.
 */
function hasContinuationMarker(text: string): boolean {
  const trimmed = text.trim();
  return CONTINUATION_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Parse ISO timestamp to milliseconds.
 */
function parseTime(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Generate a unique transition ID.
 */
function makeTransitionId(sessionId: string, prevIdx: number, nextIdx: number): string {
  const shortSession = sessionId.slice(0, 8);
  return `tr-${shortSession}-${prevIdx}-${nextIdx}`;
}

/**
 * Determine label and confidence for a transition.
 */
function labelTransition(
  prevTurn: Turn | null,
  nextTurn: Turn,
  isFirstTurn: boolean,
  timeGapMs: number,
  timeGapThresholdMinutes: number,
): { label: TransitionLabel; confidence: Confidence; source: string } {
  const userText = nextTurn.userText;
  const timeGapMinutes = timeGapMs / (1000 * 60);

  // First turn of a session
  if (isFirstTurn) {
    // Check for continuation boilerplate (resumed session)
    if (hasContinuationBoilerplate(userText)) {
      return { label: 'continuation', confidence: 'high', source: 'continued-session' };
    }
    // Otherwise, definitionally a new topic
    return { label: 'new_topic', confidence: 'high', source: 'session-boundary' };
  }

  // Explicit topic-shift markers (hard negatives - topic shift within session)
  if (hasTopicShiftMarker(userText)) {
    return { label: 'new_topic', confidence: 'high', source: 'explicit-shift-marker' };
  }

  // Explicit continuation markers
  if (hasContinuationMarker(userText)) {
    return { label: 'continuation', confidence: 'high', source: 'explicit-continuation-marker' };
  }

  // Large time gap suggests context switch
  if (timeGapMinutes > timeGapThresholdMinutes) {
    return { label: 'new_topic', confidence: 'medium', source: 'time-gap' };
  }

  // References to tool outputs or file paths suggest continuation
  // (This is a simple heuristic - the lexical features module does more sophisticated detection)
  const hasFileRef = /\.(ts|js|py|json|md|tsx|jsx|css|html|go|rs|java|c|cpp|h)\b/i.test(userText);
  const hasToolRef = /(output|result|error|warning|log|file|path)/i.test(userText);
  if (hasFileRef || hasToolRef) {
    return { label: 'continuation', confidence: 'high', source: 'tool-file-reference' };
  }

  // Default: adjacent same-session turns are assumed to continue
  return { label: 'continuation', confidence: 'medium', source: 'same-session-adjacent' };
}

/**
 * Generate turn transitions from a single session file.
 */
export async function generateSessionTransitions(
  sessionPath: string,
  sessionId: string,
  sessionSlug: string,
  options: LabelerOptions = {},
): Promise<TurnTransition[]> {
  const { timeGapMinutes = DEFAULT_TIME_GAP_MINUTES } = options;

  const messages = await readSessionMessages(sessionPath);
  const turns = assembleTurns(messages);

  if (turns.length < 2) {
    return [];
  }

  const transitions: TurnTransition[] = [];

  for (let i = 0; i < turns.length; i++) {
    const nextTurn = turns[i];
    const prevTurn = i > 0 ? turns[i - 1] : null;
    const isFirstTurn = i === 0;

    // Skip if user text is empty
    if (!nextTurn.userText.trim()) continue;

    // For first turn, we don't have a previous assistant output
    // But we still want to label whether this starts a new topic
    let prevAssistantText = '';
    let timeGapMs = 0;

    if (prevTurn) {
      prevAssistantText = extractAssistantText(prevTurn.assistantBlocks);
      const prevTime = parseTime(prevTurn.startTime);
      const nextTime = parseTime(nextTurn.startTime);
      timeGapMs = Math.max(0, nextTime - prevTime);
    }

    const { label, confidence, source } = labelTransition(
      prevTurn,
      nextTurn,
      isFirstTurn,
      timeGapMs,
      timeGapMinutes,
    );

    transitions.push({
      id: makeTransitionId(sessionId, i - 1, i),
      sessionId,
      sessionSlug,
      prevTurnIndex: isFirstTurn ? -1 : i - 1,
      nextTurnIndex: i,
      prevAssistantText,
      nextUserText: nextTurn.userText,
      timeGapMs,
      label,
      confidence,
      labelSource: source,
    });
  }

  return transitions;
}

/**
 * Session info for transition generation.
 */
export interface SessionSource {
  path: string;
  sessionId: string;
  sessionSlug: string;
}

/**
 * Generate turn transitions from multiple sessions.
 */
export async function generateTransitionLabels(
  sessions: SessionSource[],
  options: LabelerOptions = {},
): Promise<TurnTransition[]> {
  const { includeLowConfidence = true } = options;

  const allTransitions: TurnTransition[] = [];

  for (const session of sessions) {
    try {
      const transitions = await generateSessionTransitions(
        session.path,
        session.sessionId,
        session.sessionSlug,
        options,
      );

      for (const t of transitions) {
        if (!includeLowConfidence && t.confidence === 'low') {
          continue;
        }
        allTransitions.push(t);
      }

      console.log(`  ${session.sessionSlug}: ${transitions.length} transitions`);
    } catch (err) {
      console.warn(`  Failed to process ${session.path}: ${err}`);
    }
  }

  return allTransitions;
}

/**
 * Compute dataset statistics from transitions.
 */
export function computeDatasetStats(transitions: TurnTransition[]): DatasetStats {
  const byLabelSource: Record<string, number> = {};

  let continuationCount = 0;
  let newTopicCount = 0;
  let highConfidenceCount = 0;
  let mediumConfidenceCount = 0;
  let lowConfidenceCount = 0;

  for (const t of transitions) {
    if (t.label === 'continuation') continuationCount++;
    else newTopicCount++;

    if (t.confidence === 'high') highConfidenceCount++;
    else if (t.confidence === 'medium') mediumConfidenceCount++;
    else lowConfidenceCount++;

    byLabelSource[t.labelSource] = (byLabelSource[t.labelSource] ?? 0) + 1;
  }

  return {
    totalTransitions: transitions.length,
    continuationCount,
    newTopicCount,
    highConfidenceCount,
    mediumConfidenceCount,
    lowConfidenceCount,
    byLabelSource,
  };
}

/**
 * Filter transitions to only include high-confidence labels.
 */
export function filterHighConfidence(transitions: TurnTransition[]): TurnTransition[] {
  return transitions.filter((t) => t.confidence === 'high');
}

/**
 * Balance dataset by undersampling the majority class.
 */
export function balanceDataset(transitions: TurnTransition[], seed: number = 42): TurnTransition[] {
  const continuations = transitions.filter((t) => t.label === 'continuation');
  const newTopics = transitions.filter((t) => t.label === 'new_topic');

  const minCount = Math.min(continuations.length, newTopics.length);

  // Deterministic shuffle
  const shuffledContinuations = seededShuffle(continuations, seed);
  const shuffledNewTopics = seededShuffle(newTopics, seed + 1);

  return [...shuffledContinuations.slice(0, minCount), ...shuffledNewTopics.slice(0, minCount)];
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
