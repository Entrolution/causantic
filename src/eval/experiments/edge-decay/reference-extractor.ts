/**
 * Reference extractor for turn-to-turn reference detection.
 *
 * Parses session data to identify when a user turn references
 * specific earlier assistant turns. Distance metric: hop distance
 * (turn count difference).
 */

import { readSessionMessages } from '../../../parser/session-reader.js';
import { assembleTurns } from '../../../parser/turn-assembler.js';
import type { Turn, ContentBlock, TextBlock, ToolResultBlock } from '../../../parser/types.js';
import type { TurnReference, SessionReferences, ReferenceType } from './reference-types.js';

/**
 * Extract file paths from text.
 */
function extractFilePaths(text: string): string[] {
  // Match common file extensions
  const pathPattern =
    /(?:^|\s|['"`])([.\/~]?[\w\-./]+\.(ts|tsx|js|jsx|py|json|md|yaml|yml|toml|rs|go|java|c|cpp|h|hpp|css|html|xml|sql|sh|bash|zsh))\b/gi;
  const matches: string[] = [];
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    matches.push(match[1].toLowerCase());
  }
  return [...new Set(matches)];
}

/**
 * Extract error message fragments (first 50 chars of error lines).
 */
function extractErrorFragments(text: string): string[] {
  const fragments: string[] = [];

  // Look for error patterns
  const errorPatterns = [
    /error[:\s]+(.{10,50})/gi,
    /Error[:\s]+(.{10,50})/gi,
    /failed[:\s]+(.{10,50})/gi,
    /exception[:\s]+(.{10,50})/gi,
    /cannot\s+(.{10,40})/gi,
    /unexpected\s+(.{10,40})/gi,
  ];

  for (const pattern of errorPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      fragments.push(match[1].toLowerCase().trim());
    }
  }

  return [...new Set(fragments)];
}

/**
 * Extract code entities (function names, variable names, class names).
 */
