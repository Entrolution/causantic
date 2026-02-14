/**
 * Turn-based, code-block-aware chunking.
 *
 * Strategy:
 * 1. Primary boundary: turns (each turn = one user prompt + response cycle)
 * 2. Oversized turns split between tool exchanges or code blocks (never mid-code-block)
 * 3. Trivially small turns merged with neighbors
 * 4. Text rendering with structure markers for embedding
 */

import type {
  Chunk,
  ChunkMetadata,
  RenderMode,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  Turn,
} from './types.js';
import { approximateTokens } from '../utils/token-counter.js';
/** Main UI agent identifier */
export const MAIN_AGENT_ID = 'ui';

/** Human user agent identifier */
export const HUMAN_AGENT_ID = 'human';

export interface ChunkerOptions {
  /** Target max tokens per chunk. Default: 4096. */
  maxTokens?: number;
  /** Minimum tokens before a turn gets merged. Default: 64. */
  minTokens?: number;
  /** Include thinking blocks in rendered text. Default: true. */
  includeThinking?: boolean;
  /** Render mode. Default: 'full'. */
  renderMode?: RenderMode;
  /** Session ID for chunk metadata. */
  sessionId: string;
  /** Session slug for chunk metadata. */
  sessionSlug: string;
}

/**
 * Render a turn to flat text with structure markers.
 */
export function renderTurn(
  turn: Turn,
  mode: RenderMode = 'full',
  includeThinking: boolean = true,
): string {
  const parts: string[] = [];

  // User message
  if (turn.userText) {
    parts.push(`[User]\n${turn.userText}`);
  }

  // Assistant content
  for (const block of turn.assistantBlocks) {
    switch (block.type) {
      case 'thinking':
        if (includeThinking) {
          parts.push(`[Thinking]\n${(block as ThinkingBlock).thinking}`);
        }
        break;
      case 'text':
        parts.push(`[Assistant]\n${(block as TextBlock).text}`);
        break;
      case 'tool_use':
        if (mode === 'full') {
          const tu = block as ToolUseBlock;
          parts.push(`[Tool:${tu.name}]\n${summarizeToolInput(tu)}`);
        }
        break;
    }
  }

  // Tool results
  if (mode === 'full' || mode === 'code-focused') {
    for (const ex of turn.toolExchanges) {
      if (mode === 'code-focused' && !isCodeTool(ex.toolName)) continue;
      const resultPreview = truncateResult(ex.result, 500);
      parts.push(`[Result:${ex.toolName}]\n${resultPreview}`);
    }
  }

  return parts.join('\n\n');
}

function summarizeToolInput(tu: ToolUseBlock): string {
  const input = tu.input;
  // Common patterns
  if ('command' in input) return String(input.command);
  if ('pattern' in input) return String(input.pattern);
  if ('file_path' in input) return String(input.file_path);
  if ('query' in input) return String(input.query);
  if ('url' in input) return String(input.url);
  return JSON.stringify(input).slice(0, 200);
}

function isCodeTool(name: string): boolean {
  return ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'].includes(name);
}

function truncateResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[truncated]';
}

/**
 * Count code blocks in a turn's text content.
 */
function countCodeBlocks(turn: Turn): number {
  let count = 0;
  for (const block of turn.assistantBlocks) {
    if (block.type === 'text') {
      const matches = (block as TextBlock).text.match(/```/g);
      count += matches ? Math.floor(matches.length / 2) : 0;
    }
  }
  return count;
}

/**
 * Split an oversized turn's rendered text at natural boundaries.
 * Splits between tool exchanges or between paragraphs, never mid-code-block.
 */
function splitRenderedText(text: string, maxTokens: number): string[] {
  const tokens = approximateTokens(text);
  if (tokens <= maxTokens) return [text];

  // Try splitting at section markers first
  const sections = text.split(/\n\n(?=\[(?:User|Assistant|Tool|Result|Thinking)\])/);
  if (sections.length <= 1) {
    // Can't split at markers, split at paragraph boundaries
    return splitAtParagraphs(text, maxTokens);
  }

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    const combined = current ? current + '\n\n' + section : section;
    if (approximateTokens(combined) > maxTokens && current) {
      chunks.push(current);
      current = section;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function splitAtParagraphs(text: string, maxTokens: number): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const combined = current ? current + '\n\n' + para : para;
    if (approximateTokens(combined) > maxTokens && current) {
      chunks.push(current);
      current = para;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Chunk turns into embeddable text chunks.
 */
export function chunkTurns(turns: Turn[], options: ChunkerOptions): Chunk[] {
  const {
    maxTokens = 4096,
    minTokens = 64,
    includeThinking = true,
    renderMode = 'full',
    sessionId,
    sessionSlug,
  } = options;

  // First pass: render each turn
  const rendered = turns.map((turn) => ({
    turn,
    text: renderTurn(turn, renderMode, includeThinking),
  }));

  // Second pass: merge small turns, split large turns
  const chunks: Chunk[] = [];
  let mergeBuffer: { turns: Turn[]; text: string } = { turns: [], text: '' };

  function flushBuffer(): void {
    if (!mergeBuffer.text) return;

    const texts = splitRenderedText(mergeBuffer.text, maxTokens);
    for (const text of texts) {
      const turnIndices = mergeBuffer.turns.map((t) => t.index);
      const firstTurn = mergeBuffer.turns[0];
      const lastTurn = mergeBuffer.turns[mergeBuffer.turns.length - 1];

      chunks.push(
        makeChunk(text, {
          sessionId,
          sessionSlug,
          turnIndices,
          startTime: firstTurn.startTime,
          endTime: lastTurn.startTime,
          codeBlockCount: mergeBuffer.turns.reduce((n, t) => n + countCodeBlocks(t), 0),
          toolUseCount: mergeBuffer.turns.reduce((n, t) => n + t.toolExchanges.length, 0),
          hasThinking: mergeBuffer.turns.some((t) => t.hasThinking),
          renderMode,
          approxTokens: approximateTokens(text),
        }),
      );
    }

    mergeBuffer = { turns: [], text: '' };
  }

  for (const { turn, text } of rendered) {
    const tokens = approximateTokens(text);

    if (tokens < minTokens) {
      // Merge with buffer
      const combined = mergeBuffer.text ? mergeBuffer.text + '\n\n' + text : text;
      if (approximateTokens(combined) > maxTokens) {
        flushBuffer();
        mergeBuffer = { turns: [turn], text };
      } else {
        mergeBuffer.turns.push(turn);
        mergeBuffer.text = combined;
      }
    } else if (tokens > maxTokens) {
      // Flush buffer first, then split this turn
      flushBuffer();
      mergeBuffer = { turns: [turn], text };
      flushBuffer();
    } else {
      // Normal sized turn
      if (mergeBuffer.text) {
        const combined = mergeBuffer.text + '\n\n' + text;
        if (approximateTokens(combined) <= maxTokens) {
          mergeBuffer.turns.push(turn);
          mergeBuffer.text = combined;
          continue;
        }
        flushBuffer();
      }
      mergeBuffer = { turns: [turn], text };
    }
  }

  flushBuffer();

  return chunks;
}

let chunkCounter = 0;

function makeChunk(text: string, metadata: ChunkMetadata): Chunk {
  chunkCounter++;
  return {
    id: `${metadata.sessionId}-chunk-${chunkCounter}`,
    text,
    metadata,
  };
}

/** Reset chunk counter (for testing). */
export function resetChunkCounter(): void {
  chunkCounter = 0;
}
