/**
 * Topic continuity detection for edge creation.
 * Determines whether consecutive chunks should be connected.
 * Reuses lexical classifier from topic continuity experiments.
 */

import {
  hasTopicShiftMarker,
  computeFilePathOverlap,
  computeKeywordOverlap,
  extractFilePaths,
  extractKeywords,
} from '../eval/experiments/topic-continuity/lexical-features.js';
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
  /** Type of reference detected */
  type: ReferenceType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Evidence for the detection */
  evidence: string;
}

/**
 * Default threshold for time gap (30 minutes) that indicates new topic.
 */
const DEFAULT_TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Detect transitions/edges between consecutive chunks.
 * Returns transitions that should become edges (continuations).
 * Skips transitions that appear to be topic shifts.
 */
export function detectTransitions(
  chunks: Chunk[],
  options: DetectionOptions = {}
): TransitionResult[] {
  const { timeGapThresholdMs = DEFAULT_TIME_GAP_THRESHOLD_MS } = options;
  const results: TransitionResult[] = [];

  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const curr = chunks[i];

    // Calculate time gap
    const prevEndTime = new Date(prev.metadata.endTime).getTime();
    const currStartTime = new Date(curr.metadata.startTime).getTime();
    const timeGapMs = currStartTime - prevEndTime;

    // Large time gap indicates new topic
    if (timeGapMs > timeGapThresholdMs) {
      continue;
    }

    // Check for explicit topic shift markers in user text
    const userText = extractUserText(curr.text);
    if (hasTopicShiftMarker(userText)) {
      continue;
    }

    // Detect reference type and evidence
    const detection = detectReferenceType(prev.text, curr.text, timeGapMs);

    results.push({
      sourceIndex: i - 1,
      targetIndex: i,
      type: detection.type,
      confidence: detection.confidence,
      evidence: detection.evidence,
    });
  }

  return results;
}

export interface DetectionOptions {
  /** Time gap threshold in ms. Default: 30 minutes. */
  timeGapThresholdMs?: number;
}

interface ReferenceDetection {
  type: ReferenceType;
  confidence: number;
  evidence: string;
}

/**
 * Detect the type of reference between two chunk texts.
 */
function detectReferenceType(
  prevText: string,
  currText: string,
  timeGapMs: number
): ReferenceDetection {
  // Extract structured data for analysis
  const prevPaths = extractFilePaths(prevText);
  const currPaths = extractFilePaths(currText);
  const prevKeywords = extractKeywords(prevText);
  const currKeywords = extractKeywords(currText);

  // Check for file path references
  const pathOverlap = computePathOverlap(prevPaths, currPaths);
  if (pathOverlap > 0) {
    const sharedPaths = [...currPaths].filter((p) => prevPaths.has(p));
    return {
      type: 'file-path',
      confidence: Math.min(0.9, 0.7 + pathOverlap * 0.2),
      evidence: `Shared paths: ${sharedPaths.slice(0, 3).join(', ')}`,
    };
  }

  // Check for code entity references (function names, variables)
  const codeEntities = detectCodeEntities(prevText, currText);
  if (codeEntities.length > 0) {
    return {
      type: 'code-entity',
      confidence: 0.8,
      evidence: `Code entities: ${codeEntities.slice(0, 3).join(', ')}`,
    };
  }

  // Check for error fragment references
  const errorMatch = detectErrorReference(prevText, currText);
  if (errorMatch) {
    return {
      type: 'error-fragment',
      confidence: 0.9,
      evidence: `Error: ${errorMatch.slice(0, 50)}`,
    };
  }

  // Check for explicit backreferences
  if (hasExplicitBackreference(currText)) {
    return {
      type: 'explicit-backref',
      confidence: 0.85,
      evidence: 'Explicit backreference detected',
    };
  }

  // Check for tool output references
  const toolRef = detectToolOutputReference(prevText, currText);
  if (toolRef) {
    return {
      type: 'tool-output',
      confidence: 0.8,
      evidence: `Tool: ${toolRef}`,
    };
  }

  // Default: adjacent with keyword overlap
  const keywordOverlap = computeKeywordOverlap(prevText, currText);
  const baseConfidence = timeGapMs < 5 * 60 * 1000 ? 0.6 : 0.4;

  return {
    type: 'adjacent',
    confidence: Math.min(0.7, baseConfidence + keywordOverlap * 0.2),
    evidence: `Adjacent, keyword overlap: ${(keywordOverlap * 100).toFixed(0)}%`,
  };
}