function extractCodeEntities(text: string): string[] {
  const entities: string[] = [];

  // Function definitions
  const funcPattern = /(?:function|def|fn|func)\s+(\w+)/gi;
  let match;
  while ((match = funcPattern.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  // Class definitions
  const classPattern = /(?:class|struct|interface|type)\s+(\w+)/gi;
  while ((match = classPattern.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  // Const/let/var declarations
  const varPattern = /(?:const|let|var|val)\s+(\w+)/gi;
  while ((match = varPattern.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  // Export declarations
  const exportPattern = /export\s+(?:const|function|class|interface|type)\s+(\w+)/gi;
  while ((match = exportPattern.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  return [...new Set(entities)].filter((e) => e.length > 2); // Filter out short names
}

/**
 * Explicit backreference patterns and their target descriptions.
 */
const BACKREF_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bthe\s+error\b/i, description: 'the error' },
  { pattern: /\bthat\s+error\b/i, description: 'that error' },
  { pattern: /\bthis\s+error\b/i, description: 'this error' },
  { pattern: /\bthe\s+bug\b/i, description: 'the bug' },
  { pattern: /\bthat\s+bug\b/i, description: 'that bug' },
  { pattern: /\bthe\s+issue\b/i, description: 'the issue' },
  { pattern: /\bthat\s+issue\b/i, description: 'that issue' },
  { pattern: /\bthe\s+output\b/i, description: 'the output' },
  { pattern: /\bthat\s+output\b/i, description: 'that output' },
  { pattern: /\byour\s+suggestion\b/i, description: 'your suggestion' },
  { pattern: /\bthe\s+fix\b/i, description: 'the fix' },
  { pattern: /\bthat\s+function\b/i, description: 'that function' },
  { pattern: /\bthe\s+function\b/i, description: 'the function' },
  { pattern: /\bthat\s+file\b/i, description: 'that file' },
  { pattern: /\bthe\s+file\b/i, description: 'the file' },
  { pattern: /\byou\s+mentioned\b/i, description: 'you mentioned' },
  { pattern: /\byou\s+showed\b/i, description: 'you showed' },
  { pattern: /\byou\s+said\b/i, description: 'you said' },
  { pattern: /\bas\s+you\s+said\b/i, description: 'as you said' },
  { pattern: /\blike\s+you\s+said\b/i, description: 'like you said' },
  { pattern: /\bearlier\b/i, description: 'earlier' },
  { pattern: /\bpreviously\b/i, description: 'previously' },
  { pattern: /\bbefore\b/i, description: 'before' },
  { pattern: /\babove\b/i, description: 'above' },
];

/**
 * Check for explicit backreferences in text.
 */
function findBackreferences(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, description } of BACKREF_PATTERNS) {
    if (pattern.test(text)) {
      found.push(description);
    }
  }
  return found;
}

/**
 * Extract assistant text content from blocks.
 */
function getAssistantText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Extract tool results from blocks.
 */
function getToolResults(blocks: ContentBlock[]): string[] {
  return blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result').map((b) => b.content);
}

/**
 * Get all text content from an assistant turn (text + tool results).
 */
function getAllTurnContent(turn: Turn): string {
  const text = getAssistantText(turn.assistantBlocks);
  const toolResults = turn.toolExchanges.map((t) => t.result).join('\n');
  return `${text}\n${toolResults}`;
}

/**
 * Find which earlier turns a user turn references.
 * Distance metric: hop distance (queryIndex - prevTurnIndex).
 */
function findReferences(
  queryTurn: Turn,
  queryIndex: number,
  previousTurns: Turn[],
): TurnReference[] {
  const references: TurnReference[] = [];
  const userText = queryTurn.userText;

  // Extract features from user text
  const userFilePaths = extractFilePaths(userText);
  const userBackrefs = findBackreferences(userText);
  const userErrorFrags = extractErrorFragments(userText);
  const userCodeEntities = extractCodeEntities(userText);

  // Check each previous turn for matches
  for (let i = 0; i < previousTurns.length; i++) {
    const prevTurn = previousTurns[i];
    const prevContent = getAllTurnContent(prevTurn);
    const hopDistance = queryIndex - i;

    // Extract features from previous turn
    const prevFilePaths = extractFilePaths(prevContent);
    const prevErrorFrags = extractErrorFragments(prevContent);
    const prevCodeEntities = extractCodeEntities(prevContent);

    // Check for file path matches
    for (const userPath of userFilePaths) {
      for (const prevPath of prevFilePaths) {
        if (userPath === prevPath || userPath.endsWith(prevPath) || prevPath.endsWith(userPath)) {
          references.push({
            userTurnIndex: queryIndex,
            referencedTurnIndex: i,
            referenceType: 'file-path',
            confidence: 'high',
            evidence: userPath,
            hopDistance,
          });
          break; // One reference per type per turn
        }
      }
    }

    // Check for error fragment matches
    for (const userFrag of userErrorFrags) {
      for (const prevFrag of prevErrorFrags) {
        if (userFrag.includes(prevFrag) || prevFrag.includes(userFrag)) {
          references.push({
            userTurnIndex: queryIndex,
            referencedTurnIndex: i,
            referenceType: 'error-fragment',
            confidence: 'high',
            evidence: userFrag,
            hopDistance,
          });
          break;
        }
      }
    }

    // Check for code entity matches
    for (const userEntity of userCodeEntities) {
      if (prevCodeEntities.includes(userEntity)) {
        references.push({
          userTurnIndex: queryIndex,
          referencedTurnIndex: i,
          referenceType: 'code-entity',
          confidence: 'medium',
          evidence: userEntity,
          hopDistance,
        });
        break;
      }
    }

    // Check for tool output references (if user mentions tool result content)
    const toolResults = getToolResults(prevTurn.assistantBlocks);
    for (const result of toolResults) {
      // Check if user text contains a significant fragment from the tool result
      const resultLines = result.split('\n').filter((l) => l.trim().length > 20);
      for (const line of resultLines.slice(0, 5)) {
        // Check first 5 significant lines
        const fragment = line.trim().slice(0, 40).toLowerCase();
        if (fragment.length > 20 && userText.toLowerCase().includes(fragment)) {
          references.push({
            userTurnIndex: queryIndex,
            referencedTurnIndex: i,
            referenceType: 'tool-output',
            confidence: 'high',
            evidence: fragment,
            hopDistance,
          });
          break;
        }
      }
    }
  }

  // Add explicit backreferences (usually to recent turns)
  if (userBackrefs.length > 0 && previousTurns.length > 0) {
    // Backreferences typically refer to the most recent relevant turn
    // For now, assume they refer to the immediately previous turn
    references.push({
      userTurnIndex: queryIndex,
      referencedTurnIndex: previousTurns.length - 1,
      referenceType: 'explicit-backref',
      confidence: 'medium',
      evidence: userBackrefs[0],
      hopDistance: queryIndex - (previousTurns.length - 1),
    });
  }

  // If no references found and there's an immediately previous turn,
  // add a weak "adjacent" reference (hop distance = 1)
  if (references.length === 0 && previousTurns.length > 0) {
    references.push({
      userTurnIndex: queryIndex,
      referencedTurnIndex: previousTurns.length - 1,
      referenceType: 'adjacent',
      confidence: 'low',
      evidence: 'adjacent',
      hopDistance: 1,
    });
  }

  // Deduplicate references (same turn, same type)
  const seen = new Set<string>();
  return references.filter((ref) => {
    const key = `${ref.referencedTurnIndex}-${ref.referenceType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract all turn-to-turn references from a session.
 */
export async function extractSessionReferences(
  sessionPath: string,
  sessionId: string,
  sessionSlug: string,
): Promise<SessionReferences> {
  const messages = await readSessionMessages(sessionPath);
  const turns = assembleTurns(messages);

  const references: TurnReference[] = [];
  const unreferencedTurns: number[] = [];

  // For each turn (starting from index 1, since turn 0 has no previous context)
  for (let i = 1; i < turns.length; i++) {
    const queryTurn = turns[i];
    const previousTurns = turns.slice(0, i);

    // Skip if user text is empty
    if (!queryTurn.userText.trim()) {
      unreferencedTurns.push(i);
      continue;
    }

    const turnRefs = findReferences(queryTurn, i, previousTurns);

    if (turnRefs.length === 0) {
      unreferencedTurns.push(i);
    } else {
      references.push(...turnRefs);
    }
  }

  return {
    sessionId,
    sessionSlug,
    turnCount: turns.length,
    references,
    unreferencedTurns,
  };
}

/**
 * Session source info.
 */
export interface SessionSource {
  path: string;
  sessionId: string;
  sessionSlug: string;
}

/**
 * Extract references from multiple sessions.
 */
export async function extractReferences(
  sessions: SessionSource[],
  verbose: boolean = true,
): Promise<SessionReferences[]> {
  const results: SessionReferences[] = [];

  for (const session of sessions) {
    try {
      const refs = await extractSessionReferences(
        session.path,
        session.sessionId,
        session.sessionSlug,
      );
      results.push(refs);

      if (verbose) {
        console.log(
          `  ${session.sessionSlug}: ${refs.turnCount} turns, ${refs.references.length} references`,
        );
      }
    } catch (err) {
      if (verbose) {
        console.warn(`  Failed to process ${session.path}: ${err}`);
      }
    }
  }

  return results;
}

/**
 * Compute reference statistics.
 */
export function computeReferenceStats(sessions: SessionReferences[]): {
  totalTurns: number;
  totalReferences: number;
  byType: Record<ReferenceType, number>;
  byConfidence: Record<string, number>;
  avgRefsPerTurn: number;
} {
  let totalTurns = 0;
  let totalReferences = 0;
  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};

  for (const session of sessions) {
    totalTurns += session.turnCount;
    totalReferences += session.references.length;

    for (const ref of session.references) {
      byType[ref.referenceType] = (byType[ref.referenceType] ?? 0) + 1;
      byConfidence[ref.confidence] = (byConfidence[ref.confidence] ?? 0) + 1;
    }
  }

  return {
    totalTurns,
    totalReferences,
    byType: byType as Record<ReferenceType, number>,
    byConfidence,
    avgRefsPerTurn: totalTurns > 0 ? totalReferences / totalTurns : 0,
  };
}
