/**
 * Groups raw messages into conversational Turns.
 *
 * A new turn starts when a user message contains actual text
 * (not just tool_result blocks). Everything between turn boundaries
 * belongs to one turn.
 */

import type {
  ContentBlock,
  RawMessage,
  TextBlock,
  ThinkingBlock,
  ToolExchange,
  ToolResultBlock,
  ToolUseBlock,
  Turn,
} from './types.js';

/**
 * Returns true if a user message represents a new conversational turn
 * (contains actual user-authored text, not just tool results).
 */
function isNewTurnBoundary(msg: RawMessage): boolean {
  if (msg.type !== 'user') return false;
  const content = msg.message?.content;
  if (!content) return false;

  // Simple string content = real user text
  if (typeof content === 'string') return true;

  // Array content: check if any text block has real user text
  // (not system-generated interruption notices)
  for (const block of content) {
    if (block.type === 'text') {
      const text = (block as TextBlock).text.trim();
      if (text && !text.startsWith('[Request interrupted')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract plain text from user message content.
 */
function extractUserText(msg: RawMessage): string {
  const content = msg.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;

  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Extract all content blocks from an assistant message.
 */
function extractAssistantBlocks(msg: RawMessage): ContentBlock[] {
  const content = msg.message?.content;
  if (!content || typeof content === 'string') return [];
  return content as ContentBlock[];
}

/**
 * Build tool exchanges by matching tool_use blocks to their results.
 */
function buildToolExchanges(messages: RawMessage[]): ToolExchange[] {
  const exchanges: ToolExchange[] = [];
  const pendingTools = new Map<string, ToolUseBlock>();

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.content) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            const tu = block as ToolUseBlock;
            pendingTools.set(tu.id, tu);
          }
        }
      }
    }

    if (msg.type === 'user' && msg.message?.content) {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const tr = block as ToolResultBlock;
            const toolUse = pendingTools.get(tr.tool_use_id);
            if (toolUse) {
              exchanges.push({
                toolName: toolUse.name,
                toolUseId: toolUse.id,
                input: toolUse.input,
                result: tr.content,
                isError: tr.is_error ?? false,
              });
              pendingTools.delete(tr.tool_use_id);
            }
          }
        }
      }
    }
  }

  return exchanges;
}

/**
 * Assemble raw messages from an async stream into conversational turns.
 * For memory-efficient processing of large sessions.
 */
export async function assembleTurnsFromStream(
  messages: AsyncGenerator<RawMessage> | AsyncIterable<RawMessage>,
): Promise<Turn[]> {
  const collected: RawMessage[] = [];
  for await (const msg of messages) {
    collected.push(msg);
  }
  return assembleTurns(collected);
}

/**
 * Assemble raw messages into conversational turns.
 */
export function assembleTurns(messages: RawMessage[]): Turn[] {
  const turns: Turn[] = [];
  let currentGroup: RawMessage[] = [];

  function flushGroup(index: number): void {
    if (currentGroup.length === 0) return;

    const firstMsg = currentGroup[0];
    const lastMsg = currentGroup[currentGroup.length - 1];

    const allAssistantBlocks: ContentBlock[] = [];
    for (const msg of currentGroup) {
      if (msg.type === 'assistant') {
        allAssistantBlocks.push(...extractAssistantBlocks(msg));
      }
    }

    const hasThinking = allAssistantBlocks.some(
      (b) => b.type === 'thinking',
    );

    turns.push({
      index,
      startTime: firstMsg.timestamp,
      userText: extractUserText(firstMsg),
      assistantBlocks: allAssistantBlocks,
      toolExchanges: buildToolExchanges(currentGroup),
      hasThinking,
      rawMessages: [...currentGroup],
    });
  }

  for (const msg of messages) {
    if (isNewTurnBoundary(msg)) {
      flushGroup(turns.length);
      currentGroup = [msg];
    } else {
      currentGroup.push(msg);
    }
  }

  // Flush the last group
  flushGroup(turns.length);

  return turns;
}