/**
 * Compute overlap between two path sets.
 */
function computePathOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of b) {
    if (a.has(item)) intersection++;
  }

  return intersection / Math.min(a.size, b.size);
}

/**
 * Detect shared code entities (function names, class names, etc.).
 */
function detectCodeEntities(prevText: string, currText: string): string[] {
  // Pattern for camelCase or PascalCase identifiers
  const identifierPattern = /\b([a-z][a-zA-Z0-9]+|[A-Z][a-zA-Z0-9]+)\b/g;

  const prevIds = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(prevText)) !== null) {
    const id = match[1];
    if (id.length >= 4 && !isCommonWord(id)) {
      prevIds.add(id.toLowerCase());
    }
  }

  const shared: string[] = [];
  const currPattern = new RegExp(identifierPattern.source, 'g');

  while ((match = currPattern.exec(currText)) !== null) {
    const id = match[1];
    if (prevIds.has(id.toLowerCase()) && !shared.includes(id)) {
      shared.push(id);
    }
  }

  return shared;
}

/**
 * Check if an identifier is a common programming word.
 */
function isCommonWord(word: string): boolean {
  const common = new Set([
    'function', 'const', 'let', 'var', 'return', 'import', 'export',
    'async', 'await', 'class', 'interface', 'type', 'string', 'number',
    'boolean', 'null', 'undefined', 'true', 'false', 'error', 'result',
    'value', 'data', 'item', 'index', 'length', 'name', 'path', 'file',
  ]);
  return common.has(word.toLowerCase());
}

/**
 * Detect error message reference between texts.
 */
function detectErrorReference(prevText: string, currText: string): string | null {
  // Look for error patterns in previous text
  const errorPatterns = [
    /Error:\s*(.+?)(?:\n|$)/gi,
    /error\[.+?\]:\s*(.+?)(?:\n|$)/gi,
    /TypeError:\s*(.+?)(?:\n|$)/gi,
    /ReferenceError:\s*(.+?)(?:\n|$)/gi,
    /SyntaxError:\s*(.+?)(?:\n|$)/gi,
  ];

  for (const pattern of errorPatterns) {
    const prevMatches = [...prevText.matchAll(pattern)];
    for (const match of prevMatches) {
      const errorFragment = match[1].trim().slice(0, 30);
      if (errorFragment.length > 5 && currText.includes(errorFragment)) {
        return match[0].trim();
      }
    }
  }

  return null;
}

/**
 * Check for explicit backreference phrases.
 */
function hasExplicitBackreference(text: string): boolean {
  const patterns = [
    /\b(the|that|this)\s+(error|issue|problem|bug|fix|solution|code|file|function)\b/i,
    /\b(as|like)\s+(you|we)\s+(mentioned|discussed|said|showed)\b/i,
    /\b(from|in)\s+(the|your)\s+(previous|last|earlier)\b/i,
    /\b(still|again|same)\s+(error|issue|problem)\b/i,
  ];

  return patterns.some((p) => p.test(text));
}

/**
 * Detect tool output reference (referencing specific tool results).
 */
function detectToolOutputReference(prevText: string, currText: string): string | null {
  // Look for tool result markers in previous text
  const toolResultPattern = /\[Result:(\w+)\]/g;
  const tools = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = toolResultPattern.exec(prevText)) !== null) {
    tools.add(match[1]);
  }

  if (tools.size === 0) return null;

  // Check if current text references tool output
  for (const tool of tools) {
    const toolPatterns = [
      new RegExp(`\\b(the|that|this)\\s+${tool}\\s*(output|result)`, 'i'),
      new RegExp(`\\b(from|in)\\s+(the\\s+)?${tool}`, 'i'),
    ];

    if (toolPatterns.some((p) => p.test(currText))) {
      return tool;
    }
  }

  return null;
}

/**
 * Extract user text from a chunk's rendered text.
 */
function extractUserText(chunkText: string): string {
  const match = chunkText.match(/\[User\]\n([\s\S]*?)(?=\n\n\[|$)/);
  return match ? match[1] : '';
}

/**
 * Get time gap between two timestamps in milliseconds.
 */
export function getTimeGapMs(chunk1: Chunk, chunk2: Chunk): number {
  const end1 = new Date(chunk1.metadata.endTime).getTime();
  const start2 = new Date(chunk2.metadata.startTime).getTime();
  return start2 - end1;
}
